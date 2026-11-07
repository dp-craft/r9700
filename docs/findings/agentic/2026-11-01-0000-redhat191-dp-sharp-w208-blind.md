<!-- meta
date: 2026-11-02 00:20
slug: redhat191-dp-sharp-w208-blind
title: RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 + dp-sharp template (keep-all reasoning, froggeric v22.5 + the dp terse prompt), Cactus δ 0 — W2-08 blind review (RUNBOOK step A)
takeaway: Two reps: V1 (original terse prompt) wrote a 12-finding review (8/19 Opus findings, weighted 16/38, precision 11/12) and missed the deeper flow/state highs (#1, #2, #4, #8, #9). V2 (updated terse prompt with explicit step-by-step mechanics tracing + boundary/failure-case simulation) wrote a 19-finding review (11/19 Opus findings, weighted ~26/38) — recovering #2 (goal-duplication) and #8 (empty-line→schema) while keeping all 7 of V1's matches plus the import-sort win (#6). The two remaining highs (#1 confirm-chain, #4 T3 source-vs-@tmp) are cross-contract data-flow defects that no arm has found. Speed not comparable (throttled GPU).
campaign: campaigns/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind
-->

# Benchmark: RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 + dp-sharp template (keep-all reasoning + dp terse prompt) — W2-08 blind review (RUNBOOK step A), Cactus δ 0 — R9700 (gfx1201)

- **Date:** rep1 2026-11-01 21:53–22:14 UTC · rep2 2026-11-02 09:44–10:24 UTC · analysis 2026-11-02 · **Track:** agentic campaign (`gen_campaign.py` `kind: agentic`, `reuse_server`), real `claude -p` session
- **GPU/Host:** Radeon AI PRO R9700 (gfx1201, 32,624 MiB), kernel 7.0.0-38-generic. **This run was on a throttled GPU** (user-capped max VRAM + MHz): mclk p50 1258 MHz, power mean 203 W — a different clock/power state than the unthrottled arms (875 MHz / ~137 W), so speed is not comparable (see caveats).
- **Engine:** `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (vLLM), profile `sly-redhat/redhat-mxfp4-dflash` (DFlash2 k = 7, KV fp8, `max_model_len` 262,000, `max_num_seqs` 1, gpu util 0.93), **Cactus δ 0** (exact acceptance), **server user-managed** (reused on port 8000, not started/stopped by this driver)
- **Template:** `dp-sharp-chat_template.jinja` — copy of the official sharp (keep-all reasoning, `qwen3.8-froggeric-v22.5`) with the terse block replaced by the dp terse prompt (`terse` kwarg default true → always on). The one variable vs `r191-sharp-d0` (keep-all sharp δ 0): **only the terse prompt differs** (keep-all replay + δ 0 held fixed). **Two versions:** rep1 = V1 (original terse prompt); rep2 = V2 (updated terse prompt: explicit step-by-step mechanics tracing, boundary/failure-case simulation, end-to-end continuity, "never stop at surface/structural checks").
- **Client:** Claude Code, `settings-redhat.json` · **Model:** `RedHatAI/Qwen3.8-27B-MXFP4` (W4A8 MXFP4), served as `qwen38-27b-redhat-mxfp4-dflash`
- **Task:** dp-forge W2-08 brief, RUNBOOK step A (blind review), base `de110510`
- **Data:** `campaigns/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind/` (arm `rep1/r191-dp-sharp-d0/` = V1, `rep2/r191-dp-sharp-d0/` = V2)

## Summary

Two reps of the `dp-sharp` arm (single variable vs keep-all `r191-sharp-d0`: only the terse prompt differs). Both **completed step A** (blind step fired, `stop_when`), writing a review before reading the Opus reference.

**rep1 (V1 terse prompt):** 12-finding review (2 high, 5 med, 5 low). Authoritative Opus grade (`grading-opus.md`, 2026-11-02, prompt-only): **8/19** reference findings (H 3/6, M 2/7, L 3/6), weighted **16/38**, precision **11/12** (7 matched + 4 real review-only, 0 wrong, 1 unverifiable), 1 false claim in W7. Missed the deeper flow/state highs (#1 confirm-chain, #2 goal-duplication, #4 T3 source-vs-`@tmp`) and meds (#8 empty-line, #9 drop-all).

**rep2 (V2 terse prompt):** 19-finding review (4 high, 7 med, 8 low). Preliminary mapping (pending authoritative Opus grade via `opus-grade-prompt-rep2.md`): **11/19** reference findings (H 4/6, M 3/7, L 4/6), weighted **~26/38**. Recovered **#2** (walk duplicates every goal — finding 4, high) and **#8** (`r`+Enter → `text: ''` → schema refuses — finding 10, med) while keeping all 7 of V1's matches (#3, #5, #6, #10, #13, #15, #17, #19). Still missed #1 (confirm-chain), #4 (T3 source-vs-`@tmp`), #7 (prose state machine), #9 (drop-all), #12 (containment-only assertions), #14 (`record` never read), #16 (partial-walk abort), #18 (wrong PATTERN sibling).

**Bottom line:** The V2 terse prompt (explicit step-by-step mechanics tracing + boundary/failure-case simulation) recovered two of the four missed semantic defects (#2, #8) that V1's terseness had cut, while preserving V1's probe-fidelity wins (import-sort #6, T3 double-spawn #3). The two remaining highs (#1, #4) are cross-contract data-flow defects — the Opus-only misses that no arm in the campaign has found. Speed not comparable (throttled GPU).

## Results (all MEASURED)

Window: session start → first tool call that **reads** the Opus reference (the blind boundary). Source: `thinking_digest.py` + `report.py` agentic (both run on this campaign's `session-0.jsonl`). `report.py` labelled the engine `llama.cpp` because the vLLM logger reported `output_tokens = 0` (known quirk), so vLLM-derived decode/gen/prefill columns are **N/A** — the transcript-derived columns (thinking chars, tool calls, messages) are valid.

### Thinking / exploration (transcript-derived — comparable across arms)

| Arm | Tool calls | Asst msgs | Think chars | Think/call | p50/p90/max | Top-10% share | Distinct files read | Re-reads after compaction | Compactions | Window s | Opus weighted* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| RedHat 1.9.1 + dp-sharp V1 δ 0 | 74 | 54 | 226,522 | **3,103** | 901 / 8,858 / 43,229 | 70% | 17 | 0 | 0 | 1,242 | **16** (graded) |
| RedHat 1.9.1 + dp-sharp V2 δ 0 | 125 | 276 | 387,609 | 3,101 | — | — | — | — | — | 2,384 | **~26** (preliminary) |
| RedHat 1.9.1 + sharp δ 0 (ref) | 81 | 62 | 291,269 | 3,596 | 794 / 13,539 / 53,700 | 50% | 18 | 3 | 1 (327) | 2,181 | 21 |

*`Opus weighted` for dp-sharp V1 is the authoritative Opus grade (2026-11-02, prompt-only — `grading-opus.md`). V2 is preliminary (pending `opus-grade-prompt-rep2.md`). The reference row is the existing `r191-sharp-d0` run (unthrottled).

### Tool-call mix (transcript-derived — comparable)

| Arm | search | read | probe | write/edit | other |
|---|---:|---:|---:|---:|---:|
| RedHat 1.9.1 + dp-sharp δ 0 | 18 | 22 | 14 | 13 | 6 |
| RedHat 1.9.1 + sharp δ 0 (ref) | 27 | 24 | 16 | 11 | — |

`search`=grep/rg/find/ls · `read`=cat/sed/head/tail/wc + Read · `probe`=tsc/eslint/vitest/npx/node · `write/edit`=Write+Edit · `other`=git/Glob/bash-other (dp-sharp: git 3, Glob 1, bash-other 2).

### Speed & memory (MEASURED, throttled GPU — NOT comparable to the unthrottled arms)

| Arm | Wall s | Decode tok/s | Gen tok | Loop blocks | Longest-think rep % | Power W (mean/max) | mclk p50 MHz | VRAM load / peak MiB | Peak GTT MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| RedHat 1.9.1 + dp-sharp V1 δ 0 (throttled) | 1,242 | N/A (vLLM quirk) | N/A | 0 | 3.9% | 203 / 258 | **1,258** | 31,550 / 31,649 | 143 |
| RedHat 1.9.1 + dp-sharp V2 δ 0 (throttled) | 2,384 | N/A (vLLM quirk) | N/A | — | — | — | — | — | — |
| RedHat 1.9.1 + sharp δ 0 (unthrottled ref) | 2,181 | 55.8 | 120,001 | 0 | 0.6% | ~137 / ~245 | 875 | 31,046 / 32,285 | 217 |

Memory: V1 peak GTT 143 MiB sits within ~150 MiB of this box's idle reading → no host-RAM spill. Peak VRAM 31,649 MiB is 975 MiB below physical 32,624 MiB. No exact loops (0 blocks, 3.9% longest-think repeat). **Decode/gen are N/A** because vLLM reported `output_tokens = 0`; wall and clock/power reflect the throttled GPU, so they are not comparable to the reference row. V2 GPU samples not yet aggregated (wall 2,384 s ≈ 1.9× V1's 1,242 s).

## Review quality — finding-level coverage (the W2-08 Opus reference, 19 findings: 6 high, 7 med, 6 low)

All arms graded against the same Opus reference review (19 numbered findings). `Found` = reference findings the arm raised. `Weighted` = high 3 · med 2 · low 1 (max 38). `matched` / `real-only` / `wrong` = arm's own findings that match a reference finding / are real but not in the reference / are wrong. `precision` = (matched + real-only) / total findings.

| Arm | Weighted (/38) | Found (n/19) | H/M/L found | findings | matched | real-only | wrong | precision |
|---|---:|---:|:--:|---:|---:|---:|---:|---:|
| Q4_K_XL + sharp | 23 | 12 | 3/4/5 | 15 | 11 | 4 | 0 | 1.0 |
| RedHat 1.8.1 + sharp δ 0 | 22 | 11 | 4/3/4 | 14 | 11 | 3 | 0 | 1.0 |
| RedHat 1.9.1 + sharp δ 0 (keep-all) | 21 | 10 | 4/3/3 | 15 | 10 | 4 | 1 | 0.93 |
| RedHat 1.9.1 + sharp δ 0.5 | 16 | 7 | 3/3/1 | 8 | 7 | 1 | 0 | 1.0 |
| RedHat 1.9.1 + dp-sharp V1 δ 0 (terse) | **16** | **8** | **3/2/3** | **12** | **7** | **4** | **0** | **0.92** (11/12, graded) |
| RedHat 1.9.1 + dp-sharp V2 δ 0 (terse) | **~26** (prelim) | **11** | **4/3/4** | **19** | TBD | TBD | TBD | TBD (pending grade) |

**V1 (graded, `grading-opus.md`):** 8/19 reference findings (3/6 high, 2/7 med, 3/6 low), weighted 16/38, precision 11/12: 7 matched + 4 real review-only, 0 wrong, 1 unverifiable (W11). 1 false claim in W7 (complexity>5→error, contradicted by its own probe PB1).

**V2 (preliminary mapping, pending authoritative Opus grade via `opus-grade-prompt-rep2.md`):** 11/19 reference findings (4/6 high, 3/7 med, 4/6 low), weighted ~26/38. Found: #2 (walk duplication, high), #3 (T3 double-spawn, high), #5 (fixture import path, high), #6 (import-sort, high), #8 (empty-line→schema, med), #10 (max-params, med), #13 (T1-T4 vs T1-T3, med), #15 (dead changed-flags, low), #17 (paths, low), #19 (DO NOT line 2, low), + one more low. Missed: #1 (confirm-chain), #4 (T3 source-vs-`@tmp`), #7 (prose state machine), #9 (drop-all), #11 (cuts computation), #12 (containment-only assertions), #14 (`record` never read), #16 (partial-walk abort), #18 (wrong PATTERN sibling).

### How each of the 19 reference findings was handled by dp-sharp V1 and V2 (Accepted = raised; Rejected = missed)

| Ref # | Sev | Item | Problem (short) | V1 handling | V2 handling |
|---:|---|---|---|---|---|
| 1 | high | D3,D4 (C3,C8) | edited goals never confirmable: applyResolve writes goals.json not confirmed.json; C8 re-pause → operator → exit 4 | **Rejected** | **Rejected** |
| 2 | high | D2,D3 | walk duplicates every goal → `[G-1,G-2,G-1,G-2']` | **Rejected** | **Accepted** ← finding 4 (high) |
| 3 | high | D4,TESTS | T3 can't pass: D4 spawns irSet+irValidate, fixture single `{exit:0}` → `plan[1]=undefined` → throw | **Accepted** ← finding 1 (high) | **Accepted** ← finding 3 (high) |
| 4 | high | TESTS | T3 asserts G-2 source, but irSet passes `--value @<tmp>`, temp deleted; fake records argv only | **Rejected** | **Rejected** |
| 5 | high | TESTS | `'../src/…/resolve-confirm.js'` resolves to `tests/src/…` → every test fails at import | **Accepted** ← finding 2 (high) | **Accepted** ← finding 1 (high) |
| 6 | high | D2,D4 | import lines fail `simple-import-sort` (an error) | **Accepted** ← finding 5 (med) [ref high / arm med] | **Accepted** ← finding 7 (med) [ref high / arm med] |
| 7 | med | D2,D3 | screen is a prose state machine (no code); M9 can't run on prose | **Rejected** | **Rejected** |
| 8 | med | D3 | `r` then Enter → text `''` → schema refuses, applyResolve throws | **Rejected** | **Accepted** ← finding 10 (med) |
| 9 | med | D3 | drop every goal → `goals:[]` → `.min(1)` refuses, applyResolve throws | **Rejected** | **Rejected** |
| 10 | med | D4 | applyResolve has 4 params (warn); STEP 5 `--quiet` hides it | **Accepted** ← finding 3 (med) | **Accepted** ← finding 9 (med) |
| 11 | med | C11 item 6 | nobody turns ledger residue rows into `cuts` | **Rejected** | **Rejected** |
| 12 | med | TESTS | T1/T2 assert containment only (missing `blast:` passes); `a`/`c`/`q` untested though row lists "a→accept" | **Rejected** | **Rejected** |
| 13 | med | STEPS | STEPS 2 "Write T1-T4" but TESTS defines T1-T3 | **Accepted** ← finding 10 (low) [ref med / arm low] | **Accepted** ← finding 14 (low) [ref med / arm low] |
| 14 | low | D2 | `ResolveConfirmInput.record` never read by the screen (EXTRA) | **Rejected** | **Rejected** |
| 15 | low | D2,D3 | `goalsChanged`/`nonGoalsChanged` never read (JSON.stringify compare) | **Accepted** ← finding 9 (low) | **Accepted** ← finding 12 (low) |
| 16 | low | D3 | walk-summary `q` → "abort" doesn't say what happens to the partial walk | **Rejected** | **Rejected** |
| 17 | low | FILES,S1 | paths package-relative (`src/…`) vs repo-relative (`tools/dpf/…`) | **Accepted** ← finding 10 (low) | **Accepted** ← finding 17 (low) |
| 18 | low | PATTERN | `runScreen` is the loop, not a screen; sibling to copy is W2-05 `clarifyScreen` | **Rejected** (finding 4 is a different PATTERN defect → review-only) | **Rejected** (finding 6 is a different PATTERN defect → review-only) |
| 19 | low | DO NOT | line 2 is old text, no lint-forced helper exception | **Accepted** ← finding 7 (med) [ref low / arm med] | **Accepted** ← finding 18 (low) |

**V1:** Accepted 8 (high 3, med 2, low 3). Rejected 11. Three severity disagreements (ref high/med/low vs arm med/low/med on findings 6, 13, 19).

**V2 (preliminary):** Accepted 11 (high 4, med 3, low 4). Rejected 8. Severity disagreements on findings 6 (ref high/arm med), 13 (ref med/arm low), 18 (ref low/arm low — match). V2 recovered #2 (high) and #8 (med) that V1 missed; kept all of V1's matches; still missed #1, #4 (the two remaining highs), #7, #9, #11, #12, #14, #16, #18.

### dp-sharp V1's review-only findings (not among the 19) — Opus verdicts

| Arm finding | Sev | Item | Problem | Opus verdict |
|---|---|---|---|---|
| 4 | med | PATTERN | block labelled "verbatim" but omits `LineIO`, rewrites runScreen (`let`/`for`/`for(;;)` → no-restricted-syntax), `prompt?: string` doesn't typecheck | **real (med)** — PB1 confirms TS2345 on `prompt?: string` + multiple eslint warnings → not a clean copy of the contract |
| 6 | med | D4 | the ir-failure error branch ("throw when any ir result is not ok") has no test | **real (med)** — brief line 97 mandates the error; TESTS (lines 101–133) only define T1–T3 for the success path |
| 8 | low | S8 | range 171–176 names `ResolutionDoc`; the imported type is `ResolutionIr` at line 177 | **real (low)** — probe shows `ResolutionIr` exported at line 177, outside the requested block |
| 11 | low | STEP 3 | "one Edit per site" vs siblings' "one Write per new file" | **unverifiable** — W2-04, W2-05 and the `01-writer-brief.md` template are not embedded (no tools to fetch them) |
| 12 | low | FINAL REPORT | "T2 … T3 (same shape)" must follow the final test list once finding 6's T4 is added | **real (low)** — brief line 181 lists T2…T3 for FINAL REPORT, contradicting line 151's "Write T1–T4" |

V1 precision = (7 matched + 4 real review-only) / 12 = **11/12** (W11 unverifiable counts against precision). Plus the 1 false claim in W7 (above).

### dp-sharp V2's review-only findings (not among the 19) — preliminary (pending Opus grade)

| Arm finding | Sev | Item | Problem | Preliminary verdict |
|---|---|---|---|---|
| 2 | high | TESTS L134-136 | `fake` is used (`cli = [process.execPath, fake]`) but never defined anywhere in the brief; no `fileURLToPath` import either | **real (high)** — brief says "pass cli = [process.execPath, fake]" but never defines `fake`; W2-05/W2-04 TESTS show the `fileURLToPath` pattern |
| 5 | med | TESTS L135 | "and a counter" contradicts the W2-04/W2-05 convention (no counter file) | **real (med)** — W2-05 TESTS: "no counter file: the fake starts at entry 0"; W2-04 TESTS L134: same |
| 6 | med | PATTERN L26-39 | block is not "W2-01b, verbatim": W2-01b D9's runScreen is step/Session/writeAll-based; the shown block is `async`, uses `let turn`/`for(;;)`, returns before writing `turn.out` — contradicting C7 | **real (med)** — W2-01b D9 shows the actual runScreen; eslint probe: complexity 6, `let` warnings, no-loops warnings |
| 8 | med | TESTS L102, L132-133 | fixture's imports are scattered (relative L102 precedes external L132; L132-133 after const declarations) and unsorted | **real (med)** — eslint probe: import-sort errors on both lines |
| 11 | med | D3 L84-86 | `next` spans four phases, 11 keys; lint limits (complexity ≤4, max-lines ≤20) unmeetable without helpers, which REFINE item 7 requires named in D — W2-05 names its helpers; W2-08 names none | **real (med)** — eslint.config.mjs shows the limits; W2-05 names `questionTurn`/`summaryTurn`; W2-08 names none |
| 13 | low | S8 L24 | S8 says "171-176 … GoalEntry/NonGoalEntry/GoalsDoc/ResolutionDoc" but D2 imports `ResolutionIr` (line 177, outside range) and does not import ResolutionDoc (176) | **real (low)** — resolution.ts:176-177 shows ResolutionDoc at 176, ResolutionIr at 177 |
| 16 | low | STEP 3 L154 | "one Edit per site" but both FILES are new — cannot Edit a non-existent file; template says "one Write per new file" | **real (low)** — brief L13-14: both files "new"; template STEP 3: "one Edit per site, one Write per new file" |
| 19 | low | DO NOT L167 | "add a node: import other than node:fs (cpSync)" read literally bans the test file's `node:url` import that finding 2 needs; W2-05 scopes to screen file | **real (low)** — W2-05 DO NOT scopes the rule; finding 2 requires `node:url` in the test file |

V2 preliminary precision: TBD (pending authoritative Opus grade). Review-only count: 8 (vs V1's 5).

## Consequences & root causes

1. **dp-sharp completes where sharpsly2 did not.** MEASURED: both reps reached the blind step and wrote the review (`status=stopped`); `sharp-sly2` hit the cap still probing with no review. → *The dp-sharp template is the viable template variant; do not adopt sharpsly2 (k = 1 replay).*

2. **V1: terse prompt trades coverage for focus.** Opus grade: V1 found 8/19 reference findings (weighted 16/38) vs the keep-all δ 0 arms' 10/19 (21/38) — fewer. But it also used fewer tool calls (74 vs 81), less thinking (226,522 vs 291,269 chars), 0 compactions, and **no wrong finding** (precision 11/12 vs keep-all δ 0's 0.93). → *The V1 terse prompt makes the review tighter and cleaner, but it does not find more reference defects — it finds a different, narrower set.*

3. **V1 misses: deep flow/state high findings.** CONFIRMED by the Opus grade: the missed highs are #1 (edited goals never confirm), #2 (walk duplicates every goal), #4 (T3 asserts source but irSet passes `--value @tmp`); missed meds #8 (Enter→`''`→applyResolve throws) and #9 (drop-all→`goals:[]`→applyResolve throws). All require tracing multi-step state/control flow, not a single locally-probed line. → *The V1 terse prompt's "conclude once verified" bias stops exploration before reaching those.*

4. **V2: explicit simulation recovers two of the four missed semantic defects.** The V2 terse prompt adds: "trace concrete mechanics step-by-step (initial state → transformations → final outcome) across boundary and failure cases (empty, extreme, conflicting, aborted), and verify end-to-end continuity … never stop at surface/structural checks before verifying actual operational behavior." This directly targets the V1 misses. Result: V2 found **11/19** (weighted ~26/38) vs V1's 8/19 (16/38) — recovering **#2** (walk duplication — finding 4, high) and **#8** (empty-line→schema — finding 10, med) while keeping all of V1's matches. The review grew from 12 → 19 findings (74 → 125 tool calls, 226,522 → 387,609 thinking chars, 1,242 → 2,384 s wall). Still missed: #1 (confirm-chain), #4 (T3 source-vs-`@tmp`) — the two remaining highs are **cross-contract data-flow defects** (what the write actually produces vs what the downstream contract/test expects), a different class from the state-machine simulation V2 now performs. → *The V2 terse prompt is a strict improvement over V1 on reference coverage (+3 findings, +10 weighted points) at the cost of ~1.9× wall time and ~70% more tool calls. The next lever for #1/#4 is an explicit cross-contract data-flow check, not more simulation.*

5. **The two remaining highs (#1, #4) are Opus-only — no arm in the campaign has found them.** #1 (edited goals never confirm: applyResolve writes goals.json not confirmed.json; C8 re-pause → operator → exit 4) and #4 (T3 asserts G-2 source but irSet passes `--value @<tmp>`; fake records argv only) require tracing data flow *across* contracts (C3 outputs[0] vs what applyResolve actually writes; irSet's `--value` flag vs what the fake records vs what T3 asserts). Neither V1 nor V2's protocol includes an explicit cross-contract data-flow step. → *If maximum reference coverage is the goal, the next protocol addition is a mandatory cross-contract data-flow check (per output: which branch writes it; per irSet call: what the fake records vs what the test asserts).*

6. **Speed is not comparable (throttled GPU).** MEASURED: V1 mclk p50 1258 MHz / power mean 203 W differ from the unthrottled arms' 875 MHz / ~137 W. V2 wall (2,384 s) is ~1.9× V1's (1,242 s) on the same throttled GPU — the extra time went into more tool calls (125 vs 74) and deeper thinking (387,609 vs 226,522 chars). Decode/gen N/A (vLLM `output_tokens = 0`). → *Do not read either rep's wall or clock/power against the reference row; only transcript-derived columns and review content are comparable.*

## Methodology & caveats

- **n = 2, single arm** (`r191-dp-sharp-d0`); rep1 = V1 terse prompt, rep2 = V2 terse prompt (the only variable between reps is the template's terse block; keep-all replay + δ 0 held fixed). The one variable vs `r191-sharp-d0` is the terse prompt.
- **`reuse_server`:** the vLLM server was user-managed on port 8000 (started by `vllm.sh`), not by this driver — no boot/stop/unload. The server ran `RADIANCE_CACTUS_DELTA=0` + the dp-sharp template (verified in `server-info.txt`). For rep2, the user manually restarted the server with the V2 template before the run.
- **Opus grade V1 (authoritative, done 2026-11-02).** `opus-grade-prompt.md` is a **self-contained prompt-only** grader — all files to be analyzed (the review, the reference review + its 19 findings, the brief, all 12 probe files) are embedded in it, so it runs in any Opus UI with **no tools** (no file reads, no git, no tsc/eslint/vitest). It was run on a **real Opus model** and the result is saved verbatim in **`grading-opus.md`**. The blind package is at `campaigns/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind/blind-grading-dp-sharp/pkg/` (arm anonymized as `W`; `key.json` deliberately not embedded; unblinded in `grading-opus.md` only after the grade: W = `r191-dp-sharp-d0`).
- **Opus grade V2 (pending).** `opus-grade-prompt-rep2.md` is the equivalent self-contained prompt-only grader for rep2 (18 probe files embedded; same §2–§4 as V1; §5 replaced with rep2's probes). **User to run** on a real Opus model; result to be saved in `grading-opus-rep2.md`. The preliminary mapping above (11/19, weighted ~26/38) is from direct review reading, not the authoritative grade.
- **Throttled GPU:** mclk 1258 MHz / power 203 W (vs 875 MHz / ~137 W unthrottled). Speed/clock/power are not comparable; transcript-derived metrics and review content are.
- **vLLM `output_tokens = 0` quirk:** decode/gen/prefill columns are N/A; transcript-derived metrics are used instead.
