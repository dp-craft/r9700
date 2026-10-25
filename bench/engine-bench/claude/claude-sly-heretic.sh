#!/usr/bin/env bash
# Claude Code on vllm-sly-radiance serving Swift-1.5 heretic GPTQ-MXFP4 (compressed-tensors, research-only, safety removed) with the Sly docs' official
# single-R9700 recipe (profile sly-official/heretic-mxfp4: DFlash2 k=7, cudagraphs, Cactus 0.5, util 0.98, thinking ON, no kernarg fix) at image 1.8.1; the
# context is the model-native window 262144 (user decision 2026-10-25; docs: 65536). The 1.8.1 boot dips to ~250 MiB free (MEASURED 2026-10-24 at MAXLEN 150000, settles ~1.1 GiB), under serve_vllm.sh's 256 MiB watchdog default, so WATCHDOG_MIB=32 here (24 MiB free killed the desktop on 2026-10-22). First boot compiles ~10 min (cache is per image tag under /mnt/Lin1/work/vllm/sly-radiance/cache/).
# Usage: ./claude-sly-heretic.sh [claude args]        Knobs: _lib.sh + IMAGE MAXLEN(262144) MAXSEQS(2) WATCHDOG_MIB(32) GPU_UTIL(0.93) CACTUS_DELTA(0.5) SPEC_K(7) EXTRA_ARGS (serve_vllm.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
: "${IMAGE:=ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1}"; : "${MAXLEN:=262000}"; : "${MAXSEQS:=2}"; : "${WATCHDOG_MIB:=32}"; CT="vllm-$PORT"
free_gpu
[ "$KEEP" = 1 ] || trap 'PORT=$PORT "$ENG/vllm/serve_vllm.sh" stop >/dev/null 2>&1' EXIT
PROFILE=sly-official/heretic-mxfp4 IMAGE=$IMAGE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS WATCHDOG_MIB=$WATCHDOG_MIB WAIT=$WAIT "$ENG/vllm/serve_vllm.sh" start >"$RUNDIR/$PORT.boot" 2>&1 \
  || { tail -20 "$RUNDIR/$PORT.boot" >&2; exit 1; }
run_claude "$CT" "$MAXLEN" "$@"
