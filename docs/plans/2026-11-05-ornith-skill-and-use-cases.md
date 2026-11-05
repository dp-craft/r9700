# Ornith skill and use-case tests: plan and status

Living plan. **Nothing is committed.** Status last updated 2026-11-05, while Phase A was running.

## Goal

Ornith is free to run, so find where and how to use it. Deliver a shared skill that says when to use Ornith, how to use it,
and the recommended maximum token amount for good quality. Limits and briefs in the skill must come from tests where possible.
Anything untested is labelled as untested.

## Decisions so far

| Decision | Choice | Source |
|---|---|---|
| Skill location | `/home/dev/work/dippe/skills-agents/skills/ornith/` | Other repos link their shared skills from here |
| Symlinks | `.claude/skills/ornith` in `amd`, `dp-forge` and `AiChatney` | Operator |
| Session | `ornith.sh`: no CLAUDE.md, MCP, skills or user settings; 3.0k first prompt; 80 turns; refuses a server that isn't Ornith | Earlier report, smoke test |
| Tool profiles | `read`, `data` (adds jq, python3), `code` (adds Edit, pytest, vitest, tsc, git diff/status) | This plan |
| Thinking | Always on | Operator |
| Samplers | Only the two official presets, below | Operator, official doc |
| Prompts | Test plain, rules, and rules plus validation | Operator |
| Coding | Include simple coding tasks, in TypeScript and Python | Operator |
| Haiku | Use it widely for grading and baselines, if it agrees with Opus; one subagent at a time (iron rule 19) | Operator |

| Preset | temp | top_p | top_k | min_p | presence | repetition | Server state |
|---|---:|---:|---:|---:|---:|---:|---|
| P0 general | 1.0 | 0.95 | 20 | 0.0 | 1.5 | 1.0 | Starter default |
| P2 precise coding | 0.6 | 0.95 | 20 | 0.0 | 0.0 | 1.0 | `EXTRA_ARGS="--temp 0.6 --presence-penalty 0"`, needs a restart |

Claude Code sends no sampler values (`MEASURED`, wire capture), so the server's flags apply to every session.
The starter doesn't set `min_p` or repetition penalty. The server log confirms `min_p` 0.00; the repetition penalty's value isn't confirmed.

## Use cases under test

Fixture tokens are `MEASURED` with the server's `/tokenize`. Data is real unless stated.

| Use case | Data | Tokens S / M / L | Graded by |
|---|---|---:|---|
| `log`: find and count problems | vLLM server log, 6 planted fictional faults | 18k / 151k / 340k | Class recall, first line, count, planted faults |
| `bugs`: classify bug text, extract paths | dp-forge findings ledger, labels hidden | 8.7k / 33k / 69k | Kind, severity, path recall vs ledger |
| `json`: query JSONL | Benchmark `results.jsonl` rows | 8.1k / 40k / 131k | 10 questions with a Python oracle |
| `summary`: fixed-form summary | Repo reports, one Hungarian report extra | 6.0k / 20k / 55k | Numbers present in source, then blind grading |
| `classify`: document type | Heads of real documents, 8 labels, paths hidden | 17k / 67k / 167k | Accuracy vs location label |
| `codeinv`: code inventory | Repo Python files | 7.6k / 36k / 88k | Recall and line numbers vs `ast` |
| `impl`: code from a clear spec (TS) | logfmt spec, written for this test | Small | 34 hidden tests, tsc |
| `testgen`: write tests (TS) | semver module, written for this test | Small | Pass on original, 16 mutants killed |
| `edit`: multi-file rename (Python) | shop package with traps, written for this test | Small | 9 hidden tests, nothing forbidden touched |
| `bugfix`: two root causes (Python) | movstats module, written for this test | Small | 11 hidden tests, `rolling_max` unchanged |
| `docnotes`: per-document notes | The earlier report's 7 fixtures | 117k total | Earlier scorer, blind grading |
| `docsplit`: split one document per section, with index | Real reports; extra prose size `P` is this repo's CLAUDE.md | To measure; 304 / 200 / 496 / 972 lines at P / S / M / L | Content preservation (below), right file, index links |
| `docreorg`: sort mixed sections into topic files | H2 sections of 3 real reports, shuffled with a fixed seed | To measure; 331 / 428 / 827 lines at S / M / L | Content preservation (below), origin report as placement oracle |

