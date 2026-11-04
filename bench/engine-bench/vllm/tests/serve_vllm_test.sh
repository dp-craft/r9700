#!/usr/bin/env bash
# serve_vllm_test.sh — unit tests for serve_vllm.sh's existing-instance handling (NO GPU):
#   T1 dead-leftover container (crashed boot / host restart) + stale state file -> auto-removed at start
#   T2 stale state file without a container -> removed at start
#   T3 live instance + non-TTY start -> refusal, instance untouched
#   T4 live instance + TTY 'y' -> takeover (the live instance is stopped)
#   T5 live instance + TTY 'n' -> abort, instance untouched
#   T6 live instance + run mode (even on a TTY) -> hard refusal, no prompt, instance untouched
#   T7 foreign (non-container) process on the port + TTY 'y' -> that process is killed
#   T8 print mode is unchanged (no docker call, no state change)
#   T9 stop with no container removes the stale state file
#
# The GPU is never touched: EXCLUSIVE points at a stub that fails the free-VRAM floor, so every `start`
# aborts BEFORE docker run. "Live instance" = a dummy container named vllm-$PORT (python3 http.server in
# the local Sly image) holding test port 19999; the real server on port 8000 is never touched.
# Requires: docker, script(1), the local Sly image, and a profile whose model+drafter are fetched
# (default sly-redhat/redhat-mxfp4-dflash). All knobs overridable:
#   PROFILE=... IMAGE=... TEST_PORT=... tests/serve_vllm_test.sh
set -u
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
VD="$(cd "$HERE/.." && pwd)"
SERVE="$VD/serve_vllm.sh"
REPO="$(cd "$VD/../../.." && pwd)"
RUNDIR="$REPO/bench/.servers"
PORT=${TEST_PORT:-19999}
NAME="vllm-$PORT"
PROFILE=${PROFILE:-sly-redhat/redhat-mxfp4-dflash}
IMAGE=${IMAGE:-ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1}

TMP=$(mktemp -d)
STUB="$TMP/exclusive_stub.sh"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
echo "exclusive-stub: free-VRAM floor refused (unit test -- no GPU)"
exit 1
EOF
chmod +x "$STUB"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $*"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $*" >&2; }
check() { local label=$1; shift; if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi; }

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1
  [ -n "${HOSTPID:-}" ] && kill "$HOSTPID" >/dev/null 2>&1
  rm -f "$RUNDIR/$PORT.container" "$RUNDIR/$PORT.cmdline" "$RUNDIR/$PORT.watchdog"
  rm -rf "$TMP"
}
trap cleanup EXIT

port_held() { ss -ltn | grep -q ":$PORT "; }
container_running() { docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null | grep -q true; }

# non-TTY start: stdin = /dev/null -> [ -t 0 ] is false -> the takeover prompt must refuse
start_nontty() { PORT=$PORT PROFILE=$PROFILE EXCLUSIVE=$STUB bash "$SERVE" start </dev/null; }
# TTY start: feeds <answer> through script(1)'s pty; rc = serve_vllm.sh's rc (script -e)
start_tty()   { printf '%s\n' "$1" | script -qec "PORT=$PORT PROFILE=$PROFILE EXCLUSIVE=$STUB bash $SERVE start" /dev/null; }
start_tty_run() { printf '%s\n' "$1" | script -qec "PORT=$PORT PROFILE=$PROFILE EXCLUSIVE=$STUB bash $SERVE run" /dev/null; }

start_dummy() {   # "live vllm instance": our container name, holding the port (http.server, no GPU)
  docker rm -f "$NAME" >/dev/null 2>&1
  docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8001" --entrypoint python3 "$IMAGE" -m http.server 8001 >/dev/null || return 1
  for _ in $(seq 20); do port_held && return 0; sleep 1; done
  return 1
}

command -v script >/dev/null || { echo "needs script(1) (util-linux)" >&2; exit 2; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "needs local image $IMAGE (docker pull $IMAGE)" >&2; exit 2; }
port_held && { echo "test port $PORT is held -- pick another (TEST_PORT=...)" >&2; exit 2; }
OUT=$(PROFILE=$PROFILE PORT=$PORT bash "$SERVE" print 2>&1) || { echo "profile $PROFILE does not resolve: $OUT" >&2; exit 2; }

echo "== T1: dead-leftover container + stale state file are auto-removed at start =="
docker rm -f "$NAME" >/dev/null 2>&1
docker create --name "$NAME" "$IMAGE" true >/dev/null 2>&1   # exists, not running (crash/restart state)
printf 'dead\n' > "$RUNDIR/$PORT.container"
OUT=$(PORT=$PORT PROFILE=$PROFILE EXCLUSIVE=$STUB bash "$SERVE" start </dev/null 2>&1); rc=$?
case "$OUT" in *"dead leftover"*) ok "T1 cleanup message";; *) bad "T1 cleanup message (got: $OUT)";; esac
check "T1 leftover container removed" bash -c '! docker inspect '"$NAME"' >/dev/null 2>&1'
check "T1 state file removed" test ! -e "$RUNDIR/$PORT.container"
[ "$rc" -ne 0 ] && ok "T1 aborted before booting (exclusive stub, rc=$rc)" || bad "T1 expected refusal, got rc=0"

echo "== T2: stale state file without a container is removed at start =="
docker rm -f "$NAME" >/dev/null 2>&1
printf 'stale\n' > "$RUNDIR/$PORT.container"
OUT=$(PORT=$PORT PROFILE=$PROFILE EXCLUSIVE=$STUB bash "$SERVE" start </dev/null 2>&1); rc=$?
check "T2 stale state file removed" test ! -e "$RUNDIR/$PORT.container"
[ "$rc" -ne 0 ] && ok "T2 aborted before booting (rc=$rc)" || bad "T2 expected refusal, got rc=0"

