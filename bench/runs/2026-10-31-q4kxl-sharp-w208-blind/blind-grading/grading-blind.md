# Blind grading — W2-08 refine-check reviews X, Y, Z

Yardstick: `ref/opus-W2-08.md` (19 findings: 6 high, 7 med, 6 low). Code and plan checked at dp-forge
`de110510`; `tools/` is identical between the brief's base 36ffe5b4 and de110510 (`git diff --stat 36ffe5b4 de110510 -- tools/` is empty).
I re-ran these probes myself: eslint `--stdin --stdin-filename tools/scripts/__probe.ts` on the brief's D2+D4 import lines (`1:1 error Run autofix to sort these imports!`), on D4's two lines alone (same error: no blank line between the groups), and on the 4-param signature (`warning … too many parameters (4) … max-params`).

## Summary

| Review | Opus found | high /6 | med /7 | low /6 | Findings | Matched | Real only | Wrong | Unverif. | Precision | False claims |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **X** | 9/19 | 4 | 3 | 2 | 14 | 10 | 3 | 1 | 0 | **0.93** | 1 |
| **Y** | 4/19 | 3 | 1 | 0 | 6 | 4 | 2 | 0 | 0 | **1.00** | 2 |
| **Z** | 12/19 | 3 | 4 | 5 | 15 | 11 | 4 | 0 | 0 | **1.00** | 4 (2 substantive, 2 wrong line cites) |

