---
name: local-agent
description: Delegate a simple, self-contained task (boilerplate, renames, small tests, summarizing or grepping files, mechanical edits) to whichever local model is running on port 8000 (fastest: start ornith_rad_mtp.sh at the repo root). Use when the user says "delegate to local", "use local", "local agent", or for mechanical tasks that don't need deep reasoning.
allowed-tools: Bash(/home/dev/work/dp-craft/amd/.claude/skills/local-agent/scripts/local-agent.sh:*)
compatibility:
  tools:
    - claude (Claude Code CLI)
    - jq
    - a local model server on 127.0.0.1:8000 (ornith_rad_mtp.sh, or any other starter on that port)
---

# Local Agent Skill

Runs a headless Claude Code session against whichever model the server on port 8000 reports and returns only
its final answer. Ornith on `ornith_rad_mtp.sh` is the fastest. Ornith reports the 27b's name, so the name does
not show which model answered; check the running starter with `<script> status` if it matters.

## Steps

1. **Write a self-contained brief.** The local agent sees nothing of this conversation. Include:
   the goal, exact file paths, constraints (what not to touch), and the exact output format to return.
   Keep the task small and mechanical — it is a weaker model.
2. **Run it** with Bash (timeout 600000):
   ```bash
   /home/dev/work/dp-craft/amd/.claude/skills/local-agent/scripts/local-agent.sh "<brief>"
   ```
   - It runs in the current working directory; `cd` into the right folder in the same command if needed.
   - A server must be up first: `ornith_rad_mtp.sh start` (repo root). Any other starter on port 8000 also works.
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
- Output starting with `LOCAL AGENT ERROR:` means the run failed (server down, max turns hit, ...).
