# Blind grading — W2-08 (resolve-confirm screen), reviews W / X / Y vs the Opus reference

Graded against the brief `pkg/ref/W2-08.brief.md`, the 19 Opus findings (`pkg/ref/findings-W2-08.tsv`) and dp-forge at `de110510`. `git diff --stat 36ffe5b4 de110510 -- tools/` is empty, so every SITE is the same at both commits. Grader probes (eslint via `--stdin`, nothing written to dp-forge) are in `scratchpad/blind3w/grader-probes/`.

## Summary

| | W | X | Y |
|---|---|---|---|
| Opus found (n/19) | 7 | **11** | 10 |
| high (n/6) | 3 | **4** | **4** |
| med (n/7) | 3 | 3 | 3 |
| low (n/6) | 1 | **4** | 3 |
| Weighted coverage (max 38) | 16 | **22** | 21 |
| Review findings total | 8 | 14 | 15 |
| Matched | 7 | 11 | 10 |
| Real review-only | 1 | 3 | 4 |
| Wrong | 0 | 0 | 1 |
| Unverifiable | 0 | 0 | 0 |
| Precision | 1.00 | 1.00 | 0.93 |
| False claims (non-finding) | 1 | 1 | 1 |
| Severity agrees with Opus (on matches) | 4/7 | 6/11 | **9/10** |

**Ranking: X ≥ Y > W.** X vs Y is too close to call (confidence low). Y > W and X > W are clear (confidence moderate-high).

**Missed by all three:** #1 (an edit never writes `confirmed.json`, so the C8 re-pause loop follows), #4 (`calls.jsonl` records argv only, so T3 cannot assert G-2's source), #8 (`r` then Enter gives empty text, which the schema refuses), #9 (dropping every goal breaks `.min(1)`), #11 (nothing turns residue rows into `cuts`), #14 (`record` is never read by the screen), #18 (runScreen is the loop, not a screen). On #11, W and Y both derived the C11 residue-row source and then waved it through. Y wrote "OK, no GAP".

