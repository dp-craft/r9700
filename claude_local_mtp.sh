#!/usr/bin/env bash
# Start Claude Code against the local llama-swap backend, Qwen3.8-27B MXFP4 + its own MTP head on vLLM
# (row qwen38-27b-mxfp4-mtp-kvfp8-vllm), using local_muxik_mtp/settings.json = a clone of local_muxik
# with only the model ids changed. The main ~/.claude/settings.json is left untouched; --settings layers
# this file on top for this session only. Extra args are passed through (e.g. claude_local_mtp.sh -c).
exec claude --settings /home/dev/.config/claude/local_muxik_mtp/settings.json "$@"
