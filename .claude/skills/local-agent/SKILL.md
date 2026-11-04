---
name: local-agent
description: Delegate a simple, self-contained task (boilerplate, renames, small tests, summarizing or grepping files, mechanical edits) to the local Qwen3.5-35B-A3B model running behind the vLLM server (start it with qwen35_sly_dflash.sh at the repo root). Use when the user says "delegate to local", "use local", "local agent", or for mechanical tasks that don't need deep reasoning.
allowed-tools: Bash(/home/dev/work/dp-craft/amd/.claude/skills/local-agent/scripts/local-agent.sh:*)
compatibility:
  tools:
    - claude (Claude Code CLI)
    - jq
    - vLLM on 127.0.0.1:8000 (profile sly-amd/qwen35-35b-a3b-mxfp4-dflash)
---

# Local Agent Skill

Runs a headless Claude Code session against the local vLLM model (amd/Qwen3.5-35B-A3B-MXFP4 + z-lab DFlash
drafter) and returns only its final answer. The script verifies the server serves the settings file's model
before running (port 8000 is shared with the 27b server -- a wrong-model-up refusal is a clear error).

## Steps

1. **Write a self-contained brief.** The local agent sees nothing of this conversation. Include:
   the goal, exact file paths, constraints (what not to touch), and the exact output format to return.
   Keep the task small and mechanical — it is a weaker model.
2. **Run it** with Bash (timeout 600000):
   ```bash
   /home/dev/work/dp-craft/amd/.claude/skills/local-agent/scripts/local-agent.sh "<brief>"
   ```
   - It runs in the current working directory; `cd` into the right folder in the same command if needed.
   - The server must be up: `qwen35_sly_dflash.sh start` (repo root) first.
   - For tasks likely to exceed ~2 min, use `run_in_background` and continue with other work.
   - Extra claude flags can follow the brief, e.g. `--max-turns 40`.
   - `--agent <name>` runs the session as `.claude/agents/<name>.md` (its rules + tools); use it for
     code-writer roles. It also unlocks LSP and `npx vitest|tsc|tsx`, `npm run|test`.
3. **Verify before reporting.** Check `git diff` / run the relevant tests. Treat the output as a draft:
   fix or redo anything wrong yourself rather than passing it on unchecked.

## Limits

- Tools available to the local agent: Read, Grep, Glob, Edit, Write, `git diff`, `git status`, `ls`
  (plus the `--agent` extras above).
  Anything else is denied (headless mode cannot prompt). Edits are auto-accepted.
- One model in VRAM, concurrency 1 — local tasks run serially; don't launch several in parallel.
- Output starting with `LOCAL AGENT ERROR:` means the run failed (server down, wrong model up, max turns hit, ...).
