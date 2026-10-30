#!/usr/bin/env bash
# heretic then redhat, sequential (one GPU); raw data under amd bench/runs/<stamp>-dpf-brief-ab/
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT=/home/dev/work/dp-craft/amd/bench/runs/$(date +%Y-%m-%d-%H%M)-dpf-brief-ab
mkdir -p "$ROOT"; cp -p "$HERE/run_arm.sh" "$HERE/run_all.sh" "$ROOT/"
echo "root=$ROOT"
for arm in heretic redhat; do bash "$HERE/run_arm.sh" "$arm" "$ROOT"; echo "arm $arm exit=$?"; done
echo "all done: $ROOT"
