#!/usr/bin/env bash
# Claude Code on the NATIVE radiance engine serving the Swift-1.5 Qwen3.8-27B heretic MXFP4 .rad (target only, no drafter).
# A .rad is NOT loadable by vLLM / vllm-sly-radiance — it needs stilldeadcode/radiance >= 1.2.3. Flags = the file's README
# "Launch" block (batched tokens 2048, --reasoning-effort medium). The .rad on disk has a mangled name (ra~ce), so it is globbed.
# Usage: ./claude-rad-heretic.sh [claude args]    Knobs: _lib.sh + MAXLEN(200000) IMAGE RAD_FILE EXTRA_ARGS
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
: "${RAD_FILE:=$(ls /mnt/Lin1/work/vllm/sly-radiance/models/swift-heretic-gptq/*.rad | head -1)}"
: "${MAXLEN:=200000}"; : "${EXTRA_ARGS:=--max-num-batched-tokens 2048 --reasoning-effort medium}"; CT="radiance-$PORT"
free_gpu
[ "$KEEP" = 1 ] || trap 'docker rm -f "$CT" >/dev/null 2>&1' EXIT
RAD_FILE=$RAD_FILE PORT=$PORT MAXLEN=$MAXLEN EXTRA_ARGS=$EXTRA_ARGS CONTAINER_NAME=$CT "$ENG/radiance/serve_radiance.sh" run >"$RUNDIR/$PORT.log" 2>&1 &
wait_health "$CT" $! || { tail -20 "$RUNDIR/$PORT.log" >&2; exit 1; }
run_claude "$CT" "$MAXLEN" "$@"
