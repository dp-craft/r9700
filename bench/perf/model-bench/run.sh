#!/usr/bin/env bash
# model-bench — single-engine tuning microscope via llama.cpp `llama-bench`.
# Sweeps knobs (comma-separated values are swept by llama-bench in one invocation), holds the rest
# fixed, emits canonical JSON into a campaign dir: raw (stderr, logs, GPU samples) ->
# $CAMPAIGN_DIR/tmp/<stamp>-model-<slug>/, results (llama-bench.json / batched-bench.json, meta.txt) ->
# $CAMPAIGN_DIR/results/<stamp>-model-<slug>/. Vendor-neutral: AMD/NVIDIA detected via
# stack/gpu/gpu_env.sh — on NVIDIA just point LLAMA_BENCH at a CUDA build.
#
# Usage:
#   CAMPAIGN_DIR=campaigns/perf/<stamp>-<slug> MODEL=/home/dev/models/gguf/Qwen3.6-27B-Q4_K_S.gguf SLUG=27b-ubsweep ./run.sh
#   NPL=2 PP=32768 TG=2048 CAMPAIGN_DIR=… MODEL=… ./run.sh    # N concurrent requests: llama-batched-bench from the same bin/
#
# For the ADAPTIVE optimum search (expands the grid until the peak is interior), use ./sweep.py.
# Override any knob via env (defaults below). See ./README.md for the full menu.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
USAGE="usage: CAMPAIGN_DIR=campaigns/<type>/<stamp>-<slug> MODEL=/path/to/model.gguf [SLUG=…] $0"
[ -n "${CAMPAIGN_DIR:-}" ] || { echo "CAMPAIGN_DIR is not set — $USAGE" >&2; exit 2; }
CAMPAIGN_DIR="$(realpath -m "$CAMPAIGN_DIR")"

# --- environment (vendor-aware) ---
source "$REPO/stack/gpu/gpu_env.sh"
gpu_setup_env
# ROCm build by default; Vulkan: LLAMA_BENCH=$REPO/stack/llamacpp/var/builds/latest-vulkan/bin/llama-bench
# NVIDIA/other: LLAMA_BENCH=/path/to/cuda-build/llama-bench
: "${LLAMA_BENCH:=$REPO/stack/llamacpp/var/builds/latest-rocm/bin/llama-bench}"
: "${MODEL:?set MODEL=/path/to/model.gguf — $USAGE}"
: "${SLUG:=modelbench}"

# --- sweep knobs (comma-separated = swept) ---
: "${PP:=512,2048,8192}"      # prefill prompt sizes (tokens)
: "${TG:=128}"                # decode tokens
: "${DEPTH:=0}"               # context depth for pp/tg tests (-d) — measure AT 32768/65536 etc.
: "${NGL:=99}"                # GPU layers
: "${FA:=on}"                 # flash attention: on|off|auto (legacy 0/1 also accepted)
: "${UB:=512,1024,2048}"      # micro-batch (-ub)
: "${BATCH:=2048}"            # logical batch (-b)
: "${CTK:=f16}"               # KV key type   — f16 is the BASELINE; q8_0 must earn its place
: "${CTV:=f16}"               # KV value type   via an explicit A/B (see sweep.py / GUIDE)
: "${REPS:=3}"                # repetitions (stddev)
: "${PG:=}"                   # request shapes "P,G P,G" → one -pg test each (P prompt then G generated, timed together)
: "${WARMUP:=1}"              # 0 = --no-warmup (llama-bench's warmup re-runs every test's prompt in full)
: "${NPL:=}"                  # N concurrent sequences → llama-batched-bench -npl N (single PP/TG; DEPTH/REPS/PG unused)
: "${VRAM_SAMPLE:=1}"         # 1 = sample VRAM/power to gpu_samples.csv during the run

[ -x "$LLAMA_BENCH" ] || { echo "llama-bench not found/executable: $LLAMA_BENCH" >&2; exit 1; }
[ -f "$MODEL" ]       || { echo "model not found: $MODEL" >&2; exit 1; }
if [ -n "$NPL" ]; then
  BATCHED="$(dirname "$LLAMA_BENCH")/llama-batched-bench"
  [ -x "$BATCHED" ] || { echo "llama-batched-bench not found next to $LLAMA_BENCH" >&2; exit 1; }
  case "$NPL$PP$TG" in *[!0-9]*)
    echo "NPL mode needs single integer PP/TG/NPL (got PP=$PP TG=$TG NPL=$NPL)" >&2; exit 1 ;; esac
