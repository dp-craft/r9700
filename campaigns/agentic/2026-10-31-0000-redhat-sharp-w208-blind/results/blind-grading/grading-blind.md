# Blind grading: W2-08 code-plan reviews W / X / Y / Z

Yardstick: `ref/opus-W2-08.md`, 19 findings (6 high, 7 med, 6 low). Code and plan docs read at dp-forge `de110510`. `git diff --stat 36ffe5b4 de110510 -- tools/ eslint.config.mjs` is empty, and `tools/dpf` exists at neither commit, so every SITE and line number is the same at both. The brief is `ref/W2-08.brief.md` (it is not committed at de110510).

## Summary

| | W | X | Y | Z |
|---|---|---|---|---|
| Opus found (n/19) | 9 | 11 | 4 | **12** |
| high (n/6) | **4** | **4** | 3 | 3 |
| med (n/7) | 3 | 3 | 1 | **5** |
| low (n/6) | 2 | **4** | 0 | **4** |
| **Weighted coverage (max 38)** | 20 | 22 | 11 | **23** |
| Review findings total | 14 | 14 | 6 | 16 (15 table rows + 1 NEEDS block) |
| Matched to Opus | 11 | 11 | 4 | 13 |
| Real, review-only | 2 | 3 | 2 | 3 |
| Wrong | 1 | 0 | 0 | 0 |
| Unverifiable | 0 | 0 | 0 | 0 |
| **Precision** (matched+real)/total | 0.929 | 1.000 | 1.000 | 1.000 |
| False claims (all / substantive) | 1 / 0 | 2 / 1 | 2 / 2 | 3 / 2 |
| Precision with false claims added to the denominator | 0.867 | 0.875 | 0.750 | 0.842 |

**Ranking: Z ≥ X > W >> Y.** Confidence is low for the order of Z, X and W, and high that Y is last. Z and X are too close to separate. X and W are close.

Opus findings that no review found: **#1** (an edit never writes confirmed.json, so the step re-pauses, high), **#4** (T3 asserts a value that calls.jsonl never holds, high), **#7** (the state machine is given as prose, med) and **#18** (the PATTERN shows the wrong sibling, low; see the note on the PATTERN findings).

### Grader probes (re-run, read-only, `eslint --stdin --stdin-filename tools/scripts/__probe_*.ts` from the dp-forge root)

