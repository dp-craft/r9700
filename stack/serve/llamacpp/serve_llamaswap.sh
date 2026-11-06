#!/usr/bin/env bash
# serve_llamaswap.sh — drive ONE model row of the user's persistent llama-swap router with the same
# print|start|stop contract as vllm/serve_vllm.sh, so gen_campaign.py (kind "agentic") can treat it as
# an engine. llama-swap itself is NEVER started-for-keeps or stopped here: it is the user's router and
# stays up by design; `start` only launches it (via LLAMASWAP_START) if nothing answers on PORT.
#
# Usage:
#   MODEL=<row id> ./serve_llamaswap.sh print   # provenance (config sha, resolved cmd, binary, gguf, template); no GPU
#   MODEL=<row id> ./serve_llamaswap.sh start   # preload the row with a 1-token request, wait until ready, print /props
#   PORT=9292 ./serve_llamaswap.sh stop         # GET /unload, wait for /running to empty, stop the log follower
#
# Knobs (env): PORT(9292) MODEL(llama-swap model id; required for print/start) CONFIG(~/.config/llama-swap/config.yaml)
#   LLAMASWAP_START(~/.config/llama-swap/start_llama_swap.sh) LOG_OUT(file: upstream llama-server log, captured
#   from `start` until `stop`; follower pid in bench/.servers/llamaswap-$PORT.logpid) CURL(curl)
#   LOAD_TIMEOUT_S(900: the preload request; also bounded by llama-swap's own healthCheckTimeout)
#
# Why the preload: llama-swap loads a model on the first request and, with sendLoadingState, streams
# loading messages into that response. Doing the load here keeps them out of the client session.
# /unload is GET -- POST returns 405 and `curl -sf` hides it (iron rule 14, same trap as gpu_exclusive.sh).
set -uo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"

: "${PORT:=9292}"
: "${CONFIG:=$HOME/.config/llama-swap/config.yaml}"
: "${LLAMASWAP_START:=$HOME/.config/llama-swap/start_llama_swap.sh}"
: "${CURL:=curl}"
: "${LOAD_TIMEOUT_S:=900}"
BASE="http://127.0.0.1:$PORT"
RUNDIR="$REPO/stack/serve/var/servers"; mkdir -p "$RUNDIR"
LOGPID="$RUNDIR/llamaswap-$PORT.logpid"

usage() { echo "usage: MODEL=<llama-swap model id> $0 print|start   |   PORT=$PORT $0 stop" >&2; exit 2; }

# Resolve one config row: macros expanded (llama-swap substitutes ${name} text-wise), cmd split like a
# shell would. Emits one JSON object; exit 3 if MODEL is not a row.
row_json() {
  python3 -I - "$CONFIG" "$MODEL" <<'PY'
import json, re, shlex, sys, yaml
cfg = yaml.safe_load(open(sys.argv[1])); mid = sys.argv[2]
row = (cfg.get("models") or {}).get(mid)
if row is None:
    print(f"MODEL '{mid}' is not a row in {sys.argv[1]}", file=sys.stderr); sys.exit(3)
macros = cfg.get("macros") or {}
def expand(s):
    for _ in range(10):
        n = re.sub(r"\$\{([A-Za-z_][\w-]*)\}", lambda m: str(macros[m.group(1)]) if m.group(1) in macros else m.group(0), s)
        if n == s: break
        s = n
    return s
raw = row.get("cmd", "")
argv = shlex.split(expand(raw))
def after(*flags):
    for i, a in enumerate(argv[:-1]):
        if a in flags: return argv[i + 1]
    return ""
print(json.dumps({"raw_cmd": raw, "env": row.get("env") or [], "expanded": " ".join(shlex.quote(a) for a in argv),
                  "binary": argv[0] if argv else "", "gguf": after("--model", "-m"),
                  "template": after("--chat-template-file"), "name": row.get("name", "")}))
PY
}
jget() { python3 -I -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }

