#!/usr/bin/env bash
# check_27b_consistency.sh — GPU-free invariants of the 27B (Qwen3.8-27B) serving convention.
# TDD anchor for the 2026-11-09 centralization refactor (user decision 2026-10-25: 262000 ctx + 2 seqs):
#   1. syntax: every shell file the refactor touches parses (bash -n, + shellcheck if installed)
#   2. the convention lives ONCE in stack/serve/27b.conf — no hardcoded 262000 / MAXSEQS=1 copies
#      in any 27B starter or launcher (non-comment lines only)
#   3. every 27B starter RESOLVES to the convention — via its GPU-free `print` mode (the resolved
#      docker argv). Ornith (35B) is a negative check: it must keep its own 262144/3, not the conf.
#   4. the claude settings files: exactly one compaction knob (window - max output = 198000) and
#      served model names matching what the profiles actually serve.
# Run: bash stack/serve/tests/check_27b_consistency.sh   (no GPU, no docker calls, ~10 s)
set -u
SELF=$(readlink -f "${BASH_SOURCE[0]}")
ROOT=$(cd "$(dirname "$SELF")/../../.." && pwd)
APRIV=$(cd "$ROOT/../amd-private/clients/claude" 2>/dev/null && pwd || true)
SVC=/home/dev/.config/claude/local_vllm_direct

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $*"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $*" >&2; }
check() { local label=$1; shift; if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi; }

