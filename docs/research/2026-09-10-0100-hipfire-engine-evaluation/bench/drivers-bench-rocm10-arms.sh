#!/usr/bin/env bash
# ROCm 10 follow-ups: DFlash ON, and CASK ON at long context.
# Both were tuned against the ROCm 7.13 kernel path, which ROCm 10 has changed.
set -uo pipefail
export PATH="/usr/bin:$HOME/.hipfire/bin:$PATH"
cd /home/dev/work/dippe/dp-forge || exit 1
S=docs/test/hipfire-bench/bench.py; OUT=docs/test/hipfire-bench
M="$HOME/.hipfire/models/qwen3.8-27b.mq4-pro"

restart() {  # $1=dflash $2=cask
  hipfire stop >/dev/null 2>&1; sleep 4
  for p in $(ps -eo pid,comm --no-headers | awk '$2=="daemon"{print $1}'); do kill "$p" 2>/dev/null; done
  sleep 3
  hipfire config set speculation.dflash "$1"     >/dev/null 2>&1
  hipfire config set memory.cask.enabled "$2"    >/dev/null 2>&1
  hipfire config set reasoning.mode off          >/dev/null 2>&1
  hipfire serve --model "$M" -d >/dev/null 2>&1
  for i in $(seq 1 150); do
    curl -sf -m 10 http://127.0.0.1:11435/health 2>/dev/null | grep -q '"loading_model":null' && return 0
    sleep 5
  done
  return 1
}

echo "########## ARM 1: ROCm10 + DFlash ON (CASK off) ##########"
restart on false && python3 "$S" --base-url http://127.0.0.1:11435/v1 --model "$M" \
  --label rocm10-dflash-on --out "$OUT" --reps 3 --warmups 10 \
  --note "hipfire 800ddf7403d8 on ROCm 10.0.0 (HIP 7.15.26333); DFlash ON, CASK off, reasoning off; GPU exclusive. Compare vs ROCm 7.13 DFlash-on: decode 119.9, coding decode 150.2, prefill 496.5."
echo "ARM1 DONE"

echo "########## ARM 2: ROCm10 + CASK ON, longctx ~55k ##########"
restart off true && python3 "$S" --base-url http://127.0.0.1:11435/v1 --model "$M" \
  --label rocm10-longctx-cask-on --out "$OUT" --workloads longctx --reps 2 --warmups 2 \
  --note "hipfire 800ddf7403d8 on ROCm 10.0.0 (HIP 7.15.26333); CASK ON, DFlash off; GPU exclusive. Compare vs ROCm10 CASK-off 550.9 and ROCm 7.13 CASK-on 292.8."
echo "ARM2 DONE"
echo "ROCM10 ARMS COMPLETE"