Severity-weighted Opus coverage (high 3 · med 2 · low 1, max 38): X 20 · Y 11 · Z 22 (21 without the borderline #16 match).

**Ranking: Z > X > Y.** I am moderately confident that Z beats X, because the two are close. I am highly confident that Y comes last.

No review found Opus findings #1, #4, #7, #11 or #18. #18 is under the strict matching rule: all three flagged the PATTERN block for a different defect.

---

## X — mapping

| X # | X sev | Maps to | Opus sev | Evidence / note |
|---|---|---|---|---|
| 1 | high | #5 | high | brief:133 `'../src/…'` from tests/screens → tests/src; X's probe returned TS2307. Correct. |
| 2 | high | #2 | high | brief:74-75 + 81 + 84: initial goals = input, and the walk appends → `[G-1, G-2, G-1, G-2']`. Correct. |
| 3 | high | #3 | high | W2-04 D2 step 1 `entry = plan[n]`; D4 spawns irSet then irValidate → plan[1] undefined. Correct. |
| 4 | med | #6 (D2 half) | **high** | My eslint probe gives an error. Severity is under-rated: a lint error is `high` per 04-check-method § Severity. |
| 5 | med | #6 (D4 half) | **high** | D4's `node:fs` and the relative import have no blank line between the groups → error (my probe confirms). Same under-rating. |
| 6 | med | real (review-only) | — | see below |
| 7 | med | real (review-only) | — | PATTERN is not W2-01b's code (see below). Not Opus #18, which is a different defect. |
| 8 | med | #13 | med | brief:151/153 say T1-T4, while 137-146 and 181 define T1-T3. Correct. |
| 9 | med | real (review-only) | — | see below |
| 10 | med | #8 | med | resolution.ts:15 `text: z.string().min(1)`. The mechanism is misstated (false claim F-X1). |
| 11 | low | #10 | **med** | Correct, but under-rated. |
| 12 | low | #15 | low | brief:73-75, 85 and 95-96: the flags are never read. Correct. |
| 13 | low | #17 | low | brief:13-14 are package-relative while 152 and 157 are repo-relative. Correct. |
| 14 | low | **wrong** | — | see below |

Opus findings X missed: #1, #4, #7, #9, #11, #12, #14, #16, #18, #19. On #9, X's Compared section *explicitly dismissed* the drop-every-goal branch ("Not a finding"). On #12, X judged the `a` deferral legitimate, which is defensible because wave-2-dpf-cli.md:64 names scenario (1).

## Y — mapping

| Y # | Y sev | Maps to | Opus sev | Evidence / note |
|---|---|---|---|---|
| 1 | high | #5 | high | It quotes W2-01b.md:162-163 ("`../src` would resolve to tools/dpf/tests/src") correctly. |
| 2 | med | #6 (D2 half; also flags the TESTS imports) | **high** | Correct citations: eslint.config.mjs:23 and :160. It gives only the group order: no specifier order, no blank-line or D4 half. Severity is under-rated. |
| 3 | med | real (review-only) | — | see below |
| 4 | med | #2 | **high** | It reaches the right conclusion but under-rates it, because T3 cannot pass. |
| 5 | low | real (review-only) | — | PATTERN is not verbatim (W2-01b.md:135-138, cited correctly) |
| 6 | low | #13 | **med** | Correct, but under-rated. |

Opus findings Y missed: #1, #3, #4, #7–#12, #14–#19 (15 of 19).

## Z — mapping

| Z # | Z sev | Maps to | Opus sev | Evidence / note |
|---|---|---|---|---|
| 1 | high | #5 | high | It ran a `path.resolve` probe. Correct. |
| 2 | high | #13 | **med** | The defect is correct but over-rated. Its fix differs, restoring the `a` case as T4, which is acceptable. |
| 3 | high | #3 | high | Strong: a runtime replica of the fake (plan `[{exit:0}]`, 2 calls → `TypeError … reading 'exit'`; the counter file left at 2). It also notes the stray "and a counter". |
| 4 | high | #2 + #16 | high / low | Doubling is correct. It also states that "aborting and re-entering `g` doubles again" and fixes it ("re-initialized on `g`"), which is the partial-walk-on-abort defect, so I counted #16. This match is borderline. |
| 5 | med | #10 | med | It ran a probe (`max-params` warning) and cites the W2-01b "four parameters break max-params 3" precedent. Correct. |
| 6 | med | real (review-only) | — | see below |
| 7 | med | real (review-only) | — | see below |
| 8 | med | #12 (the `a`-untested half) | med | The defect matches. Its justification rests on a false premise (F-Z1). |
| 9 | med | #17 | **low** | Correct, but over-rated. |
| 10 | med | #9 | med | resolution.ts:23 `.min(1)`. Correct. |
| 11 | low | real (review-only) | — | see below |
| 12 | low | #14 + #15 | low / low | It explicitly names both: the flags are never read, and `input.record` is unused by the screen. |
| 13 | low | #12 (the diffLines half) | **med** | The fixture has `diffLines: undefined`, so the render is untested. Correct. |
| 14 | low | #19 | low | DO NOT L163 vs the 01-writer-brief template ("…or a helper beyond the ones it names — unless the lint limits need one"). Correct. |
| 15 | low | real (review-only) | — | see below |

Opus findings Z missed: #1, #4, #6, #7, #8, #11, #18. Its D2 probe dismissed the import-sort error as a probe artifact (F-Z2). On #11, Z's Compared section saw the gap ("GAP→design … the residue filter is W2-13's, NEEDS") but never raised it as a finding row, although the protocol says "every GAP and EXTRA is a row". Not counted.

---

## Review-only findings

| Review # | Verdict | My sev | Evidence |
|---|---|---|---|
| X6 | real | med | The TESTS fixture puts its imports mid-file (brief:102, 132-133), with unsorted specifiers (`ResolutionIr, GoalsDoc`) and the external import directly before a relative one → simple-import-sort errors. The rule applies to all files (eslint.config.mjs:157-160). Opus #6 covers D2/D4 only, though Opus's corrected test fixes this. |
| X7 / Y5 / Z7 | real | low | The brief says PATTERN is "src/ui/screen.ts from W2-01b, verbatim", but W2-01b D9's runScreen (W2-01b.md:126-138) is a non-async `step`/`writeAll` recursion with `prompt = DEFAULT_PROMPT`, no `let`/`for`. The brief's block uses `let`, `for(;;)` and 2× `for…of`. It also returns `turn.result` (L36) before writing that turn's `out` (L37), which contradicts C7 ("every turn's `out` is written, the result turn's too"); only Z states this. X's TS2345 (`prompt?: string` passed to `ask(prompt: string)`) holds given W2-01b's `LineIO`. This is a different defect from Opus #18 (wrong sibling), so it is not a match. Low severity because the writer does not touch screen.ts. |
| X9 | real | med | The fixture has `nonGoals: []` (brief:121), so the non-goal walk branch (`index - goals.length`) and the "$.nonGoals only when changed" write branch are never exercised. Opus's corrected tests add NG-1 and a dedicated `$.nonGoals` test, but Opus has no numbered finding for it. |
| Y3 | real | trivial | D4 prose `irSet of { kind, file, path, value }` omits `cli`, which W2-05 D1 (W2-05.md:43-44) requires. A writer recovers it from applyResolve's `cli` param, and the sibling W2-05 D4 uses the same shorthand. |
| Z6 | real | med | The T1 drift half is vacuous: the fixture drift is already `[D-1 unclear, D-2 matches]` (brief:110-113), so a no-sort implementation passes "D-1 before D-2". Opus silently fixed this in its corrected fixture (D-1 matches, D-2 unclear) without a numbered finding. |
| Z11 | real | low | S8 says `resolution.ts:171-176` "…ResolutionDoc types", but D2 imports `ResolutionIr`, which is at resolution.ts:177. An M10 range defect. |
| Z15 | real | trivial | STEPS 3 reads "one Edit per site" for two new files. The template's fixed STEPS text (01-writer-brief.md:130) is "one Edit per site, one Write per new file", and W2-04:156 says "one Write per new file". (W2-05 shares the same deviation.) |
| X14 | **wrong** | — | Claim: "base 36ffe5b4 is docs-only — tools/dpf does not exist there; S2-S8 verified at HEAD → change base to de110510". The brief's S1 already says screen.ts and ir.ts come from W2-01b/W2-05. `tools/` is byte-identical between 36ffe5b4 and de110510, so S2-S8 hold at the stated base, and base drift is handled by 01-writer-brief § Per row step 1. Moving the base fixes nothing. |

## False claims (not findings, but factually wrong)

| Id | Review | Claim | Fact |
|---|---|---|---|
| F-X1 | X (#10, and Compared M4 "d on every goal") | "`w` → irSet writes it → irValidate refuses → applyResolve throws" | `ir set` validates the whole result before it writes ("Apply, validate the WHOLE result, and only then write — a refusal never touches the file", spec-pipeline/src/ir/command.ts:236-244). irSet itself refuses. The conclusion (applyResolve throws) still holds. |
| F-Y1 | Y (Probes) | "D2/D3/D4 are prose (not code)… The only code shown is the PATTERN TO COPY runScreen" | D1, D2 and D4 contain TypeScript blocks (imports, `ResolveConfirmInput`, `ResolveResult`, signatures), and TESTS has a full fixture. M9 applies to them (04-check-method M9: "Each code block — an inline code span holding a statement too"). As a result Y probed none of them. |
| F-Y2 | Y (Derived) | "all SITES are base files … no post-<Id> site, so M1 does not apply" | S1 names files created by W2-01b and W2-05 (W2-05 is the row's dependency), and D2/D4 import them. M1 is "the base commit plus each not-done predecessor's change". |
| F-Z1 | Z (#8) | "the wave file names no such scenario, so the justification is unverifiable" | wave-2-dpf-cli.md:64 (W2-13a): "Scenarios: (1) specify: clarify … → resolve-confirm `a` → boundary". The deferral is grounded in the wave. |
| F-Z2 | Z (Probes, D2 line) | "D2 L49-64 · tsc: none · eslint: none (the only errors are probe artifacts: import sort …)" | probe-types.ts did not reproduce the brief's import lines (it re-wrote them as one sorted `import type`). The brief's D2 lines as written fail simple-import-sort; my probe returned `1:1 error`. This dismissal is why Z missed high #6. |
| F-Z3 | Z (Derived M4-4) | "GoalsDocSchema requires goals: min(1) (resolution.ts:44)" | The constraint is at resolution.ts:23; line 44 is `SURFACE_KINDS`. Z#10 cites :23 correctly. Trivial. |
| F-Z4 | Z (Derived M2-3) | "`ResolutionIr` = … (resolution.ts:164)" | ResolutionIrSchema is at :151 and the type at :177; line 164 is a legacy-schema field. Trivial. |

I spot-checked X's citations (registry.ts:49/50, io.ts:22-25/179, loop-ports.ts:936-942, residue.ts:37-47, the six `source ===` hits) and Y's (W2-01b.md:112-113/135-138, W2-05.md:43-44, eslint.config.mjs:23/160). All are correct.

---

## Judgement

**X.** This is the most rigorous verifier. Every code block (PATTERN, D2, D4, TESTS) was probed with tsc and eslint, the output was quoted, and genuine errors were separated from probe artifacts. A fix-probe derived the correct import order. It found 4 of the 6 high findings, including both halves of the lint error that Z missed, plus r-then-Enter (#8), which no other review caught. Its weaknesses:
- It explicitly reasoned the drop-every-goal branch away.
- It filed one wrong finding (the base sha).
- It slipped on the ir mechanism (F-X1).
- It under-rates the lint errors as med.

Its fixes are concrete and line-addressed.

**Y.** Every finding is valid, so precision is perfect, but the review is thin. It wrongly declared D2/D4/TESTS "prose" and ran no tsc or eslint probes on them; it found the import order by reading the eslint config. It covers only 4 of 19 Opus findings. It missed the fake-plan blocker (#3), both schema edge cases, max-params, the dead flags and the path convention. Its severity is mostly under-rated. Its fixes are correct but minimal.

**Z.** This has the broadest coverage (12/19, with 5 of the 6 lows) and no wrong findings. The runtime probes are real and convincing: a replica of the fake showing the `TypeError`, and a `path.resolve` probe. It added useful test-quality findings, including vacuous T1 drift (Z6), which Opus fixed only silently. Its weaknesses:
- Its D2 lint probe was not verbatim, and it dismissed a real high import-sort error as an artifact.
- One finding rests on a false reading of the wave file.
- Some severities are mis-calibrated (the T1-T4 typo rated high, paths rated med).

Its Compared section saw the cuts-ownership gap (#11) but did not raise it.

**Ranking: Z > X > Y.**
- **Z vs X (moderate confidence):** Z leads on breadth (12 vs 9 Opus findings), precision (1.00 vs 0.93) and weighted coverage (22 vs 20). X leads on high-severity coverage (4 vs 3), on probe fidelity, and on fewer substantive false claims (1 vs 2).
- **What would flip it:** rejecting the borderline Z4→#16 match *and* weighting high findings more heavily would make the two equal or put X ahead. Without #16, weights of 4/2/1 tie them at 24–24, and 5/2/1 puts X ahead 28–27. Counting X6's test-import lint error as high would also narrow the gap.
- **Y last (high confidence):** under any weighting, Y covers less than half of what either other review does.

## Ambiguities

1. **PATTERN findings vs Opus #18.** All three flag the PATTERN block, but as "not verbatim/fabricated", not as "the wrong sibling (should be clarifyScreen)". Under the strict same-defect rule, none matches #18. Matching it would add +1 low to every review and change no ranking.
2. **Z4 → #16** rests on a single clause ("aborting and re-entering `g` doubles again") plus a fix that re-initialises on `g`. I counted it as explicitly naming the abort defect. Without it Z has 11/19 and 4 lows.
3. **Z8 matched to #12 despite a false premise.** The defect is the same (the row lists "`a` → result accept" and there is no unit test), but the stated reason is wrong (F-Z1). X took the opposite and correct factual position ("legitimate per the wave"), so X's "miss" of this half of #12 is a defensible judgement.
4. **Y's probe directory** contains `opus-code.ts`, `fixed-code.ts` and `probe/src/screens/resolve-confirm.ts`. These are byte-identical (modulo trailing whitespace) to the reference's corrected D1–D4 code. Y's review never cites them, and its findings do not reflect any Opus-only finding (#1, #3, #4, #7, #11), so they look like leftovers from a shared `/tmp/dp-refine/W2-08/` directory. I graded Y on its review text only.
5. **Severity of X6** (lint error in the TESTS import block). Strictly, the protocol says a lint error is high. I set it to med because the brief presents the fixture as a list rather than a verbatim file, and STEP 5 would surface it to the writer.
