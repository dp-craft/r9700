#!/usr/bin/env bash
# serve_radiance.sh — launcher for the NATIVE radiance runtime (docker image stilldeadcode/radiance,
# https://codeberg.org/StillDeadcode/radiance), serving a single-file .rad model. This is NOT vLLM:
# the vllm-radiance image (serve_vllm.sh) loads HF checkpoint dirs; this one loads `*.rad` containers
# (weights + tokenizer + chat template + DFlash2 drafter in one file). Flags follow the model card
# (HF StillDeadcode/qwen3.8-27b-mxfp4): --tp 1 --max-model-len 200000 --kv-cache-dtype fp8 --max-num-seqs 8.
#
# Usage:
#   RAD_FILE=/abs/model.rad PORT=10005 CONTAINER_NAME=llama-swap-x ./serve_radiance.sh run   # FOREGROUND, for llama-swap
#   RAD_FILE=/abs/model.rad ./serve_radiance.sh print                                       # show docker argv, no GPU
# Stop with `docker rm -f <CONTAINER_NAME>` (llama-swap's cmdStop). Like serve_vllm.sh `run`, it does
# NOT call gpu_exclusive.sh (that unloads llama-swap = its own parent); it waits up to FLOOR_WAIT s for
# FREE_MIB_FLOOR of free VRAM and refuses below it (iron rule 14).
# Knobs (env): RAD_FILE (required) IMAGE(stilldeadcode/radiance:1.11.0) PORT(8000) CONTAINER_NAME(radiance-$PORT)
#   MAXLEN(200000) MAXSEQS(8) KV_DTYPE(fp8) TP(1) REASONING_MAP(high=xhigh) FREE_MIB_FLOOR(30000) FLOOR_WAIT(90) EXTRA_ARGS
#   HIP_FORCE_DEV_KERNARG(0: iron-rule env, CLAUDE.md "ROCm engines")
set -euo pipefail

: "${IMAGE:=stilldeadcode/radiance:1.11.0}"
: "${PORT:=8000}"
: "${CONTAINER_NAME:=radiance-$PORT}"
: "${MAXLEN:=200000}"
: "${MAXSEQS:=8}"
: "${KV_DTYPE:=fp8}"
: "${TP:=1}"
: "${REASONING_MAP=high=xhigh}"   # space-separated FROM=TO pairs; set empty to pass none
: "${FREE_MIB_FLOOR:=30000}"
: "${FLOOR_WAIT:=90}"
: "${RAD_FILE:?set RAD_FILE=<absolute path to the .rad model>}"
MODE="${1:-run}"
case "$MODE" in run|print) ;; *) echo "usage: RAD_FILE=... $0 [run|print]" >&2; exit 2;; esac
[ "${RAD_FILE:0:1}" = / ] && [ "${RAD_FILE##*.}" = rad ] || { echo "RAD_FILE must be an absolute path to a .rad file (got: $RAD_FILE)" >&2; exit 2; }

vram_free_mib() {
  local d
  for d in /sys/class/drm/card*/device; do
    [ -r "$d/mem_info_vram_total" ] || continue
    echo $(( ($(cat "$d/mem_info_vram_total") - $(cat "$d/mem_info_vram_used")) / 1048576 )); return
  done
  echo 999999
}

RENDER_GID=$(getent group render | cut -d: -f3); VIDEO_GID=$(getent group video | cut -d: -f3)
# Flags/devices mirror the upstream deploy/compose/common.yaml: seccomp=unconfined (io_uring + NUMA mbind),
# memlock unlimited, init, run as the host user, GPU groups. Port 8000 inside, ${PORT} on loopback outside.
CMD=(docker run --rm --init --name "$CONTAINER_NAME"
     --device /dev/kfd --device /dev/dri --group-add "$VIDEO_GID" --group-add "$RENDER_GID"
     --security-opt seccomp=unconfined --ulimit memlock=-1:-1
     --user "$(id -u):$(id -g)" -p "127.0.0.1:$PORT:8000"
     -e HIP_FORCE_DEV_KERNARG="${HIP_FORCE_DEV_KERNARG:-0}"
     -v "$(dirname "$RAD_FILE"):/models:ro"
     "$IMAGE" --model "/models/$(basename "$RAD_FILE")" --host 0.0.0.0 --port 8000
     --tp "$TP" --max-model-len "$MAXLEN" --kv-cache-dtype "$KV_DTYPE" --max-num-seqs "$MAXSEQS")
# Qwen3.8's embedded template takes xhigh|medium|low only and 400s on OpenAI's `high` (opencode sends it).
# The engine maps it before the template sees it and checks TO against the template at startup.
for pair in $REASONING_MAP; do CMD+=(--reasoning-effort-map "$pair"); done
if [ -n "${EXTRA_ARGS:-}" ]; then read -r -a XA <<<"$EXTRA_ARGS"; CMD+=("${XA[@]}"); fi

if [ "$MODE" = print ]; then printf '%q ' "${CMD[@]}"; echo; exit 0; fi

[ -f "$RAD_FILE" ] || { echo "model not found: $RAD_FILE" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "image not present: $IMAGE (docker pull $IMAGE)" >&2; exit 1; }
if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" != true ]; then
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1   # dead leftover of a crashed supervised boot
fi
if ss -ltn | grep -q ":$PORT "; then echo "port $PORT held by a foreign process" >&2; exit 1; fi
for _ in $(seq "$FLOOR_WAIT"); do [ "$(vram_free_mib)" -ge "$FREE_MIB_FLOOR" ] && break; sleep 1; done
f=$(vram_free_mib)
if [ "$f" -lt "$FREE_MIB_FLOOR" ]; then
  echo "refusing to boot $CONTAINER_NAME: ${f} MiB free < floor ${FREE_MIB_FLOOR} MiB — holders:" >&2
  amd-smi process -g 0 >&2 2>/dev/null || true; exit 1
fi

echo "running $CONTAINER_NAME in the foreground on 127.0.0.1:$PORT ($IMAGE, $(basename "$RAD_FILE"))"
# Docker client as a background job + `wait`, so a TERM from the supervisor removes the container at once.
"${CMD[@]}" & DP=$!
trap 'docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1' TERM INT
rc=0; wait "$DP" || rc=$?
if [ "$rc" -gt 128 ]; then wait "$DP" 2>/dev/null || true; fi
exit "$rc"
