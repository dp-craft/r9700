#!/usr/bin/env bash
# Forced batch for campaigns/perf/2026-11-09-1825-27b-arms-kld (2026-11-12, user decisions: "q8 should be the
# baseline", "2 ok f16", "3 option B teacher-forced", "4 KLD_N=128", 32 evenly spaced positions, "e depth curve
# yes", "Dflash/MTP: if cheap then measure", calibration v2 "Stop, fix, restart"). Hand-written driver like run-compare.sh (no gen_campaign kind
# covers a multi-engine KLD batch); all machinery comes from run.sh (sourced, WS_NO_MAIN=1).
#
# Prompts: inputs/calibration-v2-prompts.jsonl (bench/perf/kld_calibration.py: mid-text cuts — v1's whole files made
#    the model stop at once on 78/128 prompts — 90 code / 14 prose / 24 chat turns in the production template).
# 1. q8   unsloth Q8_0 @ llama.cpp latest-vulkan, f16 KV, ctx 32768, 1 seq: GREEDY fetch (KLD_N prompts x 512
#         tokens) = the reference, + depth cells 10k/20k.
# 2. every later arm: TEACHER-FORCED fetch on q8's greedy continuation (kld_probe.py forced: prompt + the first i
#    reference tokens, max_tokens 1, top-20, KLD_POSITIONS evenly spaced i per prompt) -> every arm is scored at the
#    SAME positions, so the KL means are comparable across arms. Spec decoding is invisible here (max_tokens 1).
#      q8f    q8 again, KLD only                                  -> engine/boot floor of the method
#      d      RedHat-MXFP4 @ sly 1.11.0, DFlash k=7 (arm D)        + depth cells 10k/20k/50k/100k
#      d0     d without DFlash (profile sly-redhat/redhat-mxfp4)   + depth cells
#      dfh    d0 with a full-precision lm head (sly-redhat/redhat-mxfp4-fullhead), KLD only, ctx 8192
#      d0f    d0 again (fresh boot), KLD only                     -> vLLM boot noise floor (2026-11-12)
#      bf     b again (fresh boot), KLD only                      -> radiance boot noise floor (2026-11-12)
#      d181   d on the OLD sly 1.8.1 image (IMG_SLY_E), KLD only  -> engine effect, de-confounds e vs d (round 2)
#      q6kf16 q6k with f16 KV, ctx 32768, 1 seq (the reference's KV/ctx), KLD only -> weights-only Q6 (round 3)
#      q4kxlf16 q4kxl the same way, KLD only                      -> weights-only Q4_K_XL; vs q4kxl = q8_0-KV cost
#      q8i    q8 greedy WITH prompt ids (KLD_PROMPT_IDS=1) into kld-q8i.jsonl: an id-carrying reference for
#             later batches (KLD_REF=$RES/kld-q8i.jsonl); not mixed with the published q8 reference
#      a b c c0 q4kxl q6k   as in run-compare.sh                 + depth cells
#      q4mtp  q4kxl with MTP=1, KLD only: a GREEDY fetch of the first DIAG_N prompts
#    DIAG_ARMS (d d0 c c0 q4kxl) also get a greedy fetch of the first DIAG_N prompts (kld-<arm>-greedy.jsonl):
#    spec on vs off on free-running output -> the DFlash (d/d0, c/c0) and MTP (q4mtp/q4kxl) effect on quality.
#      e      heretic @ sly 1.8.1, KLD only
# 3. scores: kld-forced-<stamp>.d/kld-forced-<arm>-vs-q8.json + kld-diag-<stamp>.d/kld-diag-<on>-vs-<off>.json.
#
# Knobs: ARMS (default all above, q8 first)  KLD_N (128)  KLD_POSITIONS (32)  DIAG_N (16)  DIAG_ARMS  KLD_CAL
#   REPS (2)  RUN_TAG (forced-<stamp>; pin it to RESUME)  + every run.sh pin.
# Requires a plain terminal, port 8000 free, GPU idle (the boot gate refuses otherwise).
set -uo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ARMS="${ARMS:-q8 q8f d d0 dfh a b c c0 q4kxl q4mtp q6k e}"
for _a in $ARMS; do
  case "$_a" in q8|q8i|q8f|d|d0|d0f|d181|dfh|a|b|bf|c|c0|q4kxl|q4kxlf16|q4mtp|q6k|q6kf16|e) ;;
    *) echo "unknown arm '$_a' (only: q8 q8i q8f d d0 d0f d181 dfh a b bf c c0 q4kxl q4kxlf16 q4mtp q6k q6kf16 e)" >&2; exit 1 ;; esac
