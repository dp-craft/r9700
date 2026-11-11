#!/usr/bin/env bash
# stack/serve/radiance/start_qwen38_27b_iq4r-l-v4_rad.sh — start/stop native Radiance ("rad") serving
# StillDeadcode/qwen3.8-27b-iqr-v4 @ qwen3.8-27b-iq4r-l-v4.rad (IQR-V4 ladder: 4.793 bpw, source KL
# 0.00297 vs bf16 — 24 % below the official FP8 checkpoint's KL at 55 % of its size) on one card.
# It is the 27B comparison twin of claude-rad-mxfp4.sh — same context config (27b.conf: 260000 ctx,
# 2 seqs; user decision 2026-10-25) and same engine flags, so the A/B is quantization-only.
#   start_qwen38_27b_iq4r-l-v4_rad.sh start|stop|status|logs|print   then: claude --settings ~/.config/claude/local_vllm_direct/settings-redhat.json
# Thin over serve_radiance.sh `start` (which owns: gpu_exclusive, VRAM floor, health poll, cmdline
# record, graceful stop + TIME_WAIT wait). This file pins only what is model-specific.
# IMAGE pinned to 1.17.0: the IQR-V4 .rad containers REFUSE radiance <= 1.16.0 (model card), so
# 1.17.0 is the floor; the pin keeps the comparison reproducible (iron rule 2).
# Deviations from the MXFP4 twin, none of them model-facing:
#   --gpu-headroom-mib 596 instead of the default 96 — the headroom issue is live (113 MiB free at
#   peak crashed the desktop once; docs/guides/vllm/known-issues.md); HIP_FORCE_DEV_KERNARG=0 (the
#   twin's serve_radiance.sh sets it; an unset value gives random MEMORY_FAULT); EXTRA_ARGS appended last.
# Port and served name come from SETTINGS (default the 27b's settings-redhat.json), so the same config
# works unchanged. The name is an alias: Claude and /v1/models show the 27b's name while IQR answers
# (same pattern as start_ornith_35b_vllm_rad.sh).
# Fetch (18.7 GB, ONE file — not the whole repo, which holds all 15 V4 tiers ~200 GB):
#   /mnt/Lin1/work/vllm/sly-radiance/tools/hf-venv/bin/hf download StillDeadcode/qwen3.8-27b-iqr-v4 \
#     --revision e5f1b3ef70741d705a64a28b852acf3fcefcead7 --include "qwen3.8-27b-iq4r-l-v4.rad" \
#     --local-dir /mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef
#   then write SOURCE.txt (repo/revision/date/size) next to it — iron rule 2: an unpinned checkpoint is an unreproducible number.
# serve_vllm.sh does not cover this: it builds vLLM arguments, native Radiance has its own CLI.
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"   # readlink -f: also works via symlink (repo/dp-forge/claude root)
# shellcheck source=../serve_lib.sh
source "$HERE/../serve_lib.sh"
SERVE="$HERE/serve_radiance.sh"
SETTINGS=${SETTINGS:-$HOME/.config/claude/local_vllm_direct/settings-redhat.json}
# status/logs need only the port: a missing or unreadable settings file falls back to ${PORT:-8000}
# (read leaves MODEL empty; status/logs never use the alias). stop refuses instead, so it never stops
# whatever else holds that port.
if ! read -r _ SET_PORT MODEL < <(read_settings_file "$SETTINGS" 2>/dev/null); then
  case "${1:-start}" in
    status|logs) echo "warning: $SETTINGS missing, unreadable or without a valid URL port -- $1 uses PORT=${PORT:-8000}" >&2; SET_PORT=${PORT:-8000};;
    start|stop|print) echo "$SETTINGS: missing, unreadable or without a valid URL port -- ${1:-start} needs it" >&2; exit 2;;
  esac
fi
MODEL_DIR=${MODEL_DIR:-/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef}
RAD_FILE=${RAD_FILE:-$MODEL_DIR/qwen3.8-27b-iq4r-l-v4.rad}
IMAGE=${IMAGE:-stilldeadcode/radiance:1.17.0}
PORT=${PORT:-$SET_PORT}
# shellcheck source=../27b.conf
source "$HERE/../27b.conf"   # MAXLEN/MAXSEQS/HEADROOM_MIB (27B convention; env still wins)
FREE_MIB_FLOOR=${FREE_MIB_FLOOR:-30000}
EXTRA_ARGS="--gpu-headroom-mib $HEADROOM_MIB ${EXTRA_ARGS:-}"

case "${1:-start}" in
  start)
    RAD_FILE=$RAD_FILE IMAGE=$IMAGE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS SERVED_NAME=$MODEL \
      FREE_MIB_FLOOR=$FREE_MIB_FLOOR EXTRA_ARGS=$EXTRA_ARGS "$SERVE" start
    echo "served under alias $MODEL (settings-redhat.json is shared with the MXFP4 server, so /v1/models shows that name)"
    echo "ready: claude --settings $SETTINGS";;
  stop|status|logs|print)
    RAD_FILE=$RAD_FILE IMAGE=$IMAGE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS SERVED_NAME=$MODEL \
      FREE_MIB_FLOOR=$FREE_MIB_FLOOR EXTRA_ARGS=$EXTRA_ARGS "$SERVE" "$1";;
  *) echo "usage: $0 start|stop|status|logs|print" >&2; exit 2;;
esac