### Matching conventions used (applied the same way to all three)
- **PATTERN "false verbatim" findings** (W #2, X F5, Y F7) are **not** matched to Opus #18. Opus's defect is that the wrong exemplar was chosen (a loop instead of a screen; the sibling should be clarifyScreen). The reviews' defect is that the block is not W2-01b's code. Same section, different defect, so each is scored as real review-only.
- **Partial matches accepted:** W #7 and Y F3 → #7 (the state exists only in prose, with no code form). X F13 → #12 (`c`/`q` have no unit test). X F14 → #10 (the defect is right, but X proposes no change).
- **TESTS import order** (Y F5) is scored review-only. Opus #6's item is D2/D4. X F8 names D2, D4 *and* TESTS in one finding, so it maps to #6.

---

## W — per-finding mapping

| W # | W sev | Maps to | Opus sev | Verdict / evidence |
|---|---|---|---|---|
| 1 | high | #5 | high | match. The test import `'../src/…'` from `tests/screens/`. W probe 2: `Cannot find module '../src/screens/resolve-confirm.js'`. |
| 2 | med | — | — | **real review-only (my sev: low).** The PATTERN block is not W2-01b's code. At de110510, W2-01b.md:135-137 is `runScreen = <S, R>(screen, io, prompt = DEFAULT_PROMPT)` → `step(...)`, with "No `let`/`for`" (:159). `LineIO.ask(prompt: string)` (:114) makes `io.ask(prompt?)` a TS2345 error. 01-writer-brief rule 5 requires "a contiguous `sed -n` slice … unedited". |
| 3 | high | #2 | high | match. The initial `goals = input.goals.goals` plus "append" duplicates entries. Quotes brief:74-75, 81, T3:141. |
| 4 | low | #15 | low | match. The changed flags are never read. |
| 5 | low | #10 | med | match, sev lower. The 4-param max-params warning. Unlike Opus, W does not say that `--quiet` hides it. |
| 6 | high | #3 | high | match. A single plan entry vs. irSet + irValidate spawns. `plan[1]` is undefined (W2-04.md:110-111). W does not note that irValidate is redundant. |
| 7 | low | #7 (partial) | med | match, sev lower. "`ResolveState` is referenced … never defined as a type". The fix gives the state a code form. It covers the state type, not the prose transitions. |
| 8 | low | #13 | med | match, sev lower. STEPS says T1-T4, but only T1-T3 exist. |

**False claim (1):** the Probes section says the D1+D2+D4 probe's eslint `import-sort … = probe artifacts`. That is wrong. W's probe copies the brief's import lines in the brief's order (`probe/a/src/screens/resolve-confirm.ts:2-6`). The D2 block alone fails `simple-import-sort/imports` (grader probe `d2-imports.ts`: `1:1 error Run autofix to sort these imports!`), and so does the D4 block alone (`d4-imports.ts`, same error: no blank line between the node: and relative groups). Writing off the error cost W the high finding Opus #6.

Not counted: "No GAP. No EXTRA." and "covered (fields match C11)" for `ResolveConfirmInput`. These are coverage judgements, but they are the reason #11 and the irValidate EXTRA in #3 were missed.

---

## X — per-finding mapping

| X # | X sev | Maps to | Opus sev | Verdict / evidence |
|---|---|---|---|---|
| F1 | high | #5 | high | match. Cites W2-05's "two levels below tools/dpf" rule. Probe P2 gives TS2307. |
| F2 | high | #3 | high | match. Single plan entry → `plan[1]` undefined → crash. It adds that "and a counter" contradicts W2-04.md:134 / W2-05.md:112 "no counter file". Verified. |
| F3 | high | #2 | high | match. Gives `[G-1, G-2, G-1, G-2-new]` vs the T3 expectation. |
| F4 | med | — | — | **real review-only (my sev: low).** D4's prose irSet/irValidate objects omit `cli`, but W2-05.md:43-44 requires `cli` (and `kind` for irValidate). A literal copy is a tsc error that the writer would fix at STEP 5. |
| F5 | med | — | — | **real review-only (my sev: low).** Same defect as W #2. The W2-01b D9 quote is accurate. |
| F6 | med | #16 | low | match, sev higher. Walk-summary `q` leaves the walked lists on the main screen. |
| F7 | low | #13 | med | match, sev lower. |
| F8 | low | #6 | high | match, **sev two steps lower**. X itself says "(error; not hidden by `--quiet`)" and still rates it low. It covers D2, D4 and TESTS, and the canonical order it gives is right (X's own `src-imp.ts`). |
| F9 | low | #17 | low | match. |
| F10 | low | #15 | low | match. |
| F11 | low | — | — | **real review-only (my sev: trivial).** S8 says `171-176`, but `ResolutionIr` is at resolution.ts:177. |
| F12 | low | #19 | low | match. Quotes the 01-writer-brief.md:138-139 template line exactly. |
| F13 | low | #12 (partial) | med | match, sev lower. "`c` and `q` … neither unit-tested nor named-dropped". The fix points the other way from Opus (mark them FLOW-dropped), and it would claim that W2-13a covers quit, which none of W2-13a's five scenarios does. |
| F14 | low | #10 | med | match on the defect (4 params, hidden by `--quiet`). X proposes "none — keep the signature". Opus wants it changed. |

**False claim (1):** probe P3 reports `Cannot find name 'Screen'`, and F5 says the PATTERN block "does not compile standalone". X's probe file (`probe/pattern.ts`) holds only brief lines 29-39. It drops the `Turn`/`Screen` interfaces that the block defines at lines 27-28, so the `Screen` error is a probe truncation, not a property of the brief. The probe also missed the real TS2345 on `io.ask(prompt)`, which W and Y both found.

Not counted: X's derived "D1 grep verified" and "git diff … empty" are both correct. Its P1 probe as stored still has unsorted imports (`GoalsDoc` before `GoalEntry`, `../ui` before `../run`; grader probe `xp1.ts` → `simple-import-sort` error), although P1 reports "eslint: none with the canonical imports". The separately stored `src-imp.ts` has the canonical order, so I count this as stale probe bookkeeping, not a false claim. Minor slip: the fake fails at `entry.ledger` (step 3), before `process.exit(entry.exit)`.

---

## Y — per-finding mapping

| Y # | Y sev | Maps to | Opus sev | Verdict / evidence |
|---|---|---|---|---|
| F1 | high | #5 | high | match. |
| F2 | high | #3 | high | match. "TypeError in the child" is accurate (W2-04 step 3 reads `entry.ledger`). It also catches the counter contradiction. In its derivation (M4) Y noticed that `ir set` already validates the whole document (W2-05.md:31), which is Opus #3's second half, but then accepted irValidate as the W2-05 house pattern. That pattern does exist (W2-05.md:88-92 does irSet then irValidate). |
| F3 | med | #7 (partial) | med | match. "ResolveState is defined only in prose … give ResolveState a code form". The "uninitialised const signature" half is the house's normal signature notation, so it is a nitpick. |
| F4 | high | #6 | high | match. eslint.config.mjs:23 (groups) and :160 (error) are cited correctly. |
| F5 | high | — | — | **real review-only (my sev: med).** The TESTS imports (102, 132-133) fail `simple-import-sort`. Grader probe `t-imports.ts` under `tools/dpf/tests/screens/…test.ts`: `1:1 error Run autofix to sort these imports!`. The test block keeps import order (eslint.config.mjs:211, quoted correctly). |
| F6 | high | #2 | high | match. |
| F7 | med | — | — | **real review-only (my sev: low).** The PATTERN is not verbatim. W2-01b:114/:135/118-137 are all cited correctly, and its probe found the TS2345 error. |
| F8 | med | #13 | med | match. |
| F9 | low | #10 | med | match, sev lower. eslint.config.mjs:46 is correct. |
| F10 | low | #17 | low | match. It also lists the D1-D4 site lines. |
| F11 | low | — | — | **real review-only (my sev: trivial).** The S8 range misses :177. Y adds that the S8 description names `ResolutionDoc`, not `ResolutionIr` (true). |
| F12 | low | #19 | low | match. |
| F13 | low | — | — | **real review-only (my sev: low).** "irValidate of record.inputs.goals" omits `kind` (W2-05.md:44). This is a subset of X F4. |
| F14 | low | #15 | low | match. |
| F15 | low | — | — | **wrong.** "stale verification sha — re-verify at HEAD, write de110510". 01-writer-brief.md:10 says: "`git diff --stat <its base>..HEAD -- <its FILES>` prints nothing → use it as is". The tools/ tree is identical between 36ffe5b4 and de110510, and Y itself says the anchors re-verified. So pinning to the stated base is correct, and nothing needs fixing. |

**False claim (1):** in Compared, Y says "cuts arrive pre-filtered as strings (the runId/stage filtering belongs to W2-13)". Nothing supports this. The W2-08 row (wave-2-dpf-cli.md:58) gives W2-08 "the cut lines from `residue` rows". The W2-13 row (same file) does not mention cuts, and Y itself notes that W2-13 has no brief. This is the reasoning that dismissed Opus #11.

Not counted (minor slip): "registry.ts:46" for the resolution kind. It is at :49 (goals at :50 is right).

---

## Review-only findings (all three)

| Review | # | Verdict | My sev | Evidence |
|---|---|---|---|---|
| W | 2 | real | low | W2-01b.md:114, 135-137, 159; 01-writer-brief rule 5 ("unedited" sibling slice) |
| X | F4 | real | low | W2-05.md:43-44 signatures need `cli` (+`kind`); brief:93-96 omits them |
| X | F5 | real | low | as W #2 |
| X | F11 | real | trivial | resolution.ts:177 `export type ResolutionIr` outside the S8 range 171-176 |
| Y | F5 | real | med | grader eslint probe: TESTS import lines → `simple-import-sort/imports` error |
| Y | F7 | real | low | as W #2 |
| Y | F11 | real | trivial | as X F11 |
| Y | F13 | real | low | W2-05.md:44 `irValidate(o: { cli, kind, file })` |
| Y | F15 | **wrong** | — | 01-writer-brief.md:10 "use it as is"; `git diff --stat 36ffe5b4 de110510 -- tools/` empty |

## False claims

| Review | Claim | Why it is wrong |
|---|---|---|
| W | eslint `import-sort … = probe artifacts` | The brief's own D2 and D4 import blocks each fail simple-import-sort on their own (grader probes). This hid Opus #6. |
| X | P3 `Cannot find name 'Screen'`, so the block "does not compile standalone" | X's probe dropped brief lines 27-28, which define `Turn`/`Screen`. The real error (TS2345 on `io.ask`) was missed. |
| Y | "the runId/stage filtering belongs to W2-13" | The W2-08 row owns "the cut lines from residue rows". The W2-13 row does not mention cuts. This dismissed Opus #11. |

---

## Judgements

**W.** The shortest review. Its 8 findings are all correct and its fixes are concrete (`'../../src/…'`, two plan entries, empty initial lists). It caught 3 of the 6 Opus highs (#2, #3, #5). It ran real probes: tsc on the assembled D1+D2+D4, and tsc+eslint on the PATTERN block, where it found TS2345. But it wrote off the import-sort error as a probe artifact, which lost Opus #6, and it put `"No GAP. No EXTRA."` over a cuts derivation that should have produced #11. It rates three med-level problems low. It has no findings on paths, the template line or the walk abort. Verification was moderate and it stopped early.

**X.** The most thorough derivation. It checked the SITES diff, re-ran the D1 grep, quoted the W2-04/W2-05 helper rules with line numbers, and confirmed the canonical import order with `eslint --fix`. It has the widest Opus coverage (11/19, all four Opus highs it hit: #2/#3/#5/#6) and no wrong findings. Its weaknesses are calibration and one bad probe. It rates the error-level import-sort failure (#6) low, says the max-params warning needs no change, and proposes a FLOW-drop for `c`/`q` that would claim W2-13a covers quit, which it does not. The PATTERN probe truncated the block, gave a misleading compile result, and missed TS2345. Its fixes are mostly ready to paste.

**Y.** Coverage is close to X (10/19, same four highs) and its severity calibration is the best of the three (9/10 matches agree with Opus). It found the only substantive extra issue (the TESTS import order, verified as an eslint error). Its probes were well built: stubs that mirror the real shapes, the PATTERN block probed with `LineIO` supplied (TS2345 found), and the import lines linted on their own. Every eslint.config line it cites is correct. Against that: one wrong finding (F15, the stale sha, which goes against 01-writer-brief:10), and an unsupported "belongs to W2-13" claim used to wave off #11. In its derivation it saw that irValidate is redundant (half of Opus #3) but backed off. Its fixes are concrete.

## Ranking and confidence

1. **X** (22 weighted, precision 1.00)
2. **Y** (21 weighted, precision 0.93, best severity calibration)
3. **W** (16 weighted, precision 1.00, fewest findings)

- **X vs Y: too close to separate (low confidence).** X leads by one weighted point and one Opus finding, and has no wrong finding. Y has clearly better severity calibration and the more useful extra finding (TESTS import order, med, vs X's low/trivial extras). Two things flip the order to Y > X: rejecting the partial X F13 → #12 match (X 20 < Y 21), or giving severity calibration weight in the rubric. Rejecting the partial matches to #7 (W #7, Y F3) instead widens X's lead (Y 19, W 14).
- **X/Y vs W: separable (moderate-high confidence).** W is 5-6 weighted points behind, misses #6 because of a false probe-artifact claim, and finds none of the lows past #15. Counting the PATTERN findings as matches to #18 would give each review +1 low and change nothing.

## What made grading ambiguous

- Opus #7 (the prose state machine) vs the reviews' narrower "ResolveState has no code form": I accepted it as a partial match for W and Y. X probed the prose state as an interface and raised nothing.
- Opus #18 vs the reviews' "PATTERN is not verbatim": same section, different defect. I scored it as real review-only for all three, so the ranking is unaffected either way.
- X F13 / F14 identify the Opus defect, but their fixes go the other way (name-drop instead of unit-test; keep the 4 params). I scored them as matches with lower severity, per the defect-based matching rule.
- Opus #6 covers D2/D4 only, so Y's separate TESTS import finding counts as review-only. X's combined D2+D4+TESTS finding counts as a single match.
