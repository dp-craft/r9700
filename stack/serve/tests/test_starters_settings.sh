#!/usr/bin/env bash
# test_starters_settings.sh — how the four settings-file starters treat a missing or bad settings file
# (start_heretic_27b.sh, start_redhat_27b.sh, start_qwen38_27b_iq4r-l-v4_rad.sh, start_ornith_35b_vllm_rad.sh):
#   - missing file: start/stop/print exit 2 with NO docker call (stop never guesses a port);
#     status and logs fall back to ${PORT:-8000} and reach docker with that port
#   - ANTHROPIC_BASE_URL without a valid port (none, 0, 70000, abc): read_settings_file fails, so stop exits 2
#     (was: port 80 for none)
#   - a valid file: stop reaches docker on the port the starter resolves (file and PORT agree here: the
#     vLLM starters let the file win, the radiance ones PORT -- an open owner decision)
# GPU-free and docker-free: a logging stub docker (exit 1) is first on PATH and DOCKER_HOST points nowhere.
# Test port 19992 only, pre-checked free. Run: bash stack/serve/tests/test_starters_settings.sh
set -u
SELF=$(readlink -f "${BASH_SOURCE[0]}")
ROOT=$(cd "$(dirname "$SELF")/../../.." && pwd)
P=19992
ss -ltn | grep -q ":$P " && { echo "FAIL - test port $P is in use" >&2; exit 1; }
mkdir -p "$ROOT/tmp"; TMP=$(mktemp -d -p "$ROOT/tmp"); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
printf '#!/usr/bin/env bash\necho "$*" >> "%s/calls.log"\nexit 1\n' "$TMP" > "$TMP/bin/docker"; chmod +x "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH" DOCKER_HOST=unix:///nonexistent-docker.sock
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $*"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $*"; }
settings() {   # settings URL -> file
  python3 - "$1" "$2" <<'PY'
import json, sys
json.dump({"env": {"CLAUDE_CODE_MAX_CONTEXT_TOKENS": "260000", "ANTHROPIC_BASE_URL": sys.argv[1],
                   "ANTHROPIC_MODEL": "test-model"}}, open(sys.argv[2], "w"))
PY
}
settings "http://127.0.0.1:$P" "$TMP/valid.json"
settings "http://127.0.0.1" "$TMP/noport.json"
settings "http://127.0.0.1:0" "$TMP/port0.json"
settings "http://127.0.0.1:70000" "$TMP/port70000.json"
settings "http://127.0.0.1:abc" "$TMP/portabc.json"
run() {   # SETTINGS ACTION STARTER -> rc in $rc, docker calls in $calls
  : > "$TMP/calls.log"
  SETTINGS=$1 PORT=$P bash "$3" "$2" </dev/null >"$TMP/out" 2>&1; rc=$?
  calls=$(cat "$TMP/calls.log")
}

for s in "$ROOT/stack/serve/vllm/start_heretic_27b.sh" "$ROOT/stack/serve/vllm/start_redhat_27b.sh" \
         "$ROOT/stack/serve/radiance/start_qwen38_27b_iq4r-l-v4_rad.sh" "$ROOT/stack/serve/radiance/start_ornith_35b_vllm_rad.sh"; do
  n=$(basename "$s"); echo "== $n"
  for a in start stop print; do
    run "$TMP/missing.json" "$a" "$s"
    [ "$rc" -eq 2 ] && [ -z "$calls" ] && ok "missing file: $a exits 2, no docker call" || bad "missing file: $a rc=$rc calls=[$calls]"
  done
  run "$TMP/missing.json" status "$s"
  [ "$rc" -ne 2 ] && grep -q -- "-$P" <<<"$calls" && ok "missing file: status falls back to PORT=$P" || bad "missing file: status rc=$rc calls=[$calls]"
  run "$TMP/missing.json" logs "$s"
  [ "$rc" -ne 2 ] && grep -q -- "-$P" <<<"$calls" && ok "missing file: logs falls back to PORT=$P" || bad "missing file: logs rc=$rc calls=[$calls]"
  for b in noport port0 port70000 portabc; do
    run "$TMP/$b.json" stop "$s"
    [ "$rc" -eq 2 ] && [ -z "$calls" ] && ok "$b URL: stop exits 2, no docker call" || bad "$b URL: stop rc=$rc calls=[$calls]"
  done
  run "$TMP/valid.json" stop "$s"
  grep -q -- "-$P" <<<"$calls" && ok "valid file: stop reaches docker on port $P" || bad "valid file: stop rc=$rc calls=[$calls]"
done

echo
echo "test_starters_settings: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
