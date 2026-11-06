#!/usr/bin/env bash
# local-agent: run one self-contained task headless on whichever model the local server is running
# (fastest: ornith_rad_mtp.sh at the repo root) and print only the final result.
# usage: local-agent.sh "task" [extra claude args, e.g. --agent tools-code-logic-writer --max-turns 40]
# With --agent <name>, the session runs as .claude/agents/<name>.md (its rules + tools) and may
# also run tests / typecheck / npm scripts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"

# Port and Claude env come from LOCAL_AGENT_SETTINGS (default the 35b vLLM settings); the model name comes from
# the server, because port 8000 is shared and each starter serves its own name.
SETTINGS="${LOCAL_AGENT_SETTINGS:-$REPO/bench/engine-bench/vllm/settings/settings-35b.json}"

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: local-agent.sh \"task\" [extra claude args]" >&2
  exit 2
fi
task="$1"; shift

BASE_URL="$(jq -r '.env.ANTHROPIC_BASE_URL // empty' "$SETTINGS" 2>/dev/null)"
RUN_SETTINGS="$SETTINGS"
if [ -n "$BASE_URL" ]; then
  GOT_MODEL="$(curl -s -m 3 "$BASE_URL/v1/models" | jq -r '.data[0].id // empty' 2>/dev/null || true)"
  if [ -z "$GOT_MODEL" ]; then
    echo "LOCAL AGENT ERROR: no model server at $BASE_URL (start one first, fastest: ornith_rad_mtp.sh)" >&2
    exit 1
  fi
  # Point every env entry naming the settings' model at the running model.
  WANT_MODEL="$(jq -r '.env.ANTHROPIC_MODEL // empty' "$SETTINGS")"
  RUN_SETTINGS="$(mktemp)"
  trap 'rm -f "$RUN_SETTINGS"' EXIT
  jq --arg want "$WANT_MODEL" --arg got "$GOT_MODEL" \
    '.env |= with_entries(if .value == $want then .value = $got else . end)' "$SETTINGS" > "$RUN_SETTINGS"
fi

allowed="Read,Grep,Glob,Edit,Write,Bash(git diff:*),Bash(git status:*),Bash(ls:*)"
for arg in "$@"; do
  if [ "$arg" = "--agent" ]; then
    allowed="$allowed,LSP,Bash(npx vitest:*),Bash(npx tsc:*),Bash(npx tsx:*),Bash(npm run:*),Bash(npm test:*)"
    break
  fi
done

RAW="$(claude --settings "$RUN_SETTINGS" \
  -p "$task" --output-format json --max-turns "${MAX_TURNS:-20}" \
  --permission-mode acceptEdits \
  --allowedTools "$allowed" \
  --append-system-prompt "You ARE the local agent. Do the task yourself; never call local-agent.sh or delegate it." \
  "$@" < /dev/null 2>/dev/null)"

# Save the raw JSON (num_turns, duration_ms, cost, tokens) when LOCAL_AGENT_OUT is set.
# The caller reads it for the runs table; the result below is unchanged for everyone.
if [ -n "${LOCAL_AGENT_OUT:-}" ]; then
  mkdir -p "$(dirname "$LOCAL_AGENT_OUT")"
  printf '%s\n' "$RAW" > "$LOCAL_AGENT_OUT"
fi

printf '%s\n' "$RAW" | jq -r 'if .is_error then "LOCAL AGENT ERROR: \(.subtype) \(.result // "")" else .result end'
