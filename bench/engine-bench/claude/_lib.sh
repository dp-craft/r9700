# _lib.sh — shared by the claude-*.sh launchers (sourced, not run). Boot ONE local server, point Claude Code at it,
# stop the server when Claude exits. Server start/stop stays in serve_radiance.sh / serve_vllm.sh (iron rule 6).
# Knobs (env): PORT(8000) KEEP(0: 1 = leave the server running after Claude exits) WAIT(1200 s to /health)
#   CLAUDE_BASE_SETTINGS(~/.config/claude/local_vllm_direct/settings.json: env block reused, URL/model/window rewritten)
ENG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"      # bench/engine-bench
REPO="$(cd "$ENG/../.." && pwd)"
: "${PORT:=8000}"; : "${KEEP:=0}"; : "${WAIT:=1200}"
: "${CLAUDE_BASE_SETTINGS:=$HOME/.config/claude/local_vllm_direct/settings.json}"
RUNDIR="$REPO/bench/.servers"; mkdir -p "$RUNDIR"
IMAGES=(stilldeadcode/radiance ghcr.io/slybase/vllm-sly-radiance)

# Free the card: any running container of either image (e.g. the crash-looping `vllm` from sly-radiance/run.sh,
# --restart unless-stopped) goes away, restart policy off first so docker does not resurrect it mid-run.
free_gpu() {
  local id img name
  while read -r id img name; do
    case "$img" in stilldeadcode/radiance*|ghcr.io/slybase/vllm-sly-radiance*) ;; *) continue;; esac
    echo "stopping container $name ($img) to free the GPU"
    docker update --restart=no "$id" >/dev/null 2>&1 || true   # fails on a container already marked for removal (Dead); must not abort under set -e
    docker rm -f "$id" >/dev/null
  done < <(docker ps -a --format '{{.ID}} {{.Image}} {{.Names}}')
  for _ in $(seq 30); do ss -ltn | grep -q ":$PORT " || return 0; sleep 1; done
  echo "port $PORT still held by a foreign process" >&2; return 1
}

# wait_health CONTAINER PID — /health must answer while the launcher PID stays alive (the container appears a few s after it)
wait_health() {
  local t=0
  until curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do
    kill -0 "$2" 2>/dev/null || { echo "container $1 died during boot — docker logs $1" >&2; return 1; }
    t=$((t+3)); [ "$t" -le "$WAIT" ] || { echo "no /health after ${WAIT}s" >&2; return 1; }
    sleep 3
  done
}

# run_claude CONTAINER MAXLEN [claude args...] — per-run settings = base env + this server's URL, served name, window
run_claude() {
  local ct=$1 maxlen=$2; shift 2
  local served; served=$(curl -s "http://127.0.0.1:$PORT/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])') \
    || { echo "cannot read /v1/models" >&2; return 1; }
  local cfg="$RUNDIR/$PORT.claude-settings.json"
  python3 - "$CLAUDE_BASE_SETTINGS" "$cfg" "$served" "$maxlen" "$PORT" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); e=d['env']; m=int(sys.argv[4])
e['ANTHROPIC_BASE_URL']=f'http://127.0.0.1:{sys.argv[5]}'
for k in ('ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL'):
    e[k]=sys.argv[3]
# window follows the booted max-model-len; compaction must fire before prompt+output > window (else HTTP 400)
out=int(e['CLAUDE_CODE_MAX_OUTPUT_TOKENS'])
e['CLAUDE_CODE_MAX_CONTEXT_TOKENS']=str(m); e['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']=str(min(75,(m-out)*100//m-3))
json.dump(d,open(sys.argv[2],'w'),indent=2)
PY
  echo "server up: $served on :$PORT (window $maxlen) — starting Claude Code"
  claude --settings "$cfg" --dangerously-skip-permissions --verbose "$@"
}
