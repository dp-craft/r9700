#!/usr/bin/env bash
# Claude Code on the NATIVE radiance engine (stilldeadcode/radiance) serving StillDeadcode/qwen3.8-27b-mxfp4
# (.rad = MXFP4 weights + vision + DFlash2 drafter in one file; tp1, fp8 KV).
# 27B context config = 27b.conf (260000 ctx + 2 seqs; user decision 2026-10-25, DC1 re-tune 2026-11-09; same as the sly twins
# claude-sly-redhat.sh / claude-sly-heretic.sh). The model card's 200000/8 was the pre-decision default.
# IMAGE: unset = serve_radiance.sh's default (currently 1.11.0; the .rad needs >= 1.2.3).
# Usage: ./claude-rad-mxfp4.sh [claude args]      Knobs: _lib.sh + 27b.conf + IMAGE RAD_FILE EXTRA_ARGS (serve_radiance.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
# shellcheck source=/home/dev/work/dp-craft/amd/stack/serve/27b.conf
source "$REPO/stack/serve/27b.conf"
: "${RAD_FILE:=$(ls /mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-mxfp4@*/qwen3.8-27b-mxfp4.rad | head -1)}"
: "${IMAGE:=}"; : "${EXTRA_ARGS:=}"
CT="radiance-$PORT"
rad_run "$RAD_FILE" "$IMAGE" "$EXTRA_ARGS" "$@"