done
RUN_TAG="${RUN_TAG:-forced-$(date +%Y%m%d-%H%M%S)}"; export RUN_TAG
export KLD_N="${KLD_N:-128}" REPS="${REPS:-2}" DEPTH=1
export DIAG_N="${DIAG_N:-16}" DIAG_ARMS="${DIAG_ARMS:-d d0 c c0 q4kxl}"
export KLD_CAL="${KLD_CAL:-$HERE/inputs/calibration-v2-prompts.jsonl}"
if [ -z "${ONLY:-}" ]; then
  _o=""; for _a in $ARMS; do
    case "$_a" in
      q8f|q8i|d0f|d181|dfh|bf|q4mtp|q6kf16|q4kxlf16|e) ;;                         # KLD only
      q8) _o="$_o,q8-10k-tg512-n1,q8-20k-tg512-n1" ;;                        # ctx 32768
      *)  _o="$_o,$_a-10k-tg512-n1,$_a-20k-tg512-n1,$_a-50k-tg512-n1,$_a-100k-tg512-n1" ;;
    esac; done
  ONLY="${_o#,}"; [ -n "$ONLY" ] || ONLY='none'
fi
export ONLY
WS_NO_MAIN=1
# shellcheck source=run.sh
source "$HERE/run.sh"
REF="${KLD_REF:-$RES/kld-q8.jsonl}"   # KLD_REF: force on another reference (e.g. kld-q8i.jsonl, with ids)

arm_sly_kld () {  # arm boot_name ctx np served [cells: 1|0] — a sly arm outside arm_d
  local arm=$1 name=$2 ctx=$3 np=$4 served=$5 cells=${6:-0}
  local all="${SLUG_R1//x-/$arm-}" sel=""
  [ "$cells" = 1 ] && sel=$(selected_slugs $all)
  if { [ -z "$sel" ] || ! server_needed $sel; } && kld_complete "$RES/kld-$arm.jsonl" "$served" "$IMAGE" \
     && kld_diag_complete "$arm" "$served" "$IMAGE"; then
    echo "  skip (done): arm $arm"; return 0; fi
  start_server "$name" "$ctx" fp8 0 "$np" || return 1
  kld_selftest sly "$served"
  if [ -f "$RAW/done/kld-selftest-sly" ]; then
    kld_fetch "$served" "$RES/kld-$arm.jsonl" "$IMAGE"
    kld_diag_fetch "$arm" "$served" "$IMAGE"
  else
    echo "  KLD fetch skipped for arm $arm (selftest failed)"
  fi
  if [ -n "$sel" ]; then export ENGINES_LIST="vllm-sly-$arm|http://localhost:8000/v1|$served"; arm_cells "$arm"; fi
  stop_server
}

arm_e () {  # heretic: KLD only
  if kld_complete "$RES/kld-e.jsonl" swift-1.5 "$IMG_SLY_E"; then echo "  skip (done): arm e"; return 0; fi
  start_server e-heretic-sly181 8192 fp8 0 1 || return 1
  kld_selftest sly swift-1.5
  if [ -f "$RAW/done/kld-selftest-sly" ]; then kld_fetch swift-1.5 "$RES/kld-e.jsonl" "$IMG_SLY_E"
  else echo "  KLD fetch skipped for arm e (selftest failed)"; fi
  stop_server
}

score_diag () {  # label off_file on_file — KL(spec off ‖ spec on), both greedy DIAG_N and complete -> $DIAG_DIR
  local label=$1 bf=$2 af=$3
  if [ ! -f "$bf" ] || [ ! -f "$af" ]; then echo "  KLD diag $label: not in this batch (fetch absent)"; return 0; fi
  if ! KLD_FORCED_REF='' KLD_N=$DIAG_N kld_complete "$bf" || ! KLD_FORCED_REF='' KLD_N=$DIAG_N kld_complete "$af"; then
    echo "KLD DIAG SKIPPED: $label (base or arm greedy fetch incomplete/absent)" | tee -a "$RES/failures.txt"; return 0; fi
  [ -n "${DIAG_DIR:-}" ] || { DIAG_DIR=$(fresh_file "$RES/kld-diag-$(date +%Y%m%d-%H%M%S).d"); mkdir -p "$DIAG_DIR"; }
  python3 "$KLD" score --ref "$bf" --arm "$af" --label "$label" --ref-label "$(basename "$bf" .jsonl)" \
    --out "$DIAG_DIR/kld-diag-$label.json" || echo "KLD DIAG SCORE FAILED: $label" | tee -a "$RES/failures.txt"
}

