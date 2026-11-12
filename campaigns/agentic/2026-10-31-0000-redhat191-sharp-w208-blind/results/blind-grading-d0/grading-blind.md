# Blind grading — brief W2-08 (resolve-confirm screen), reviews W and X

Yardstick: the Opus review `ref/opus-W2-08.md` (19 findings: 6 high · 7 med · 6 low; max weighted 38).
Code and plan docs read at dp-forge `de110510` (`git show de110510:<path>`). The probes I re-ran used
`npx eslint --stdin --stdin-filename tools/scripts/__probe.ts` (or a `tools/*/tests/**` path for test files) from the dp-forge root, which
matches HEAD = de110510 (eslint.config.mjs unchanged), and `npx tsc --noEmit --strict …` on copies in
`scratchpad/blind3/grader/`. dp-forge was not modified.

## Summary

| | W | X |
|---|---|---|
| Opus found (n/19) | **10** — #2 #3 #5 #6 #7(partial) #10 #13 #15 #17 #19 | **11** — #2 #3 #5 #6 #10 #12(partial) #13 #15 #16 #17 #19 |
| high n/6 | 4 (#2 #3 #5 #6) | 4 (#2 #3 #5 #6) |
| med n/7 | 3 (#7 #10 #13) | 3 (#10 #12 #13) |
| low n/6 | 3 (#15 #17 #19) | 4 (#15 #16 #17 #19) |
| Weighted coverage (/38) | **21** | **22** |
| Weighted, partial matches not counted | 19 | 20 |
| Review findings total | 15 | 14 |
| Matched to Opus | 10 | 11 |
| Real review-only | 4 | 3 |
| Wrong | 1 | 0 |
| Unverifiable | 0 | 0 |
| Precision (matched+real)/total | **0.933** (14/15) | **1.000** (14/14) |
| False claims (outside findings) | 3 | 3 |
| Severity disagreements on matched findings | 1 of 10 | 5 of 11 (rates almost everything low, including a lint **error**) |

**Ranking: X ≥ W, low confidence. They are too close to separate with confidence.** X is one point ahead on coverage
and has the cleaner precision. Its import-sort fix is the only one that passes lint. W calibrates severity much
better and its probes reproduce exactly. W also has one wrong finding and talked itself out of Opus #11.

Missed by both: **#1** (edited goals never reach `confirmed.json`, so a C8 re-pause follows), **#4** (calls.jsonl
holds the argv only: `--value @<tmp>`, and the temp file is deleted), **#8** (an empty replace text fails `min(1)`),
**#9** (dropping every goal fails `goals.min(1)`), **#11** (nobody produces `cuts`), **#14** (`record` is unused by the screen), and
**#18** (PATTERN is the loop, not a sibling screen). Both reviews flag the PATTERN block for a different defect (see below).

---

## Review W — mapping to Opus

| W # | W sev | Opus # | Opus sev | Verdict / note |
|---|---|---|---|---|
| F1 | high | **#5** | high | Match. "`../src/…` resolves to tools/dpf/tests/src/ … change to `'../../src/screens/resolve-confirm.js'`" |
| F2 | high | **#3** | high | Match. "a single-entry plan cannot feed two spawns: … irSet + irValidate … plan[1] is undefined → … applyResolve throws → T3 cannot pass". Quotes W2-04 D2 `entry = plan[n]` correctly (W2-04.md:111). It does not say irValidate is EXTRA. In Compared it accepts irValidate as "house pattern". |
| F3 | med | **#7** (partial) | med | "the code block does not compile: an uninitialised const signature; ResolveState is defined only in prose … give ResolveState a code form". The second half is #7's defect: the state machine is prose. The first half (TS1005 on `…): Screen<…>;`) follows the house signature convention. W2-05.md:65 uses the identical form, so on its own it would be a non-defect. Counted as a partial match. |
| F4 | high | **#6** | high | Match on the D2 group order. The diagnosis is incomplete: it misses member order and D4's `node:fs`. **The proposed fix ("move the PausePayload import first, then the two relatives") still fails `simple-import-sort/imports`.** I re-ran it: `1:1 error Run autofix to sort these imports!`, because the members `ResolutionIr, GoalsDoc, GoalEntry, NonGoalEntry` stay unsorted. |
| F5 | high | — | — | Review-only: TESTS import order (see below). |
| F6 | high | **#2** | high | Match. "initial state is the full copy, but keep/replace APPEND … → [G-1, G-2, G-1, G-2']" |
| F7 | med | — | — | Review-only: PATTERN not verbatim (see below). This is not #18: it names the stale/fabricated block, not "loop vs screen". |
| F8 | med | **#13** | med | Match. "Write T1-T4" / "T1-T4 MUST fail" while only T1-T3 exist. |
| F9 | low | **#10** | med | Match, severity lower than Opus. 4 params against max-params 3, hidden by `--quiet`. Probe reproduced: `15:148 warning … too many parameters (4)`. |
| F10 | low | **#17** | low | Match. Package-relative FILES/S1. |
| F11 | low | — | — | Review-only: S8 range misses ResolutionIr:177. |
| F12 | low | **#19** | low | Match. DO NOT line 2 is not the fixed template text. |
| F13 | low | — | — | Review-only: the irValidate prose omits `kind`. |
| F14 | low | **#15** | low | Match. `goalsChanged`/`nonGoalsChanged` are never read. |
| F15 | low | — | — | Review-only: stale verification sha. **Wrong** (see below). |

## Review X — mapping to Opus

| X # | X sev | Opus # | Opus sev | Verdict / note |
|---|---|---|---|---|
| F1 | high | **#5** | high | Match. Its probe P2 `TS2307: Cannot find module '../src/screens/resolve-confirm.js'` is plausible (the probe tree `probe/dpf/tests/screens/` exists). |
| F2 | high | **#3** | high | Match. Same analysis as W, and it also notes no `$.nonGoals` call in the fixture. It does not say irValidate is EXTRA. |
| F3 | high | **#2** | high | Match. "a literal implementation appends to the already-populated lists, so `w` returns `[G-1, G-2, G-1, G-2-new]`" |
| F4 | med | — | — | Review-only: the D4 irSet/irValidate objects omit `cli`. |
| F5 | med | — | — | Review-only: PATTERN not verbatim (same as W F7). Its evidence is partly false (see False claims). |
| F6 | med | **#16** | low | Match, severity higher than Opus. "walk-summary `q` → phase 'main' (abort) without restoring the originals". |
| F7 | low | **#13** | med | Match, severity lower than Opus. |
| F8 | low | **#6** | high | Match. It covers D2, D4 **and** TESTS: member order, group order, `../ui` before `../run`, missing blank lines. Its canonical form is correct: I re-linted the F8 text and got no import-sort error. **Severity is wrong.** It writes "(error; not hidden by `--quiet`)" and still rates it low, while 04-check-method.md:35 makes a lint error `high`. |
| F9 | low | **#17** | low | Match. |
| F10 | low | **#15** | low | Match. |
| F11 | low | — | — | Review-only: S8 range misses ResolutionIr:177 (same as W F11). |
| F12 | low | **#19** | low | Match. |
| F13 | low | **#12** (partial) | med | "The `c` (correction) and `q` (quit) results … are neither unit-tested nor named-dropped". This is #12's second defect: the main keys have no unit test. It does not cover #12's first defect (T1/T2 assert containment only). The proposed fix is partly false (see False claims). |
| F14 | low | **#10** | med | Match, severity lower than Opus. It records the hidden max-params warn, then proposes "none — keep the signature". |

---

## Review-only findings

| Review # | Claim | Verdict | My sev | Evidence |
|---|---|---|---|---|
| W F5 | TESTS imports (relative 102, package 132, relative 133) fail simple-import-sort | **real** | med | Re-ran W's `tests-imports.ts` under a test path: `3:1 error Run autofix to sort these imports!`. eslint.config.mjs:155-162 applies import sort to tests too. Opus #6 names only D2/D4, so this is a separate item. Caveat: W's proposed order (`spec-pipeline/protocol`, then the two relatives with unsorted members) **still fails**. I re-ran it and got the same error. |
| W F7 / X F5 | PATTERN claims "src/ui/screen.ts from W2-01b, verbatim" but shows a let/for `runScreen` | **real** (both) | low | W2-01b.md:135 at de110510 is `runScreen = <S, R>(screen, io, prompt = DEFAULT_PROMPT)` delegating to `step`, with "No `let`/`for`: no-restricted-syntax" (:159). At the brief's base 36ffe5b4, W2-01b.md:112-122 *was* the let/for version, so the block is **stale drift**, not an invention (same class as Opus #19). W's probe reproduced exactly: tsc `TS2345 (11,31)`; eslint 5 warnings (complexity 6, 1 let, 3 for). Low, because a screen does not copy runScreen and the incremental tier only warns. |
| W F11 / X F11 | S8 `resolution.ts:171-176` misses `ResolutionIr` at :177 and names `ResolutionDoc` | **real** (both) | low | resolution.ts:176 `ResolutionDoc`, :177 `export type ResolutionIr = …`. D2 imports ResolutionIr. |
| W F13 | D4 "then irValidate of record.inputs.goals" omits `kind` | **real** | trivial | W2-05.md:44 `irValidate = (o: { cli; kind; file })`. Low value, since Opus #3 says the irValidate call should go altogether. |
| X F4 | The D4 irSet/irValidate objects omit `cli` | **real** | low | W2-05.md:43 requires `cli`. The brief's D4 prose shows `{ kind, file, path, value }`, and ir.ts is not a SITE. tsc would catch it, so the cost is one fix round. The house prose (W2-05 D4, C11) uses the same shorthand. |
| W F15 | "stale verification sha … re-verify S2-S8 at HEAD, write de110510" | **wrong** | — | 01-writer-brief.md:10: a brief whose FILES are unchanged since its base is used as is. The SITES are byte-identical: `git diff --stat 36ffe5b4 de110510 -- tools/shared tools/spec-pipeline` is empty. W itself notes "docs-only commits since". "verified at 36ffe5b4" is still true, so nothing is stale. |

## False claims (statements outside the findings, or false evidence inside them)

**W (3)**
1. Compared, M2 line: "cuts arrive pre-filtered as strings (**the runId/stage filtering belongs to W2-13**) … OK, no GAP." That ownership is wrong. Wave-2-dpf-cli.md:58 gives W2-08 "the cut lines from `residue` rows", and C11 item 6 (02-contracts.md:239) puts the runId/stage/anchor filter in the W2-08 screen content. W2-13's row (:65) never mentions cuts. W had derived the right answer in M2/M4 and argued itself out of Opus #11.
2. Derived M8 (4): "the W2-04 fake + calls.jsonl, asserting one `ir set` argv **and the value**". The fake records argv only (W2-04.md:120), and irSet passes `--value @<tmp>` and deletes the file (W2-05.md:46-48). This is the inverse of Opus #4.
3. Derived M2: "`readIr('resolution', …)` → `ResolutionIr`, tools/shared/ir/**registry.ts:46**". The `resolution:` entry is at registry.ts:49 (trivial).

**X (3)**
1. F5 / probe P3: "`Cannot find name 'Screen'`" given as evidence that the PATTERN block does not compile. The block defines `Screen` (brief line 28). X's probe `probe/pattern.ts` holds only lines 29-39, yet its header calls it the block "verbatim". I re-ran it: TS2304 for Screen and LineIO. Because of that, the probe also missed the block's real tsc error (TS2345 on `io.ask(prompt)`, which W found).
2. F13 proposed change: "The accept, correction **and quit** cases … are proven by W2-13a's flow test". W2-13a's scenarios (wave-2-dpf-cli.md:64) cover resolve-confirm `a` (1) and `c` (2), and no resolve-confirm `q`.
3. F12: "01-writer-brief.md template **lines 51-52**". The fixed DO NOT text is at 01-writer-brief.md:138-139 (trivial).

Not counted, but noted: X's P1 says "eslint: none with the canonical imports". The saved P1 file (`probe/dpf/src/screens/resolve-confirm.ts`) still has non-canonical imports (`GoalsDoc` before `GoalEntry`, `../ui` before `../run`). When I re-lint it I get `simple-import-sort/imports` plus a max-statements error from its scaffolding line. The "final" corrected files (`fixed-imports.ts`, `fixed-test.ts`) are empty. The claim is unverifiable from the saved artifacts, though X's F8 *text* is correct.

---

## Qualitative judgement

**W.** It verifies with care: a probe per code block, exact and reproducible outputs (pattern: TS2345 + 5 warnings; max-params; import sort), and correct file:line citations almost everywhere (W2-01b:114/135, eslint.config.mjs:23/46/160, 02-contracts.md:157/181). Its severities follow the method: import sort high, state duplication high. Its fixes are weaker. Both import-order fixes still fail lint because W diagnosed only the group order, not the member order. F15 is a non-defect. The big miss is #11: W derived the residue-row cut filter correctly in M4 and then waved it off with an ownership claim the plan does not support. Like X, it does not reach the semantic contract defects (#1, #4, #8, #9).

**X.** It covers one more Opus item (#16, and #12 in part) and every finding it makes is real. Its import-sort analysis is the most complete of the two, and the canonical form passes lint. Its derived section is well sourced (W2-04/W2-05 line quotes, manifest.ts:19). Its severities are poorly calibrated: five of eleven matched findings disagree with Opus, and a lint *error* it calls "not hidden by --quiet" is rated low. Its probe hygiene is weaker: the pattern probe was truncated and produced a false "Cannot find name 'Screen'", P1's "eslint: none" is not reproducible from the saved file, and the "final" files are empty. The F13 fix leans on a W2-13a scenario that does not exist for `q`.

**Ranking: X, then W. Confidence: low.** The coverage gap is 1 point (22 vs 21) and rests on two partial matches. Drop both and it is still 20 vs 19. Count W F3→#7 but drop X F13→#12 and **W leads 21-20**. X's precision edge (1.000 vs 0.933) comes from one trivial wrong finding (W F15). These would change the order:
- if severity calibration is weighted (W clearly better), or the PATTERN probe accuracy (W reproduced, X fabricated an error);
- or if X F13→#12 is rejected because its fix contradicts the plan.

Either one tips it to W. I flag the pair as **too close to separate**.