| Probe | Result |
|---|---|
| D2 import lines as written (brief:49-51) | `1:1 error Run autofix to sort these imports! simple-import-sort/imports` |
| D2 with the external import moved first and a blank line, specifiers still unsorted (Y's fix) | still `1:1 error … simple-import-sort/imports` |
| D4 pair as written (brief:89-90) | error. With a blank line between the groups: clean (W's nuance is correct) |
| X's canonical import block (F8) | clean |
| the test's three imports as placed (brief:102, 132-133) | 2 × `simple-import-sort/imports` errors |
| `applyResolve` with 4 params | `warning Arrow function has too many parameters (4). Maximum allowed is 3 max-params` |

## Opus coverage matrix

| Opus # | sev | item | W | X | Y | Z |
|---|---|---|---|---|---|---|
| 1 | high | D3/D4: an edit never writes confirmed.json | – | – | – | – |
| 2 | high | D2/D3: the walk duplicates goals | W2 | F3 | Y4 (med) | Z4 |
| 3 | high | D4/TESTS: the second spawn (irValidate) crashes the fake | W3 | F2 | – | Z3 |
| 4 | high | TESTS: calls.jsonl cannot show G-2's source | – | – | – | – |
| 5 | high | TESTS: `../src` import path | W1 | F1 | Y1 | Z1 |
| 6 | high | D2/D4: imports fail simple-import-sort | W4, W5, W6 (med) | F8 (low) | Y2 (med) | – (Z called it a probe artifact) |
| 7 | med | D2/D3: a prose state machine | – | – | – (Y argued the opposite) | – |
| 8 | med | D3: `r` + empty line writes `''` | W10 | – | – | – |
| 9 | med | D3: dropping every goal → `.min(1)` | – (W dismissed it) | – | – | Z10 |
| 10 | med | D4: 4 params, warn hidden by `--quiet` | W11 (low) | F14 (low, fix "none") | – | Z5 |
| 11 | med | Input: residue rows → cuts have no owner | – | – | – | Z NEEDS block |
| 12 | med | TESTS: weak T1/T2; a/c/q untested | – | F13 (low) | – | Z6, Z8, Z13 |
| 13 | med | STEPS: T1-T4 vs T1-T3 | W8 | F7 (low) | Y6 (low) | Z2 (high) |
| 14 | low | D2: `record` unused by the screen | – | – | – | Z12 |
| 15 | low | D2/D3: dead `*Changed` flags | W12 | F10 | – | Z12 |
| 16 | low | D3: summary `q` leaves the partial walk | – | F6 (med) | – | – |
| 17 | low | FILES/S1: package-relative paths | W13 | F9 | – | Z9 (med) |
| 18 | low | PATTERN: runScreen is the loop, not a screen | – (adjacent: W7) | – (adjacent: F5) | – (adjacent: Y5) | – (adjacent: Z7) |
| 19 | low | DO NOT line 2: old text | – | F12 | – | Z14 |

**Note on #18.** All four reviews flag the PATTERN block, but for a different defect: it is not verbatim W2-01b (W2-01b.md:127-138 is a non-async `runScreen` built on `step`/`writeAll`, with no `let`/`for`). Opus's defect is that the block is the I/O loop, not a screen to copy (it names clarifyScreen). Under the rule "same section, different defect = no match", these are graded as real review-only findings (low) for all four. Crediting them as #18 would add 1 point to every review and change no rank.

---

## W: per-finding mapping

| W # | W sev | Maps to | Opus sev | Evidence / note |
|---|---|---|---|---|
| 1 | high | #5 | high | probe b4 `TS2307 Cannot find module '../src/screens/resolve-confirm.js'`. Correct; matches the 04-check-method.md:48 rule |
| 2 | high | #2 | high | quotes brief:74-75 + :81 vs T3 :141. Adds a real nuance: brief:78 `index < goals.length` is ambiguous between state and input |
| 3 | high | #3 | high | brief:135 single entry; W2-04.md:111 `entry = plan[n]`. Correct (cites `process.exit` at "L128"; the real line is 125) |
| 4 | med | #6 | high | D2 imports. Probe matches mine (1:1 import-sort error). Severity under-rated: it is an error, and `--quiet` does not hide it |
| 5 | med | #6 | high | D4 pair: "group order CORRECT; blank line missing". Verified exactly (my d4 vs d4b probes) |
| 6 | med | #6 | high | test imports: 2 errors. Verified |
| 7 | med | review-only | – | PATTERN not verbatim: **real, low** (see #18 note). TS2345 on `io.ask(prompt)` with `prompt?: string` is right against W2-01b's `ask(prompt: string)` |
| 8 | med | #13 | med | brief:151/153 vs :146/:181 |
| 9 | med | review-only | – | fixture `nonGoals: []` → the non-goal walk branch and the `$.nonGoals` write are never exercised: **real, med** (04-check-method.md:26 "Which wrong implementation still passes?"; an implementation that misroutes non-goals passes T3) |
| 10 | med | #8 | med | resolution.ts:15 `text: z.string().min(1)`; sibling W2-05.md:71-72 re-asks on blank. Correct |
| 11 | low | #10 | med | probe `max-params` warning. The fix (pass `input`) makes `record` used: the opposite direction to #14, but valid |
| 12 | low | #15 | low | brief:73-75, 85, 95-96 |
| 13 | low | #17 | low | sibling W2-04/05 FILES are repo-relative |
| 14 | low | **wrong** | – | "base 36ffe5b4 is a docs-only commit — tools/dpf does not exist there … → base de110510". `git diff --stat 36ffe5b4 de110510 -- tools/` is empty, and tools/dpf is absent at de110510 too, so the change fixes nothing. S1 (brief:17) already names W2-01b/W2-05 as the creators of screen.ts and ir.ts, and RUNBOOK step C rewrites the SITES sha at fix time anyway |

W dismissed #9 explicitly ("D4:97-98 states the result … Not a finding"), and #11 ("the flow extracts entry.text") without raising a gap.

## X: per-finding mapping

| X # | X sev | Maps to | Opus sev | Evidence / note |
|---|---|---|---|---|
| F1 | high | #5 | high | probe P2 TS2307; quotes W2-05.md:109-110 |
| F2 | high | #3 | high | W2-04 D2 steps 1/6; W2-05:127 "(one plan, three calls…)". Correct |
| F3 | high | #2 | high | D2:74 + D3:81 vs T3:141. Fix: reset on `g` |
| F4 | med | review-only | – | irSet/irValidate objects omit `cli`: **real, low**. W2-05.md:43-44 require `cli`; mitigated because C11 (02-contracts.md:231) and W2-05 D4 (:90-92) use the same shorthand, `cli` is applyResolve's own param, and STEP 5 tsc catches it |
| F5 | med | review-only | – | PATTERN not verbatim: **real, low**. Evidence partly an artifact: its probe `probe/pattern.ts` holds only brief lines 29-39, so "Cannot find name 'Screen'" is false (Screen is defined at brief:28); `LineIO` missing is true |
| F6 | med | #16 | low | summary `q` → main without restoring the originals |
| F7 | low | #13 | med | |
| F8 | low | #6 | high | all three import blocks. Canonical order verified clean by me. **Severity mis-rated**: X itself writes "(error; not hidden by `--quiet`)" yet grades it low |
| F9 | low | #17 | low | |
| F10 | low | #15 | low | |
| F11 | low | review-only | – | S8 range 171-176 misses `ResolutionIr` at resolution.ts:177: **real, trivial** (a writer reading 80 lines from the anchor sees it anyway) |
| F12 | low | #19 | low | quotes the template DO NOT line (01-writer-brief.md:138-139; X cites "lines 51-52", a citation slip) |
| F13 | low | #12 (partial) | med | `c`/`q` neither unit-tested nor named as FLOW. Covers the main-keys half of #12, not the weak T1/T2 assertions |
| F14 | low | #10 | med | the problem text is identical to Opus #10, but the **proposed change is "none — keep the signature"**, which contradicts M9 "compiles and lints with no output" (04-check-method.md:27) and the "≤ 3 params" limit (:51). Credited as a weak match |

X missed #8 and #9, both concrete runtime failure paths.

## Y: per-finding mapping

| Y # | Y sev | Maps to | Opus sev | Evidence / note |
|---|---|---|---|---|
| 1 | high | #5 | high | quotes W2-01b.md:163-164. Correct |
| 2 | med | #6 | high | names the group-order error only. **The fix is incomplete**: with the external import first, the unsorted specifiers still error (my probe), and the missing blank line is not mentioned. Correct citations (eslint.config.mjs:23, :160) |
| 3 | med | review-only | – | `cli` missing: **real, low** (same as X F4) |
| 4 | med | #2 | high | correct analysis; severity under-rated (T3 cannot pass) |
| 5 | low | review-only | – | PATTERN not verbatim: **real, low**. Citations W2-01b.md:112-113 and :135-138 exact |
| 6 | low | #13 | med | |

Y missed #3 (a high: T3 cannot pass because of the second spawn) and every med/low design finding except #13.

## Z: per-finding mapping

| Z # | Z sev | Maps to | Opus sev | Evidence / note |
|---|---|---|---|---|
| 1 | high | #5 | high | `path.resolve` probe |
| 2 | high | #13 | med | fix: restore the accept case as T4 (an alternative that also satisfies #12) |
| 3 | high | #3 | high | fake-replica probe: call 2 `TypeError … (reading 'exit')`. The real fake dies one step earlier (`entry.ledger`), with the same outcome |
| 4 | high | #2 | high | also notes that abort + re-entering `g` doubles again (not credited as #16: the finding is about doubling, not the abort state) |
| 5 | med | #10 | med | probe `max-params` warning; quotes W2-01b's "four parameters break max-params 3". Fix: an object param |
| 6 | med | #12 | med | T1's drift half is vacuous (the fixture is already unclear-first). Opus's corrected fixture reorders the drift for exactly this reason; same defect class at T1 ("a wrong implementation passes") |
| 7 | med | review-only | – | PATTERN not verbatim: **real, low**. Z adds a true semantic point: the pasted loop returns `turn.result` (brief:36) before writing that turn's `out` (:37), which contradicts C7 "the result turn's too" (02-contracts.md:171) and W2-01b.md:126,131-132 |
| 8 | med | #12 | med | `a` → accept has no unit test. **Contains a false claim**: "the wave file names no such scenario". wave-2-dpf-cli.md:64 names W2-13a scenario (1) "… → resolve-confirm `a` → boundary" |
| 9 | med | #17 | low | adds the STEP 2/5 vs FILES inconsistency |
| 10 | med | #9 | med | resolution.ts:23 `.min(1)` quoted exactly |
| 11 | low | review-only | – | S8 range misses resolution.ts:177: **real, trivial** |
| 12 | low | #15 + #14 | low/low | names both defects explicitly: the dead flags, and "`input.record` (L57) is unused by the screen" |
| 13 | low | #12 | med | the diffLines render is untested (Opus #12: "a dropped diffLines line passes") |
| 14 | low | #19 | low | template text quoted via W2-04.md:165-166 (exact) |
| 15 | low | review-only | – | STEPS 3 drops the fixed text's "one Write per new file" (01-writer-brief.md:130): **real, trivial** (sibling W2-05:144 has the same drift) |
| NEEDS block | – | #11 (partial) | med | "W2-13 owns … the residue filter (runId, stage 'spec-a-resolve', anchor $.sections.request-docs, entry.text), the ResolveConfirmInput construction … (NEEDS)". This is the same ownership gap Opus raises; the fix lands in W2-13 rather than in a `resolveCuts` here. Counted as one finding |

Z missed #6 (a high) and told the reader the opposite (see false claims). It also missed #8 and #16.

---

## Review-only findings (not among the 19)

| Finding | Reviews | Verdict | Grader sev | Evidence |
|---|---|---|---|---|
| PATTERN is not W2-01b verbatim (async loop, `let`/`for`, result returned before its `out` is written, `LineIO` undefined) | W7, X F5, Y5, Z7 | real | low | W2-01b.md:126-138 vs brief:29-39. The writer never writes runScreen (DO NOT brief:164), so the impact is a misleading reference |
| Non-goal walk branch and the `$.nonGoals` write never exercised by T3 | W9 | real | med | brief:121 `nonGoals: []`; T3 brief:140-143; 04-check-method.md:26 |
| irSet/irValidate objects omit `cli` | X F4, Y3 | real | low | W2-05.md:43-44; the same shorthand appears in C11 and W2-05 D4; tsc catches it at STEP 5 |
| S8 range stops at :176; `ResolutionIr` is at :177 | X F11, Z11 | real | trivial | resolution.ts:177 |
| STEPS 3 drops "one Write per new file" | Z15 | real | trivial | 01-writer-brief.md:130 vs brief:154 |
| base sha should be de110510 | W14 | **wrong** | – | the tools tree is identical at both commits; tools/dpf is absent at both; S1 already declares the predecessors |

## False claims (factual statements that are wrong; minor citation slips counted but marked)

| Review | Claim | Why it is wrong | Kind |
|---|---|---|---|
| W | "W2-04 brief:122 'the test sits two levels below'", "L128 (`process.exit(entry.exit)`)" | the real lines are W2-04.md:129-130 and :125 | minor (citation) |
| X | P3: the PATTERN fails tsc with "Cannot find name 'Screen'" | the probe holds only brief:29-39; `Screen` is defined at brief:28. Only `LineIO` is really missing | substantive (an evidence artifact) |
| X | the template DO NOT line is at "01-writer-brief.md template lines 51-52" | it is at 01-writer-brief.md:138-139 | minor (citation) |
| Y | "The only code shown is the PATTERN TO COPY runScreen"; "D2/D3/D4 are prose (not code)" | D2 and D4 contain import lines, an interface, a union type and signatures; TESTS contains a full fixture. Y never probed them | substantive |
| Y | "no post-<Id> site, so M1 does not apply" | D2/D4 import W2-01b's screen.ts and W2-05's ir.ts, which are not done (S1, brief:17; W2-05 is in the row's Depends cell) | substantive |
| Z | finding 8: "the wave file names no such scenario" | wave-2-dpf-cli.md:64: "(1) specify: clarify … → resolve-confirm `a` → boundary" | substantive |
| Z | probe D2: "eslint: none (the only errors are probe artifacts: import sort …)" | Z's probe-types.ts does not contain the brief's import lines. The real D2 lines fail simple-import-sort (grader probe), so Z reports a high defect as absent | substantive |
| Z | "goals: min(1) (resolution.ts:44)", "ResolutionIr … (resolution.ts:164)" | the real lines are :23 and :151/:177 | minor (citation) |

X F14's "no change needed" and W's dismissal of #9 are judgement errors, not counted as false claims; they are discussed below.

---

## Judgement

**Z (rank 1, narrowly).** It has the broadest blind derivation (M2-M8 from the row and contracts) and the highest weighted coverage (23). It is the only review to reach #9, #11 (through its NEEDS block) and #14, and it hits #12 from three angles: the vacuous drift fixture, the untested `a`, and the untested diffLines. Its probes were real and targeted: a fake replica that reproduces the second-spawn crash, a max-params probe, and a PATTERN lint. Severity on the highs is well calibrated. Against it: it missed #6 and stated the opposite (that D2 lints clean, from a probe that did not contain the brief's imports), and it backed finding 8 with a false statement about the wave file. A fixer acting on Z would ship a brief that still fails STEP 5's eslint.

**X (rank 2, too close to Z).** It is the cleanest review: no wrong findings, and its imports were verified with `eslint --fix` (I re-ran the canonical block: clean). It is the only one besides Z to catch #19, and the only one to catch #16. Its findings are precise and its fixes actionable. Against it: severity calibration is the weakest of the top three. The import-sort *error* is rated low, #13 is low, and F14 records the max-params warning and then recommends "no change", against M9. One probe artifact ("Cannot find name 'Screen'") is presented as evidence. It missed the runtime failure paths #8 and #9.

**W (rank 3).** It has the most careful verification of the high-impact lint and compile issues. It probed all four code blocks, split #6 correctly per block (including the subtle "D4 group order is right, only the blank line is missing"), and caught #8 and a real coverage gap in T3 (non-goals never walked). It ties X for highs (4/6). Against it: one wrong finding (the base-sha change accomplishes nothing), #6 under-rated as med, #9 dismissed explicitly, and it misses #12, #16 and #19.

**Y (rank 4, clearly last).** Y is short and accurate, with 6 of 6 findings correct and exact citations, but the depth is not there. It declared the brief's code blocks to be "prose" and probed nothing but the PATTERN, so it missed #3 (T3 cannot pass) and every design-level finding. Its import-sort fix is incomplete (the specifier order still errors), and it under-rates #2 as med.

**Ranking: Z, X, W, Y.** Confidence: low among Z/X/W, high for Y last.
- **Too close to separate: Z vs X** (23 vs 22 weighted; X has higher precision with false claims included, 0.875 vs 0.842, and no high miss outside #1/#4). **X vs W** are also close (22 vs 20; W ties X on highs and has better severity calibration, but one wrong finding).
- What would change it:
  - Not crediting Z's NEEDS block for #11 (it sits outside the findings table) gives Z 21, and X moves to first.
  - Not crediting X F14 (it recommends no change) gives X 20, tying W; Z then leads clearly.
  - Weighting false claims or high-severity misses more heavily favours X and W over Z (Z missed #6 and denied it).
  - Crediting the PATTERN findings as #18 moves nothing.
