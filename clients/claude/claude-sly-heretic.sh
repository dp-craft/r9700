#!/usr/bin/env bash
# Claude Code on vllm-sly-radiance serving Swift-1.5 heretic GPTQ-MXFP4 (compressed-tensors, research-only, safety removed) with the Sly docs' official
# single-R9700 recipe (profile sly-official/heretic-mxfp4: DFlash2 k=7, cudagraphs, Cactus 0.5, util 0.93 (the docs say 0.98), thinking ON, no kernarg fix) at image 1.8.1.
# 27B context config = 27b.conf (260000 ctx + 2 seqs; user decision 2026-10-25, DC1 re-tune 2026-11-09; the model card says 65536 — the pre-decision default).
# The 1.8.1 boot dips to ~250 MiB free (MEASURED 2026-10-24 at MAXLEN 150000, settles ~1.1 GiB), under serve_vllm.sh's 256 MiB watchdog default, so WATCHDOG_MIB=32 here (24 MiB free killed the desktop on 2026-10-22). First boot compiles ~10 min (cache is per image tag under /mnt/Lin1/work/vllm/sly-radiance/cache/).
# Usage: ./claude-sly-heretic.sh [claude args]        Knobs: _lib.sh + 27b.conf + IMAGE AUTO_PULL(1; 0 = refuse a missing image) WATCHDOG_MIB(32) EXTRA_ARGS (serve_vllm.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
# shellcheck source=/home/dev/work/dp-craft/amd/stack/serve/27b.conf
source "$REPO/stack/serve/27b.conf"
: "${IMAGE:=ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1}"; : "${WATCHDOG_MIB:=32}"; CT="vllm-$PORT"
# serve_vllm.sh refuses a missing model or drafter (exit 1) only AFTER free_gpu has stopped the live server, so check the
# same two files first, on the paths of its read-only `print` preview (no GPU). The image is pulled here too, before free_gpu:
# serve_vllm.sh would pull it only after free_gpu. The name is this launcher's IMAGE, the value its `start` call is given.
preview=$(PROFILE=sly-official/heretic-mxfp4 MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS "$ENG/vllm/serve_vllm.sh" print)
model_dir=$(sed -n 's/^#   MODEL_DIR=//p' <<<"$preview"); draft_dir=$(sed -n 's/^#   DRAFT_DIR=\([^ ]*\).*/\1/p' <<<"$preview")
[ -f "$model_dir/config.json" ] && { [ "$draft_dir" = none ] || [ -f "$draft_dir/config.json" ]; } \
  || { echo "claude-sly-heretic: model or drafter not found (model: '$model_dir', drafter: '$draft_dir'; fetch_model.sh) -- the running server was NOT touched" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { [ "${AUTO_PULL:-1}" = 1 ] && docker pull "$IMAGE"; } || { echo "claude-sly-heretic: image $IMAGE not present and docker pull failed (or AUTO_PULL=0) -- the running server was NOT touched" >&2; exit 1; }
# dp-sharp chat template on every 27B vLLM path (owner 2026-11-11: one template, easy to update and compare).
: "${CHAT_TEMPLATE:=$ENG/vllm/templates/dp-sharp-chat_template.jinja}"
free_gpu
[ "$KEEP" = 1 ] || trap 'PORT=$PORT "$ENG/vllm/serve_vllm.sh" stop >/dev/null 2>&1' EXIT
PROFILE=sly-official/heretic-mxfp4 IMAGE=$IMAGE CHAT_TEMPLATE=$CHAT_TEMPLATE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS SPEC_K=$SPEC_K WATCHDOG_MIB=$WATCHDOG_MIB WAIT=$WAIT "$ENG/vllm/serve_vllm.sh" start >"$RUNDIR/$PORT.boot" 2>&1 \
  || { tail -20 "$RUNDIR/$PORT.boot" >&2; exit 1; }
run_claude "$CT" "$MAXLEN" "$@"