ensure_fixtures 'codereview-10000.txt' 'codereview-20000.txt' 'codereview-50000.txt' 'codereview-100000.txt'
echo "=== forced batch: arms [$ARMS], KLD_N=$KLD_N x $KLD_POSITIONS forced positions, DIAG_N=$DIAG_N [$DIAG_ARMS q4mtp], REPS=$REPS"
echo "    calibration: $KLD_CAL"
echo "    unique dir: $RUN_DIR  (results: $RES)"
for _a in $ARMS; do
  echo; echo "=================== arm $_a ($(date +%H:%M:%S)) ==================="
  # the reference is greedy; every other arm is forced on it
  if [ "$_a" = q8 ] || [ "$_a" = q8i ]; then KLD_FORCED_REF=''; else KLD_FORCED_REF="$REF"; fi
  case "$_a" in
    q8)    LLAMA_KV=f16 LLAMA_CTX=32768 LLAMA_NP=1 arm_llama q8 "$GGUF_Q8" qwen38-27b-q8 ;;
    q8i)   KLD_ONLY=1 KLD_PROMPT_IDS=1 LLAMA_KV=f16 LLAMA_CTX=32768 LLAMA_NP=1 arm_llama q8i "$GGUF_Q8" qwen38-27b-q8 ;;
    q8f)   KLD_ONLY=1 LLAMA_KV=f16 LLAMA_CTX=32768 LLAMA_NP=1 arm_llama q8f "$GGUF_Q8" qwen38-27b-q8 ;;
    d)     arm_d ;;
    d0)    arm_sly_kld d0 d0-redhat-sly1100 110000 2 qwen38-27b-redhat-mxfp4-sly 1 ;;
    d0f)   arm_sly_kld d0f d0-redhat-sly1100 110000 2 qwen38-27b-redhat-mxfp4-sly ;;   # vLLM floor: d0 re-boot
    dfh)   arm_sly_kld dfh dfh-redhat-sly1100 8192 1 qwen38-27b-redhat-mxfp4-fullhead ;;
    a)     arm_rad a  "$IMG_RAD_A"  "$RAD_MXFP4" qwen38-27b-mxfp4 ;;
    b)     arm_rad b  "$IMG_RAD_BC" "$RAD_MXFP4" qwen38-27b-mxfp4 ;;
    bf)    KLD_ONLY=1 arm_rad bf "$IMG_RAD_BC" "$RAD_MXFP4" qwen38-27b-mxfp4 ;;     # radiance floor: b re-boot
    c)     arm_rad c  "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 ;;
    c0)    arm_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0 ;;
    q4kxl) arm_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-ud-q4kxl ;;
    q4mtp) KLD_FORCED_REF='' KLD_N=$DIAG_N KLD_ONLY=1 LLAMA_MTP=1 arm_llama q4mtp "$GGUF_Q4KXL" qwen38-27b-ud-q4kxl-mtp ;;
    q6k)   arm_llama q6k "$GGUF_Q6K" qwen38-27b-ud-q6k ;;
    q6kf16)   KLD_ONLY=1 LLAMA_KV=f16 LLAMA_CTX=32768 LLAMA_NP=1 arm_llama q6kf16 "$GGUF_Q6K" qwen38-27b-ud-q6k ;;
    q4kxlf16) KLD_ONLY=1 LLAMA_KV=f16 LLAMA_CTX=32768 LLAMA_NP=1 arm_llama q4kxlf16 "$GGUF_Q4KXL" qwen38-27b-ud-q4kxl ;;
    d181)  IMAGE="$IMG_SLY_E" arm_sly_kld d181 d-redhat-sly1100 "$D_CTX" 2 qwen38-27b-redhat-mxfp4-dflash ;;  # d @ sly 1.8.1
    e)     arm_e ;;
  esac || echo "  arm $_a did not complete (see $RES/failures.txt) — continuing with the next arm"
done
KLD_FORCED_REF=''

echo; echo "=================== KLD scores ==================="
_f=""; for _a in $ARMS; do case "$_a" in q8|q8i|q4mtp) ;; *) _f="$_f $_a" ;; esac; done
# shellcheck disable=SC2086  # $_f is the arm list
kld_score_forced q8 "$REF" $_f
DIAG_DIR=""
score_diag d-vs-d0       "$RES/kld-d0-greedy.jsonl"    "$RES/kld-d-greedy.jsonl"     # DFlash on sly
score_diag c-vs-c0       "$RES/kld-c0-greedy.jsonl"    "$RES/kld-c-greedy.jsonl"     # DFlash2 on radiance
score_diag q4mtp-vs-q4kxl "$RES/kld-q4kxl-greedy.jsonl" "$RES/kld-q4mtp.jsonl"       # MTP on llama.cpp
print_summary
make_report
echo "forced batch done. dir: $RUN_DIR   failures: $RES/failures.txt"
echo "resume this batch: RUN_TAG=$RUN_TAG $0"
[ -f "$RES/skipped.txt" ] && { echo "--- guard-skipped (over budget) ---"; cat "$RES/skipped.txt"; } || true
