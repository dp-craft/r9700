#!/usr/bin/env bash
# Claude Code on vllm-sly-radiance 1.9.1 (since 2026-10-30; was 1.8.1 -- IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 to roll back) serving RedHatAI/Qwen3.8-27B-MXFP4 (compressed-tensors mxfp4-pack-quantized) + the DFlash2 drafter
# (profile sly-redhat/redhat-mxfp4-dflash: the sly-official engine layer = heretic's stable recipe, DFlash2 k=7, cudagraphs, util 0.93) with Cactus delta 0
# like start_redhat_27b.sh: the profile's 0.5 loops on agentic work (docs/findings/agentic/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md).
# Benchmarked 2026-10-30 (docs/findings/radiance/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md, ctx 110000, slower of 2 reps): decode 122.72/86.34/86.24 tok/s at 10k/50k/100k on 1.9.1 (1.8.1: 122.27/84.76/87.36).
# 27B context config = 27b.conf (260000 ctx + 2 seqs; user decision 2026-10-25, DC1 re-tune 2026-11-09): MEASURED 2026-10-30 at MAXLEN 262000, GPU KV cache 370,702 tokens (1.41x); boot 419 s and 400 s (two boots, MEASURED).
# WATCHDOG_MIB=32: the RedHat 1.8.1 boot dipped to 71 MiB free on 2026-10-30 (killed at the 256 MiB default).
# Usage: ./claude-sly-redhat.sh [claude args]        Knobs: _lib.sh + 27b.conf + IMAGE AUTO_PULL(1; 0 = refuse a missing image) WATCHDOG_MIB(32) CACTUS_DELTA(0) EXTRA_ARGS (serve_vllm.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
# shellcheck source=/home/dev/work/dp-craft/amd/stack/serve/27b.conf
source "$REPO/stack/serve/27b.conf"
: "${IMAGE:=ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1}"; : "${WATCHDOG_MIB:=32}"; : "${CACTUS_DELTA:=0}"; CT="vllm-$PORT"
# serve_vllm.sh refuses a missing model or drafter (exit 1) only AFTER free_gpu has stopped the live server, so check the
# same two files first, on the paths of its read-only `print` preview (no GPU). The image is pulled here too, before free_gpu:
# serve_vllm.sh would pull it only after free_gpu. The name is this launcher's IMAGE, the value its `start` call is given.
preview=$(PROFILE=sly-redhat/redhat-mxfp4-dflash MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS "$ENG/vllm/serve_vllm.sh" print)
model_dir=$(sed -n 's/^#   MODEL_DIR=//p' <<<"$preview"); draft_dir=$(sed -n 's/^#   DRAFT_DIR=\([^ ]*\).*/\1/p' <<<"$preview")
[ -f "$model_dir/config.json" ] && { [ "$draft_dir" = none ] || [ -f "$draft_dir/config.json" ]; } \
  || { echo "claude-sly-redhat: model or drafter not found (model: '$model_dir', drafter: '$draft_dir'; fetch_model.sh) -- the running server was NOT touched" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { [ "${AUTO_PULL:-1}" = 1 ] && docker pull "$IMAGE"; } || { echo "claude-sly-redhat: image $IMAGE not present and docker pull failed (or AUTO_PULL=0) -- the running server was NOT touched" >&2; exit 1; }
# dp-sharp chat template on every 27B vLLM path (owner 2026-11-11: one template, easy to update and compare).
: "${CHAT_TEMPLATE:=$ENG/vllm/templates/dp-sharp-chat_template.jinja}"
free_gpu
[ "$KEEP" = 1 ] || trap 'PORT=$PORT "$ENG/vllm/serve_vllm.sh" stop >/dev/null 2>&1' EXIT
PROFILE=sly-redhat/redhat-mxfp4-dflash IMAGE=$IMAGE CHAT_TEMPLATE=$CHAT_TEMPLATE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS SPEC_K=$SPEC_K CACTUS_DELTA=$CACTUS_DELTA WATCHDOG_MIB=$WATCHDOG_MIB WAIT=$WAIT "$ENG/vllm/serve_vllm.sh" start >"$RUNDIR/$PORT.boot" 2>&1 \
  || { tail -20 "$RUNDIR/$PORT.boot" >&2; exit 1; }
run_claude "$CT" "$MAXLEN" "$@"
