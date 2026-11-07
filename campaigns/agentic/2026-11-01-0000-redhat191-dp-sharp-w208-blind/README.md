# RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 (DFlash2 k=7, fp8, 262000), Cactus delta 0, with the dp-sharp chat template (keep-all reasoning, froggeric v22.5 + the dp terse prompt) - W2-08 blind review (RUNBOOK step A); one variable vs r191-sharp-d0 -- only the terse prompt differs (keep-all replay + delta 0 held fixed) (R9700, 2026-11-01-0000)

Scaffolded by `bench/core/gen_campaign.py` (`kind: agentic`). The executable driver is **`run.sh`** in this folder.
Each (rep, arm) reuses the **already-running** user-managed server on :8000 (the driver does **not** boot, stop or unload it, and does not run `gpu_exclusive.sh`), creates a **fresh git
worktree** of `/home/dev/work/dippe/dp-forge` at `de110510eb9a4561a8e412f47a7c8d80fa5f0ebd`, runs a real `claude -p` session (same session resumed until `done_when`),
tears the server down and collects the outputs. Loop order: reps outer, arms inner (arms interleave).

## Fixed parameters
- Engine **user-managed vllm** (reuse_server): the server is **already running** on :8000 (served model
  `qwen38-27b-redhat-mxfp4-dflash`; must match the claude settings' model names, checked against `/v1/models` before each arm). The driver does **not** boot, stop or unload it
  (iron rule 14): it never runs `gpu_exclusive.sh` and never kills a process it does not own. Each arm's `server.txt` notes the reuse; the GPU sampler records VRAM/GTT
  during the arm. `summary.tsv`'s `port_free` column reads `reused` (the server is left running after every arm).
- Claude settings `/home/dev/.config/claude/local_vllm_direct/settings-redhat.json` · args `--dangerously-skip-permissions --output-format stream-json --verbose`.
- Base `de110510` = `de110510eb9a4561a8e412f47a7c8d80fa5f0ebd` · worktree template `/home/dev/work/dippe/dpf-bench-{arm}-r{rep}`.
- The server's exact template/δ/KV come from the running container (the user manages it); `server.txt` records
  `reuse_server=true` and the live `/v1/models` response. The `server` block is ignored in reuse mode.

## Arms
| arm | served model | port |
|-----|--------------|-----:|
| `r191-dp-sharp-d0` | `qwen38-27b-redhat-mxfp4-dflash` | 8000 |

Per arm, the driver verifies the server is up and serves `qwen38-27b-redhat-mxfp4-dflash` (shared `/v1/models` check); it does not touch the GPU otherwise.

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
- `server_info`: `["docker exec vllm-{server_port} sh -c 'head -1 /templates/dp-sharp-chat_template.jinja; sha256sum /templates/dp-sharp-chat_template.jinja'", "docker exec vllm-{server_port} sh -c 'cat /proc/1/cmdline | tr \"\\0\" \" \"'", "docker exec vllm-{server_port} sh -c 'env | grep RADIANCE_CACTUS'"]`

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
- `cap_s` 5400 s wall per session · `max_resumes` 1 · `reps` 1.
- `stop_when`: tool name `.` AND tool input (JSON) `"(file_)?path": "[^"]*27b-fix/opus|\b(cat|sed|head|tail|less|more|grep|rg|awk|diff|nl|bat|python3?|node)\b[^;&|\n]*27b-fix/opus/` (python `re.search`). A watcher follows each call's stream-json file; at the FIRST assistant `tool_use` matching both it writes `<arm_dir>/stop_when.txt` (call, ts, tool, line, input) and sends SIGINT to the session's process group. The arm then ends with status `stopped` -- a **result** (done marker written, never resumed); it takes precedence over `done_when`/`cap`/`max_resumes`/`claude_error` for that call. Text, `tool_result` and user messages never match.
- Statuses: `done`, `cap`, `max_resumes`, `stopped` are results (done marker written). `interrupted`/`claude_error` are quarantined
  (never auto-deleted, never auto-retried). `wt_exists`, `gpu_busy`, `server_fail`, `served_name_mismatch`, `wt_fail`,
  `prep_fail`, `proxy_fail` leave no marker, so a rerun retries them.

## Placeholders
`{wt}` `{arm}` `{rep}` `{arm_dir}` `{port}` `{server_port}` in the worktree template (no `{wt}`), `rewrite.to`,
`server_info` and `post` commands. Prompts are NOT substituted.

## Run / rerun / re-collect
```bash
bash campaigns/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind/run.sh
# resume after interruption: same command (tmp/done/ markers skip finished arms)
# subset / shorter:  ONLY='s1-*' REPS=1 CAP_S=3600 MAX_RESUMES=2 bash campaigns/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind/run.sh
# another campaign dir: CAMPAIGN_DIR=/path bash campaigns/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind/run.sh
```
Output: `results/` (committed): `summary.tsv` (rep, arm, status, wall_s, calls, resumes, done_line,
main_unchanged, port_free, image, env), `failures.txt`, `spec.resolved.json`; `tmp/` (git-ignored raw):
`done/`, `started/`, `.lock`, `driver.log`, `agentic_helper.py`, `stale/`, and per (rep, arm) `rep<R>/<arm>/`:
`server.txt`, `calls.tsv`, `session-N.jsonl`, `gpu_samples.csv`, `wt.diff`, `outputs/`, `tmp/`,
`claude-project/`, `main-*.txt`.

An **interrupted** arm (started marker, no done marker) is reported and skipped on every rerun. Nothing is deleted. To
re-collect by hand use the commands `run.sh` prints (worktree status/diff, the spec's `collect` paths, the
`~/.claude/projects/` transcript). To retry from scratch: remove its `started/` marker, move its arm dir aside, and
`git worktree remove --force` its worktree, then rerun.

## Write-up
**Write-up:** [`2026-10-31-1640-agentic-thinking-volume-and-levers.md`](../../../docs/findings/agentic/2026-10-31-1640-agentic-thinking-volume-and-levers.md) · [`2026-11-01-0000-redhat191-dp-sharp-w208-blind.md`](../../../docs/findings/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind.md) (its `<!-- meta -->` block names this campaign).
