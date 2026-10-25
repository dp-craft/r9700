#!/usr/bin/env bash
# Claude Code on the NATIVE radiance engine (stilldeadcode/radiance) serving StillDeadcode/qwen3.8-27b-mxfp4
# (.rad = MXFP4 weights + vision + DFlash2 drafter in one file; model card flags: tp1, fp8 KV, 8 seqs).
# Usage: ./claude-rad-mxfp4.sh [claude args]      Knobs: _lib.sh + MAXLEN(200000) IMAGE RAD_FILE EXTRA_ARGS (serve_radiance.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
: "${RAD_FILE:=$(ls /mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-mxfp4@*/qwen3.8-27b-mxfp4.rad | head -1)}"
: "${MAXLEN:=200000}"; CT="radiance-$PORT"
free_gpu
[ "$KEEP" = 1 ] || trap 'docker rm -f "$CT" >/dev/null 2>&1' EXIT
RAD_FILE=$RAD_FILE PORT=$PORT MAXLEN=$MAXLEN CONTAINER_NAME=$CT "$ENG/radiance/serve_radiance.sh" run >"$RUNDIR/$PORT.log" 2>&1 &
wait_health "$CT" $! || { tail -20 "$RUNDIR/$PORT.log" >&2; exit 1; }
run_claude "$CT" "$MAXLEN" "$@"