Reference solutions pass all hidden tests, and the reference test suite kills all 16 mutants (`MEASURED`).

### Document refactoring: can Ornith do it without losing or changing content?

The test requires verbatim content. Reworded restructuring is not tested, because it needs fact checking rather than a line comparison.

| Variant | Method | Expected trade-off (`INFERRED`) |
|---|---|---|
| V0 | Plain request, retype with Write | Baseline; shows unprompted loss |
| V1 | V0 plus strict copy rules | Does telling it stop loss? |
| V2 | V1 plus running `doc_check.py` and repairing until PASS | Validation loop; adds time |
| V3 | Ornith only decides a line-range manifest; `doc_apply.py` moves the bytes, then `doc_check.py` runs | Text can't be altered; cheapest and should scale furthest |

**Hypothesis to test:** presence penalty 1.5 (P0) may corrupt verbatim copying, because copying is repeated tokens. So retyping briefs also run at P2.

**Scoring** (`harness/score_doc.py`), deterministic:

- **Headline:** `zero_loss` means no lost line, no altered line, and no missing or invented number. For this use case it replaces the score bands below, because a split that loses 3% is not "good enough".
- **Counted separately:** lost lines and table rows, altered lines and those with a changed number, added lines, duplicates, numbers missing and invented.
- **Structure:** section in the right file, section intact and in order, index links, odd code fences.

Checked offline (`MEASURED`, no model): reference splits of all 7 fixtures scored 1.0 and `zero_loss`. A deliberately damaged output with a changed number, deleted table row, invented line and duplicate was caught by both the checker and the scorer, and `doc_apply.py` refused an overlapping and an out-of-directory manifest, writing nothing.

| Step | Arms | Runs |
|---|---|---:|
| 1. Small sizes at P0 | `docsplit` P, S and `docreorg` S × V0–V3 | 12 |
| 2. Preset effect | Same three fixtures, V1 at P2; `docreorg.S` V3 at P2 | 4 |
| 3. Size ladder | `docsplit` M, L and `docreorg` M, L × best retyping brief and V3 | 8 |
| 4. Repeats | Winner at the largest passing size, 2 extra runs per task, because zero loss from one run proves little | 4 |

### Amount processed per time

Measured for **every** use case, and shown in the report and the skill:

| Metric | Meaning |
|---|---|
| Source tokens per minute | Fixture tokens ÷ session wall time, including reasoning, tools and repair loops |
| Generated tokens per 1k source tokens | Work overhead, which is what makes one method slower |
| Largest source per session | Biggest tested size that still meets the quality bar |
| Time to a verified result | Wall time until the output passes its check, the practical figure for planning |

Rates come from whole sessions, so they fall with size where reasoning grows. Each is quoted with its size and run count, and estimates for larger jobs split into several sessions are `INFERRED`.

| Brief | Content |
|---|---|
| V0 | Task and output format only |
| V1 | V0 plus how-to steps and rules |
| V2 | V1 plus a validation step specific to the task, such as re-grepping cited numbers and checking counts |
| V3 | `json` only: compute with jq or python3 through the `data` profile |

## Phases

