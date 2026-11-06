# Qwen3.8-27B UD-Q4_K_XL (llama-swap sharp row) - W2-08 blind review (RUNBOOK step A) quality vs RedHat MXFP4 delta 0 (R9700, 2026-10-31)

Scaffolded by `bench/core/gen_campaign.py` (`kind: agentic`). The executable driver is **`run.sh`** in this folder.
Each (rep, arm) loads the llama-swap row `qwen38-27b-q4kxl-q8-mtp-kvq8-mtp-sharp-planning` **fresh** (`gpu_exclusive.sh` unloads every model first, so the prefix cache never carries over), creates a **fresh git
worktree** of `/home/dev/work/dippe/dp-forge` at `de110510eb9a4561a8e412f47a7c8d80fa5f0ebd`, runs a real `claude -p` session (same session resumed until `done_when`),
tears the server down and collects the outputs. Loop order: reps outer, arms inner (arms interleave).

## Fixed parameters
- Engine **llama-swap** via `stack/serve/llamacpp/serve_llamaswap.sh`: the server is the llama-swap row `qwen38-27b-q4kxl-q8-mtp-kvq8-mtp-sharp-planning` of the
  persistent router on :9292 (also the client port; the row id must equal the claude settings' model names,
  checked at emit time and against `/v1/models` per boot). `start` preloads the row and streams its upstream
  llama-server log into `server-container.log`; after each arm `stop` unloads it (GET `/unload`) and `summary.tsv`'s
  `port_free` column records `unloaded=yes|no`. The router itself stays up by design (never stopped).
- Claude settings `/home/dev/work/dp-craft/amd/campaigns/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind/claude-settings-q4kxl-sharp.json` · args `--dangerously-skip-permissions --output-format stream-json --verbose`.
- Base `de110510` = `de110510eb9a4561a8e412f47a7c8d80fa5f0ebd` · worktree template `/home/dev/work/dippe/dpf-bench-{arm}-r{rep}`.
- The row's binary, gguf, ctx, KV, flags, env and chat template come from the llama-swap config; `serve_llamaswap.sh print`
  records them (config sha256, resolved cmd, llama-server version, gguf) in each arm's `server.txt`.

## Arms
| arm | served model (llama-swap row) | free_mib_floor |
|-----|-------------------------------|---------------:|
| `q4kxl-sharp` | `qwen38-27b-q4kxl-q8-mtp-kvq8-mtp-sharp-planning` | 30000 |

Per boot, `gpu_exclusive.sh <free_mib_floor>` unloads llama-swap and asserts the floor before `start`.

## Installs (copied into each fresh worktree)
| src | dst (worktree-relative) | sha256 at emit time |
|-----|-----|-----|
| `/home/dev/work/dp-craft/amd/campaigns/agentic/2026-10-30-0947-dpf-brief-ab/inputs/heretic/W2-06.md` | `docs/plans/2026-10-28-2239-dpf-tui-f0-f1/briefs/W2-06.md` | `afdff4f392841aa15e852770856fcb5f8f8d54908a83f7f14b63ec2c51780baa` |
| `/home/dev/work/dp-craft/amd/campaigns/agentic/2026-10-30-0947-dpf-brief-ab/inputs/heretic/W2-07.md` | `docs/plans/2026-10-28-2239-dpf-tui-f0-f1/briefs/W2-07.md` | `e8218f2efd5686fae2b4a8bcef415aed5ba3365142ba989821172f969f68f26b` |
| `/home/dev/work/dp-craft/amd/campaigns/agentic/2026-10-30-0947-dpf-brief-ab/inputs/heretic/W2-08.md` | `docs/plans/2026-10-28-2239-dpf-tui-f0-f1/briefs/W2-08.md` | `b249ad0d2645cf9dc03c2d2233353f0eca9e0980ae2fd9a17f2f17fa98222e23` |
| `/home/dev/work/dp-craft/amd/campaigns/agentic/2026-10-30-0947-dpf-brief-ab/inputs/heretic/progress.md` | `docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/progress.md` | `fc434b236e9f32855e47209aaf7a40e84011ccb45d49bb29f720bc811703887e` |

