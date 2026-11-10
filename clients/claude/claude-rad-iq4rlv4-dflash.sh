#!/usr/bin/env bash
# Claude Code on the NATIVE radiance engine serving StillDeadcode/qwen3.8-27b-iqr-v4
# @ qwen3.8-27b-iq4r-l-v4.rad with DFlash2 speculation ON (pinned to the drafter's own depth, SPEC_K 7).
# A/B twin of claude-rad-iq4rlv4-nospec.sh — the ONLY difference is --num-speculative-tokens (7 vs 0).
# The IQR-V4 .rad carries the z-lab/Qwen3.8-27B-DFlash2 drafter merged in (card; MEASURED: DFlash2DraftModel
# + dflash.blk.* tensors in the .rad header) and radiance auto-enables it (default auto = 7); pinning 7
# makes this arm explicit. There is NO MTP head in this .rad (no mtp/nextn tensors; server log shows
# dflash2 as the only drafter), so dflash-vs-mtp is not a testable pair with this file.
# Card: "Drafts are verified, so they change the speed, never the output" — a pure speed A/B.
# 27B config from 27b.conf (260000 ctx + 2 seqs, user decision 2026-10-25, DC1 re-tune 2026-11-09); IMAGE floor 1.17.0
# (IQR-V4 refuses <= 1.16.0); headroom 596 (the default 96 left 113 MiB free at peak and crashed the desktop once).
# Usage: ./claude-rad-iq4rlv4-dflash.sh [claude args]    Knobs: _lib.sh + 27b.conf + IMAGE RAD_FILE EXTRA_ARGS
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
# shellcheck source=/home/dev/work/dp-craft/amd/stack/serve/27b.conf
source "$REPO/stack/serve/27b.conf"
: "${RAD_FILE:=$(ls /mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@*/qwen3.8-27b-iq4r-l-v4.rad | head -1)}"
: "${IMAGE:=stilldeadcode/radiance:1.17.0}"
: "${EXTRA_ARGS:=--gpu-headroom-mib $HEADROOM_MIB --num-speculative-tokens $SPEC_K}"
CT="radiance-$PORT"
rad_run "$RAD_FILE" "$IMAGE" "$EXTRA_ARGS" "$@"