fi

STAMP="$(date '+%Y-%m-%d-%H%M')"
OUT="$CAMPAIGN_DIR/results/${STAMP}-model-${SLUG}"   # results: meta.txt + llama-bench.json / batched-bench.json
RAW="$CAMPAIGN_DIR/tmp/${STAMP}-model-${SLUG}"       # raw: llama-bench.err, batched-bench.log, gpu_samples.csv
mkdir -p "$OUT" "$RAW"

# Record exact invocation + environment for reproducibility (iron rule #2).
{
  echo "date=$(date -Iseconds)"
  echo "host=$(uname -a)"
  gpu_meta
  echo "llama_bench=$LLAMA_BENCH"
  echo "model=$MODEL"
  echo "knobs: PP=$PP TG=$TG DEPTH=$DEPTH NGL=$NGL FA=$FA UB=$UB BATCH=$BATCH CTK=$CTK CTV=$CTV REPS=$REPS PG='$PG' WARMUP=$WARMUP NPL=$NPL"
} > "$OUT/meta.txt"

SAMPLER_PID=""
if [ "$VRAM_SAMPLE" = "1" ]; then
  python3 "$REPO/stack/gpu/vram_sampler.py" --out "$RAW/gpu_samples.csv" --interval 1 &
  SAMPLER_PID=$!
fi
cleanup() { [ -n "$SAMPLER_PID" ] && kill "$SAMPLER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if [ -n "$NPL" ]; then
  # every sequence holds its own prompt + generation (no shared prompt) → ctx = NPL × (PP + TG)
  set -x
  "$BATCHED" -m "$MODEL" -c "$(( NPL * (PP + TG) ))" -npp "$PP" -ntg "$TG" -npl "$NPL" \
    -ngl "$NGL" -fa "$FA" -ub "$UB" -b "$BATCH" -ctk "$CTK" -ctv "$CTV" > "$RAW/batched-bench.log" 2>&1
  set +x
  "$BATCHED" --version 2>&1 | grep -m1 '^version:' >> "$OUT/meta.txt" || true
  # Markdown result rows → canonical JSON (older builds have no --output-format jsonl).
  python3 - "$OUT" "$RAW" <<'EOF'
import json, re, sys
out, raw = sys.argv[1], sys.argv[2]
keys = ["pp", "tg", "pl", "n_kv", "t_pp", "speed_pp", "t_tg", "speed_tg", "t", "speed"]
rows = []
for line in open(f"{raw}/batched-bench.log", errors="replace"):
    if re.match(r"^\|\s*\d+ \|", line):
        vals = [x.strip() for x in line.strip().strip("|").split("|")]
        rows.append({k: (int(v) if i < 4 else float(v)) for i, (k, v) in enumerate(zip(keys, vals))})
json.dump(rows, open(f"{out}/batched-bench.json", "w"), indent=1)
print(json.dumps(rows))
EOF
else
  EXTRA=()
  for s in $PG; do EXTRA+=(-pg "$s"); done
  if [ "$WARMUP" = "0" ]; then EXTRA+=(--no-warmup); fi

  set -x
  "$LLAMA_BENCH" -m "$MODEL" \
    -p "$PP" -n "$TG" -d "$DEPTH" -ngl "$NGL" -fa "$FA" \
    -ub "$UB" -b "$BATCH" -ctk "$CTK" -ctv "$CTV" \
    -r "$REPS" "${EXTRA[@]}" --progress -o json 2> "$RAW/llama-bench.err" | tee "$OUT/llama-bench.json"
  set +x

  # llama-bench JSON rows carry build info — surface it into meta.txt (unversioned = noise).
  python3 - "$OUT" <<'EOF' || true
import json, sys
out = sys.argv[1]
rows = json.load(open(f"{out}/llama-bench.json"))
if rows:
    with open(f"{out}/meta.txt", "a") as f:
        f.write(f"build_commit={rows[0].get('build_commit')}\n")
        f.write(f"build_number={rows[0].get('build_number')}\n")
        f.write(f"backends={rows[0].get('backends')}\n")
EOF
fi

echo "→ raw: $RAW"
echo "→ results: $OUT"
