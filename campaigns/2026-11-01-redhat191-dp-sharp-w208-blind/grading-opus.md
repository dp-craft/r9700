# Opus blind grade — W2-08 review (label W)

- **Grader:** real Opus model (designated grader, not the 27B session model)
- **Date:** 2026-11-02
- **Method:** prompt-only — `opus-grade-prompt.md` (self-contained: review, reference review + 19 findings, brief, all 12 probe files embedded; no tools, no repo access, no file reads, no git, no tsc/eslint/vitest)
- **Blinding:** arm anonymized as `W` (blind package `bench/runs/2026-11-01-redhat191-dp-sharp-w208-blind/blind-grading-dp-sharp/pkg/`; `key.json` not embedded — unblinded here only after the grade: **W = `r191-dp-sharp-d0`**)

The grade below is reproduced verbatim from the Opus output.

## Summary table

Reference found: 8/19

High: 3/6

Med: 2/7

Low: 3/6

Weighted: 16/38

Findings total: 12

Matched: 7

Real review-only: 4

Wrong: 0

Unverifiable: 1

Precision: 11/12

## Per-finding mapping table

W1 → Matches Opus 3 (High)

W2 → Matches Opus 5 (High)

W3 → Matches Opus 10 (Med)

W4 → real (Med). The PB1 probe confirms prompt?: string fails to typecheck (error TS2345) and the runScreen rewrite triggers multiple eslint warnings, proving the block is not a clean copy of the contract.

W5 → Matches Opus 6 (High - note severity difference W med vs Opus high)

W6 → real (Med). Brief line 97 requires throwing an error when any ir result is not ok, but the TESTS section (lines 101-133) only defines tests (T1-T3) for the successful (exit: 0) path.

W7 → Matches Opus 19 (Low - note severity difference W med vs Opus low)

W8 → real (Low). Brief line 24 (S8) cites tools/shared/ir/resolution.ts:171-176, but the probe for this file shows ResolutionIr is exported on line 177, meaning it falls outside the requested block.

W9 → Matches Opus 15 (Low)

W10 → Matches Opus 17 (Low) AND Opus 13 (Med)

W11 → unverifiable. Cannot verify W's claim that W2-04, W2-05, and the template say "one Write per new file" as those files are not embedded and cannot be fetched.

W12 → real (Low). Brief line 181 explicitly lists T2 … T3 (same shape) for the FINAL REPORT, which contradicts the instruction at line 151 to Write T1-T4.

## The 19 reference findings, one row each

1 (high): Rejected

2 (high): Rejected

3 (high): Accepted (W1)

4 (high): Rejected

5 (high): Accepted (W2)

6 (high): Accepted (W5)

7 (med): Rejected

8 (med): Rejected

9 (med): Rejected

10 (med): Accepted (W3)

11 (med): Rejected

12 (med): Rejected

13 (med): Accepted (W10)

14 (low): Rejected

15 (low): Accepted (W9)

16 (low): Rejected

17 (low): Accepted (W10)

18 (low): Rejected

19 (low): Accepted (W7)

## Review-only findings

W4 (real, med): The PATTERN block provided in the brief is mangled and fails tsc/eslint (evidence: PB1 probe outputs error TS2345 and 5 warnings).

W6 (real, med): Missing test coverage for applyResolve failure path (evidence: Brief line 97 mandates the error, but the TESTS block only checks exit: 0).

W8 (real, low): S8 line range misses the ResolutionIr type export (evidence: shared/ir/resolution.ts probe shows it at line 177, but brief specifies 171-176).

W12 (real, low): FINAL REPORT asks for T2-T3 while STEPS asks for T1-T4 (evidence: Brief lines 151 and 181).

## False claims list

In finding W7, W claims that a function complexity > 5 causes commit-gate errors (COMPLEXITY_HARD 5 "errors at >5"). This is demonstrably false according to its own probe PB1, which explicitly shows that a complexity of 6 on runScreen results in a warning, with "0 errors".

## Qualitative judgement

W provides a highly structured and detailed review with excellent probe coverage (PB1-PB4), capturing critical issues like the import path failure (O5), the double spawn bug (O3), and missing lint exceptions (O19). However, W completely missed the most severe logical and data-flow flaws in the state machine (O1, O2, O8, O9), focusing heavily on syntax and structural discrepancies rather than semantic correctness. W introduced valuable review-only findings that correctly identified broken code blocks and missing test coverage.

I could not verify W11 (claims about W2-04/W2-05 briefs) and references to the 01-writer-brief.md template because those files are not embedded and there are no tools to fetch them.
