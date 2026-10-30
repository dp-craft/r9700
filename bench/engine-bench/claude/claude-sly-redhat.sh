#!/usr/bin/env bash
# Claude Code on vllm-sly-radiance 1.9.1 (since 2026-10-30; was 1.8.1 -- IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 to roll back) serving RedHatAI/Qwen3.8-27B-MXFP4 (compressed-tensors mxfp4-pack-quantized) + the DFlash2 drafter
# (profile sly-redhat/redhat-mxfp4-dflash: the sly-official engine layer = heretic's stable recipe, DFlash2 k=7, cudagraphs, Cactus 0.5, util 0.93).
# Benchmarked 2026-10-30 (docs/analysis/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md, ctx 110000, slower of 2 reps): decode 122.72/86.34/86.24 tok/s at 10k/50k/100k on 1.9.1 (1.8.1: 122.27/84.76/87.36).
# Window 262000 like claude-sly-heretic.sh: MEASURED 2026-10-30 at MAXLEN 262000, GPU KV cache 370,702 tokens (1.41x); boot 419 s and 400 s (two boots, MEASURED).
# WATCHDOG_MIB=32: the RedHat 1.8.1 boot dipped to 71 MiB free on 2026-10-30 (killed at the 256 MiB default).
# Usage: ./claude-sly-redhat.sh [claude args]        Knobs: _lib.sh + IMAGE MAXLEN(262000) MAXSEQS(2) WATCHDOG_MIB(32) GPU_UTIL(0.93) CACTUS_DELTA(0.5) SPEC_K(7) EXTRA_ARGS (serve_vllm.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
: "${IMAGE:=ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1}"; : "${MAXLEN:=262000}"; : "${MAXSEQS:=2}"; : "${WATCHDOG_MIB:=32}"; CT="vllm-$PORT"
free_gpu
[ "$KEEP" = 1 ] || trap 'PORT=$PORT "$ENG/vllm/serve_vllm.sh" stop >/dev/null 2>&1' EXIT
PROFILE=sly-redhat/redhat-mxfp4-dflash IMAGE=$IMAGE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS WATCHDOG_MIB=$WATCHDOG_MIB WAIT=$WAIT "$ENG/vllm/serve_vllm.sh" start >"$RUNDIR/$PORT.boot" 2>&1 \
  || { tail -20 "$RUNDIR/$PORT.boot" >&2; exit 1; }
run_claude "$CT" "$MAXLEN" "$@"
