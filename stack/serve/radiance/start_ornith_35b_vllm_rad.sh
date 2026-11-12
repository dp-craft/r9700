#!/usr/bin/env bash
# stack/serve/radiance/start_ornith_35b_vllm_rad.sh — start/stop native Radiance ("rad") serving
# keptn/ornith-1.5-35b-a3b-w4a8 (own MTP head, K=3) on one card. (was ornith_rad_mtp.sh, renamed 2026-11-08)
#   start_ornith_35b_vllm_rad.sh start|stop|status|logs|print   then: claude --settings ~/.config/claude/local_vllm_direct/settings-redhat.json
# Thin over serve_radiance.sh `start` (which owns: gpu_exclusive, VRAM floor, health poll, cmdline
# record, graceful stop + TIME_WAIT wait, HIP_FORCE_DEV_KERNARG=0).
# Flags = the creator's deploy/compose/ornith-1.5-35b-a3b-w4a8-tp1.yaml (codeberg.org/StillDeadcode/radiance)
# verbatim: 262144 ctx + 3 seqs are the creator's, NOT the 27B convention (27b.conf) — this is a 35B model.
# Deviations from that compose file, none of them model-facing:
#   --host 127.0.0.1 instead of :: (local only, so no API key); no restart policy (a reboot must not hold VRAM);
#   image pinned instead of :latest (iron rule 2); --served-model-name = the usual Claude settings' ANTHROPIC_MODEL.
# Claude: port and served name come from SETTINGS (default the 27b's settings-redhat.json), so the same config works
# unchanged. A readable file's port always wins, even over an exported PORT (as in the vLLM starters); PORT is the
# fallback only when the file is unreadable (status/logs). The name is an alias: Claude and /v1/models show the
# 27b's name while Ornith answers.
# VRAM: Radiance claims all free VRAM minus the headroom, whatever --max-model-len is; the KV cache takes the rest.
# The default 96 left about 232 MiB free (MEASURED), which crashed the desktop once, so the headroom is 500 MiB higher;
# not measured yet. Close Chrome if VRAM gets tight.
# EXTRA_ARGS="--gpu-headroom-mib 2048" is recommended only (docs/guides/vllm/known-issues.md).
# For precise coding the creator suggests --temp 0.6 --presence-penalty 0 (EXTRA_ARGS=... appended last, later flag wins).
# Thinking stays on (operator's rule; added to the compose flags): explicit default, and reasoning_effort none/minimal is
# remapped. A request's own chat_template_kwargs {"enable_thinking":false} still wins; no server flag blocks that.
# Fetch: stack/serve/vllm/fetch_model.sh keptn/ornith-1.5-35b-a3b-w4a8 cfed0f8f07d0ef8d0c7dcf4d29a07eeb6a402472
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
VLLM_ROOT=${VLLM_ROOT:-/mnt/Lin1/work/vllm/sly-radiance}
MODEL_DIR=${MODEL_DIR:-$VLLM_ROOT/models/keptn__ornith-1.5-35b-a3b-w4a8@cfed0f8f}
RAD_FILE=${RAD_FILE:-$MODEL_DIR/ornith-1.5-35b-a3b-w4a8.rad}
IMAGE=${IMAGE:-stilldeadcode/radiance:1.16.0}
PORT=${SET_PORT:-${PORT:-8000}}   # the settings file's port wins; an exported PORT only when the file is unreadable
FREE_MIB_FLOOR=${FREE_MIB_FLOOR:-30000}
WAIT=${WAIT:-900}
# the creator's compose values (35B — deliberately not 27b.conf's 260000/2)
MAXLEN=262144; MAXSEQS=3
# compose's reasoning map, verbatim (single comma-joined flag); sampler + MTP + headroom via EXTRA_ARGS
REASONING_MAP=${REASONING_MAP:-"none=high,minimal=high"}
EXTRA_ARGS="--gpu-headroom-mib 596 --num-speculative-tokens 3 --max-num-batched-tokens 2048 \
  --temp 1.0 --top-p 0.95 --top-k 20 --presence-penalty 1.5 \
  --chat-template-kwargs {\"enable_thinking\":true} ${EXTRA_ARGS:-}"

case "${1:-start}" in
  start)
    RAD_FILE=$RAD_FILE IMAGE=$IMAGE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS SERVED_NAME=$MODEL \
      REASONING_MAP=$REASONING_MAP FREE_MIB_FLOOR=$FREE_MIB_FLOOR WAIT=$WAIT EXTRA_ARGS=$EXTRA_ARGS "$SERVE" start
    echo "served under alias $MODEL (settings-redhat.json is shared with the 27B server, so /v1/models shows that name)"
    echo "ready: claude --settings $SETTINGS";;
  stop|status|logs|print)
    RAD_FILE=$RAD_FILE IMAGE=$IMAGE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=$MAXSEQS SERVED_NAME=$MODEL \
      REASONING_MAP=$REASONING_MAP FREE_MIB_FLOOR=$FREE_MIB_FLOOR WAIT=$WAIT EXTRA_ARGS=$EXTRA_ARGS "$SERVE" "$1";;
  *) echo "usage: $0 start|stop|status|logs|print" >&2; exit 2;;
esac
