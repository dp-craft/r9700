# _lib.sh — shared by the claude-*.sh launchers (sourced, not run). Boot ONE local server, point Claude Code at it,
# stop the server when Claude exits. Server start/stop stays in serve_radiance.sh / serve_vllm.sh (iron rule 6).
# Knobs (env): PORT(8000) KEEP(0: 1 = leave the server running after Claude exits) WAIT(1200 s to /health)
#   CLAUDE_BASE_SETTINGS(~/.config/claude/local_vllm_direct/settings.json: env block reused, URL/model/window rewritten)
REPO="${AMD_REPO:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../amd" && pwd)}"   # amd/clients/claude -> repo root (readlink -f lands in the repo even via the amd-private copy)
ENG="$REPO/stack/serve"      # vllm/serve_vllm.sh, radiance/serve_radiance.sh
source "$ENG/serve_lib.sh"   # wait_port_bindable (free_gpu): port re-bindable = LISTEN gone + TIME_WAIT drained
: "${PORT:=8000}"; : "${KEEP:=0}"; : "${WAIT:=1200}"
: "${CLAUDE_BASE_SETTINGS:=$HOME/.config/claude/local_vllm_direct/settings.json}"
RUNDIR="$REPO/stack/serve/var/servers"; mkdir -p "$RUNDIR"
IMAGES=(stilldeadcode/radiance ghcr.io/slybase/vllm-sly-radiance)

# Free the card: any running container of either image (e.g. the crash-looping `vllm` from sly-radiance/run.sh,
# --restart unless-stopped) goes away, restart policy off first so docker does not resurrect it mid-run.
free_gpu() {
  local id img name
  while read -r id img name; do
    case "$img" in stilldeadcode/radiance*|ghcr.io/slybase/vllm-sly-radiance*) ;; *) continue;; esac
    echo "stopping container $name ($img) to free the GPU"
    docker update --restart=no "$id" >/dev/null 2>&1 || true   # fails on a container already marked for removal (Dead); must not abort under set -e
    # graceful first, like serve_vllm.sh / serve_radiance.sh (a SIGKILL'd engine can wedge the card); both bounded.
    # a run-mode container (--rm) is auto-removed as it stops, so the rm -f below may find nothing: warn only if it is still there
    timeout 90 docker stop -t 60 "$id" >/dev/null 2>&1 || true
    timeout 60 docker rm -f "$id" >/dev/null 2>&1 || ! docker container inspect "$id" >/dev/null 2>&1 \
      || echo "warning: $name is still there after stop + rm -f (GPU process may be wedged in the driver)" >&2
  done < <(docker ps -a --format '{{.ID}} {{.Image}} {{.Names}}')
  wait_port_bindable "$PORT"   # LISTEN gone and TIME_WAIT drained: a fresh bind fails EADDRINUSE until then
}

# wait_health CONTAINER PID — /health must answer while the launcher PID stays alive (the container appears a few s after it)
# Run mode is --rm, so a container that died during boot is usually already gone when PID exits: "no container" does not prove it never started.
wait_health() {
  local t=0
  until curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do
    kill -0 "$2" 2>/dev/null || {
      if docker container inspect "$1" >/dev/null 2>&1; then echo "container $1 died during boot — docker logs $1" >&2
      else echo "launch exited with no container $1 (never started, or died and --rm removed it) — see the log tail below" >&2; fi
      return 1; }
    t=$((t+3)); [ "$t" -le "$WAIT" ] || { echo "no /health after ${WAIT}s" >&2; return 1; }
    sleep 3
  done
}

