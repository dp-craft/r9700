#!/usr/bin/env bash
# test_claude_settings.sh — unit test for amd-private's _lib.sh write_claude_settings (the per-run
# claude-settings writer that run_claude uses before every `claude --settings` launch).
# GPU-free: no server, no docker — a hostile fixture base JSON + the real function from _lib.sh.
# The writer's contract (2026-11-09, the "compacted at 140k" fix):
#   - model x4 + ANTHROPIC_BASE_URL rewritten to the served server
#   - CLAUDE_CODE_MAX_CONTEXT_TOKENS = the booted window
#   - EXACTLY ONE compaction knob: CLAUDE_CODE_AUTO_COMPACT_WINDOW = window - max output
#     (a full max-length reply always fits) — any base-file AUTO_COMPACT_WINDOW or
#     CLAUDE_AUTOCOMPACT_PCT_OVERRIDE is dropped, never inherited
set -u
SELF=$(readlink -f "${BASH_SOURCE[0]}")
ROOT=$(cd "$(dirname "$SELF")/../../.." && pwd)
APRIV=$(cd "$ROOT/clients/claude" 2>/dev/null && pwd || true)
[ -n "${APRIV:-}" ] || { echo "FAIL - clients/claude not found in $ROOT (the launcher home)" >&2; exit 1; }
BASE_SETTINGS=${BASE_SETTINGS:-/home/dev/.config/claude/local_vllm_direct/settings.json}
[ -f "$BASE_SETTINGS" ] || { echo "FAIL - base settings not found: $BASE_SETTINGS" >&2; exit 1; }

mkdir -p "$ROOT/tmp"; TMP=$(mktemp -d -p "$ROOT/tmp"); trap 'rm -rf "$TMP"' EXIT
# hostile fixture: the stale values the real base file carried (2026-11-09), so a lazy writer fails
python3 - "$BASE_SETTINGS" "$TMP/base.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["env"]["CLAUDE_CODE_AUTO_COMPACT_WINDOW"] = "220000"
d["env"]["CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"] = "95"
json.dump(d, open(sys.argv[2], "w"), indent=2)
PY

export AMD_REPO=$ROOT
# shellcheck source=/dev/null
source "$APRIV/_lib.sh"
if ! type write_claude_settings >/dev/null 2>&1; then
  echo "FAIL - _lib.sh has no write_claude_settings function (run_claude must expose it)" >&2
  exit 1
fi
if ! write_claude_settings "$TMP/base.json" "$TMP/out.json" qwen35 260000 8000; then
  echo "FAIL - write_claude_settings errored" >&2
  exit 1
fi

python3 - "$TMP/out.json" <<'PY' && echo "PASS: write_claude_settings (served name x4, URL, one compaction knob = window - output)" || exit 1
import json, sys
e = json.load(open(sys.argv[1]))["env"]
errs = []
for k in ("ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL"):
    if e.get(k) != "qwen35":
        errs.append(f"{k} = {e.get(k)!r}, want qwen35")
if e.get("ANTHROPIC_BASE_URL") != "http://127.0.0.1:8000":
    errs.append(f"ANTHROPIC_BASE_URL = {e.get('ANTHROPIC_BASE_URL')!r}")
if e.get("CLAUDE_CODE_MAX_CONTEXT_TOKENS") != "260000":
    errs.append(f"CLAUDE_CODE_MAX_CONTEXT_TOKENS = {e.get('CLAUDE_CODE_MAX_CONTEXT_TOKENS')!r}, want 260000")
want = 260000 - int(e.get("CLAUDE_CODE_MAX_OUTPUT_TOKENS", 64000))
if e.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW") != str(want):
    errs.append(f"CLAUDE_CODE_AUTO_COMPACT_WINDOW = {e.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW')!r}, want {want}")
if "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" in e:
    errs.append("stale CLAUDE_AUTOCOMPACT_PCT_OVERRIDE survived")
for x in errs: print("  " + x, file=sys.stderr)
sys.exit(1 if errs else 0)
PY
