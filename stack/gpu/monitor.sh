#!/usr/bin/env bash
# monitor.sh — live view of the booted vLLM server (thin wrapper around stack/gpu/monitor.py):
# per-call tokens/TTFT/TPS + GPU + log table. Read-only — it never touches the server.
# Records the session to stack/serve/var/servers/<port>.session.jsonl by default.
# Usage: ./monitor.sh [monitor args]        Knobs: _lib.sh (PORT)
#   e.g. ./monitor.sh --once          ./monitor.sh --history 50          ./monitor.sh --out /tmp/s.jsonl
set -euo pipefail
source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_lib.sh"
python3 "$REPO/stack/gpu/monitor.py" --port "$PORT" --out "$RUNDIR/$PORT.session.jsonl" "$@"
