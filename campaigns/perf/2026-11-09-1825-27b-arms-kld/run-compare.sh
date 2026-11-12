#!/usr/bin/env bash
# Compare-all batch for campaigns/perf/2026-11-09-1825-27b-arms-kld (2026-11-11, user request:
# "all tests after each other, like my manual runs, in a single batch, started from a terminal").
#
# One boot per arm, one arm after the other, each with run.sh's full machinery (preflight, boot
# gate, VRAM sampling + boots.jsonl, residency check, KLD selftest, Memory-Fault watcher, resume
# markers):  boot -> residency -> KLD selftest -> KLD fetch (KLD_N prompts) -> perf cells -> stop.
# Then every ORDERED pair of complete KLD fetches is scored against each other (arm-vs-arm, no FP8
# reference needed) -> results/kld-pair-<arm>-vs-<ref>.json + results/kld-matrix.md, + summary + charts.
#
#   arms (ARMS, run in this order; default "d a b c c0 q4kxl e"):
#     d      RedHat-MXFP4        @ sly vLLM 1.11.0 (dflash)      fp8 KV
#     a      Quark-MXFP4 .rad    @ radiance 1.11.0                fp8 KV
#     b      Quark-MXFP4 .rad    @ radiance 1.17.0                fp8 KV   (a-vs-b = engine-version floor)
#     c      IQ4R-L-V4 .rad      @ radiance 1.17.0, spec 7        fp8 KV
#     c0     IQ4R-L-V4 .rad      @ radiance 1.17.0, spec 0        fp8 KV   (c-vs-c0 = spec-decode floor)
#     q4kxl  unsloth UD-Q4_K_XL  @ llama.cpp latest-vulkan        q8_0 KV  (no fp8 KV in llama.cpp)
#     q6k    unsloth UD-Q6_K     @ llama.cpp latest-vulkan        q8_0 KV  (opt-in only: ARMS="... q6k";
#            dropped from the default by the user 2026-11-11)
#     q8     unsloth Q8_0         @ llama.cpp latest-vulkan        q8_0 KV  (opt-in, KLD baseline; ctx 32768,
#            1 seq — 27 GiB weights; only the 10k cell)
#     e      heretic-MXFP4-GPTQ  @ sly 1.8.1 — KLD only, no perf cells
#   all arms: ctx 260000, 2 seqs.  Perf cells (ONLY default): <arm>-10k-tg512-n1, <arm>-100k-tg512-n1.
#   KLD_FP8=1 (optional, LAST): also boot the local FP8 reference, score every arm vs it (kld-<arm>.json)
#             and add it to the matrix as 'fp8'.
#
# Unique output dir per invocation (rule 19): tmp/runs/<RUN_TAG>/{results,tmp}; default RUN_TAG =
# compare-<YYYYmmdd-HHMMSS>. Pin RUN_TAG=<same> to RESUME an interrupted batch (done cells and
# complete KLD fetches are skipped; an incomplete fetch resumes at its missing prompts).
#
# Knobs (env, optional): ARMS  KLD_N (16; 128 = the full calibration set)  REPS (2)  KLD_FP8 (0)
#   ONLY  RUN_TAG  + every run.sh pin (IMAGE, IMG_RAD_BC, RAD_IQRV4, GGUF_Q4KXL, GGUF_Q6K, LLAMA_BIN, ...)
# Requires: a plain terminal, port 8000 FREE (stop the local sly-27b / any model server first),
#   GPU idle — the boot gate refuses a boot otherwise (waits FLOOR_WAIT s, then the arm is skipped).
# Time INFERRED (not measured as a batch): per arm boot ~1-8 min + 2 cells x REPS + KLD_N x 512
#   generated tokens; MEASURED first batch 2026-11-11: ~5-6 min per arm (warm caches, KLD_N=16).
#
#   ./run-compare.sh                                   # everything, defaults
#   ARMS="c c0 q4kxl" KLD_N=32 ./run-compare.sh        # a subset
#   RUN_TAG=compare-20261111-140000 ./run-compare.sh   # resume
set -uo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ARMS="${ARMS:-d a b c c0 q4kxl e}"
for _a in $ARMS; do
  case "$_a" in d|a|b|c|c0|q4kxl|q6k|q8|e) ;; *) echo "unknown arm '$_a' (only: d a b c c0 q4kxl q6k q8 e)" >&2; exit 1 ;; esac