echo "== 1. syntax (bash -n, + shellcheck if installed) =="
for f in "$ROOT"/stack/serve/*.sh "$ROOT"/stack/serve/vllm/*.sh "$ROOT"/stack/serve/radiance/*.sh \
         "$ROOT"/stack/serve/vllm/tests/*.sh "$ROOT"/stack/serve/tests/*.sh; do
  [ -f "$f" ] || continue
  check "bash -n $(basename "$f")" bash -n "$f"
  if command -v shellcheck >/dev/null; then check "shellcheck $(basename "$f")" bash -c 'shellcheck -S error "$1"' -- "$f"; fi
done
if [ -z "${APRIV:-}" ]; then
  bad "amd-private repo not found next to $ROOT (expected $ROOT/../amd-private)"
else
  for f in "$APRIV"/*.sh; do check "bash -n $(basename "$f")" bash -n "$f"; done
fi

echo "== 2. the convention has one home: stack/serve/27b.conf =="
CONF="$ROOT/stack/serve/27b.conf"
check "27b.conf exists" test -f "$CONF"
if [ -f "$CONF" ]; then
  read -r C_M C_S C_K C_H < <(. "$CONF" && echo "$MAXLEN $MAXSEQS $SPEC_K $HEADROOM_MIB")
  [ "$C_M" = 262000 ] && [ "$C_S" = 2 ] && [ "$C_K" = 7 ] && [ "$C_H" = 596 ] \
    && ok "27b.conf = 262000 / 2 seqs / SPEC_K 7 / headroom 596" || bad "27b.conf values (got: $C_M/$C_S/$C_K/$C_H)"
fi
# no hardcoded convention outside the conf (non-comment lines only; Ornith is 35B = 262144/3, its own)
no_27b_literal() { grep -vE '^[[:space:]]*#' "$1" | grep -qE '262000|MAXSEQS=1([^0-9]|$)'; }
for f in "$ROOT"/stack/serve/radiance/start_*.sh "$ROOT"/stack/serve/vllm/start_*.sh; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in start_ornith*) continue;; esac
  if no_27b_literal "$f"; then bad "hardcoded 27B convention in $(basename "$f") (should come from 27b.conf)"; else ok "no 27B literals: $(basename "$f")"; fi
done
if [ -n "${APRIV:-}" ]; then
  for f in "$APRIV"/claude-rad-{mxfp4,heretic,iq4rlv4,iq4rlv4-dflash,iq4rlv4-nospec}.sh "$APRIV"/claude-sly-{redhat,heretic}.sh; do
    [ -f "$f" ] || continue
    if no_27b_literal "$f"; then bad "hardcoded 27B convention in $(basename "$f") (should come from 27b.conf)"; else ok "no 27B literals: $(basename "$f")"; fi
    check "$(basename "$f") sources 27b.conf" grep -q '27b\.conf' "$f"
    case "$(basename "$f")" in claude-rad-*) check "$(basename "$f") uses the shared rad_run tail" grep -q 'rad_run ' "$f";; esac
  done
fi

echo "== 3. every 27B starter resolves to the convention (GPU-free print modes) =="
has_flag() { if grep -q -- "$2" <<<"$1"; then ok "$3"; else bad "$3 — resolved argv lacks '$2'"; fi; }
# `print` output is %q-escaped (spaces as "\ ") — unescape for matching; starter's rc in print_rc
PRINT_OUT=$(mktemp); trap 'rm -f "$PRINT_OUT"' EXIT
print_argv() {
  bash "$1" print >"$PRINT_OUT" 2>&1
  print_rc=$?
  sed -i 's/\\ / /g' "$PRINT_OUT"
}
RAD="$ROOT/stack/serve/radiance"
print_argv "$RAD/start_qwen38_27b_iq4r-l-v4_rad.sh"
[ "$print_rc" -eq 0 ] && ok "iq4r rad starter: print rc=0" || bad "iq4r rad starter: print failed (rc=$print_rc): $(tail -1 "$PRINT_OUT")"
has_flag "$(cat "$PRINT_OUT")" "--max-model-len 262000" "iq4r rad starter: max-model-len 262000"
has_flag "$(cat "$PRINT_OUT")" "--max-num-seqs 2"       "iq4r rad starter: max-num-seqs 2"
print_argv "$RAD/start_ornith_35b_vllm_rad.sh"
[ "$print_rc" -eq 0 ] && ok "ornith rad starter: print rc=0" || bad "ornith rad starter: print failed (rc=$print_rc): $(tail -1 "$PRINT_OUT")"
has_flag "$(cat "$PRINT_OUT")" "--max-model-len 262144" "ornith rad starter: 262144 (its own convention, not the 27B conf)"
has_flag "$(cat "$PRINT_OUT")" "--max-num-seqs 3"       "ornith rad starter: 3 seqs (its own convention)"
for s in start_redhat_27b.sh start_heretic_27b.sh; do
  print_argv "$ROOT/stack/serve/vllm/$s"
  [ "$print_rc" -eq 0 ] && ok "$s: print rc=0" || bad "$s: print failed (rc=$print_rc): $(tail -1 "$PRINT_OUT")"
  has_flag "$(cat "$PRINT_OUT")" "--max-model-len 262000" "$s: max-model-len 262000"
  has_flag "$(cat "$PRINT_OUT")" "--max-num-seqs 2"       "$s: max-num-seqs 2 (27B convention — the stale 1 is gone)"
done

echo "== 4. claude settings files: one compaction knob, correct served names =="
python3 - "$SVC/settings-redhat.json" "$SVC/settings.json" <<'PY' && ok "settings-redhat.json + settings.json invariants" || bad "settings files: see messages above"
import json, sys
red = json.load(open(sys.argv[1]))["env"]
her = json.load(open(sys.argv[2]))["env"]
errs = []
for name, e, want in (("settings-redhat.json", red, "qwen38-27b-redhat-mxfp4-dflash"),
                      ("settings.json", her, "swift-1.5")):
    for k in ("ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL"):
        if e.get(k) != want:
            errs.append(f"{name}: {k} = {e.get(k)!r}, want {want!r}")
    m = int(e["CLAUDE_CODE_MAX_CONTEXT_TOKENS"]); o = int(e.get("CLAUDE_CODE_MAX_OUTPUT_TOKENS", 0))
    if e.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW") != str(m - o):
        errs.append(f"{name}: AUTO_COMPACT_WINDOW = {e.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW')!r}, want {m - o} (= window - max output)")
    if "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" in e:
        errs.append(f"{name}: stale CLAUDE_AUTOCOMPACT_PCT_OVERRIDE")
for x in errs: print("  " + x, file=sys.stderr)
sys.exit(1 if errs else 0)
PY

echo
echo "check_27b_consistency: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
