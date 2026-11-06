# Repo restructure: plan (2026-11-06)

Supersedes the approach of `2026-11-04-repo-restructure-status.md` (publication-safety audit); its open history and
language questions carry over. Evidence for every claim here: `docs/tmp/2026-11-06-1559-92306dd0/00-MAP.md` and the
`merged/*.tsv` label tables next to it. **Nothing has been moved yet.**

## Decisions (owner, 2026-11-06)

| # | Decision |
|---|---|
| 1 | Two ignored dir names, anywhere in the tree: `tmp/` = reproducible internals + scratch (deleting costs rerun time only); `var/` = machine state that running services need (builds, SDK, venvs, model caches, pidfiles, server logs) |
| 2 | Result **data** stays with its campaign (`results/`); **write-ups** move to `docs/findings/<topic>/` and link back to the campaign |
| 3 | `bench/runs/` is dissolved: every run joins a campaign (`results/` + `tmp/`); standalone runs get a small campaign dir; aborted/smoke/noise go to the archive |
| 4 | Archive = ignored payload on disk + tracked `MANIFEST.md` (old path → new place, last commit SHA); links into internals are **not** updated; git history kept |
| 5 | The repo's `llama-swap/` is canonical; `~/.config/llama-swap` symlinks to it |
| 6 | The repo goes public; private parts live in a separate private repo, symlinked into this tree and ignored here |

## Target layout

```
README.md  CLAUDE.md  .gitignore
stack/                      generic machine stack; never imports bench/
  install/                  install.sh, rocm-upgrade/ (from docs/research/…hipfire…/rocm-upgrade)
  llamacpp/                 build_llamacpp.sh, build_stew675_patched.sh, setup_vulkan.sh
                            var/builds (← llamacpp/builds, 11 GB), var/vulkansdk (← llamacpp/vulkansdk, 4 GB)
  llama-swap/               generate.py, models.yaml, config.yaml, add_model.py, build/start/restart scripts,
                            templates/, tests/, opencode-model-notes.md; var/ (← binary + go toolchain)
  serve/                    llamacpp/ (serve_llamacpp.sh, serve_llamaswap.sh)
                            vllm/ (serve_vllm.sh, profiles, settings, templates, overlays, fetch_model, warm_start,
                                   warmup, tests, start_vllm.sh)
                            radiance/ (serve_radiance.sh, ornith_rad_mtp.sh)
                            var/servers (← bench/.servers), var/venvs (← bench/dl/*-venv), var/models (← bench/dl/radiance-cache)
  gpu/                      gpu_env.sh, gpu_exclusive.sh, monitor.py/.sh, vram_sampler.py, spec_metrics.py, phase_power.py, tests
  clients/                  → private repo (Claude launchers, _lib.sh, statusline-command.sh, local-agent)
bench/                      benchmark code + shared inputs; writes nothing into its own tree
  core/                     gen_campaign.py, capture_engine.py, report.py, gguf_kv.py, tests
  workloads/                build_prompt.py, corpus/, tasks/; tmp/ (← generated/)
  perf/                     model-bench run.sh + sweep.py, engine-bench run.sh + campaign.sh, hipfire bench.py
  build-check/              compare_builds.py
  quality/                  ts-harness/ (ONE copy; node_modules → var/), capture.py, graders/ (+ score_typescript,
                            judge), aggregate.py, make_charts.py, make_charts_detailed.py, mrcr/ (run_local.py, pinned download)
  workers/                  subagent-fitness harness (← bench/runs/2026-11-05-0320-ornith-usecases/harness)
campaigns/<type>/<YYYY-MM-DD-HHMM>-<slug>/
                            spec.json run.sh configs.jsonl templates/ README.md   (recipe, committed)
                            inputs/      campaign-specific fixtures                (committed)
                            results/     results.jsonl, summary.*, scores, charts/, appendix.md (committed)
                            tmp/         replies, server logs, gpu csv, props, transcripts, per-arm dumps, markers (ignored)
  types: build-check, perf, quality, agentic, workers, investigation
docs/                       publishable
  README.md                 landing page: top findings per topic
  INDEX.md, reindex.py      generated register
  findings/<topic>/         our write-ups (← docs/analysis, campaigns/*/analysis.md, mrcr result)
  research/<topic>/         external synthesis (← docs/research)
  articles/                 EN articles, linkedin/, assets/
  guides/                   GUIDE.md, vllm/ knowledge base, driver-upgrade runbook
notes/                      → private repo (plans/, brainstorm/, tmp/ for subagent results)
archive/                    → private repo (MANIFEST.md tracked there; payload ignored)
```

Topics for `docs/findings/` and `docs/research/` (from the doc labels): `llamacpp` (incl. `build-checks/`), `vllm`,
`radiance`, `hipfire`, `rocm-driver`, `models-sampling`, `quality`, `agentic`, `workers`, `methodology`.

Rules the layout encodes:
- Dependency direction: `stack/` ← `bench/` ← `campaigns/` ← `docs/`. Nothing points the other way.
- A tool never writes into `bench/` or `stack/` except into that area's `var/` or `tmp/`.
- `.gitignore` becomes: `tmp/`, `var/`, `node_modules/`, `__pycache__/`, plus the private symlinks.

