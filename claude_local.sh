#!/usr/bin/env bash
# Start Claude Code against the local llama-swap backend using local_muxik/settings.json.
# The main ~/.claude/settings.json is left untouched; --settings layers this file on top
# for this session only. Extra args are passed through (e.g. claude_local.sh -c).
exec claude --settings /home/dev/.config/claude/local_muxik/settings.json --dangerously-skip-permissions  --verbose "$@"
