#!/usr/bin/env bash
# stack/serve/vllm/start_heretic_27b.sh — start/stop the heretic vLLM server (Qwen3.8-27B heretic MXFP4,
# profile sly-official/heretic-mxfp4, served as swift-1.5) that local_vllm_direct/settings.json talks to (no llama-swap).
#   start_heretic_27b.sh start|stop|status|logs        then: claude --settings ~/.config/claude/local_vllm_direct/settings.json
# (was vllm-heretic.sh in ~/.config/claude/local_vllm_direct/, renamed into the amd repo 2026-11-08; that path is now a symlink)
# Single source of truth = settings.json: MAXLEN comes from CLAUDE_CODE_MAX_CONTEXT_TOKENS, the port from
# ANTHROPIC_BASE_URL, and ANTHROPIC_MODEL must equal the profile's served name (serve_vllm.sh aborts if the server
# answers with another name).
# `start` runs gpu_exclusive.sh (unloads llama-swap, refuses below FREE_MIB_FLOOR). llama-swap reloads
# its model on its next request and would then contend for VRAM -- don't use both at once.
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"   # readlink -f: also works via symlink (repo/dp-forge/claude root)
SERVE="$HERE/serve_vllm.sh"
: "${PROFILE:=sly-official/heretic-mxfp4}"   # Sly 1.8.1 official recipe, served as swift-1.5 (DFlash2 drafter, MXFP4)

read -r MAXLEN PORT MODEL < <(python3 - "/home/dev/.config/claude/local_vllm_direct/settings.json" <<'EOF'
import json, sys, urllib.parse
e = json.load(open(sys.argv[1]))["env"]
u = urllib.parse.urlparse(e["ANTHROPIC_BASE_URL"])
print(e["CLAUDE_CODE_MAX_CONTEXT_TOKENS"], u.port or 80, e["ANTHROPIC_MODEL"])
EOF
)
[[ "$MAXLEN" =~ ^[0-9]+$ ]] || { echo "settings.json: CLAUDE_CODE_MAX_CONTEXT_TOKENS is not an integer ($MAXLEN)" >&2; exit 2; }

case "${1:-start}" in
  start)
    # the heretic profile hard-codes its served name, so check it before booting (~5 min) rather than after
    served=$(PROFILE=$PROFILE PORT=$PORT MAXLEN=$MAXLEN "$SERVE" print | grep -oP '(?<=--served-model-name )\S+')
    [ "$served" = "$MODEL" ] || {
      echo "profile $PROFILE serves '$served' but settings.json ANTHROPIC_MODEL is '$MODEL' -- fix one of them" >&2; exit 2; }
    PROFILE=$PROFILE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=1 KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 "$SERVE" start
    echo "ready: claude --settings /home/dev/.config/claude/local_vllm_direct/settings.json";;
  stop|status|logs) PORT=$PORT "$SERVE" "$1";;
  *) echo "usage: $0 start|stop|status|logs" >&2; exit 2;;
esac
