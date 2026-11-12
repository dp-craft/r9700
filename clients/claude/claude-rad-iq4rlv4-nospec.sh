#!/usr/bin/env bash
# Claude Code on the NATIVE radiance engine serving StillDeadcode/qwen3.8-27b-iqr-v4
# @ qwen3.8-27b-iq4r-l-v4.rad with speculation DISABLED (--num-speculative-tokens 0).
# A/B twin of claude-rad-iq4rlv4-dflash.sh — the ONLY difference is --num-speculative-tokens (0 vs 7).
# Use it to measure the DFlash2 drafter's NET contribution: with a live accept rate of only ~0.27
# (~1.9 of the 7 proposed tokens, MEASURED 2026-11-09 from /stats), the draft pass + 8-row verify pass may
# cost more than it saves at deep context — this arm settles it. No MTP head exists in this .rad to
# substitute (no mtp/nextn tensors in the header; radiance auto-runs a bundled MTP head with no flag,
# so its absence in the log is its absence in the file).
# Card: "Drafts are verified, so they change the speed, never the output" — a pure speed A/B.
# 27B config from 27b.conf (260000 ctx + 2 seqs, user decision 2026-10-25, DC1 re-tune 2026-11-09); IMAGE floor 1.17.0
# (IQR-V4 refuses <= 1.16.0); headroom 596 (the default 96 left 113 MiB free at peak and crashed the desktop once).
# Usage: ./claude-rad-iq4rlv4-nospec.sh [claude args]    Knobs: _lib.sh + 27b.conf + IMAGE RAD_FILE EXTRA_ARGS
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
# shellcheck source=/home/dev/work/dp-craft/amd/stack/serve/27b.conf
source "$REPO/stack/serve/27b.conf"
# pinned to the starter's snapshot @e5f1b3ef (iron rule 2): the old glob took any revision
: "${RAD_FILE:=/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef/qwen3.8-27b-iq4r-l-v4.rad}"
: "${IMAGE:=stilldeadcode/radiance:1.17.0}"
: "${EXTRA_ARGS:=--gpu-headroom-mib $HEADROOM_MIB --num-speculative-tokens 0}"
CT="radiance-$PORT"
rad_run "$RAD_FILE" "$IMAGE" "$EXTRA_ARGS" "$@"
