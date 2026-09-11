#!/usr/bin/env bash
set -uo pipefail
export PATH="/usr/bin:$HOME/.hipfire/bin:$PATH"
cd /home/dev/work/dippe/dp-forge || exit 1
S=docs/test/hipfire-bench/bench.py; OUT=docs/test/hipfire-bench
M="$HOME/.hipfire/models/qwen3.8-27b.mq4-pro"
# CASK OFF arm -> compares directly against ROCm 7.13 longctx 186.1 tok/s
echo "########## ROCm10 longctx ~70k, CASK OFF ##########"
python3 "$S" --base-url http://127.0.0.1:11435/v1 --model "$M" \
  --label rocm10-longctx-cask-off --out "$OUT" --workloads longctx --reps 2 --warmups 2 \
  --note "hipfire 800ddf7403d8 on ROCm 10.0.0 (HIP 7.15.26333); CASK off, DFlash off; GPU exclusive (llama-swap killed). Compare vs ROCm 7.13 longctx CASK-off 186.1 tok/s."
echo "LONGCTX ROCM10 COMPLETE"