done
RUN_TAG="${RUN_TAG:-compare-$(date +%Y%m%d-%H%M%S)}"
export RUN_TAG
export KLD_N="${KLD_N:-16}"
export REPS="${REPS:-2}"
KLD_FP8="${KLD_FP8:-0}"
if [ -z "${ONLY:-}" ]; then
  _o=""; for _a in $ARMS; do
    case "$_a" in e) ;; q8) _o="$_o,q8-10k-tg512-n1" ;;   # q8: ctx 32768 -> no 100k cell
      *) _o="$_o,$_a-10k-tg512-n1,$_a-100k-tg512-n1" ;; esac; done
  ONLY="${_o#,}"; [ -n "$ONLY" ] || ONLY='none'   # only arm e selected: no perf cells
fi
export ONLY
WS_NO_MAIN=1
# shellcheck source=run.sh
source "$HERE/run.sh"   # definitions + preflight (RUN_TAG-aware dirs are set there)

arm_e () {  # heretic: KLD only (no perf cells), skipped when its fetch is already complete
  if kld_complete "$RES/kld-e.jsonl" swift-1.5 "$IMG_SLY_E"; then echo "  skip (done): arm e — KLD fetch complete"; return 0; fi
  start_server e-heretic-sly181 8192 fp8 0 1 || return 1
  kld_selftest sly swift-1.5
  if [ -f "$RAW/done/kld-selftest-sly" ]; then
    kld_fetch swift-1.5 "$RES/kld-e.jsonl" "$IMG_SLY_E"
  else
    echo "  KLD fetch skipped for arm e (selftest failed)"
  fi
  stop_server
}

ensure_fixtures 'codereview-10000.txt' 'codereview-100000.txt'
echo "=== compare batch: arms [$ARMS], cells [10k,100k] x tg512 x n1, REPS=$REPS, KLD_N=$KLD_N, KLD_FP8=$KLD_FP8"
echo "    unique dir: $RUN_DIR  (results: $RES)"
for _a in $ARMS; do
  echo; echo "=================== arm $_a ($(date +%H:%M:%S)) ==================="
  case "$_a" in
    d)     arm_d ;;
    a)     arm_rad a  "$IMG_RAD_A"  "$RAD_MXFP4" qwen38-27b-mxfp4 ;;
    b)     arm_rad b  "$IMG_RAD_BC" "$RAD_MXFP4" qwen38-27b-mxfp4 ;;
    c)     arm_rad c  "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 ;;
    c0)    arm_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0 ;;   # spec-off
    q4kxl) arm_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-ud-q4kxl ;;
    q6k)   arm_llama q6k   "$GGUF_Q6K"   qwen38-27b-ud-q6k ;;
    q8)    LLAMA_CTX=32768 LLAMA_NP=1 arm_llama q8 "$GGUF_Q8" qwen38-27b-q8 ;;   # KLD baseline
    e)     arm_e ;;
  esac || echo "  arm $_a did not complete (see $RES/failures.txt) — continuing with the next arm"
done
if [ "$KLD_FP8" = 1 ]; then
  echo; echo "=================== optional: FP8 reference ($(date +%H:%M:%S)) ==================="
  kld_ref_ensure || true
  kld_score_all q4kxl q6k e
fi
echo; echo "=================== pairwise KLD ==================="
kld_score_pairs $ARMS
print_summary
make_report
echo "compare batch done. dir: $RUN_DIR   matrix: $RES/kld-matrix.md   failures: $RES/failures.txt"
echo "resume this batch: RUN_TAG=$RUN_TAG $0"
[ -f "$RES/skipped.txt" ] && { echo "--- guard-skipped (over budget) ---"; cat "$RES/skipped.txt"; } || true
