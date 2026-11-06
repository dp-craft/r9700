#!/usr/bin/env bash
# monitor.sh — live view of the booted vLLM server (thin wrapper around stack/gpu/monitor.py):
# per-call tokens/TTFT/TPS + GPU + log table. Read-only — it never touches the server.
# Records the session to stack/serve/var/servers/<port>.session.jsonl by default.
# Usage: ./monitor.sh [monitor args]        Knobs (env): PORT (8000)
#   e.g. ./monitor.sh --once          ./monitor.sh --history 50          ./monitor.sh --out /tmp/s.jsonl
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
: "${PORT:=8000}"
RUNDIR="$REPO/stack/serve/var/servers"; mkdir -p "$RUNDIR"
python3 "$HERE/monitor.py" --port "$PORT" --out "$RUNDIR/$PORT.session.jsonl" "$@"