## Private repo

`/home/dev/work/dp-craft/amd-private` (local git repo; remote later, owner's call). Holds: `clients/`, `notes/`, `archive/`,
and the personal Claude skill/command symlinks (`.claude/skills/{brainstorming,consider,research,llama-swap-add-model}`,
`.claude/commands/*` → `~/work/dippe/skills-agents`). The public tree keeps ignored symlinks at the same paths, so local
use is unchanged. A fresh public clone has none of them; `stack/README.md` says `clients/` is optional.

## Tool changes (from the output contracts, `00-MAP.md` §7)

| Tool | Change |
|---|---|
| gen_campaign templates | two roots: `$CAMPAIGN_DIR/tmp/<stamp>/` for raw, `$CAMPAIGN_DIR/results/` for results.jsonl/summary; repo-relative paths (`git rev-parse --show-toplevel`) instead of the hard-coded absolute path; campaign path includes `<type>/` |
| engine-bench `run.sh`/`campaign.sh`, model-bench `run.sh`, `sweep.py`, `compare_builds.py` | replace the hard-coded `bench/runs/<stamp>` root with a campaign dir argument (same two-root split) |
| quality `run_capture.sh` | becomes a bench/quality tool taking a campaign dir; `out/` → `results/` + `tmp/` |
| `report.py`, `make_charts*.py` | read raw from `tmp/`, write charts + appendix to `results/`; carry measured peak VRAM/GTT into `results/` so rule 7 stays satisfied without the CSV |
| `serve_*.sh`, `claude/*.sh`, `start_vllm.sh` | `$RUNDIR` → `stack/serve/var/servers` |
| `build_llamacpp.sh`, `build_stew675_patched.sh`, `setup_vulkan.sh` | `$BUILD`, SDK → `stack/llamacpp/var/` |
| `reindex.py` | scan `docs/findings/**`, `docs/research/**`; validate each finding's `campaign:` link |
| old gen_campaign campaigns | `run.sh` regenerated from `spec.json` (the spec is the recipe), not patched by hand |

## Outside consumers to update (same phase as the move they depend on)

`~/.config/llama-swap/{generate.py (REPO, build paths, radiance cache), config.yaml, symlinks}`,
`~/.config/claude/local_vllm_direct/vllm*.sh`, symlinks in `~/work/dippe/{dp-forge,AiChatney,dpf-bench-redhat-d0-sharp-r1}`,
`~/.bashrc` aliases `cv`/`caa`, dp-fan-out-subagents (`ornith_rad_mtp.sh`, manual paths in `refs/*.md`), dippe ornith skill.

## Skills and docs to update

benchmark-new-campaign, benchmark-results, llamacpp-build, local-agent (already broken: missing `.claude/agents/`), the
research skill's output path, the brainstorming skill's `docs/plans/` path, `CLAUDE.md` (map + rule path references:
`bench/.servers`, `bench/lib/gpu_exclusive.sh`, …), `docs/GUIDE.md`, `README.md`, every per-area README.

## Execution

No existing tool covers a bulk move with a manifest, so a one-off `restructure.py plan|apply|verify` driven by
`moves.tsv` is written for this job and kept in `notes/restructure/` (private, not product code).
- `moves.tsv` (old path or prefix → new path, class `move|tmp|var|archive|private|delete`) is generated by rules from the
  label tables. Ornith assigns the ambiguous rows (which campaign and type each standalone run belongs to). The owner
  reviews the table before any apply.
- `apply` uses `git mv` for tracked files, `mv` for ignored ones, and writes `archive/MANIFEST.md`.
- `verify` greps code, config, skills and publishable docs for any old path still referenced (links inside archived
  internals are exempt), then runs the test suites.

| Phase | Scope | Gate (stress test) |
|---|---|---|
| 0 | Mirror clone of today's repo (full history) into the private repo; branch `restructure` | clone verifies, `git log` count matches |
| 1 | Private repo + symlinks; untrack personal symlinks | local skills/commands still load; `git status` clean |
| 2 | `stack/` + `var/` moves; outside consumers | llama-swap tests + `generate.py` output diff empty; `serve_vllm_test.sh`; start/stop llama-swap and one vLLM profile; `gpu_exclusive.sh` |
| 3 | `bench/` moves, TS harness consolidation, tool two-root changes | `test_gen_campaign.py`, `test_report.py`, `test_monitor.py`; scaffold + run one tiny throughput campaign end to end |
| 4 | campaigns + runs via `moves.tsv`; archive + manifest | every `results/` has its rows; no untracked raw in `git status`; manifest covers every removed path |
| 5 | docs → findings/research/articles/guides by topic; reindex | `reindex.py` passes; no broken link inside `docs/` |
| 6 | skills, CLAUDE.md, GUIDE, READMEs | `verify` finds no stale path; `/benchmark-new-campaign` dry run emits into the new layout |
| 7 | (separate decision) first public push | publication-safety scan (old audit S1 never finished) |

Constraints: phases 2–4 need the GPU servers stopped (pidfiles move; iron rule 14); the stress tests need the GPU free.
