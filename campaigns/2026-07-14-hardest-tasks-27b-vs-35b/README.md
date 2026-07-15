# Campaign 4 — **Hardest tasks: 27B quant ladder vs 35B-A3B at 128k** (R9700)

*Part of the agentic-config series. Reuses the quality-at-depth harness (`campaigns/2026-07-13-27b-quality-at-depth`) — grader, corpus, tasks, judge, charts — with the **grader bug fixed** and a **sharper, narrower matrix**.*

**Status: READY TO RUN.** One command: `bash run_capture.sh`.

---

## 1. Why this campaign

The previous run (`2026-07-13-27b-quality-at-depth`) established two things:
1. The 27B is **not** below-haiku — it sits in the **haiku→sonnet band**; its real limiter is **strict
   `eslint`/`tsc` cleanliness**, not logic. *(That run's headline was corrupted by a grader bug — a
   `vitest` execution failure zeroed `tests`+`edge` on all 120 replies; see that campaign's
   `analysis_detailed.md`.)*
2. Reasoning budget helped at 64k but saturated at 128k; the model **always spends its whole budget**.

This campaign drills into the **4 hardest tasks** with the **bug fixed** and asks one focused question:
**does model choice — quantization precision or capacity — move quality at a single low-risk setting?**
It holds everything else fixed (one reasoning budget) and varies only the model: a **27B quant ladder**
(Q4_K_M → Q4_K_XL → Q5_K_M → Q6_K) plus the **35B-A3B** MoE. Add-on A makes `lint`/`types` **fractional**
so we can *see* how close each model is to the strict bar. *(The reasoning-budget sweep `{0, 2048, 8192}`
is deferred to a follow-up campaign — out of scope here; we fix budget at a safe, saturated **4096**.)*

## 2. The matrix — what runs

**Fixed for every cell:** llama.cpp **Vulkan b9950** · `-ub 2048 -b 4096 -fa on` · **MTP-on** ·
**ctx 163840** (prompt depth 120k ≈ **132.7k real tok** → fits with ~19k headroom for think+answer) ·
KV **f16**, except **Q5_K_M + Q6_K on q8_0** to fit VRAM (see below) · **reasoning-budget 4096** ·
prefix cache · sampling **temp 0.6 / top_p 0.95 / top_k 20 / min_p 0** · **REPS 3**. Only the **model/quant**
varies (KV is a forced exception on the two heaviest — flagged as a confound).

| cell | model | quant | weights | KV | @163840 ctx MTP (MEASURED/INFERRED) |
|------|-------|:---:|:---:|:---:|:---:|
| `un-d128-f16-rb4096` | Qwen3.6-**27B**-MTP | Q4_K_M | 16.1 GiB | f16 | ✅ fits (f16 caps ~189k ctx) |
| `xl-d128-f16-rb4096` | Qwen3.6-**27B**-MTP | **UD-Q4_K_XL** | 16.7 GiB | f16 | ✅ fits (f16 caps ~179k) |
| `q5-d128-q8-rb4096` | Qwen3.6-**27B**-MTP | **Q5_K_M** | 18.5 GiB | **q8_0** | ✅ fits (f16 caps ~150k < prompt+gen) |
| `q6-d128-q8-rb4096` | Qwen3.6-**27B**-MTP | **Q6_K** | 21.3 GiB | **q8_0** | ✅ **30.8/31.9 GiB** (f16 caps ~104k) |
| `a3b-d128-f16-rb4096` | Qwen3.6-**35B**-A3B-MTP | Q4_K_M | 21.1 GiB | f16 | ✅ fits (light KV, 20 KiB/tok) |

**= 5 cells × 4 hardest tasks × 3 reps = 60 graded replies.** Config source of truth: `configs.jsonl`.
The four 27B rows are a **quant ladder** (same weights, rising precision) — the primary axis.

**Tasks (4 hardest, from `tasks.jsonl`):** `rate-limiter`, `lru-cache`, `async-memo`, `expr-eval`.
Dropped from the matrix (consistently strong — avg 84–89% last run): `deep-equal`, `store-remove`
(kept as `matrix:false` for reference/smoke). Easy controls `count-words`/`shape-variant` are `SMOKE=1` only.

**Questions:** (a) does higher **precision** (Q4_K_M → Q4_K_XL → Q5_K_M → Q6_K) move quality — is the
strict lint/types wall a *quantization* artifact or real capability? (b) does the bigger **35B-A3B** clear
that wall (capacity vs precision)? (c) capability per task vs the haiku/sonnet/opus ladder; (d) speed vs
quality (generation tokens/time).

