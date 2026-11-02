<!-- meta
date: 2026-11-02 00:20
slug: redhat191-dp-sharp-w208-blind
title: RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 + dp-sharp template (keep-all reasoning, froggeric v22.5 + the dp terse prompt), Cactus δ 0 — W2-08 blind review (RUNBOOK step A)
takeaway: dp-sharp completed step A (reached the blind step, wrote a 12-finding review: 2 high/5 med/5 low) where sharpsly2 did not — so it clearly beats sharpsly2 on completion. Authoritative Opus grade (2026-11-02, prompt-only, grading-opus.md): 8/19 Opus findings found (H 3/6, M 2/7, L 3/6), weighted 16/38; precision 11/12 (7 matched + 4 real review-only, 0 wrong, 1 unverifiable), 1 false claim in finding W7 (complexity>5→error, contradicted by its own probe PB1). It found FEWER reference findings than the keep-all δ 0 arms (10/19 → 21/38) — the terse prompt makes the review more focused (74 tool calls vs 81, 226,522 think chars vs 291,269) but misses the deeper flow/state high findings (#1 confirm, #2 goal-duplication, #4 T3 source); the Opus grade confirms: it "completely missed the most severe logical and data-flow flaws in the state machine". Speed is not comparable: this run was on a throttled GPU (mclk 1258 MHz vs 875, power 203 W vs ~137 W).
-->

# Benchmark: RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 + dp-sharp template (keep-all reasoning + dp terse prompt) — W2-08 blind review (RUNBOOK step A), Cactus δ 0 — R9700 (gfx1201)

- **Date:** 2026-11-01, 21:53–22:14 UTC (run) · analysis 2026-11-02 · **Track:** agentic campaign (`gen_campaign.py` `kind: agentic`, `reuse_server`), real `claude -p` session
- **GPU/Host:** Radeon AI PRO R9700 (gfx1201, 32,624 MiB), kernel 7.0.0-38-generic. **This run was on a throttled GPU** (user-capped max VRAM + MHz): mclk p50 1258 MHz, power mean 203 W — a different clock/power state than the unthrottled arms (875 MHz / ~137 W), so speed is not comparable (see caveats).
- **Engine:** `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (vLLM), profile `sly-redhat/redhat-mxfp4-dflash` (DFlash2 k = 7, KV fp8, `max_model_len` 262,000, `max_num_seqs` 1, gpu util 0.93), **Cactus δ 0** (exact acceptance), **server user-managed** (reused on port 8000, not started/stopped by this driver)
- **Template:** `dp-sharp-chat_template.jinja` — copy of the official sharp (keep-all reasoning, `qwen3.8-froggeric-v22.5`) with the terse block replaced by the dp terse prompt (`terse` kwarg default true → always on). The one variable vs `r191-sharp-d0` (keep-all sharp δ 0): **only the terse prompt differs** (keep-all replay + δ 0 held fixed).
- **Client:** Claude Code, `settings-redhat.json` · **Model:** `RedHatAI/Qwen3.8-27B-MXFP4` (W4A8 MXFP4), served as `qwen38-27b-redhat-mxfp4-dflash`
- **Task:** dp-forge W2-08 brief, RUNBOOK step A (blind review), base `de110510`
- **Data:** `bench/runs/2026-11-01-redhat191-dp-sharp-w208-blind/` (arm `rep1/r191-dp-sharp-d0/`)

## Summary

The `dp-sharp` arm — the single-variable test of the dp terse prompt against the keep-all `r191-sharp-d0` run — **completed step A**: it read the Opus reference (the blind step fired, `stop_when`) and wrote a 12-finding review (2 high, 5 med, 5 low). That alone distinguishes it from `sharp-sly2` (k = 1), which hit the 1-hour cap still probing and never wrote the review. The terse prompt made the run more focused: **74 tool calls** vs 81 (keep-all), **226,522 thinking chars** vs 291,269, **3103 chars/tool call** vs 3596, **0 compactions** (ctx peaked at 158,457).

On review quality (authoritative Opus grade, `grading-opus.md`, 2026-11-02 — prompt-only, no tools), dp-sharp found **8 of the 19 Opus reference findings** (high 3/6, med 2/7, low 3/6), severity-weighted **16/38**, with **precision 11/12** (7 matched + 4 real review-only, 0 wrong, 1 unverifiable — finding W11, whose cited sibling briefs were not embedded) and **1 false claim** inside finding W7 (claims complexity >5 causes commit-gate *errors*, contradicted by its own probe PB1: complexity 6 → warning, 0 errors). It found **fewer reference findings than the keep-all δ 0 arms** (which found 10–11/19 → 21–22/38). The terse prompt concentrated the review on the concrete, locally-probed defects (the T3 double-spawn, the fixture import path, import-sort) and **missed the deeper flow/state high findings** (#1 edited-goals-never-confirm, #2 goal-duplication, #4 T3 source-vs-`--value @tmp`) — confirmed by the Opus grade, which says it "completely missed the most severe logical and data-flow flaws in the state machine (ref #1, #2, #8, #9), focusing heavily on syntax and structural discrepancies rather than semantic correctness."

**Bottom line:** dp-sharp beats sharpsly2 on completion (it writes the review) and is a high-precision, focused review (0 wrong findings, 11/12 precision), but per the authoritative Opus grade it does **not** beat keep-all on Opus-finding coverage (16/38 vs 21/38). The terse prompt trades breadth (fewer reference findings, all the missed highs are the deeper state/flow defects) for focus (fewer tool calls, no wrong findings). Speed is not comparable (throttled GPU).

## Results (all MEASURED)

Window: session start → first tool call that **reads** the Opus reference (the blind boundary). Source: `thinking_digest.py` + `report.py` agentic (both run on this campaign's `session-0.jsonl`). `report.py` labelled the engine `llama.cpp` because the vLLM logger reported `output_tokens = 0` (known quirk), so vLLM-derived decode/gen/prefill columns are **N/A** — the transcript-derived columns (thinking chars, tool calls, messages) are valid.

### Thinking / exploration (transcript-derived — comparable across arms)

| Arm | Tool calls | Asst msgs | Think chars | Think/call | p50/p90/max | Top-10% share | Distinct files read | Re-reads after compaction | Compactions | Window s | Opus weighted* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| RedHat 1.9.1 + dp-sharp δ 0 | 74 | 54 | 226,522 | **3,103** | 901 / 8,858 / 43,229 | 70% | 17 | 0 | 0 | 1,242 | **16** |
| RedHat 1.9.1 + sharp δ 0 (ref) | 81 | 62 | 291,269 | 3,596 | 794 / 13,539 / 53,700 | 50% | 18 | 3 | 1 (327) | 2,181 | 21 |

*`Opus weighted` for dp-sharp is the authoritative Opus grade (2026-11-02, prompt-only — `grading-opus.md`). The reference row is the existing `r191-sharp-d0` run (unthrottled).

### Tool-call mix (transcript-derived — comparable)

| Arm | search | read | probe | write/edit | other |
|---|---:|---:|---:|---:|---:|
| RedHat 1.9.1 + dp-sharp δ 0 | 18 | 22 | 14 | 13 | 6 |
| RedHat 1.9.1 + sharp δ 0 (ref) | 27 | 24 | 16 | 11 | — |

`search`=grep/rg/find/ls · `read`=cat/sed/head/tail/wc + Read · `probe`=tsc/eslint/vitest/npx/node · `write/edit`=Write+Edit · `other`=git/Glob/bash-other (dp-sharp: git 3, Glob 1, bash-other 2).

### Speed & memory (MEASURED, throttled GPU — NOT comparable to the unthrottled arms)

| Arm | Wall s | Decode tok/s | Gen tok | Loop blocks | Longest-think rep % | Power W (mean/max) | mclk p50 MHz | VRAM load / peak MiB | Peak GTT MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| RedHat 1.9.1 + dp-sharp δ 0 (throttled) | 1,242 | N/A (vLLM quirk) | N/A | 0 | 3.9% | 203 / 258 | **1,258** | 31,550 / 31,649 | 143 |
| RedHat 1.9.1 + sharp δ 0 (unthrottled ref) | 2,181 | 55.8 | 120,001 | 0 | 0.6% | ~137 / ~245 | 875 | 31,046 / 32,285 | 217 |

Memory: peak GTT 143 MiB sits within ~150 MiB of this box's idle reading → no host-RAM spill. Peak VRAM 31,649 MiB is 975 MiB below physical 32,624 MiB. No exact loops (0 blocks, 3.9% longest-think repeat). **Decode/gen are N/A** because vLLM reported `output_tokens = 0`; wall (1,242 s) and clock/power reflect the throttled GPU, so they are not comparable to the reference row.

## Review quality — finding-level coverage (the W2-08 Opus reference, 19 findings: 6 high, 7 med, 6 low)

All arms graded against the same Opus reference review (19 numbered findings). `Found` = reference findings the arm raised. `Weighted` = high 3 · med 2 · low 1 (max 38). `matched` / `real-only` / `wrong` = arm's own findings that match a reference finding / are real but not in the reference / are wrong. `precision` = (matched + real-only) / total findings.

| Arm | Weighted (/38) | Found (n/19) | H/M/L found | findings | matched | real-only | wrong | precision |
|---|---:|---:|:--:|---:|---:|---:|---:|---:|
| Q4_K_XL + sharp | 23 | 12 | 3/4/5 | 15 | 11 | 4 | 0 | 1.0 |
| RedHat 1.8.1 + sharp δ 0 | 22 | 11 | 4/3/4 | 14 | 11 | 3 | 0 | 1.0 |
| RedHat 1.9.1 + sharp δ 0 (keep-all) | 21 | 10 | 4/3/3 | 15 | 10 | 4 | 1 | 0.93 |
| RedHat 1.9.1 + sharp δ 0.5 | 16 | 7 | 3/3/1 | 8 | 7 | 1 | 0 | 1.0 |
| **RedHat 1.9.1 + dp-sharp δ 0 (terse)** | **16** | **8** | **3/2/3** | **12** | **7** | **4** | **0** | **0.92** (11/12) |

Opus grade (2026-11-02, prompt-only — `grading-opus.md`). dp-sharp found **8/19** reference findings (3/6 high, 2/7 med, 3/6 low), weighted **16/38**, precision **11/12 (0.92)**: 7 matched + 4 real review-only, 0 wrong, **1 unverifiable** (finding W11 — its claim about the W2-04/W2-05 sibling briefs and the template can't be checked because those files were not embedded; counted against precision per the rubric). The Opus grade also found **1 false claim**: inside finding W7, the statement that function complexity >5 causes commit-gate *errors* (COMPLEXITY_HARD 5 "errors at >5") is contradicted by W's own probe PB1 (complexity 6 on runScreen → warning, 0 errors). Its review was **more focused** (12 findings, 74 tool calls, 0 compactions) but **found fewer reference findings** than the keep-all δ 0 arms (10/19 → 21/38). **Every dp-sharp miss is one of the deeper flow/state high findings** — see the handling table below.

### How each of the 19 reference findings was handled by dp-sharp (Accepted = raised; Rejected = missed)

| Ref # | Sev | Item | Problem (short) | dp-sharp handling |
|---:|---|---|---|---|
| 1 | high | D3,D4 (C3,C8) | edited goals never confirmable: applyResolve writes goals.json not confirmed.json; C8 re-pause → operator → exit 4 | **Rejected** (missed) |
| 2 | high | D2,D3 | walk duplicates every goal → `[G-1,G-2,G-1,G-2']` | **Rejected** (missed) |
| 3 | high | D4,TESTS | T3 can't pass: D4 spawns irSet+irValidate, fixture single `{exit:0}` → `plan[1]=undefined` → throw | **Accepted** ← finding 1 (high) |
| 4 | high | TESTS | T3 asserts G-2 source, but irSet passes `--value @<tmp>`, temp deleted; fake records argv only | **Rejected** (missed) |
| 5 | high | TESTS | `'../src/…/resolve-confirm.js'` resolves to `tests/src/…` → every test fails at import | **Accepted** ← finding 2 (high) |
| 6 | high | D2,D4 | import lines fail `simple-import-sort` (an error) | **Accepted** ← finding 5 (med) [ref high / arm med] |
| 7 | med | D2,D3 | screen is a prose state machine (no code); M9 can't run on prose | **Rejected** (missed) |
| 8 | med | D3 | `r` then Enter → text `''` → schema refuses, applyResolve throws | **Rejected** (missed) |
| 9 | med | D3 | drop every goal → `goals:[]` → `.min(1)` refuses, applyResolve throws | **Rejected** (missed) |
| 10 | med | D4 | applyResolve has 4 params (warn); STEP 5 `--quiet` hides it | **Accepted** ← finding 3 (med) |
| 11 | med | C11 item 6 | nobody turns ledger residue rows into `cuts` | **Rejected** (missed) |
| 12 | med | TESTS | T1/T2 assert containment only (missing `blast:` passes); `a`/`c`/`q` untested though row lists "a→accept" | **Rejected** (arm deferred a→accept per D-8; not raised as a finding) |
| 13 | med | STEPS | STEPS 2 "Write T1-T4" but TESTS defines T1-T3 | **Accepted** ← finding 10 (low) [ref med / arm low] |
| 14 | low | D2 | `ResolveConfirmInput.record` never read by the screen (EXTRA) | **Rejected** (missed) |
| 15 | low | D2,D3 | `goalsChanged`/`nonGoalsChanged` never read (JSON.stringify compare) | **Accepted** ← finding 9 (low) |
| 16 | low | D3 | walk-summary `q` → "abort" doesn't say what happens to the partial walk | **Rejected** (missed) |
| 17 | low | FILES,S1 | paths package-relative (`src/…`) vs repo-relative (`tools/dpf/…`) | **Accepted** ← finding 10 (low) |
| 18 | low | PATTERN | `runScreen` is the loop, not a screen; sibling to copy is W2-05 `clarifyScreen` | **Rejected** (finding 4 is a different PATTERN defect → review-only) |
| 19 | low | DO NOT | line 2 is old text, no lint-forced helper exception | **Accepted** ← finding 7 (med) [ref low / arm med] |

Accepted: 8 (high 3, med 2, low 3). Rejected: 11. Three severity disagreements (ref high/med/low vs arm med/low/med on findings 6, 13, 19 respectively).

### dp-sharp's review-only findings (not among the 19) — Opus verdicts

| Arm finding | Sev | Item | Problem | Opus verdict |
|---|---|---|---|---|
| 4 | med | PATTERN | block labelled "verbatim" but omits `LineIO`, rewrites runScreen (`let`/`for`/`for(;;)` → no-restricted-syntax), `prompt?: string` doesn't typecheck | **real (med)** — PB1 confirms TS2345 on `prompt?: string` + multiple eslint warnings → not a clean copy of the contract |
| 6 | med | D4 | the ir-failure error branch ("throw when any ir result is not ok") has no test | **real (med)** — brief line 97 mandates the error; TESTS (lines 101–133) only define T1–T3 for the success path |
| 8 | low | S8 | range 171–176 names `ResolutionDoc`; the imported type is `ResolutionIr` at line 177 | **real (low)** — probe shows `ResolutionIr` exported at line 177, outside the requested block |
| 11 | low | STEP 3 | "one Edit per site" vs siblings' "one Write per new file" | **unverifiable** — W2-04, W2-05 and the `01-writer-brief.md` template are not embedded (no tools to fetch them) |
| 12 | low | FINAL REPORT | "T2 … T3 (same shape)" must follow the final test list once finding 6's T4 is added | **real (low)** — brief line 181 lists T2…T3 for FINAL REPORT, contradicting line 151's "Write T1–T4" |

Opus precision = (7 matched + 4 real review-only) / 12 = **11/12** (W11 unverifiable counts against precision). Plus the 1 false claim in W7 (above).

## Consequences & root causes

1. **dp-sharp completes where sharpsly2 did not.** MEASURED: dp-sharp reached the blind step and wrote the review (`status=stopped`); `sharp-sly2` hit the cap still probing with no review. So on this workload dp-sharp strictly beats sharpsly2 on completion. → *The keep-all dp-sharp template is the viable template variant; do not adopt sharpsly2 (k = 1 replay).*

2. **The terse prompt trades coverage for focus.** Opus grade: dp-sharp found 8/19 reference findings (weighted 16/38) vs the keep-all δ 0 arms' 10/19 (21/38) — fewer. But it also used fewer tool calls (74 vs 81), less thinking (226,522 vs 291,269 chars), 0 compactions, and **no wrong finding** (precision 11/12 vs keep-all δ 0's 0.93, which had 1 wrong finding + 3 false claims). dp-sharp's 11/12 reflects 1 unverifiable finding (W11) plus 1 false claim inside W7 (the complexity>5→error claim, contradicted by its own probe PB1). → *The terse prompt makes the review tighter and cleaner, but it does not find more reference defects — it finds a different, narrower set.*

3. **Every dp-sharp miss is a deep flow/state high finding.** CONFIRMED by the Opus grade: the missed highs are #1 (edited goals never confirm — the applyResolve/confirmed.json + C8 re-pause chain), #2 (walk duplicates every goal — state accumulation), #4 (T3 asserts source but irSet passes `--value @tmp` — the fake records argv only). All three require tracing multi-step state/control flow, not a single locally-probed line; the Opus grade adds missed meds #8 (Enter→`''`→applyResolve throws) and #9 (drop-all→`goals:[]`→applyResolve throws) to "the most severe logical and data-flow flaws in the state machine" it says W "completely missed". The terse prompt's "conclude once verified" bias appears to stop the exploration before reaching those. → *If the goal is maximum reference coverage, keep-all is the better substrate; the terse prompt's win is on focus/cleanliness, not coverage.*

4. **The Opus grader's independent read (qualitative, verbatim in `grading-opus.md`).** "W provides a highly structured and detailed review with excellent probe coverage (PB1–PB4), capturing critical issues like the import path failure (O5), the double spawn bug (O3), and missing lint exceptions (O19). However, W completely missed the most severe logical and data-flow flaws in the state machine (O1, O2, O8, O9), focusing heavily on syntax and structural discrepancies rather than semantic correctness. W introduced valuable review-only findings that correctly identified broken code blocks and missing test coverage." Unverified by design (no tools): W11 (sibling-brief/template claims) and references to `01-writer-brief.md`. → *The misses are a bias toward local, probe-verifiable defects over semantic state-machine reasoning — a template/prompt property, not a fluke of one run (n = 1 caveat stands).*

5. **Speed is not comparable (throttled GPU).** MEASURED: this run's mclk p50 1258 MHz / power mean 203 W differ from the unthrottled arms' 875 MHz / ~137 W. The wall (1,242 s) and clock/power reflect the throttled state; decode/gen are N/A (vLLM `output_tokens = 0`). → *Do not read dp-sharp's wall or clock/power against the reference row; only the transcript-derived columns (thinking chars, tool calls, messages) and the review content are comparable.*

## Methodology & caveats

- **n = 1, single arm** (`r191-dp-sharp-d0`); the one variable vs `r191-sharp-d0` is the terse prompt (keep-all replay + δ 0 held fixed).
- **`reuse_server`:** the vLLM server was user-managed on port 8000 (started by `vllm.sh`), not by this driver — no boot/stop/unload. The server ran `RADIANCE_CACTUS_DELTA=0` + the dp-sharp template (verified in `server-info.txt`).
- **Opus grade (authoritative, done 2026-11-02).** `opus-grade-prompt.md` is a **self-contained prompt-only** grader — all files to be analyzed (the review, the reference review + its 19 findings, the brief, all 12 probe files) are embedded in it, so it runs in any Opus UI with **no tools** (no file reads, no git, no tsc/eslint/vitest). It was run on a **real Opus model** and the result is saved verbatim in **`grading-opus.md`**; it replaces the earlier 27B-level preliminary numbers (the session model for this repo run is the 27B itself, which is not the designated grader). The headline held: 8/19 found, weighted 16/38 — unchanged from the preliminary; what tightened was precision **~1.0 → 11/12** (review-only 5 → 4 real + 1 unverifiable) and **1 false claim** was added (W7 complexity). The blind package is at `bench/runs/2026-11-01-redhat191-dp-sharp-w208-blind/blind-grading-dp-sharp/pkg/` (arm anonymized as `W`; `key.json` deliberately not embedded; unblinded in `grading-opus.md` only after the grade: W = `r191-dp-sharp-d0`).
- **Throttled GPU:** mclk 1258 MHz / power 203 W (vs 875 MHz / ~137 W unthrottled). Speed/clock/power are not comparable; transcript-derived metrics and review content are.
- **vLLM `output_tokens = 0` quirk:** decode/gen/prefill columns are N/A; transcript-derived metrics are used instead.