echo "== T3: live instance + non-TTY start -> refusal, instance untouched =="
start_dummy || bad "T3 dummy container did not come up"
OUT=$(start_nontty 2>&1); rc=$?
case "$OUT" in *"is running on port $PORT"*) ok "T3 names the live instance";; *) bad "T3 missing live-instance message (got: $OUT)";; esac
case "$OUT" in *TTY*) ok "T3 non-TTY refusal points at a TTY";; *) bad "T3 missing non-TTY refusal (got: $OUT)";; esac
container_running && ok "T3 instance untouched" || bad "T3 instance was killed"
[ "$rc" -eq 1 ] && ok "T3 exit 1" || bad "T3 rc=$rc"
docker rm -f "$NAME" >/dev/null 2>&1

echo "== T4: live instance + TTY 'y' -> takeover (the instance is stopped) =="
start_dummy || bad "T4 dummy container did not come up"
OUT=$(start_tty y); rc=$?
case "$OUT" in *"Stop it and start"*) ok "T4 prompt shown";; *) bad "T4 prompt missing (got: $OUT)";; esac
container_running && bad "T4 dummy still running after takeover" || ok "T4 dummy stopped (takeover)"
[ "$rc" -ne 0 ] && ok "T4 aborted before booting (exclusive stub, rc=$rc)" || bad "T4 expected refusal, got rc=0"

echo "== T5: live instance + TTY 'n' -> abort, instance untouched =="
start_dummy || bad "T5 dummy container did not come up"
OUT=$(start_tty n); rc=$?
case "$OUT" in *"aborted -- the running instance was not touched"*) ok "T5 abort message";; *) bad "T5 missing abort message (got: $OUT)";; esac
container_running && ok "T5 instance untouched" || bad "T5 instance was killed"
[ "$rc" -eq 1 ] && ok "T5 exit 1" || bad "T5 rc=$rc"
docker rm -f "$NAME" >/dev/null 2>&1

echo "== T6: live instance + run mode (even on a TTY) -> hard refusal, no prompt =="
start_dummy || bad "T6 dummy container did not come up"
OUT=$(start_tty_run y); rc=$?
case "$OUT" in *"exists — PORT=$PORT"*) ok "T6 run-mode refusal message";; *) bad "T6 missing run-mode refusal (got: $OUT)";; esac
case "$OUT" in *"Stop it and start"*) bad "T6 run mode must not prompt";; *) ok "T6 run mode did not prompt";; esac
container_running && ok "T6 instance untouched" || bad "T6 instance was killed"
[ "$rc" -eq 1 ] && ok "T6 exit 1" || bad "T6 rc=$rc"
docker rm -f "$NAME" >/dev/null 2>&1

echo "== T7: foreign (non-container) process on the port + TTY 'y' -> the process is killed =="
docker rm -f "$NAME" >/dev/null 2>&1
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
HOSTPID=$!
for _ in $(seq 10); do port_held && break; sleep 1; done
if ! port_held; then bad "T7 foreign process did not bind port $PORT"; kill "$HOSTPID" 2>/dev/null; HOSTPID=""; fi
if [ -n "${HOSTPID:-}" ]; then
  OUT=$(start_tty y); rc=$?
  case "$OUT" in *"foreign process is holding port $PORT"*) ok "T7 foreign-holder message";; *) bad "T7 missing foreign message (got: $OUT)";; esac
  case "$OUT" in *"killing it per your answer"*) ok "T7 holder killed per answer";; *) bad "T7 missing kill message (got: $OUT)";; esac
  kill -0 "$HOSTPID" 2>/dev/null && bad "T7 foreign process still alive" || ok "T7 foreign process killed"
  [ "$rc" -ne 0 ] && ok "T7 aborted before booting (exclusive stub, rc=$rc)" || bad "T7 expected refusal, got rc=0"
  HOSTPID=""
fi

echo "== T8: print mode is unchanged (no docker call, no state change) =="
docker rm -f "$NAME" >/dev/null 2>&1
printf 'stale\n' > "$RUNDIR/$PORT.container"
OUT=$(PROFILE=$PROFILE PORT=$PORT bash "$SERVE" print 2>&1); rc=$?
case "$OUT" in *docker_argv=*) ok "T8 prints docker argv";; *) bad "T8 missing docker_argv (got: $OUT)";; esac
[ "$rc" -eq 0 ] && ok "T8 exit 0" || bad "T8 rc=$rc"
check "T8 print did not touch the state file" test -e "$RUNDIR/$PORT.container"
check "T8 print did not call docker" bash -c '! docker inspect '"$NAME"' >/dev/null 2>&1'

echo "== T9: stop with no container removes the stale state file =="
docker rm -f "$NAME" >/dev/null 2>&1
printf 'stale\n' > "$RUNDIR/$PORT.container"
OUT=$(PORT=$PORT bash "$SERVE" stop 2>&1); rc=$?
case "$OUT" in *"no container $NAME"*) ok "T9 no-container message";; *) bad "T9 missing message (got: $OUT)";; esac
check "T9 stale state file removed by stop" test ! -e "$RUNDIR/$PORT.container"
[ "$rc" -eq 0 ] && ok "T9 exit 0" || bad "T9 rc=$rc"

echo
echo "serve_vllm.sh unit tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
