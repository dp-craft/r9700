#!/usr/bin/env bash
# test_rad_run.sh — GPU-free regression test for rad_run and free_gpu in clients/claude/_lib.sh
# (F2-1 env prefix, F2-5 graceful free_gpu, F2-10 refuse before destroying; 2026-11-10).
# It sources a copy of the real _lib.sh and serve_lib.sh from a fake repo under this repo's tmp/, with fake docker,
# ss, curl and claude first on PATH and a stub serve_radiance.sh that dumps the env it was given, then checks the calls:
#   1 rad_run + image: the stub gets RAD_FILE/IMAGE/PORT/MAXLEN/MAXSEQS/EXTRA_ARGS (with a space)/CONTAINER_NAME; rc 0
#   2 rad_run, empty image: the same, and IMAGE is unset in the stub
#   3 rad_run, missing .rad: rc != 0 and no docker call at all (free_gpu never ran)
#   3b rad_run, relative .rad path (exists): refused the same way (serve_radiance.sh would refuse only after free_gpu)
#   3c rad_run, absolute path that is not a .rad (exists): refused the same way
#   4 rad_run, image docker says is missing: rc != 0 and the only docker call is `image inspect`
#   5 free_gpu, one listed radiance container: update, then stop -t 60, then rm -f; no warning; LISTEN + TIME_WAIT wait
#   5b free_gpu, a container that survives rm -f: warning on stderr, rc 0
#   6 the EXIT trap after a successful rad_run: stop -t 60 before rm -f on the container
# Rule 3 (2026-11-10, a helper without these killed a live server): this file and every script it writes start with
# the fake bin first on PATH, DOCKER_HOST at a dead socket, and a guard that exits 99 unless `command -v docker` is
# this run's own fake. Run: bash stack/serve/tests/test_rad_run.sh   (no GPU, no docker; exit 0 iff all pass)
set -u
REPO=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../.." && pwd)
mkdir -p "$REPO/tmp"; W=$(mktemp -d -p "$REPO/tmp") || exit 1
trap 'rm -rf "$W"' EXIT
export PATH=$W/bin:/usr/bin:/bin DOCKER_HOST=unix://$W/no-docker.sock FAKE_DIR=$W
mkdir -p "$W/bin" "$W/fake-repo/clients/claude" "$W/fake-repo/stack/serve/radiance"

# script PATH < BODY: writes an executable that starts with the rule-3 lines (this run's $W baked in), then BODY
script() {
  { echo '#!/usr/bin/env bash'
    echo "export PATH=$W/bin:/usr/bin:/bin DOCKER_HOST=unix://$W/no-docker.sock"
    echo "[ \"\$(command -v docker)\" = \"$W/bin/docker\" ] || { echo \"real docker reachable - refusing\" >&2; exit 99; }"
    cat; } > "$1"
  chmod +x "$1"
}
script "$W/bin/docker" <<'EOF'
echo "$*" >> "$FAKE_DIR/docker.log"
case "$1" in
  ps) cat "$FAKE_DIR/ps.out" ;;
  image) case "${3:-}" in missing*) echo "Error: No such image: $3" >&2; exit 1 ;; esac ;;
  rm) case "${3:-}" in wedged*) exit 1 ;; esac ;;
  container) case "${3:-}" in wedged*) exit 0 ;; esac; exit 1 ;;
esac
exit 0
EOF
script "$W/bin/curl" <<'EOF'
echo "$*" >> "$FAKE_DIR/curl.log"
case "$*" in
  *"/health"*) [ -f "$FAKE_DIR/stub.env" ] ;;   # healthy only once the stub has run (a real server answers only when up)
  *"/v1/models"*) echo '{"data":[{"id":"test-served"}]}' ;;
esac
EOF
script "$W/bin/claude" <<'EOF'
echo "$*" >> "$FAKE_DIR/claude.log"
exit 0
EOF
[ "$(command -v docker)" = "$W/bin/docker" ] || { echo "real docker reachable - refusing" >&2; exit 99; }
script "$W/bin/ss" <<'EOF'
echo "$*" >> "$FAKE_DIR/ss.log"
EOF

# the stub serve_radiance.sh: dumps the env rad_run gave it (IMAGE=<unset> when absent), then exits 0
script "$W/fake-repo/stack/serve/radiance/serve_radiance.sh" <<'EOF'
{ for v in RAD_FILE IMAGE PORT MAXLEN MAXSEQS EXTRA_ARGS CONTAINER_NAME; do
    if [ -n "${!v+x}" ]; then printf '%s=%s\n' "$v" "${!v}"; else printf '%s=<unset>\n' "$v"; fi
  done; } > "$FAKE_DIR/stub.env"
exit 0
EOF

