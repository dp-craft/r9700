#!/usr/bin/env bash
# serve_llamacpp.sh — parameterized, reproducible llama-server launcher for engine-bench.
# Starts ONE server config in the background, waits for /health, records the exact command line
# and the server's /props (build + effective settings) so every measured number is attributable.
#
# Usage:
#   MODEL=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf BACKEND=vulkan MTP=1 KV=q8_0 \
#     PORT=8081 ./serve_llamacpp.sh            # start
#   PORT=8081 ./serve_llamacpp.sh stop         # stop
#   PORT=8081 ./serve_llamacpp.sh status
#
# Knobs (env): BACKEND=rocm|vulkan (or LLAMA_SERVER=/path for any build, e.g. CUDA on NVIDIA)
#   MODEL CTX(65536) NP(1) UB(2048) B(8192) FA(on) KV(f16|q8_0) MTP(0|1 → --spec-type draft-mtp)
#   NGL(99) PORT(8080) WAIT(420s) EXTRA_ARGS
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
source "$REPO/bench/lib/gpu_env.sh"; gpu_setup_env

: "${BACKEND:=rocm}"
if [ "$BACKEND" = vulkan ]; then DEFBIN="$REPO/bench/llamacpp-vulkan/llama-server"
else DEFBIN="$REPO/bench/llamacpp/llama-server"; fi
: "${LLAMA_SERVER:=$DEFBIN}"
: "${PORT:=8080}"
: "${WAIT:=420}"

RUNDIR="$REPO/bench/.servers"; mkdir -p "$RUNDIR"
PIDFILE="$RUNDIR/$PORT.pid"; LOGFILE="$RUNDIR/$PORT.log"; CMDFILE="$RUNDIR/$PORT.cmdline"

case "${1:-start}" in
  stop)
    if [ -f "$PIDFILE" ]; then
      PID=$(cat "$PIDFILE")
      kill "$PID" 2>/dev/null || true
      for _ in $(seq 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
      kill -9 "$PID" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "stopped port $PORT"
    else
      echo "no pidfile for port $PORT"
    fi
    exit 0;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "running (pid $(cat "$PIDFILE")): $(cat "$CMDFILE" 2>/dev/null)"
    else
      echo "not running"
    fi
    exit 0;;
  start) ;;
  *) echo "usage: $0 [start|stop|status]" >&2; exit 1;;
esac

: "${MODEL:?set MODEL=/path/to/model.gguf}"
: "${CTX:=65536}"
: "${NP:=1}"
: "${UB:=2048}"
: "${B:=8192}"
: "${FA:=on}"
: "${KV:=f16}"
: "${MTP:=0}"
: "${NGL:=99}"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "port $PORT already running (pid $(cat "$PIDFILE")) — stop it first" >&2; exit 1
fi
[ -x "$LLAMA_SERVER" ] || { echo "llama-server not found/executable: $LLAMA_SERVER" >&2; exit 1; }
[ -f "$MODEL" ] || { echo "model not found: $MODEL" >&2; exit 1; }

CMD=("$LLAMA_SERVER" -m "$MODEL" -c "$CTX" -np "$NP" -ngl "$NGL" -fa "$FA"
     -ub "$UB" -b "$B" -ctk "$KV" -ctv "$KV" --host 127.0.0.1 --port "$PORT")
if [ "$MTP" = "1" ]; then CMD+=(--spec-type draft-mtp); fi
if [ -n "${EXTRA_ARGS:-}" ]; then read -r -a XA <<<"$EXTRA_ARGS"; CMD+=("${XA[@]}"); fi

echo "${CMD[*]}" > "$CMDFILE"
nohup "${CMD[@]}" > "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
echo "starting on :$PORT (pid $(cat "$PIDFILE")) — log: $LOGFILE"

for i in $(seq "$WAIT"); do
  if curl -sf -m 2 "http://localhost:$PORT/health" >/dev/null 2>&1; then
    BUILD=$(curl -sf -m 5 "http://localhost:$PORT/props" 2>/dev/null \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("build_info",""))' 2>/dev/null || true)
    echo "up after ${i}s — build: ${BUILD:-unknown}"
    echo "cmdline: $(cat "$CMDFILE")"
    exit 0
  fi
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "server DIED during startup — last log lines:" >&2
    tail -5 "$LOGFILE" >&2; rm -f "$PIDFILE"; exit 1
  fi
  sleep 1
done
echo "server did not become healthy in ${WAIT}s — killing" >&2
kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; exit 1
