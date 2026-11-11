#!/usr/bin/env bash
# Claude Code on vllm-sly-radiance serving amd/Qwen3.8-27B-Quark-AWQ-MXFP4 (HF checkpoint, W4A8 fp8-WMMA) via the repo profile
# sly-radiance/qwen38-mxfp4 (enforce-eager, drafter off, Cactus off). Default image 1.6.0 (the profile's tested one). 1.8.0 (pulled) tripped the
# boot VRAM watchdog on 2026-10-24 (free 90 MiB < 256 right after lm_head int4) with this profile — IMAGE=...:1.8.0-rocm10.1 to retry.
# First boot compiles ~10 min (cache is per image tag under /mnt/Lin1/work/vllm/sly-radiance/cache/).
# Usage: ./claude-sly-amd.sh [claude args]        Knobs: _lib.sh + IMAGE AUTO_PULL(1; 0 = refuse a missing image) MAXLEN(profile: 150000) GPU_UTIL(0.90) EXTRA_ARGS (serve_vllm.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
: "${IMAGE:=ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1}"; : "${MAXLEN:=150000}"; CT="vllm-$PORT"
# serve_vllm.sh refuses a missing model or drafter (exit 1) only AFTER free_gpu has stopped the live server, so check the
# same two files first, on the paths of its read-only `print` preview (no GPU). The image is pulled here too, before free_gpu:
# serve_vllm.sh would pull it only after free_gpu. The name is this launcher's IMAGE, the value its `start` call is given.
preview=$(PROFILE=sly-radiance/qwen38-mxfp4 MAXLEN=$MAXLEN "$ENG/vllm/serve_vllm.sh" print)
model_dir=$(sed -n 's/^#   MODEL_DIR=//p' <<<"$preview"); draft_dir=$(sed -n 's/^#   DRAFT_DIR=\([^ ]*\).*/\1/p' <<<"$preview")
[ -f "$model_dir/config.json" ] && { [ "$draft_dir" = none ] || [ -f "$draft_dir/config.json" ]; } \
  || { echo "claude-sly-amd: model or drafter not found (model: '$model_dir', drafter: '$draft_dir'; fetch_model.sh) -- the running server was NOT touched" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { [ "${AUTO_PULL:-1}" = 1 ] && docker pull "$IMAGE"; } || { echo "claude-sly-amd: image $IMAGE not present and docker pull failed (or AUTO_PULL=0) -- the running server was NOT touched" >&2; exit 1; }
free_gpu
[ "$KEEP" = 1 ] || trap 'PORT=$PORT "$ENG/vllm/serve_vllm.sh" stop >/dev/null 2>&1' EXIT
PROFILE=sly-radiance/qwen38-mxfp4 IMAGE=$IMAGE PORT=$PORT MAXLEN=$MAXLEN WAIT=$WAIT "$ENG/vllm/serve_vllm.sh" start >"$RUNDIR/$PORT.boot" 2>&1 \
  || { tail -20 "$RUNDIR/$PORT.boot" >&2; exit 1; }
run_claude "$CT" "$MAXLEN" "$@"
