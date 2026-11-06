#!/usr/bin/env bash
# Manage llama-swap router: kill all llama-swap/llama-server instances and start/stop/restart
set -euo pipefail

BIN="$HOME/.local/bin/llama-swap"
CONFIG="$HOME/.config/llama-swap/config.yaml"
PORT=9292
LOGDIR="$HOME/.config/llama-swap/logs"
PIDFILE="$LOGDIR/llama-swap.pid"
LOG="$LOGDIR/llama-swap.log"

mkdir -p "$LOGDIR"
MY_PID=$$

running_pid() {
  if [ -f "$PIDFILE" ]; then
    local pid
    pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  # fallback: find by port
  if command -v ss >/dev/null 2>&1; then
    local pid
    pid=$(ss -lptn "sport = :$PORT" 2>/dev/null | awk 'NR>1 {print $7}' | cut -d',' -f2 | cut -d'=' -f2 | head -n1)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  return 1
}

kill_by_pattern() {
  local pattern="$1"
  # pgrep -f may match this script; exclude self
  local pids
  pids=$(pgrep -f "$pattern" | grep -v "^${MY_PID}$" || true)
  if [ -n "$pids" ]; then
    echo "Found $pattern pids: $pids"
    for pid in $pids; do
      # kill children first
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
      sleep 0.3
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
  fi
}

kill_all() {
  echo "Killing all llama-swap and llama-server processes..."
  # Use specific command-line fragments to avoid matching this script's path
  kill_by_pattern "llama-swap -config"
  kill_by_pattern "llama-server --model"
  # fallback broader patterns
  kill_by_pattern "llama-swap"
  kill_by_pattern "llama-server"
  # kill by port
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" 2>/dev/null || true
  fi
  # final sweep
  pkill -9 -f "llama-swap -config" || true
  pkill -9 -f "llama-server --model" || true
  sleep 2
  rm -f "$PIDFILE"
}

start() {
  [ -x "$BIN" ] || { echo "llama-swap binary not found: $BIN" >&2; exit 1; }
  [ -f "$CONFIG" ] || { echo "config not found: $CONFIG" >&2; exit 1; }
  if pid=$(running_pid); then
    echo "already running (pid $pid) on :$PORT"
    return 0
  fi
  if curl -sf -m 2 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
    echo "Port $PORT still in use — aborting start"
    exit 1
  fi
  echo "Starting llama-swap..."
  nohup "$BIN" -config "$CONFIG" -listen ":$PORT" -watch-config >"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 1
  if pid=$(running_pid); then
    echo "started (pid $pid) on http://127.0.0.1:$PORT/v1 — log: $LOG"
  else
    echo "FAILED to start — last log lines:" >&2
    tail -n 20 "$LOG" >&2
    exit 1
  fi
}

stop() {
  if pid=$(running_pid); then
    echo "Stopping llama-swap pid $pid..."
    kill_all
    echo "stopped"
  else
    echo "not running"
  fi
}

status() {
  if pid=$(running_pid); then
    echo "running (pid $pid) on http://127.0.0.1:$PORT/v1"
    curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1 && echo "  /v1/models OK" || echo "  (not answering yet)"
  else
    echo "not running"
  fi
}

restart() {
  stop
  start
}

case "${1:-restart}" in
  start)   start ;;
  stop)    stop ;;
  restart) restart ;;
  status)  status ;;
  *) echo "usage: $0 [start|stop|restart|status]" >&2; exit 1 ;;
esac
