#!/usr/bin/env bash
# qwen35_sly_dflash.sh — start/stop the vLLM server for amd/Qwen3.5-35B-A3B-MXFP4 + z-lab DFlash drafter
# (profile sly-amd/qwen35-35b-a3b-mxfp4-dflash, Sly 1.9.1), then run claude against it.
# ARCHIVED 2026-11-04: slower than stack/serve/radiance/ornith_rad_mtp.sh at the repo root.
#   stack/serve/vllm/retired/qwen35_sly_dflash.sh start|stop|status|logs        then: claude --settings stack/serve/vllm/settings/settings-35b.json
# Settings = same as the 27b (settings-redhat.json): port 8000, MAX_CONTEXT 262000 / MAX_OUTPUT 64000 /
# AUTO_COMPACT 220000, Cactus delta 0, util 0.93, one seq, fp8 KV. Chat template = the model's own
# chat_template.jinja (profile default -- NOT the 27b's Qwen3.8 dp-sharp artifact; override with
# CHAT_TEMPLATE=<host .jinja> if needed). The 27b server and this one share port 8000 -- only one runs at
# a time: this start ASKS before stopping whatever is up on the port (TTY only; non-TTY refuses, see
# serve_vllm.sh).
# Single source of truth = settings-35b.json next to serve_vllm.sh (copy of settings-redhat.json with only
# the four model names changed): MAXLEN comes from CLAUDE_CODE_MAX_CONTEXT_TOKENS, the port from
# ANTHROPIC_BASE_URL, and ANTHROPIC_MODEL must equal the profile's served name (checked before the ~5-min boot).
# `start` runs gpu_exclusive.sh (unloads llama-swap, refuses below FREE_MIB_FLOOR).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVE="$HERE/../serve_vllm.sh"
SETTINGS="$HERE/../settings/settings-35b.json"
: "${PROFILE:=sly-amd/qwen35-35b-a3b-mxfp4-dflash}"

read -r MAXLEN PORT MODEL < <(python3 - "$SETTINGS" <<'EOF'
import json, sys, urllib.parse
e = json.load(open(sys.argv[1]))["env"]
u = urllib.parse.urlparse(e["ANTHROPIC_BASE_URL"])
print(e["CLAUDE_CODE_MAX_CONTEXT_TOKENS"], u.port or 80, e["ANTHROPIC_MODEL"])
EOF
)
[[ "$MAXLEN" =~ ^[0-9]+$ ]] || { echo "settings-35b.json: CLAUDE_CODE_MAX_CONTEXT_TOKENS is not an integer ($MAXLEN)" >&2; exit 2; }

case "${1:-start}" in
  start)
    # check the profile's served name before booting (~5 min) rather than after
    served=$(PROFILE=$PROFILE PORT=$PORT MAXLEN=$MAXLEN "$SERVE" print | grep -oP '(?<=--served-model-name )\S+')
    [ "$served" = "$MODEL" ] || {
      echo "profile $PROFILE serves '$served' but settings-35b.json ANTHROPIC_MODEL is '$MODEL' -- fix one of them" >&2; exit 2; }
    # triton_unfused: the auto-selected EMULATION backend decodes at 16.6 t/s, this at 110.2 (10k, MEASURED,
    # docs/findings/radiance/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md)
    PROFILE=$PROFILE PORT=$PORT MAXLEN=$MAXLEN MAXSEQS=1 KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 \
      CACTUS_DELTA=0 EXTRA_ARGS="--moe-backend triton_unfused ${EXTRA_ARGS:-}" "$SERVE" start
    echo "ready: claude --settings $SETTINGS";;
  stop|status|logs) PORT=$PORT "$SERVE" "$1";;
  *) echo "usage: $0 start|stop|status|logs" >&2; exit 2;;
esac

claude --settings "$SETTINGS" --verbose
