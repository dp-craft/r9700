#!/bin/bash
# kerneltest.sh [RUNS=3] -- run after booting another kernel: the unchanged Sly 1.6.0 DFlash gate RUNS times
# (4 Claude turns each, stops at the first non-PASS), then speeds. Labels k<kernel-abi>-N in results.tsv.
# Why (2026-10-22): the vLLM MXFP4 faults (addr 0x6..., = a valid 0x7... buffer address with bit 44 cleared,
# in prefill AND decode kernels) match the 2026-10-07 llama.cpp ROCm -fa on faults (addr 0x6bc6..., 0x6e0d...,
# docs/analysis/2026-10-07-1745-rocm-fa-hsa-memory-fault.md) whose open suspect is the amdgpu driver in
# kernel 7.0.0-38. On 7.0.0-34: 3x PASS -> driver regression (pin -34); a FAULT -> engine-side after all.
set -u
H=$(cd "$(dirname "$0")" && pwd)
k=$(uname -r | grep -oE '^[0-9.]+-[0-9]+' | sed 's/.*-/k/')
echo "kernel $(uname -r)"
L=()
for i in $(seq 1 "${RUNS:-3}"); do
  bash "$H/claudetest.sh" "$k-$i" sly-radiance/qwen38-mxfp4-dflash 2>&1 | grep RESULT
  L+=("$k-$i")
  awk -F'\t' -v l="$k-$i" '$2==l{r=$4}END{exit r!="PASS"}' "$H/results.tsv" || break
done
python3 "$H/speeds.py" "${L[@]}" | column -t -s$'\t'
