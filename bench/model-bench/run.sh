#!/usr/bin/env bash
# model-bench — single-engine tuning microscope via llama.cpp `llama-bench`.
# Sweeps knobs (comma-separated values are swept by llama-bench in one invocation), holds the rest
# fixed, emits canonical JSON to bench/runs/. Vendor-neutral: AMD/NVIDIA detected via
# bench/lib/gpu_env.sh — on NVIDIA just point LLAMA_BENCH at a CUDA build.
#
# Usage:
#   MODEL=/home/dev/models/gguf/Qwen3.6-27B-Q4_K_S.gguf SLUG=27b-ubsweep ./run.sh
#
# For the ADAPTIVE optimum search (expands the grid until the peak is interior), use ./sweep.py.
# Override any knob via env (defaults below). See ./README.md for the full menu.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

# --- environment (vendor-aware) ---
source "$REPO/bench/lib/gpu_env.sh"
gpu_setup_env
# ROCm build by default; Vulkan: LLAMA_BENCH=$REPO/bench/llamacpp-vulkan/llama-bench
# NVIDIA/other: LLAMA_BENCH=/path/to/cuda-build/llama-bench
: "${LLAMA_BENCH:=$REPO/bench/llamacpp/llama-bench}"
: "${MODEL:?set MODEL=/path/to/model.gguf}"
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
: "${VRAM_SAMPLE:=1}"         # 1 = sample VRAM/power to gpu_samples.csv during the run

[ -x "$LLAMA_BENCH" ] || { echo "llama-bench not found/executable: $LLAMA_BENCH" >&2; exit 1; }
[ -f "$MODEL" ]       || { echo "model not found: $MODEL" >&2; exit 1; }

STAMP="$(date '+%Y-%m-%d-%H%M')"
OUT="$REPO/bench/runs/${STAMP}-model-${SLUG}"
mkdir -p "$OUT"

# Record exact invocation + environment for reproducibility (iron rule #2).
{
  echo "date=$(date -Iseconds)"
  echo "host=$(uname -a)"
  gpu_meta
  echo "llama_bench=$LLAMA_BENCH"
  echo "model=$MODEL"
  echo "knobs: PP=$PP TG=$TG DEPTH=$DEPTH NGL=$NGL FA=$FA UB=$UB BATCH=$BATCH CTK=$CTK CTV=$CTV REPS=$REPS"
} > "$OUT/meta.txt"

SAMPLER_PID=""
if [ "$VRAM_SAMPLE" = "1" ]; then
  python3 "$REPO/bench/lib/vram_sampler.py" --out "$OUT/gpu_samples.csv" --interval 1 &
  SAMPLER_PID=$!
fi
cleanup() { [ -n "$SAMPLER_PID" ] && kill "$SAMPLER_PID" 2>/dev/null || true; }
trap cleanup EXIT

set -x
"$LLAMA_BENCH" -m "$MODEL" \
  -p "$PP" -n "$TG" -d "$DEPTH" -ngl "$NGL" -fa "$FA" \
  -ub "$UB" -b "$BATCH" -ctk "$CTK" -ctv "$CTV" \
  -r "$REPS" --progress -o json 2> "$OUT/llama-bench.err" | tee "$OUT/llama-bench.json"
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

echo "→ results: $OUT"
