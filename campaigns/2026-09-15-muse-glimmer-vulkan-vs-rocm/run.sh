#!/usr/bin/env bash
# Campaign driver — Muse-Glimmer-30B + DFlash drafter: Vulkan vs ROCm THROUGH llama-swap (:9292).
#
# Hand-written exception per iron rule 6: gen_campaign.py cannot emit this lifecycle (its run.sh
# hardcodes serve_llamacpp.sh start/stop; here the operator starts each backend in llama-swap
# manually and this script only probes). Every probe reuses bench/engine-bench/run.sh
# (capture_engine.py + vram_sampler.py) — nothing measurement-related is reimplemented.
# Recommended tool follow-up: teach gen_campaign.py a `source: llama-swap` server mode.
#
# Usage:  bash run.sh {vulkan|rocm}
#   The matching model must ALREADY be loaded in llama-swap (README.md has the exact curl
#   commands). Resumable: per-depth markers in done/ — re-run to retry just the missing depths.
# Knobs: REPS=1 quick pass · MAX_TOKENS= · PREFIX_MODE= · API=  (override the defaults)
set -uo pipefail
ROOT="${ROOT:-/home/dev/work/dp-craft/amd}"
CAMPAIGN_DIR="${CAMPAIGN_DIR:-$ROOT/bench/runs/2026-09-15-muse-glimmer-vulkan-vs-rocm}"
EB="$ROOT/bench/engine-bench"
WL="$ROOT/bench/workloads"
GEN="$WL/generated"
LS_URL="http://127.0.0.1:9292"

BACKEND="${1:-}"
# 2x2 factorial (expanded 2026-09-15 after the first vulkan pass ran b10969 via latest-vulkan):
#   {vulkan, rocm} x {b10969 upstream 391fac1, stew675}. The two as-deployed arms (vulkan, rocm)
#   already have data; each build gets its own arm label so results.jsonl rows stay attributable
#   to a build (rule 2) and done/ markers never collide. Symlink flips are the operator's job
#   (README.md); run.sh records the RESOLVED binary per pass and warns if it is not the expected
#   build for that arm — record beats assert, so whatever ran is what the data shows.
case "$BACKEND" in
  vulkan)         MODEL_ID="muse-glimmer-30b-q5kl-f16-ctx128k-dflash";      EXPECTED_BUILD="b10969" ;;
  rocm)           MODEL_ID="muse-glimmer-30b-q5kl-f16-ctx128k-dflash-rocm"; EXPECTED_BUILD="stew675" ;;
  rocm2)           MODEL_ID="muse-glimmer-30b-q5kl-f16-ctx128k-dflash-rocm"; EXPECTED_BUILD="ROCM-lemonade" ;;
  vulkan-stew675) MODEL_ID="muse-glimmer-30b-q5kl-f16-ctx128k-dflash";      EXPECTED_BUILD="stew675" ;;
  rocm-b10969)    MODEL_ID="muse-glimmer-30b-q5kl-f16-ctx128k-dflash-rocm"; EXPECTED_BUILD="b10969" ;;
  *) echo "usage: bash run.sh {vulkan|rocm|vulkan-stew675|rocm-b10969}   (model must already be loaded in llama-swap — README.md)" >&2; exit 2 ;;
esac

DEPTHS=(8192 32768 65536 98304)
REPS="${REPS:-2}"                 # timed reps per depth (untimed warmup is always 1 — Vulkan compiles shaders on first prefill)
MAX_TOKENS="${MAX_TOKENS:-512}"
PREFIX_MODE="${PREFIX_MODE:-unique}"   # uuid prefix = cold prefill per rep, defeats the cache
API="${API:-chat}"
FREE_VRAM_FLOOR_MIB="${FREE_VRAM_FLOOR_MIB:-4096}"

mkdir -p "$CAMPAIGN_DIR/done"
if [ ! -f "$CAMPAIGN_DIR/meta.txt" ]; then
  { echo "date=$(date -Iseconds)"
    echo "campaign=muse-glimmer-vulkan-vs-rocm (served via llama-swap :9292, backends started manually by operator)"
    echo "model=/home/dev/models/gguf/unsloth/Muse-Glimmer-30B-UD-Q5_K_L.gguf + /home/dev/models/gguf/unsloth/dflash-kquant.gguf (drafter)"
    echo "builds=matched stew675 (vulkan arm pinned in the llama-swap config by operator; actual per-pass binary recorded in server_binary lines below)"
    echo "tuning=ub2048 b4096 faon ctx131072 kv=f16 np1 kv_unified spec=draft-dflash n_max15 p_min0.4 temp1.0 top_p0.95 top_k64"
    echo "vram_predicted_mib=29064 (weights 19.93 GiB incl drafter + 131072 x 52 KiB/tok f16 + 2000 overhead)"
  } > "$CAMPAIGN_DIR/meta.txt"
fi

ensure_fixtures () {  # same codereview recipe as gen_campaign.py's ensure_fixtures
  local name n
  for name in "$@"; do
    [ -f "$GEN/$name" ] && continue
    echo ">>> building missing fixture: $name"
    n="${name#codereview-}"; n="${n%.txt}"
    python3 "$WL/build_prompt.py" --task "$WL/tasks/codereview-large.task.md" \
      --src "$WL/corpus/ts-agentic-code-runner" --src "$WL/corpus/py-rich" \
      --target-tokens "$n" --out "$GEN/$name" || { echo "FIXTURE-BUILD-FAILED: $name" >&2; exit 1; }
    [ -f "$GEN/$name" ] || { echo "FIXTURE-BUILD-FAILED: $name" >&2; exit 1; }
  done; }
