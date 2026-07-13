#!/usr/bin/env bash
# claude_ask.sh — drive an INTERACTIVE `claude` session THROUGH tmux, exactly the way a human uses it:
# open `claude` in a tmux window, TYPE a one-line request that points it at a prompt file and asks it to
# write its answer to a result file, wait for that file, then close the window. **No `claude -p`, no
# headless/background** — every call is a real interactive session driven by simulated keystrokes.
#
#   claude_ask.sh --prompt PROMPT_FILE --result RESULT_FILE [--cwd DIR] [--model M] [--permission-mode MODE]
#
# The heavy content (rubric, candidate code, task) lives in PROMPT_FILE; we only TYPE a short single-line
# request that references it, so nothing large or multi-line is ever sent through the keyboard (a newline
# would submit early). Completion is detected by watching RESULT_FILE settle — claude writes it with its
# Write tool. Keep PROMPT_FILE/RESULT_FILE inside the repo tree and --cwd inside the repo so the session
# lands in an already-trusted project (no folder-trust dialog) and RESULT_FILE is an in-workspace edit
# that --permission-mode acceptEdits auto-approves.
#
# Requires a pre-existing tmux session (default: claude-run); errors with the start command if absent —
# it will NOT fall back to headless. Env knobs:
#   CLAUDE_TMUX_SESSION   session to open the window in            (default claude-run)
#   CLAUDE_ASK_TIMEOUT    seconds to wait for the answer file      (default 900)
#   CLAUDE_ASK_STARTUP    seconds to let claude boot before typing (default 8)
#   CLAUDE_ASK_STABLE     seconds RESULT_FILE size must hold steady to count as done (default 3)
set -uo pipefail
: "${CLAUDE_TMUX_SESSION:=claude-run}"
: "${CLAUDE_ASK_TIMEOUT:=900}"
: "${CLAUDE_ASK_STARTUP:=8}"
: "${CLAUDE_ASK_STABLE:=3}"

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
[ -f "$prompt" ] || { echo "claude_ask.sh: prompt file not found: $prompt" >&2; exit 2; }
command -v tmux >/dev/null 2>&1 || { echo "claude_ask.sh: tmux is not installed" >&2; exit 3; }
command -v claude >/dev/null 2>&1 || { echo "claude_ask.sh: 'claude' CLI not on PATH" >&2; exit 3; }

if ! tmux has-session -t "$CLAUDE_TMUX_SESSION" 2>/dev/null; then
  {
    echo "ERROR: claude runs INTERACTIVELY through tmux here (headless/background is restricted), but"
    echo "       tmux session '$CLAUDE_TMUX_SESSION' does not exist. Start it once, then re-run:"
    echo
    echo "         tmux new-session -d -s $CLAUDE_TMUX_SESSION"
    echo
    echo "       (override the name with CLAUDE_TMUX_SESSION=...)"
  } >&2
  exit 3
fi

# absolute paths, so whatever cwd claude runs in doesn't affect locating the files
prompt="$(cd "$(dirname "$prompt")" && pwd)/$(basename "$prompt")"
result="$(cd "$(dirname "$result")" && pwd)/$(basename "$result")"
err_f="$result.err"; rm -f "$result" "$err_f"

# 1. open an interactive claude in a fresh tmux window; capture ITS pane id so we drive exactly this one.
#    `exec` replaces the shell with claude so kill-pane later tears down claude cleanly.
if [ -n "$model" ]; then
  launch=$(printf 'cd %q && exec claude --permission-mode %q --model %q' "$cwd" "$pmode" "$model")
else
  launch=$(printf 'cd %q && exec claude --permission-mode %q' "$cwd" "$pmode")
fi
pane=$(tmux new-window -t "$CLAUDE_TMUX_SESSION" -P -F '#{pane_id}' "$launch")
[ -n "$pane" ] || { echo "claude_ask.sh: failed to open tmux window" >&2; exit 3; }
cleanup() { tmux capture-pane -p -S -400 -t "$pane" > "$result.transcript" 2>/dev/null || true
            tmux kill-pane -t "$pane" 2>/dev/null || true; }
trap cleanup EXIT

# 2. let claude boot, then TYPE the request like a human and press Enter. Single line only (a newline
#    would submit prematurely); the bulky task text stays in PROMPT_FILE, never on the keyboard.
sleep "$CLAUDE_ASK_STARTUP"
req="Read the file ${prompt} . It contains exactly one task. Do that task, then write your final answer to the file ${result} (that file must contain ONLY the answer itself, with no preamble or commentary). Writing that file is the last thing you do."
tmux send-keys -t "$pane" -l "$req"
sleep 1
tmux send-keys -t "$pane" Enter

# 3. wait for RESULT_FILE to appear and settle (size unchanged for CLAUDE_ASK_STABLE consecutive polls).
waited=0; last=-1; stable=0
while :; do
  if [ -f "$result" ]; then
    sz=$(stat -c%s "$result" 2>/dev/null || echo 0)
    if [ "$sz" -gt 0 ] && [ "$sz" = "$last" ]; then
      stable=$((stable + 1))
      [ "$stable" -ge "$CLAUDE_ASK_STABLE" ] && exit 0
    else
      stable=0
    fi
    last="$sz"
  fi
  if ! tmux capture-pane -p -t "$pane" >/dev/null 2>&1; then
    echo "claude_ask.sh: the claude window exited before writing $result" > "$err_f"
    echo "claude_ask.sh: claude window closed before producing a result (see $err_f)" >&2
    exit 4
  fi
  sleep 1; waited=$((waited + 1))
  if [ "$waited" -ge "$CLAUDE_ASK_TIMEOUT" ]; then
    tmux capture-pane -p -S -200 -t "$pane" > "$err_f" 2>/dev/null || true
    echo "claude_ask.sh: timed out after ${CLAUDE_ASK_TIMEOUT}s waiting for $result (pane dump in $err_f)" >&2
    exit 4
  fi
done