| Phase | Work | Runs | Status |
|---|---|---:|---|
| Setup | Wrapper, settings, fixtures, briefs, scorer, driver; dry run | 3 | Done |
| A | 10 use cases × V0, V1, V2 at small size, P0 | 30 | Done, 43 min of sessions; result below |
| B | Haiku grader check: 40 notes on 6 reports, compared with Opus pass 2. The 8 syntheses were dropped, because no planned grading uses them | 6 Haiku | Done (`high` and `max`), see below |
| C–E | Long run: presets, size ladders, document refactoring, per-document notes. Trimmed to a 2-hour limit, below | 35 finished, 4 quarantined (`longrun.jsonl`) | Done at 117.2 min, server back on P0; results in `harness/summary.md` |
| F | Blind grading of `summary` and `docnotes` by Haiku `max`, with disputes checked against the source | 6 Haiku, then 2 at a time plus 1 | Done: summaries 2 passes, notes 1 pass; flags checked against sources |
| G | Haiku `max` baseline on the same briefs | 17 Haiku | Done; `arms-haiku/` |
| H | Write `SKILL.md` and the tested briefs under `references/` | n/a | Done |
| I | Symlinks in `amd`, `dp-forge`, `AiChatney`; verify the skill resolves in each | n/a | Done, tested from each; document split passed from AiChatney |
| J | Report in `docs/analysis/`, `docs/reindex.py`, run README, restore the server's P0 preset | n/a | Done: `docs/analysis/2026-11-05-0814-ornith-use-cases.md` |

Local runs stay sequential. Haiku runs are remote and may overlap them, which doesn't affect local timing materially.

### Phase A result

Small size, P0, one run per arm (`MEASURED`). Coding tasks are one small fixture each.

| Use case | V0 score / s | V1 score / s | V2 score / s | Brief taken forward |
|---|---:|---:|---:|---|
| `log` | .897 / 94 | .897 / 191 | .897 / 61 | V2, tie on score, fastest |
| `bugs` | .568 / 92 | .705 / 229 | .670 / 276 | V1 |
| `json` | 1.0 / 65 | 1.0 / 48 | 1.0 / 89 | V3: 1.0 / 17 s, computes instead of reasoning |
| `summary` | 1.0 / 11 | 1.0 / 19 | 1.0 / 39 | V1, because the score only checks numbers; blind grading decides |
| `classify` | .85 / 163 | .875 / 234 | .90 / 178 | V2, within noise of the others, about as fast as V0 |
| `codeinv` | 1.0 / 10 | 1.0 / 14 | 1.0 / 10 | V0 |
| `impl` | 1.0 / 163 | .853 / 76 | 1.0 / 178 | V0 |
| `testgen` | 1.0 / 41 | 1.0 / 62 | 1.0 / 86 | V0 |
| `edit` | 1.0 / 45 | 1.0 / 124 | 1.0 / 52 | V0 |
| `bugfix` | 1.0 / 14 | .909 / 24 | 1.0 / 29 | V0 |

Rules and validation rarely helped on these clear tasks, and they often cost more time. Only `bugs` improved clearly, which fits its judgement-heavy labels. Each cell is one run, so differences under 0.05 are ties.

### Long run: 2-hour limit

The operator cut the remaining local work from about 3.5 hours to **2 hours at most**, counted from the launch of `harness/long_run.py`.

**How the limit holds:** an arm starts only if its cut-off still fits in the time left, so the run can't pass 2 hours. Arms run most useful first, so anything dropped comes from the end of the table. A cut-off arm is quarantined and counts only as "did not finish within its limit" (iron rule 18).

**Reordered at 19 minutes.** My retyping estimate was far too low (`MEASURED`): splitting a 6k-token document took 480 s and 69k generated tokens with V0, and V1 was cut at its 600 s limit, against 39 s with V3. At that rate retyping would have used up the 2 hours, so it now runs only where it answers a question. The deadline stayed at 06:09:30.

| Block | Arms | Estimate (`INFERRED`) |
|---|---|---:|
| A. Document refactoring, small | `docsplit` S × V0–V3 (done or running), then `docreorg` S V3, `docsplit` P V3 | 30 min elapsed, 2 more |
| B. P2 preset, with both restarts | `impl`, `testgen`, `edit`, `bugfix`, `bugs`, `log`; `docreorg` S V3; `docsplit` S and `docreorg` S V1, cut off at 12 min each. `docsplit` M V1 only if P2 makes retyping fast | 35 min |
| C. Cheap read ladder | `log`, `json`, `summary`, `codeinv` at M, then L if within 0.05 and no compaction; `summary` HU | 18 min |
| D. Manifest ladder and repeats | V3 at M and L for both tasks; 2 repeats per task at the largest clean size | 10 min |
| E. Per-document notes | 4 of the 7 reports with the table-search step: `buildcmp`, `sharp`, `depth`, `hardest` | 12 min |
| F. Reasoning-heavy ladder | `classify` M, `bugs` M, only if a realistic limit still fits; then repeats of `classify` S and `impl` | Whatever is left |