The sha256 of each src at run time is written to `<arm dir>/installs.sha256`; compare with the table above.
- `rewrite`: `[{"glob": "docs/plans/2026-10-28-2239-dpf-tui-f0-f1/briefs/W2-0[678].md", "from": "/home/dev/work/dippe/dpf-bench-heretic", "to": "{wt}"}, {"glob": "docs/plans/2026-10-28-2239-dpf-tui-f0-f1/01-writer-brief.md", "from": "/home/dev/work/dippe/dp-forge", "to": "{wt}"}]`
- `symlinks`: `[{"src": "/home/dev/work/dippe/dp-forge/node_modules", "dst": "node_modules"}, {"src": "/home/dev/work/dippe/dp-forge/tools/node_modules", "dst": "tools/node_modules"}, {"src": "/home/dev/work/dippe/dp-forge/tools/task-dag/node_modules", "dst": "tools/task-dag/node_modules"}, {"src": "/home/dev/work/dippe/dp-forge/tools/speckit-orchestrator/node_modules", "dst": "tools/speckit-orchestrator/node_modules"}, {"src": "/home/dev/work/dippe/dp-forge/tools/spec-pipeline/node_modules", "dst": "tools/spec-pipeline/node_modules"}]`
- `collect`: `["docs/plans/2026-10-28-2239-dpf-tui-f0-f1/briefs/W2-08.md", "docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/progress.md", "docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/W2-08.refine-27b.md"]`
- `tmp_dirs`: `["/tmp/dp-refine"]`
- `server_info`: `["curl -s -m 10 http://127.0.0.1:{port}/running", "curl -s -m 10 http://127.0.0.1:{port}/upstream/qwen38-27b-q4kxl-q8-mtp-kvq8-mtp-sharp-planning/props | head -c 4000"]`

## Prompts (verbatim, no placeholder substitution)
First call:
```
Run docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md for brief W2-08 only (W2-06 and W2-07
are out of scope): read it whole first (cat, it is short), then follow it exactly.
```
Resume (`--resume <session id>`):
```
Continue: follow docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md exactly for brief W2-08 only (W2-06 and W2-07 are out of scope); resume where you stopped.
```

## Completion, caps
- `done_when`: file `docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/progress.md` in the worktree, python regex `^W2-08 \|` (`re.search`, MULTILINE) after every call.
- `cap_s` 9000 s wall per session · `max_resumes` 5 · `reps` 1.
- `stop_when`: tool name `.` AND tool input (JSON) `"(file_)?path": "[^"]*27b-fix/opus|\b(cat|sed|head|tail|less|more|grep|rg|awk|diff|nl|bat|python3?|node)\b[^;&|\n]*27b-fix/opus/` (python `re.search`). A watcher follows each call's stream-json file; at the FIRST assistant `tool_use` matching both it writes `<arm_dir>/stop_when.txt` (call, ts, tool, line, input) and sends SIGINT to the session's process group. The arm then ends with status `stopped` -- a **result** (done marker written, never resumed); it takes precedence over `done_when`/`cap`/`max_resumes`/`claude_error` for that call. Text, `tool_result` and user messages never match.
- Statuses: `done`, `cap`, `max_resumes`, `stopped` are results (done marker written). `interrupted`/`claude_error` are quarantined
  (never auto-deleted, never auto-retried). `wt_exists`, `gpu_busy`, `server_fail`, `served_name_mismatch`, `wt_fail`,
  `prep_fail`, `proxy_fail` leave no marker, so a rerun retries them.

## Placeholders
`{wt}` `{arm}` `{rep}` `{arm_dir}` `{port}` `{server_port}` in the worktree template (no `{wt}`), `rewrite.to`,
`server_info` and `post` commands. Prompts are NOT substituted.

## Run / rerun / re-collect
```bash
bash campaigns/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind/run.sh
# resume after interruption: same command (done/ markers skip finished arms)
# subset / shorter:  ONLY='s1-*' REPS=1 CAP_S=3600 MAX_RESUMES=2 bash campaigns/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind/run.sh
# another output dir: RUN_DIR=/path bash campaigns/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind/run.sh
```
Output: `campaigns/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind/` (or `$RUN_DIR`): `summary.tsv` (rep, arm, status, wall_s, calls, resumes, done_line,
main_unchanged, port_free, image, env), `failures.txt`, `driver.log`, and per (rep, arm) `rep<R>/<arm>/`: `server.txt`,
`calls.tsv`, `session-N.jsonl`, `gpu_samples.csv`, `wt.diff`, `outputs/`, `tmp/`, `claude-project/`, `main-*.txt`.

An **interrupted** arm (started marker, no done marker) is reported and skipped on every rerun. Nothing is deleted. To
re-collect by hand use the commands `run.sh` prints (worktree status/diff, the spec's `collect` paths, the
`~/.claude/projects/` transcript). To retry from scratch: remove its `started/` marker, move its arm dir aside, and
`git worktree remove --force` its worktree, then rerun.

## Write-up
**benchmark-results** skill -> co-located `docs/findings/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind.md` (summary + table first).
