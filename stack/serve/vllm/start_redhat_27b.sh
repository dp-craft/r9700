#!/usr/bin/env bash
# stack/serve/vllm/start_redhat_27b.sh — start/stop the RedHatAI/Qwen3.8-27B-MXFP4 + DFlash2 vLLM server
# (profile sly-redhat/redhat-mxfp4-dflash, served as qwen38-27b-redhat-mxfp4-dflash) that
# local_vllm_direct/settings-redhat.json talks to (no llama-swap).
#   start_redhat_27b.sh start|stop|status|logs|print    then: claude --settings ~/.config/claude/local_vllm_direct/settings-redhat.json
# (was vllm.sh in ~/.config/claude/local_vllm_direct/, renamed into the amd repo 2026-11-08; that path is now a symlink)
# The Swift-1.5 heretic server is start_heretic_27b.sh (settings.json); both use port 8000, so only one runs at a time.
# Single source of truth = settings-redhat.json (a copy of settings.json with only the four model names changed):
# MAXLEN comes from CLAUDE_CODE_MAX_CONTEXT_TOKENS, the port from ANTHROPIC_BASE_URL, and ANTHROPIC_MODEL must
# equal the profile's served name (serve_vllm.sh aborts if the server answers with another name).
# MAXSEQS comes from 27b.conf (27B convention 260000/2, user decision 2026-10-25, DC1 re-tune 2026-11-09) — the sly launchers and
# this starter agree on it. 2026-11-09: this starter previously passed the stale MAXSEQS=1.
# `start` runs gpu_exclusive.sh (unloads llama-swap, refuses below FREE_MIB_FLOOR), then opens the Claude session.
# llama-swap reloads its model on its next request and would then contend for VRAM -- don't use both at once.
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"   # readlink -f: also works via symlink (repo/dp-forge/claude root)
SERVE="$HERE/serve_vllm.sh"
# shellcheck source=../serve_lib.sh
source "$HERE/../serve_lib.sh"
: "${PROFILE:=sly-redhat/redhat-mxfp4-dflash}"   # Sly 1.8.1 official recipe (heretic's engine layer), served as qwen38-27b-redhat-mxfp4-dflash (DFlash2 drafter, MXFP4)
# dp-sharp chat template (keep-all reasoning, froggeric v22.5 + the dp terse prompt) + Cactus delta 0 (bit-exact acceptance).
# The terse prompt is the template's own `terse` block (kwarg default true, so it is always on for this server).
DP_SHARP="$HERE/templates/dp-sharp-chat_template.jinja"
SETTINGS=${SETTINGS:-/home/dev/.config/claude/local_vllm_direct/settings-redhat.json}
# the 27B convention (env still wins); MAXLEN itself stays with the settings file (see above)
# shellcheck source=../27b.conf
source "$HERE/../27b.conf"

# status/logs need only the port: a missing or unreadable settings file falls back to ${PORT:-8000}.
# stop refuses instead, so it never stops whatever else holds that port.
FALLBACK_PORT=${PORT:-8000}
if read -r MAXLEN PORT MODEL < <(read_settings_file "$SETTINGS" 2>/dev/null); then
  [[ "$MAXLEN" =~ ^[0-9]+$ ]] || { echo "$SETTINGS: CLAUDE_CODE_MAX_CONTEXT_TOKENS is not an integer ($MAXLEN)" >&2; exit 2; }
else
  case "${1:-start}" in
    status|logs) echo "warning: $SETTINGS missing, unreadable or without a valid URL port -- $1 uses PORT=$FALLBACK_PORT" >&2; PORT=$FALLBACK_PORT;;
    start|stop|print) echo "$SETTINGS: missing, unreadable or without a valid URL port -- ${1:-start} needs it" >&2; exit 2;;
  esac
fi

# the env every resolved-argv call uses (start and print must agree)
serve_env() {
  export PROFILE PORT MAXLEN MAXSEQS SPEC_K
  export KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 CACTUS_DELTA=0 CHAT_TEMPLATE="$DP_SHARP"
}

case "${1:-start}" in
  start)
    # check the profile's served name before booting (~5 min) rather than after
    served=$(PROFILE=$PROFILE PORT=$PORT MAXLEN=$MAXLEN "$SERVE" print | grep -oP '(?<=--served-model-name )\S+')
    [ "$served" = "$MODEL" ] || {
      echo "profile $PROFILE serves '$served' but $(basename "$SETTINGS") ANTHROPIC_MODEL is '$MODEL' -- fix one of them" >&2; exit 2; }
    ( serve_env; "$SERVE" start )   # subshell: the serve exports stay out of the shell that execs claude below
    echo "ready: claude --settings $SETTINGS"
    claude --settings "$SETTINGS" --verbose;;
  stop|status|logs) PORT=$PORT "$SERVE" "$1";;
  print) serve_env; "$SERVE" print;;
  *) echo "usage: $0 start|stop|status|logs|print" >&2; exit 2;;
esac