ensure_fixtures codereview-8192.txt codereview-32768.txt codereview-65536.txt codereview-98304.txt

# --- readiness: right model, from the right build, READY — before we spend GPU minutes (iron rule 14) ---
running="$(curl -sf -m 5 "$LS_URL/running")" || { echo "llama-swap not reachable at $LS_URL" >&2; exit 1; }
echo "$running" | grep -q "\"model\":\"$MODEL_ID\"" \
  || { echo "MODEL-NOT-LOADED: '$MODEL_ID' is not loaded in llama-swap." >&2
       echo "Start it first (README.md, or): curl -sN --max-time 700 -X POST $LS_URL/v1/chat/completions" \
             " -H 'Content-Type: application/json' -d '{\"model\":\"$MODEL_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":8}'" >&2
       exit 1; }
echo "$running" | grep -q "\"state\":\"ready\"" \
  || { echo "MODEL-STILL-LOADING: '$MODEL_ID' is not ready yet — wait for llama-swap to finish loading, then re-run." >&2; exit 1; }
# Which binary did the loaded server actually start from? Record it (rule 2) and warn if this
# arm is not on the matched stew675 tree. The cmd path may be a symlink (build/latest-*), so
# RESOLVE it before matching — 2026-09-15: the first vulkan pass ran b10969 via latest-vulkan
# and only the literal string was checked, which would have passed a symlink pin silently.
bin_path="$(MODEL_ID="$MODEL_ID" python3 -c 'import json, os, sys
d = json.load(sys.stdin)
m = [x for x in d.get("running", []) if x.get("model") == os.environ["MODEL_ID"]]
print(m[0]["cmd"].split()[0] if m else "")' <<<"$running" 2>/dev/null)"
bin_resolved="$(readlink -f "${bin_path:-/nonexistent}" 2>/dev/null || echo "${bin_path:-unknown}")"
echo "  server binary: ${bin_path:-unknown} -> ${bin_resolved}"
case "$bin_resolved" in *"$EXPECTED_BUILD"*) : ;; *) echo "  WARNING: arm '$BACKEND' should run a $EXPECTED_BUILD build but resolved to: $bin_resolved — flip the symlink (README.md) and reload before trusting this pass." >&2 ;; esac
echo "backend=$BACKEND model_id=$MODEL_ID server_binary=${bin_path:-unknown} resolved=${bin_resolved} started=$(date -Iseconds)" >> "$CAMPAIGN_DIR/meta.txt"
free_mib="$(rocm-smi --showmeminfo vram 2>/dev/null | awk -F': ' \
  '/VRAM Total Memory \(B\)/{t=$NF} /VRAM Total Used Memory \(B\)/{u=$NF} END{if (t && u) printf "%d", (t-u)/1048576}')"
[ "${free_mib:-0}" -ge "$FREE_VRAM_FLOOR_MIB" ] \
  || { echo "VRAM-FLOOR: only ${free_mib:-?} MiB free (< $FREE_VRAM_FLOOR_MIB) — a stray process is holding VRAM (iron rule 14). Fix and re-run." >&2; exit 1; }
echo "ready: $MODEL_ID (binary ${bin_path:-unknown}), free VRAM ${free_mib} MiB"

for d in "${DEPTHS[@]}"; do
  slug="muse-${BACKEND}-d${d}"
  [ -f "$CAMPAIGN_DIR/done/$slug" ] && { echo "  skip (done): $slug"; continue; }
  echo ">>> probe $slug (prompt ${d} tok, reps=$REPS, max_tokens=$MAX_TOKENS, prefix=$PREFIX_MODE)"
  if PROMPT_FILE="$GEN/codereview-${d}.txt" SLUG="$slug" MAX_TOKENS="$MAX_TOKENS" CONCURRENCY=1 \
       REPS="$REPS" WARMUP=1 API="$API" PREFIX_MODE="$PREFIX_MODE" SAMPLE_VRAM=1 \
       ENGINES_LIST="muse-${BACKEND}|$LS_URL/v1|$MODEL_ID" bash "$EB/run.sh"; then
    rd="$(ls -td "$ROOT"/bench/runs/*-engine-"$slug" 2>/dev/null | head -1)"
    if [ -n "$rd" ] && [ -f "$rd/results.jsonl" ]; then
      cat "$rd/results.jsonl" >> "$CAMPAIGN_DIR/results.jsonl"
      cp "$rd"/props_*.json "$CAMPAIGN_DIR/" 2>/dev/null   # server self-description (build info, rule 2)
    fi
    if [ -n "${rd:-}" ] && python3 - "$rd/results.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
agg = [r for r in rows if r.get("kind") == "aggregate"]
sys.exit(0 if any(a.get("n_err", 1) == 0 for a in agg) else 1)
PY
    then touch "$CAMPAIGN_DIR/done/$slug"
    else echo "FAILED(no clean aggregate — all reps errored): $slug" | tee -a "$CAMPAIGN_DIR/failures.txt"; fi
  else
    echo "FAILED: $slug (probe runner exited nonzero; re-run to retry just this depth)" | tee -a "$CAMPAIGN_DIR/failures.txt"
  fi
done

echo
echo "== $BACKEND pass complete =="
echo "  depths done for $BACKEND: $(ls "$CAMPAIGN_DIR/done/" | grep -c "^muse-${BACKEND}-d")/${#DEPTHS[@]}"
case "$BACKEND" in
  vulkan|rocm) echo "  remaining arms: bash $0 {vulkan-stew675|rocm-b10969} — flip the matching latest-* symlink first (README.md)" ;;
  *)           echo "  LAST STEP — restore that arm's symlink and reload your usual model (README.md final step)." ;;
esac
