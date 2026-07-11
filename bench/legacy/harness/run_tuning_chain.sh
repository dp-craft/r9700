#!/usr/bin/env bash
# Sequential GPU chain (GPU is exclusive). Waits for any running ub sweep, then:
#   1) -b logical-batch sweep (b1295)
#   2) build/backend comparison: official ROCm 7.2 (b9950) and Vulkan (b9950) at ub2048/b16384
# All into $RESULTS. b1295 ub2048 rows already serve as the control.
source "$(dirname "$0")/config.sh"
H="$HARNESS"
while pgrep -f run_ub_sweep.sh >/dev/null; do sleep 5; done
echo "### b-sweep ###"; bash "$H/run_b_sweep.sh"
echo "### backend: official ROCm 7.2 (b9950) ###"; BB=16384 bash "$H/run_backend.sh" "$REPO/bench/llamacpp-rocm-b9950" "ROCm7.2-b9950" 2048 fa_on
echo "### backend: Vulkan RADV (b9950) ###";       BB=16384 bash "$H/run_backend.sh" "$REPO/bench/llamacpp-vulkan"     "Vulkan-b9950"  2048 fa_on
echo "### chain done ###"