# write_claude_settings BASE CFG SERVED MAXLEN PORT — per-run settings = base env + this server's URL,
# served name (x4), window, and EXACTLY ONE compaction knob (2026-11-09, the "compacted at 140k" fix):
# CLAUDE_CODE_AUTO_COMPACT_WINDOW = window - max output, so a full max-length reply always fits and
# compaction fires before prompt+output > window (else HTTP 400). Any base-file
# CLAUDE_CODE_AUTO_COMPACT_WINDOW / CLAUDE_AUTOCOMPACT_PCT_OVERRIDE is dropped, never inherited —
# three conflicting knobs (base absolute + base PCT + per-run PCT) made the effective window
# non-deterministic. Unit test: amd/stack/serve/tests/test_claude_settings.sh.
write_claude_settings() {
  python3 - "$1" "$2" "$3" "$4" "$5" <<'PY'
import json, sys
base, cfg, served, m, port = sys.argv[1:6]
m = int(m)
d = json.load(open(base)); e = d['env']
e['ANTHROPIC_BASE_URL'] = f'http://127.0.0.1:{port}'
for k in ('ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL'):
    e[k] = served
out = int(e.get('CLAUDE_CODE_MAX_OUTPUT_TOKENS', 64000))
e['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = str(m)
e['CLAUDE_CODE_AUTO_COMPACT_WINDOW'] = str(m - out)
e.pop('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', None)
json.dump(d, open(cfg, 'w'), indent=2)
PY
}

# run_claude CONTAINER MAXLEN [claude args...] — per-run settings = base env + this server's URL, served name, window
run_claude() {
  local ct=$1 maxlen=$2; shift 2
  local served; served=$(curl -s "http://127.0.0.1:$PORT/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])') \
    || { echo "cannot read /v1/models" >&2; return 1; }
  local cfg="$RUNDIR/$PORT.claude-settings.json"
  write_claude_settings "$CLAUDE_BASE_SETTINGS" "$cfg" "$served" "$maxlen" "$PORT"
  echo "server up: $served on :$PORT (window $maxlen) — starting Claude Code"
  claude --settings "$cfg" --dangerously-skip-permissions --verbose "$@"
}

# rad_run RAD_FILE IMAGE EXTRA_ARGS [claude args...] — the shared tail of every claude-rad-*.sh
# (2026-11-09 consolidation): free the card, boot serve_radiance.sh in the background (run mode,
# log -> $RUNDIR/$PORT.log), wait for /health, hand off to run_claude. IMAGE may be empty
# (serve_radiance.sh's default image); EXTRA_ARGS may be empty. MAXLEN/MAXSEQS from the caller's env
# (27B launchers source $REPO/stack/serve/27b.conf; the rest keep their own).
rad_run() {
  local rad=$1 image=$2 extra=$3; shift 3
  # refuse BEFORE free_gpu: a missing model or image must not cost the user the live server
  # the same path rule as serve_radiance.sh (absolute, .rad), which would refuse it only after free_gpu
  [ "${rad:0:1}" = / ] && [ "${rad##*.}" = rad ] && [ -f "$rad" ] || { echo "rad_run: .rad model not found: '$rad' (RAD_FILE unset, not an absolute .rad path, or not a file)" >&2; return 1; }
  [ -z "$image" ] || docker image inspect "$image" >/dev/null 2>&1 || { echo "rad_run: image '$image' is not present locally — docker pull it first" >&2; return 1; }
  local img_env=(); [ -n "$image" ] && img_env=("IMAGE=$image")   # IMAGE only when set; an expansion-built prefix word is not an assignment, so it goes to env as an operand
  free_gpu
  # graceful stop, then rm -f, both bounded; || true because under set -e a failing trap command aborts the trap and changes the exit status
  [ "$KEEP" = 1 ] || trap 'timeout 90 docker stop -t 60 "$CT" >/dev/null 2>&1 || true; timeout 60 docker rm -f "$CT" >/dev/null 2>&1 || true' EXIT
  env "RAD_FILE=$rad" "${img_env[@]}" "PORT=$PORT" "MAXLEN=$MAXLEN" "MAXSEQS=$MAXSEQS" "EXTRA_ARGS=$extra" "CONTAINER_NAME=$CT" \
    "$ENG/radiance/serve_radiance.sh" run >"$RUNDIR/$PORT.log" 2>&1 &
  wait_health "$CT" $! || { tail -20 "$RUNDIR/$PORT.log" >&2; exit 1; }
  run_claude "$CT" "$MAXLEN" "$@"
}