**VRAM / why the KV split (KV geometry from `gguf_kv.py`; overhead ≈ 3.5 GiB incl. the MTP draft batch,
MEASURED from the Q6_K load):** the ~120k-token prompt is **~132.7k real tokens** (code is ~3.93 chars/tok),
so the server needs **ctx > prompt + generation** — hence the **163840** window (the prior campaign's proven
window; a 131072 window 400s because the prompt alone exceeds it). The 27B is hybrid-attention (only 16 of 65
blocks carry KV → f16 = **64 KiB/tok**, q8_0 = **34**). At ctx 163840 with **f16** KV: Q4_K_M (f16 caps ~189k
ctx), UD-Q4_K_XL (~179k) and the KV-light **35B-A3B** (20 KiB/tok) all fit; but **Q5_K_M** (f16 caps ~150k)
and **Q6_K** (f16 caps ~104k) do **not** clear the ~145k the prompt+gen needs, so both run **q8_0** KV (q8 caps
~195–260k; Q6_K MEASURED at **30.8/31.9 GiB**, generates fine). **KV is therefore NOT uniform:** Q5_K_M+Q6_K
differ from the f16 cells in KV *and* weight-quant — a confound when reading the ladder. **Mitigation:** f16-vs-q8
KV is within the prior campaign's **≤5% rule**, so weight-precision should dominate; the analysis must flag
Q5/Q6's q8 KV explicitly and treat any Q5/Q6 delta as weight-quant *plus* a small KV effect.

## 3. The fix (so a full run succeeds, not just re-grades)

`score_typescript.py` now:
- runs **vitest single-process** (`--no-file-parallelism`) → no worker pool to fail under memory pressure;
- **fails loud**: if vitest yields no parseable summary, it retries once then records a `grade_error`
  (`HARNESS: …`) — **never a silent `tests=0`** (the bug that voided the last run);
- `run_capture.sh` runs a **grader self-check** (`selftest`, which actually executes vitest) *before*
  grading and **aborts loudly** if vitest isn't working here.

## 4. How to run

```bash
tmux new-session -d -s claude-run           # ONCE — the judge + summary drive claude through tmux
bash run_capture.sh                          # FULL: capture → self-check → grade → judge → charts → analysis.md
JUDGE_ENGINE=none SUMMARY=0 bash run_capture.sh   # capture + grade + charts only (no claude/tmux)
ONLY='q6-*' bash run_capture.sh              # skip/isolate a cell (e.g. the heavy Q6)
```
Resumable (per-cell `out/done/` markers + row-level in `capture.py`); continues past a failed cell.
All cells use **reasoning-budget 4096** (a safe, saturated value from the prior run — the budget sweep is a
separate follow-up campaign, out of scope here).

## 5. Add-ons

- **A — fractional `lint`/`types` (built in).** `lint`/`types` are now `1 − min(1, errors/K)` (K=5/3)
  instead of binary 0/1, so cleanliness has resolution (1 error = 0.8, not 0). `hard_pass` still needs a
  perfect 1.0. **Caveat:** the reference calibration (`calibration*.jsonl`) was graded **binary** — for
  an exact ladder, re-grade the reference answers in `out/haiku/` with this grader before analysis
  (`score_typescript.py response --response-file out/haiku/answer-<model>-<task>.txt --task ts-harness/tasks/<task>`).
- **B — one-turn repair arm.** `bash run_repair.sh` (after the main run): relaunches each cell's server,
  feeds the exact `tsc`+`eslint` errors of each failed reply back for ONE fix turn (`repair.py`), grades
  the result to `out/scores_repair.jsonl`. Tests whether a cheap `eslint --fix`-style loop closes the gap
  to Opus. Compare `scores_typescript.jsonl` (before) vs `scores_repair.jsonl` (after).
- **C — sampling sweep (Phase 2).** After the core, run around the winning budget:
  ```bash
  CONFIGS=$PWD/configs_sampling.jsonl JUDGE_ENGINE=none SUMMARY=0 bash run_capture.sh
  ```
  `configs_sampling.jsonl` sweeps **temp {0.3, 0.6, 0.9}** (hypothesis: lower temp → cleaner lint/types),
  then top_k/top_p at the winning temp (examples included). Extend it once you see the temp result.
- **D — complete the opus ladder.** `rate-limiter` and `lru-cache` lack an opus calibration point. Add
  them: run each task's prompt through opus **one-shot, no thinking**, save the answer, grade + append:
  ```bash
  python3 score_typescript.py response --response-file <opus-answer>.txt --task ts-harness/tasks/rate-limiter --id opus
  # then append {"model":"opus","task":"rate-limiter","score":…,"objectives":…} to calibration-hard.jsonl
  ```

## 5b. Extension (2026-07-15): budget axis · 35B sampling sweep · pricing-deferred

9 new cells appended to `configs.jsonl` (14 total). `run_capture.sh` is incremental: a cell is skipped
only when every (task, rep) it owes is already captured, so the 5 original cells re-open ONLY to
backfill the new `pricing-deferred` task (3 replies each), and grading reuses the 60 existing rows
(`--resume`).

**RUN THE FAIL-FAST PROBE FIRST** — `q5-d128-f16-rb16384` is the risky cell (f16 caps Q5 ~150k ctx, so
it may OOM at ctx 163840; by request there is NO pre-flight guard). Do not reorder `configs.jsonl` for
this — the order drives the chart palette. Use ONLY:

