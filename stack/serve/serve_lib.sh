# stack/serve/serve_lib.sh — shared helpers for the serve drivers and starters (sourced, never run).
# GPU-free: everything here works without a GPU (read settings files, wait on ports).
# Used by: serve_vllm.sh, serve_radiance.sh, the vllm/radiance starters, and the unit tests.

# read_settings_file FILE — print "MAXLEN PORT MODEL" from a claude settings JSON's env block:
# CLAUDE_CODE_MAX_CONTEXT_TOKENS, the ANTHROPIC_BASE_URL port, and ANTHROPIC_MODEL.
# A URL without an explicit port fails (prints nothing) instead of silently meaning 80.
# Replaces the per-starter python heredocs (2026-11-09 consolidation).
read_settings_file() {
  python3 - "$1" <<'EOF'
import json, sys, urllib.parse
e = json.load(open(sys.argv[1]))["env"]
port = urllib.parse.urlparse(e["ANTHROPIC_BASE_URL"]).port
if not port:
    sys.exit(f"{sys.argv[1]}: ANTHROPIC_BASE_URL has no explicit port")
print(e["CLAUDE_CODE_MAX_CONTEXT_TOKENS"], port, e["ANTHROPIC_MODEL"])
EOF
}

# wait_port_bindable PORT [LISTEN_MAX=30] [TW_MAX=70] [HOLDER_DESC...]
# Wait until :PORT is actually re-bindable: first no LISTEN socket, then drain the kernel's TIME_WAIT.
# Closed connections hold the port for the MSL (~60 s) with NO listener left, so a fresh bind fails
# EADDRINUSE in that window — seen 2026-11-08, stop->start back-to-back.
# On failure: print who holds the port (HOLDER_DESC is an optional command that describes it, e.g.
# serve_vllm.sh's port_holder) and return 1. The TIME_WAIT wait itself is best-effort — it just ends.
wait_port_bindable() {
  local port=$1 lm=${2:-30} tw=${3:-70}
  local holder_desc=("${@:4}")
  local i holder="ss -ltnp | grep :$port"
  for i in $(seq "$lm"); do ss -ltn | grep -q ":$port " || break; sleep 1; done
  if ss -ltn | grep -q ":$port "; then
    if [ "${#holder_desc[@]}" -gt 0 ]; then holder=$("${holder_desc[@]}" 2>/dev/null) || holder="unknown — ${holder_desc[*]}"; fi
    echo "port $port still held by: ${holder:-unknown}" >&2
    return 1
  fi
  for i in $(seq "$tw"); do ss -ltn state time-wait 2>/dev/null | grep -q ":$port " || break; sleep 1; done
  return 0
}