swap_up() { "$CURL" -sf -m 3 "$BASE/v1/models" >/dev/null 2>&1; }
running_json() { "$CURL" -sf -m 5 "$BASE/running" 2>/dev/null; }
# prints "<count> <MODEL state or '-'>" from /running
running_state() {
  running_json | python3 -I -c '
import json, sys
r = json.load(sys.stdin).get("running", [])
m = [x.get("state", "?") for x in r if x.get("model") == sys.argv[1]]
print(len(r), m[0] if m else "-")' "${MODEL:-}" 2>/dev/null || echo "? ?"
}
kill_follower() {   # stop the LOG_OUT follower via its pidfile and verify it died
  [ -f "$LOGPID" ] || return 0
  local p; p=$(cat "$LOGPID")
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
    kill "$p" 2>/dev/null
    for _ in $(seq 20); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done
    if kill -0 "$p" 2>/dev/null; then kill -9 "$p" 2>/dev/null; sleep 0.2; fi
    if kill -0 "$p" 2>/dev/null; then echo "log follower pid $p did NOT die" >&2; return 1; fi
  fi
  rm -f "$LOGPID"
}
unload_wait() {   # GET /unload (never POST), then poll /running until empty (<=120 s)
  local code; code=$("$CURL" -s -o /dev/null -w '%{http_code}' -m 60 "$BASE/unload" 2>/dev/null)
  [ "$code" = 200 ] || echo "GET /unload -> HTTP $code  <-- NOT 200, model may still be resident" >&2
  for _ in $(seq 120); do
    [ "$(running_state | cut -d' ' -f1)" = 0 ] && return 0
    sleep 1
  done
  return 1
}
fail() {   # reason + log tail, clean up what start began, leave the GPU empty
  echo "FAIL: $*" >&2
  if [ -n "${LOG_OUT:-}" ] && [ -s "$LOG_OUT" ]; then echo "--- tail $LOG_OUT" >&2; tail -20 "$LOG_OUT" >&2
  else echo "--- tail llama-swap /logs" >&2; "$CURL" -s -m 5 "$BASE/logs" 2>/dev/null | tail -20 >&2; fi
  kill_follower; unload_wait || echo "WARNING: model still resident after /unload -- run: PORT=$PORT $0 stop" >&2
  exit 1
}

case "${1:-}" in
  print|start) : "${MODEL:?set MODEL=<llama-swap model id> (GET $BASE/v1/models, or a key under models: in $CONFIG)}";;
  stop) ;;
  *) usage;;
esac
[ -f "$CONFIG" ] || { echo "CONFIG not found: $CONFIG" >&2; exit 2; }

case "$1" in
print)
  ROW=$(row_json) || exit 1
  BIN=$(echo "$ROW" | jget binary); GGUF=$(echo "$ROW" | jget gguf); TPL=$(echo "$ROW" | jget template)
  echo "# resolved config — print touches no GPU (file reads + binary --version only)"
  echo "MODEL=$MODEL"
  echo "PORT=$PORT"
  echo "CONFIG=$CONFIG sha256=$(sha256sum "$CONFIG" | cut -d' ' -f1)"
  echo "llama_swap_binary=$(command -v llama-swap || echo "$HOME/.local/bin/llama-swap") $("${HOME}/.local/bin/llama-swap" --version 2>&1 | head -1)"
  echo "row_name=$(echo "$ROW" | jget name)"
  echo "row_env=$(echo "$ROW" | python3 -I -c 'import json,sys; print(" ".join(json.load(sys.stdin)["env"]))')"
  echo "row_cmd_raw<<"; echo "$ROW" | jget raw_cmd | sed 's/^/  /'
  echo "row_cmd_expanded=$(echo "$ROW" | jget expanded)   # macros expanded; \${PORT} is assigned by llama-swap at load"
  if [ -n "$BIN" ] && [ -x "$BIN" ]; then
    echo "llama_server=$(readlink -f "$BIN")"
    echo "llama_server_version=$("$BIN" --version 2>&1 | tr '\n' ' ' | sed 's/  */ /g')"
  else echo "llama_server=MISSING ($BIN)"; fi
  if [ -f "$GGUF" ]; then
    echo "gguf=$(readlink -f "$GGUF") size_bytes=$(stat -L -c %s "$GGUF") mtime=$(stat -L -c %y "$GGUF")   # not hashed (17 GB)"
  else echo "gguf=${GGUF:-none-in-cmd} (not a file)"; fi
  if [ -n "$TPL" ]; then
    if [ -f "$TPL" ]; then echo "chat_template=$TPL sha256=$(sha256sum "$TPL" | cut -d' ' -f1)"
    else echo "chat_template=$TPL MISSING"; fi
  else echo "chat_template=none (model's embedded template)"; fi
  echo "printed_utc=$(date -u +%FT%TZ)"
  exit 0;;