```bash
ONLY=q5-d128-f16-rb16384 bash run_capture.sh     # fail-fast: does Q5 fit at f16?
bash run_capture.sh                              # then the rest (skips whatever is complete)
```

Axes:
- **budget** {4096 (have) → 16384 → -1 unlimited}, KV **f16** throughout. rb4096 is SATURATED 12/12 on
  Q4_K_M (exactly 4095) = thinking forced to stop mid-reasoning; Qwen recommends 32,768 output.
  16384 is the ceiling at 128k depth; **unlimited only runs untruncated on `pricing-deferred`**
  (~84.4k prompt → ~79.4k headroom), where `think_tokens` becomes the OUTCOME: how much does the model
  CHOOSE to think?
- **sampling** (35B only): temp {0.3, 0.6, 1.0} single-variable with everything else pinned at Qwen's
  coding recipe, PLUS the two vendor presets as separate labelled points (Qwen thinking-general
  `1.0/0.95/20/pp1.5`; **Unsloth-only** `1.0/1.0/40/pp2.0` — Qwen's card does not document it).
  temp 0.3 is FOLKLORE: documented by neither vendor. See `docs/research/2026-07-15-1000-*`.

Sampling stays FIXED across the budget axis so budget remains single-variable; the presets are separate
cells rather than a confounded walk.

## 5c. Reference ladder at 3 reps + integrity fixes (2026-07-15)

**`run_refs.sh`** collects the haiku/sonnet/opus ladder at 3 reps for every matrix task → `calibration-reps.jsonl`
(rows carry `rep`; `aggregate.py` then reports mean±sd and hard_pass as k/n). Resumable; glue only — it composes
`build_context.py` + `claude_ask.sh` + `score_typescript.py`.

```bash
bash run_refs.sh                 # 3 models × 5 tasks × 3 reps
GRADE_ONLY=1 bash run_refs.sh    # re-grade + re-emit the jsonl, ask nothing
```

- **Why reps:** at the measured rep noise a SINGLE reference sample carries ≈±19 pts — the old n=1 ladder could
  never be quoted as a like-for-like gap. The ladder was also *incomplete*: opus had never run `lru-cache` or
  `rate-limiter`, and neither haiku nor sonnet had seen `pricing-deferred` (4 of 15 pairs empty).
- **One-shot on purpose** (`build_context.py --tokens 0`, no filler): the ladder measures CAPABILITY, not
  capability-at-depth. It is NOT depth-matched — the local cells carry ~133k of context the refs never see, so a
  bare ref-vs-local Δ is not like-for-like.
- **`aggregate.py --calib-files`** selects the reference file (default: the legacy n=1 files). `run_capture.sh`
  passes one `$CALIB` to BOTH `aggregate.py` and `make_charts.py` — they read calibration *separately* and were
  wired to different sources, which would print a 3-rep table beside an n=1 dashed band. **Do not merge the legacy
  files in:** they hold n=1 rows for the same pairs, so a pair would silently gain a 4th rep.

**Integrity fixes.** `capture.py` now RAISES on an incomplete stream (missing `finish_reason` / no `[DONE]`)
instead of returning the partial text: an interrupted generation used to be written as a normal row, counted as
done by the resume logic, and graded as if the model wrote it that way (one such row scored 0.603 with tests=0.0
and moved its cell mean 1.1 pts). `score_typescript.py` now stamps a `GRADER` constant on every graded row — it
previously existed only as a hand-typed label in the calibration files.

**Depth label.** Cells say `120k`; the real prompt is **~132.9k tokens** (522,260 chars ÷ ~3.93 ch/tok on TS). Two
causes: `CHARS_PER_TOK = 4` is an estimate, and `build_context.py` overshoots its char budget (it breaks *after*
appending a file). Deliberately NOT fixed — changing the prompt would invalidate all 210 replies. Every cell runs
the identical prompt, so the comparison is sound; only the label is nominal.

## 6. Outputs (in `out/`)

`outputs.jsonl` (replies + tokens/latency) · `scores_typescript.jsonl` (objectives incl. fractional
lint/types, or `grade_error` HARNESS rows) · `judge_scores.jsonl` (design/clarity/robustness) ·
`vram.jsonl` + `gpu_*.csv` · `summary.md`/`summary.json` (deterministic digest — per-cell table + **per-rep
detail table** (every rep + haiku/sonnet/opus refs, all objectives) + findings a–d) ·
`charts/` (cell-level, `make_charts.py`) · `charts/detailed/` (per-task, `make_charts_detailed.py`) ·
co-located `analysis.md` (auto-written) — plus optional `outputs_repair.jsonl`/`scores_repair.jsonl` (B).

## 7. Reuse / provenance

Harness, corpus, tasks, grader, judge, charts are inherited from `2026-07-13-27b-quality-at-depth`
(model-agnostic — see that campaign's `REUSE.md`). Tests & difficulty design: `eval-design.md`.
*Provenance:* this campaign's `out/` = `MEASURED`; external = `CLAIMED`; reasoned = `INFERRED`. Never blended.
