#!/usr/bin/env bash
# Post-ROCm-10 bench. IDENTICAL flags to the 7.13 runs so the numbers are comparable.
set -uo pipefail
export PATH="/usr/bin:$HOME/.hipfire/bin:$PATH"
cd /home/dev/work/dippe/dp-forge || exit 1
S=docs/test/hipfire-bench/bench.py
OUT=docs/test/hipfire-bench
M="$HOME/.hipfire/models/qwen3.8-27b.mq4-pro"

hipfire stop >/dev/null 2>&1; sleep 3
# CRITICAL: llama-swap keeps a 20 GB model resident. hipfire needs 16.5 GB; 32.6 GB total.
# Without this the load silently starves. GET (not POST) /unload is the working endpoint.
echo "unloading llama-swap..."; curl -sf -m 30 http://127.0.0.1:9292/unload >/dev/null 2>&1; sleep 8
amd-smi metric -g 0 -m 2>/dev/null | grep -i USED_VRAM | head -1
# same config as the 7.13 "DFlash off / CASK off" arm -> compares against prefill 615.3, decode ~29
hipfire config set reasoning.mode off      >/dev/null 2>&1
hipfire config set speculation.dflash off  >/dev/null 2>&1
hipfire config set memory.cask.enabled false >/dev/null 2>&1

hipfire serve --model "$M" -d >/dev/null 2>&1
echo "waiting for model load (first run also JIT-compiles kernels for HIP 7.15)..."
for i in $(seq 1 120); do
  curl -sf -m 10 http://127.0.0.1:11435/health 2>/dev/null | grep -q '"loading_model":null' && break
  sleep 5
done
curl -sf -m 10 http://127.0.0.1:11435/health 2>/dev/null | head -c 200; echo

echo "########## ROCm10 / HIP7.15 : decode+prefill+coding, DFlash OFF, CASK OFF ##########"
python3 "$S" --base-url http://127.0.0.1:11435/v1 --model "$M" \
  --label rocm10-hip715-dflash-off --out "$OUT" --reps 3 --warmups 10 \
  --note "hipfire 0.3.0 800ddf7403d8 REBUILT against ROCm 10.0.0 (HIP 7.15.26333); gfx1201 exact-arch math libs; DFlash off, CASK off, reasoning off; kernel cache regenerated. Compare vs ROCm 7.13 arm: prefill 615.3, coding decode ~29."

echo "BENCH ROCM10 CORE COMPLETE"