**What was cut from the earlier plan, and what that costs:**

- **P2 is not run on `json`, `summary`, `classify` and `codeinv`.** They already score 1.0 or are too slow to justify it, so the skill won't claim a P2 result for them.
- **`bugs` and `classify` have no L rung, and possibly no M.** Their limit may rest on S alone.
- **Retyping has no size ladder unless P2 makes it fast.** The `docreorg` V0, P0 V1 and V2 arms and all retyping at M and L were dropped, so retyping results are small-size only.
- **`docnotes` covers 4 reports, not 7,** including the largest. The fresh-session effect and the table-search effect can't be separated, because only V2 runs.
- **Repeats are few.** Most results stay at n=1 and are labelled so.

### Phase B result: Haiku as a grader

Blind, high effort, same prompt and notes as Opus. `MEASURED`, data in `grader-check/`.

| Field (40 notes) | Exact match with Opus | Within 1 | Mean Haiku − Opus |
|---|---:|---:|---:|
| Verdict (0–3) | 26 | 38 | −0.30 |
| Config (0–2) | 34 | 40 | −0.05 |
| Decision-relevant facts (0–5) | 36 | 39 | −0.12 |
| Facts with wrong meaning | 37 | 40 | +0.07 |
| Unsupported incidents | 39 | 40 | +0.03 |
| Missed incidents | 21 | 40 | +0.03 |
| Open question (0–2) | 40 | 40 | 0.00; both gave 2 every time, so this field tells nothing |

Critical-error flags: both flagged 3 notes, Opus alone 2, Haiku alone 6. Of Haiku's 6, checked against the sources, 1 is real and 5 don't hold.

These figures are for Haiku at `high`; Opus was also at `high`. The operator chose **Haiku `max`** as the grader, so the same 40 notes were re-graded at `max` (`grader-check/haiku-max/`, about 500–780 s and 210–230k tokens per report).

| Field (40 notes) | `max` vs Opus: exact / within 1 / mean | `high` vs Opus: exact / within 1 / mean |
|---|---:|---:|
| Verdict (0–3) | 28 / 38 / −0.25 | 26 / 38 / −0.30 |
| Config (0–2) | 32 / 40 / −0.20 | 34 / 40 / −0.05 |
| Decision-relevant facts (0–5) | 36 / 40 / −0.10 | 36 / 39 / −0.12 |
| Facts with wrong meaning | 37 / 40 / +0.07 | 37 / 40 / +0.07 |
| Unsupported incidents | 40 / 40 / 0.00 | 39 / 40 / +0.03 |
| Missed incidents | 28 / 40 / −0.30 | 21 / 40 / +0.03 |

Critical-error flags, each Haiku-only flag checked against its source:

| | `max` | `high` |
|---|---:|---:|
| Opus's 5 flags also found | 4 (missed `hardest` D) | 3 |
| Flags Opus didn't raise | 3 | 6 |
| Of those, real | 2: `hardest` B (reversed budget effect), `depth` D (minor: the note says 1.9.1 changes nothing measurable, the report measures prefill 2–6% faster) | 1 |
| Of those, don't hold as critical | 1: `buildcmp` B, a missing REPS=1 caveat | 5 |

**Result:** `max` is clearly more reliable on flags, with 1 weak extra flag instead of 5, and slightly closer on most scores. It is not a drop-in for Opus on verdict totals: on the deep notes per author it stays within 1 of Opus for all three Haiku efforts, but gives Ornith 10 where Opus gives 14 of 18 (`high`: 11).

