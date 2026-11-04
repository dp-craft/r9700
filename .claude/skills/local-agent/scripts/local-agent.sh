#!/usr/bin/env bash
# local-agent: run one self-contained task headless on the local vLLM model server
# (settings: <repo>/bench/engine-bench/vllm/settings/settings-35b.json -- amd/Qwen3.5-35B-A3B-MXFP4 + DFlash,
# start it with qwen35_sly_dflash.sh at the repo root) and print only the final result.
# usage: local-agent.sh "task" [extra claude args, e.g. --agent tools-code-logic-writer --max-turns 40]
# With --agent <name>, the session runs as .claude/agents/<name>.md (its rules + tools) and may
# also run tests / typecheck / npm scripts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"

# The model server + settings come from LOCAL_AGENT_SETTINGS (default the 35b vLLM settings).
# Point it at another settings file (e.g. the 27b's ~/.config/claude/local_vllm_direct/settings-redhat.json)
# to run on that server; the reachability check is derived from that file's ANTHROPIC_BASE_URL.
SETTINGS="${LOCAL_AGENT_SETTINGS:-$REPO/bench/engine-bench/vllm/settings/settings-35b.json}"

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: local-agent.sh \"task\" [extra claude args]" >&2
  exit 2
fi
task="$1"; shift

BASE_URL="$(jq -r '.env.ANTHROPIC_BASE_URL // empty' "$SETTINGS" 2>/dev/null)"
if [ -n "$BASE_URL" ] && ! curl -s -m 3 -o /dev/null "$BASE_URL/v1/models"; then
  echo "LOCAL AGENT ERROR: model server not reachable at $BASE_URL (start it first)" >&2
  exit 1
fi
# Identity check: port 8000 is shared with the 27b server (settings-redhat.json). If the wrong server is up,
# the task would silently run on the wrong model -- refuse instead (reachability alone is not enough here).
if [ -n "$BASE_URL" ]; then
  WANT_MODEL="$(jq -r '.env.ANTHROPIC_MODEL // empty' "$SETTINGS" 2>/dev/null)"
  GOT_MODEL="$(curl -s -m 3 "$BASE_URL/v1/models" | jq -r '.data[0].id // empty' 2>/dev/null)"
  if [ -n "$WANT_MODEL" ] && [ -n "$GOT_MODEL" ] && [ "$GOT_MODEL" != "$WANT_MODEL" ]; then
    echo "LOCAL AGENT ERROR: $BASE_URL serves '$GOT_MODEL' but settings want '$WANT_MODEL' -- wrong model up on this port (start qwen35_sly_dflash.sh first)" >&2
    exit 1
  fi
fi

allowed="Read,Grep,Glob,Edit,Write,Bash(git diff:*),Bash(git status:*),Bash(ls:*)"
for arg in "$@"; do
  if [ "$arg" = "--agent" ]; then
    allowed="$allowed,LSP,Bash(npx vitest:*),Bash(npx tsc:*),Bash(npx tsx:*),Bash(npm run:*),Bash(npm test:*)"
    break
  fi
done

RAW="$(claude --settings "$SETTINGS" \
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