[ -f "$REPO/clients/claude/_lib.sh" ] && [ -f "$REPO/stack/serve/serve_lib.sh" ] \
  || { echo "FAIL: clients/claude/_lib.sh or stack/serve/serve_lib.sh not found under $REPO" >&2; exit 1; }
cp "$REPO/clients/claude/_lib.sh" "$W/fake-repo/clients/claude/"
cp "$REPO/stack/serve/serve_lib.sh" "$W/fake-repo/stack/serve/"
printf '%s\n' '{"env": {"ANTHROPIC_BASE_URL": "http://127.0.0.1:8000", "ANTHROPIC_MODEL": "x", "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000"}}' > "$W/base-settings.json"
export AMD_REPO=$W/fake-repo CLAUDE_BASE_SETTINGS=$W/base-settings.json PORT=19990 MAXLEN=260000 MAXSEQS=2 KEEP=0 WAIT=6
IMG=stilldeadcode/radiance:1.17.0
PS_RAD="abc123def456 $IMG radiance-19990"
RAD=$W/model.rad; : > "$RAD"

PASS=0; FAIL=0; ERRS=()
ok()  { PASS=$((PASS+1)); echo "PASS: $*"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $*" >&2; }
err() { ERRS+=("$*"); }
# verdict LABEL: one PASS or FAIL line per case; a FAIL also prints its reasons and the tail of the case's output
verdict() {
  if [ "${#ERRS[@]}" -eq 0 ]; then ok "$1"
  else bad "$1 - $(IFS='; '; echo "${ERRS[*]}")"; tail -6 "$FAKE_DIR/case.out" | sed 's/^/      | /' >&2; fi
  ERRS=()
}
# fresh [PS_LINE]: clears the call logs; `docker ps` prints PS_LINE (nothing when empty)
fresh() {
  rm -f "$FAKE_DIR"/{docker.log,ss.log,curl.log,claude.log,stub.env,case.out}
  : > "$FAKE_DIR/docker.log"
  if [ -n "${1:-}" ]; then echo "$1" > "$FAKE_DIR/ps.out"; else : > "$FAKE_DIR/ps.out"; fi
}
# in_lib CMD...: CMD in a subshell that loads the fake repo's _lib.sh under the launchers' `set -euo pipefail`, with CT
# set as the launchers set it. The subshell owns rad_run's EXIT trap; `wait` lets the stub finish before the checks.
in_lib() {
  ( set -euo pipefail; source "$AMD_REPO/clients/claude/_lib.sh"; unset IMAGE; CT="radiance-$PORT"; "$@"; wait || true )
}
# stub_env KEY VALUE ...: the stub's dump must hold each KEY=VALUE (<unset> = the stub saw no such variable)
stub_env() {
  [ -f "$FAKE_DIR/stub.env" ] || { err "stub never ran"; return; }
  while [ $# -ge 2 ]; do
    local got; got=$(sed -n "s/^$1=//p" "$FAKE_DIR/stub.env" | head -1)
    [ "$got" = "$2" ] || err "stub $1=${got:-<missing>}, want $2"
    shift 2
  done
}

# 1: rad_run with an image: the whole env tail reaches the stub (EXTRA_ARGS keeps its space), rc 0
fresh
in_lib rad_run "$RAD" "$IMG" "--x 1" >"$FAKE_DIR/case.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] || err "rc=$rc, want 0"
stub_env RAD_FILE "$RAD" IMAGE "$IMG" PORT 19990 MAXLEN 260000 MAXSEQS 2 EXTRA_ARGS "--x 1" CONTAINER_NAME radiance-19990
verdict "1 rad_run with an image: stub gets RAD_FILE, IMAGE, PORT, MAXLEN, MAXSEQS, EXTRA_ARGS (with a space), CONTAINER_NAME; rc 0"

# 2: rad_run with an empty image: the same env, and IMAGE is unset in the stub
fresh
in_lib rad_run "$RAD" "" "--x 1" >"$FAKE_DIR/case.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] || err "rc=$rc, want 0"
stub_env RAD_FILE "$RAD" IMAGE "<unset>" PORT 19990 MAXLEN 260000 MAXSEQS 2 EXTRA_ARGS "--x 1" CONTAINER_NAME radiance-19990
verdict "2 rad_run with an empty image: same env, IMAGE unset in the stub; rc 0"

# 3: a missing .rad is refused before free_gpu, so the live container that docker ps lists is never touched
fresh "$PS_RAD"
in_lib rad_run "$W/no-such.rad" "$IMG" "" >"$FAKE_DIR/case.out" 2>&1; rc=$?
[ "$rc" -ne 0 ] || err "rc=0, want non-zero"
[ ! -s "$FAKE_DIR/docker.log" ] || err "docker calls: $(tr '\n' ';' < "$FAKE_DIR/docker.log")"
[ ! -f "$FAKE_DIR/stub.env" ] || err "the stub ran"
grep -q 'rad_run: .rad model not found' "$FAKE_DIR/case.out" || err "no refusal message"
verdict "3 rad_run with a missing .rad: rc != 0, no docker call at all (free_gpu never ran)"

# 3b: a relative .rad path that exists is refused too (serve_radiance.sh would refuse it, but only after free_gpu)
fresh "$PS_RAD"
( cd "$W" && in_lib rad_run model.rad "$IMG" "" ) >"$FAKE_DIR/case.out" 2>&1; rc=$?
[ "$rc" -ne 0 ] || err "rc=0, want non-zero"
[ ! -s "$FAKE_DIR/docker.log" ] || err "docker calls: $(tr '\n' ';' < "$FAKE_DIR/docker.log")"
grep -q 'rad_run: .rad model not found' "$FAKE_DIR/case.out" || err "no refusal message"
verdict "3b rad_run with a relative .rad path: rc != 0, no docker call at all"

# 3c: an absolute path that exists but is not a .rad is refused too
: > "$W/model.gguf"
fresh "$PS_RAD"
in_lib rad_run "$W/model.gguf" "$IMG" "" >"$FAKE_DIR/case.out" 2>&1; rc=$?
[ "$rc" -ne 0 ] || err "rc=0, want non-zero"
[ ! -s "$FAKE_DIR/docker.log" ] || err "docker calls: $(tr '\n' ';' < "$FAKE_DIR/docker.log")"
grep -q 'rad_run: .rad model not found' "$FAKE_DIR/case.out" || err "no refusal message"
verdict "3c rad_run with an absolute non-.rad path: rc != 0, no docker call at all"

# 4: an image docker says is missing is refused after its one `image inspect`, before free_gpu
fresh "$PS_RAD"
in_lib rad_run "$RAD" missing:tag "" >"$FAKE_DIR/case.out" 2>&1; rc=$?
[ "$rc" -ne 0 ] || err "rc=0, want non-zero"
grep -qx 'image inspect missing:tag' "$FAKE_DIR/docker.log" || err "image inspect was not called"
other=$(grep -v '^image inspect ' "$FAKE_DIR/docker.log" | tr '\n' ';')
[ -z "$other" ] || err "docker calls besides image inspect: $other"
[ ! -f "$FAKE_DIR/stub.env" ] || err "the stub ran"
verdict "4 rad_run with an image docker says is missing: rc != 0, the only docker call is image inspect"

# 5: free_gpu on one listed radiance container: graceful first (update, stop -t 60), then rm -f
fresh "$PS_RAD"
in_lib free_gpu >"$FAKE_DIR/case.out" 2>&1
got=$(grep -v '^ps ' "$FAKE_DIR/docker.log")
want=$'update --restart=no abc123def456\nstop -t 60 abc123def456\nrm -f abc123def456'
[ "$got" = "$want" ] || err "docker calls: ${got//$'\n'/; }, want update; stop -t 60; rm -f"
! grep -q '^warning:' "$FAKE_DIR/case.out" || err "warned although rm -f succeeded"
grep -qx -- '-ltn' "$FAKE_DIR/ss.log" && grep -qx -- '-ltn state time-wait' "$FAKE_DIR/ss.log" || err "no LISTEN + TIME_WAIT port wait"
verdict "5 free_gpu with one listed radiance container: update, then stop -t 60, then rm -f"

# 5b: a container that survives stop + rm -f gets the warning, and free_gpu still returns 0 under set -e
fresh "wedged000001 $IMG radiance-old"
in_lib free_gpu >"$FAKE_DIR/case.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] || err "rc=$rc, want 0"
grep -q '^warning: radiance-old is still there' "$FAKE_DIR/case.out" || err "no warning for a container that survived rm -f"
verdict "5b free_gpu, a container survives rm -f: warning on stderr, rc 0"

# 6: the EXIT trap after a successful rad_run: stop -t 60 before rm -f (nothing is listed, so only the trap touches it)
fresh
in_lib rad_run "$RAD" "$IMG" "--x 1" >"$FAKE_DIR/case.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] || err "rc=$rc, want 0"
got=$(grep -F 'radiance-19990' "$FAKE_DIR/docker.log")
want=$'stop -t 60 radiance-19990\nrm -f radiance-19990'
[ "$got" = "$want" ] || err "container calls: ${got//$'\n'/; }, want stop -t 60 then rm -f"
verdict "6 EXIT trap after a successful rad_run: stop -t 60 before rm -f on the container"

echo
echo "test_rad_run: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