start)
  row_json >/dev/null || exit 1   # fail early, before touching anything, if MODEL is not a config row
  if ! swap_up; then
    echo "llama-swap not answering on $BASE -- running $LLAMASWAP_START start" >&2
    [ -x "$LLAMASWAP_START" ] || { echo "LLAMASWAP_START not executable: $LLAMASWAP_START" >&2; exit 1; }
    "$LLAMASWAP_START" start >&2 || true
    for _ in $(seq 60); do swap_up && break; sleep 1; done
    swap_up || { echo "llama-swap still not answering on $BASE after 60 s" >&2; exit 1; }
  fi
  "$CURL" -sf -m 5 "$BASE/v1/models" | python3 -I -c '
import json, sys
ids = [m["id"] for m in json.load(sys.stdin)["data"]]
sys.exit(0 if sys.argv[1] in ids else 1)' "$MODEL" || { echo "MODEL '$MODEL' is not in $BASE/v1/models" >&2; exit 1; }
  # a model another client left resident would make our load a swap and our numbers its leftovers
  read -r NRUN STATE <<<"$(running_state)"
  if [ "$NRUN" != 0 ]; then echo "llama-swap already has $NRUN model(s) resident -- run PORT=$PORT $0 stop first" >&2; exit 1; fi
  if [ -n "${LOG_OUT:-}" ]; then
    kill_follower || exit 1
    mkdir -p "$(dirname "$LOG_OUT")"; : > "$LOG_OUT"
    nohup "$CURL" -sN "$BASE/logs/stream/upstream" >> "$LOG_OUT" 2>&1 </dev/null &
    echo $! > "$LOGPID"; disown
  fi
  echo "preloading $MODEL via $BASE (1-token request, timeout ${LOAD_TIMEOUT_S}s)"
  T0=$(date +%s)
  CODE=$("$CURL" -s -o "$RUNDIR/llamaswap-$PORT.preload.json" -w '%{http_code}' -m "$LOAD_TIMEOUT_S" \
        -H 'Content-Type: application/json' "$BASE/v1/chat/completions" \
        -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":1,\"stream\":false}")
  LOAD_S=$(( $(date +%s) - T0 ))
  [ "$CODE" = 200 ] || fail "preload request returned HTTP $CODE after ${LOAD_S}s ($(head -c 300 "$RUNDIR/llamaswap-$PORT.preload.json" 2>/dev/null))"
  read -r NRUN STATE <<<"$(running_state)"
  [ "$STATE" = ready ] || fail "preload HTTP 200 but /running does not list $MODEL as ready (resident=$NRUN state=$STATE)"
  PROPS=$("$CURL" -sf -m 10 "$BASE/upstream/$MODEL/props") || fail "GET /upstream/$MODEL/props failed"
  echo "up after ${LOAD_S}s -- $MODEL state=ready${LOG_OUT:+ -- upstream log: $LOG_OUT (follower pid $(cat "$LOGPID"))}"
  echo "props: $(echo "$PROPS" | python3 -I -c '
import json, sys
p = json.load(sys.stdin); g = p.get("default_generation_settings", {})
print(json.dumps({"n_ctx": g.get("n_ctx"), "total_slots": p.get("total_slots"), "build_info": p.get("build_info"),
                  "model_path": p.get("model_path"), "chat_template_caps": bool(p.get("chat_template_caps"))}))')"
  exit 0;;

stop)
  if ! swap_up; then
    kill_follower
    echo "llama-swap not answering on $BASE -- nothing to unload"; echo "unloaded=yes"; exit 0
  fi
  unload_wait; UN=$?
  kill_follower || UN=1
  if [ "$UN" = 0 ]; then echo "unloaded=yes"; exit 0; fi
  echo "still resident: $(running_json)" >&2; echo "unloaded=no"; exit 1;;
esac
