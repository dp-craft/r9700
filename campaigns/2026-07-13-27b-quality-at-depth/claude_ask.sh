#!/usr/bin/env bash
# claude_ask.sh — run ONE `claude -p` call THROUGH tmux and capture its result to a file.
#
# Why tmux: headless/background claude is restricted in this environment, so every claude call must run
# inside a real terminal (a tmux window = a PTY). This is the single gateway both the judge (judge.py)
# and the final-summary step use. The prompt is fed on stdin (no argv escaping of code-laden prompts);
# output is the `--output-format json` envelope written to --result (stderr -> --result.err).
#
#   claude_ask.sh --prompt PROMPT_FILE --result RESULT_FILE [--cwd DIR] [--model M] [--permission-mode MODE]
#
# Requires a pre-existing tmux session (default: claude-run); if absent it errors and tells you to start
# one — it will NOT silently fall back to headless. Env: CLAUDE_TMUX_SESSION, CLAUDE_ASK_TIMEOUT (s).
set -uo pipefail
: "${CLAUDE_TMUX_SESSION:=claude-run}"
: "${CLAUDE_ASK_TIMEOUT:=900}"

prompt="" result="" cwd="$PWD" model="" pmode="acceptEdits"
while [ $# -gt 0 ]; do
  case "$1" in
    --prompt) prompt="$2"; shift 2;;
    --result) result="$2"; shift 2;;
    --cwd) cwd="$2"; shift 2;;
    --model) model="$2"; shift 2;;
    --permission-mode) pmode="$2"; shift 2;;
    *) echo "claude_ask.sh: unknown arg $1" >&2; exit 2;;
  esac
done
[ -n "$prompt" ] && [ -n "$result" ] || { echo "claude_ask.sh: need --prompt and --result" >&2; exit 2; }
command -v tmux >/dev/null 2>&1 || { echo "claude_ask.sh: tmux is not installed" >&2; exit 3; }
command -v claude >/dev/null 2>&1 || { echo "claude_ask.sh: 'claude' CLI not on PATH" >&2; exit 3; }

if ! tmux has-session -t "$CLAUDE_TMUX_SESSION" 2>/dev/null; then
  {
    echo "ERROR: claude must run through tmux (headless/background is restricted), but tmux session"
    echo "       '$CLAUDE_TMUX_SESSION' does not exist. Start it once, then re-run:"
    echo
    echo "         tmux new-session -d -s $CLAUDE_TMUX_SESSION"
    echo
    echo "       (override the name with CLAUDE_TMUX_SESSION=...)"
  } >&2
  exit 3
fi

done_f="$result.done"; err_f="$result.err"; rm -f "$done_f" "$result" "$err_f"
cargs=(-p --output-format json --permission-mode "$pmode")
[ -n "$model" ] && cargs+=(--model "$model")

# Build the in-window command with safe quoting; $? stays literal (single-quoted printf format).
inner=$(printf 'cd %q && claude' "$cwd")
for a in "${cargs[@]}"; do inner+=$(printf ' %q' "$a"); done
inner+=$(printf ' < %q > %q 2> %q; echo $? > %q' "$prompt" "$result" "$err_f" "$done_f")

tmux new-window -t "$CLAUDE_TMUX_SESSION" "$inner"

waited=0
while [ ! -f "$done_f" ]; do
  sleep 1; waited=$((waited + 1))
  [ "$waited" -ge "$CLAUDE_ASK_TIMEOUT" ] && { echo "claude_ask.sh: timed out after ${CLAUDE_ASK_TIMEOUT}s" >&2; exit 4; }
done
rc="$(cat "$done_f" 2>/dev/null || echo 1)"
exit "$rc"