**Decision:** Haiku `max` grades first; two independent passes on anything that matters. Every critical flag gets checked against the source before it's reported. An Ornith-versus-Haiku verdict gap under 4 of 18 counts as a tie, because this grader gap alone is that large.

## How results become recommendations

These thresholds are my proposal, so they can change after review:

| Scripted score at a size | Skill's recommendation |
|---|---|
| ≥ 0.95 | Use without review, with the output format checked by script |
| 0.85–0.95 | Use with a script check or spot check |
| 0.70–0.85 | Draft only, a human or stronger model reviews it |
| < 0.70 | Don't use for this |

- **Recommended maximum tokens:** the largest tested size that stays within 0.05 of the small-size score with no harmful compaction.
- **Reduced for margin:** where a limit comes from a single run, the skill says so and states a lower figure.
- **Choice of brief:** the cheapest brief within 0.02 of the best score; tokens and time break ties.
- **Noise:** every first pass is one run at the server's temperature. Differences under about 0.05 count as ties until repeated.

## Known issues

1. **`log` scorer, fixed:** the model replaced the literal `CLASS|` prefix with a class name in every arm, which scored 0.0. The scorer now accepts any first field and counts the deviation in `format_deviation`. All arms rescored: 0.897, with 15 of 17 classes and all 6 planted faults. My format line was ambiguous, so the skill's brief should show a real example.
2. **Stats overlap between arms, fixed:** `docker logs --since` has 1-second resolution, so a `server.log` could start with the previous arm's last requests. `serverstats.py` now starts at the session's first small prompt, all arms were recomputed, and `run_arm.sh` waits 2 seconds before each arm.
3. **GTT:** Phase A peaks were 129–300 MiB with no rise across the 31 arms, so there is no sign of a spill. Peak VRAM was at most 31.8 GiB (32,531 MiB), on the card's small free margin.
4. **Spec fixtures are synthetic:** the coding tasks were written for this test, so they show simple-task ability, not real repository work.
5. **`--thinking-token-budget N` exists in Radiance 1.16.0** and closes the reasoning block at N tokens. It might cut the reasoning cost on `bugs` and `classify`. It isn't in this run; it's listed as a next experiment.
6. **`min_p` and repetition penalty:** the starter doesn't set them. The server log shows `min_p` 0.00 (`MEASURED`), matching the official preset. The repetition penalty's value isn't confirmed; the preset says 1.0.
7. **`impl` denominator, fixed:** the scorer divided by 35, but there are 34 hidden tests, so .971 meant all passed. Scores are corrected in `score.json` and `summary.*`; `longrun.jsonl` keeps the logged values.
8. **Reboot:** an OOM restart wiped the scratchpad. Fixtures and grading sets were rebuilt with the same seeds; the labels and needle lines matched.

## Open decisions for the operator

The operator hasn't yet chosen on the system-prompt retest (report, "Open experiments", item 1).

| Decision | When |
|---|---|
| Starter default if P2 wins everywhere, or a restart rule if it wins only for coding | After Phase C |
| Whether `local-agent.sh` should get clean flags and more turns, or point to the new skill | After Phase H |
| Whether to commit, in `amd`, `skills-agents`, `dp-forge` and `AiChatney` | After Phase J |

`skills-agents/skills/local-agent/` has uncommitted changes that aren't from this work, so this plan doesn't touch them.
The benchmark directory reorganization request is still open: no recommendation given yet.

## Artifacts

- Run data: `bench/runs/2026-11-05-0320-ornith-usecases/` (`harness/`, `arms/<task>.<size>.<brief>.<preset>/`, `quarantine/`)
- Fixtures: session scratchpad, rebuilt by `harness/prepare.py`. Planted log lines are fiction.
- Skill draft: `/home/dev/work/dippe/skills-agents/skills/ornith/` (`scripts/ornith.sh`, `scripts/doc_apply.py`, `scripts/doc_check.py`, `settings.json`)
- Earlier report: `docs/analysis/2026-11-04-2207-sly-radiance-ornith-vs-haiku-high-effort.md`
