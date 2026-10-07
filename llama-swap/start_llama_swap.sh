#!/usr/bin/env bash
# Start / stop / status the local llama-swap router (OpenAI endpoint on :9292 for opencode).
#   ./llama_swap_start.sh          # start (idempotent — won't double-start)
#   ./llama_swap_start.sh stop
#   ./llama_swap_start.sh status
#   ./llama_swap_start.sh restart
set -euo pipefail


# Force HIP to recognize the R9700 architecture properly
export HSA_OVERRIDE_GFX_VERSION=12.0.1

# Optimize memory allocation performance
export MALLOC_THROTTLE=0
export GLIBC_TUNABLES=glibc.malloc.tcache_max=1048576
export GGML_HIPBLAS=ON
export HSA_DISABLE_CACHE=1

# 1. KIKAPCSOLJUK a CPU aktív várakozását (Spin-Lock) a ROCm-ban
export HSA_ENABLE_INTERRUPT=1

# 2. Optimalizáljuk a szálkezelést Ubuntu alatt
#export OMP_NUM_THREADS=1           # Szálütközés elkerülése
#export GOTO_NUM_THREADS=1
#export OPENBLAS_NUM_THREADS=1
export HSA_POLL_TIMEOUT=1    # Csökkentjük az időt, amíg a CPU pörögve vár


BIN="$HOME/.local/bin/llama-swap"
CONFIG="$HOME/.config/llama-swap/config.yaml"
PORT=9292
LOGDIR="$HOME/.config/llama-swap/logs"
PIDFILE="$LOGDIR/llama-swap.pid"
LOG="$LOGDIR/llama-swap.log"
mkdir -p "$LOGDIR"

running_pid() {  # echo pid if our instance is alive, else nothing
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && cat "$PIDFILE"
}

case "${1:-start}" in
  status)
    if pid=$(running_pid); then
      echo "running (pid $pid) on http://127.0.0.1:$PORT/v1"
      curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1 && echo "  /v1/models OK" || echo "  (not answering yet)"
    else
      echo "not running"
    fi
    ;;
  stop)
    if pid=$(running_pid); then
      kill "$pid"; for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
      kill -9 "$pid" 2>/dev/null || true; rm -f "$PIDFILE"
      echo "stopped (pid $pid)"
    else
      echo "not running"
    fi
    ;;
  restart)
    "$0" stop; "$0" start
    ;;
  start)
    if pid=$(running_pid); then
      echo "already running (pid $pid) on :$PORT"; exit 0
    fi
    if curl -sf -m 2 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
      echo "something else is already serving :$PORT — not starting a second instance"; exit 1
    fi
    [ -x "$BIN" ]    || { echo "llama-swap binary not found: $BIN" >&2; exit 1; }
    [ -f "$CONFIG" ] || { echo "config not found: $CONFIG" >&2; exit 1; }
    nohup "$BIN" -config "$CONFIG" -listen ":$PORT" -watch-config >"$LOG" 2>&1 &
    echo $! >"$PIDFILE"
    sleep 1
    if pid=$(running_pid); then
      echo "started (pid $pid) on http://127.0.0.1:$PORT/v1  — log: $LOG"
      echo "pick a model in opencode: /models -> llama-swap (R9700 local)"
    else
      echo "FAILED to start — last log lines:" >&2; tail -8 "$LOG" >&2; exit 1
    fi
    ;;
  *)
    echo "usage: $0 [start|stop|status|restart]" >&2; exit 1;;
esac
