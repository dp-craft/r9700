#!/usr/bin/env bash
# Claude Code on the NATIVE radiance engine serving the Swift-1.5 Qwen3.8-27B heretic MXFP4 .rad (target only, no drafter).
# A .rad is NOT loadable by vLLM / vllm-sly-radiance — it needs stilldeadcode/radiance >= 1.2.3. Flags = the file's README
# "Launch" block (batched tokens 2048, --reasoning-effort medium). The .rad on disk has a mangled name (ra~ce), so it is globbed.
# 27B context config = 27b.conf (260000 ctx + 2 seqs; user decision 2026-10-25, DC1 re-tune 2026-11-09).
# IMAGE: unset = serve_radiance.sh's default (currently 1.11.0; the .rad needs >= 1.2.3).
# Usage: ./claude-rad-heretic.sh [claude args]    Knobs: _lib.sh + 27b.conf + IMAGE RAD_FILE EXTRA_ARGS (serve_radiance.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
# shellcheck source=/home/dev/work/dp-craft/amd/stack/serve/27b.conf
source "$REPO/stack/serve/27b.conf"
: "${RAD_FILE:=$(ls /mnt/Lin1/work/vllm/sly-radiance/models/swift-heretic-gptq/*.rad | head -1)}"
: "${IMAGE:=}"; : "${EXTRA_ARGS:=--max-num-batched-tokens 2048 --reasoning-effort medium}"
CT="radiance-$PORT"
rad_run "$RAD_FILE" "$IMAGE" "$EXTRA_ARGS" "$@"
