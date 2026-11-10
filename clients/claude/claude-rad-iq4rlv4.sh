#!/usr/bin/env bash
# Claude Code on the NATIVE radiance engine (stilldeadcode/radiance) serving StillDeadcode/qwen3.8-27b-iqr-v4
# @ qwen3.8-27b-iq4r-l-v4.rad (IQR-V4 ladder: 4.793 bpw, source KL 0.00297 — 24 % below the official FP8
# checkpoint's KL at 55 % of its size). The 27B IQ4R comparison twin of claude-rad-mxfp4.sh: same
# 27b.conf config (260000 ctx + 2 seqs; user decision 2026-10-25, DC1 re-tune 2026-11-09), so the A/B is quantization-only.
# IMAGE floor is 1.17.0: the IQR-V4 .rad containers REFUSE radiance <= 1.16.0 (model card).
# Headroom 596 via EXTRA_ARGS (the default 96 left 113 MiB free at peak and crashed the desktop once —
# docs/guides/vllm/known-issues.md); HIP_FORCE_DEV_KERNARG=0 is set by serve_radiance.sh.
# Fetch (18.7 GB, ONE file): see the header of stack/serve/radiance/start_qwen38_27b_iq4r-l-v4_rad.sh.
# Spec-decode A/B twins: claude-rad-iq4rlv4-dflash.sh / -nospec.sh (differ only in --num-speculative-tokens).
# Usage: ./claude-rad-iq4rlv4.sh [claude args]    Knobs: _lib.sh + 27b.conf + IMAGE RAD_FILE EXTRA_ARGS (serve_radiance.sh)
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
# shellcheck source=/home/dev/work/dp-craft/amd/stack/serve/27b.conf
source "$REPO/stack/serve/27b.conf"
: "${RAD_FILE:=$(ls /mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@*/qwen3.8-27b-iq4r-l-v4.rad | head -1)}"
: "${IMAGE:=stilldeadcode/radiance:1.17.0}"
: "${EXTRA_ARGS:=--gpu-headroom-mib $HEADROOM_MIB}"
CT="radiance-$PORT"
rad_run "$RAD_FILE" "$IMAGE" "$EXTRA_ARGS" "$@"
