# Grading — heretic (Swift-1.5 heretic GPTQ-MXFP4 + DFlash2, served `swift-1.5`)

Graded by Opus 5.5 (the session that ran the test) on 2026-10-30, against `../opus-reference/` and the code/briefs at
dp-forge `de110510`. Provenance: counts, timings, lint results = MEASURED (files in this dir); "match", "real",
"wrong" verdicts = INFERRED (my reading, evidence quoted). Opus reviews are the reference, not ground truth.

## A. Blind review (`outputs/W2-0x.refine-27b.md`) vs the 39 Opus findings

Matching rule: same defect at the same item = match; same section but a different defect = no match.

| Brief | Opus # (sev) found blind | Opus # missed | Heretic # → Opus # |
|---|---|---|---|
| W2-06 | 1 (high), 4 (med), 6 (low) = **3/9** | 2, 3, 5 (med) · 7, 8, 9 (low) | H1→O1, H2→O4, H6→O6 |
| W2-07 | 1, 2 (high), 10, 11 (low) = **4/11** | 3 (high) · 4, 5, 6, 7 (med) · 8, 9 (low) | H1→O1, H2+H3→O2, H6→O11, H7→O10 |
| W2-08 | 2, 5, 6 (high), 13 (med) = **4/19** | 1, 3, 4 (high) · 7–12 (med) · 14–19 (low) | H1→O5, H2→O6, H4→O2, H6→O13 |
| **all** | **11/39 (28%)** — high **6/10**, med **2/15**, low **3/14** | | |

Model-only findings (not in Opus):

| Brief | # | Finding | Verdict | Evidence |
|---|---|---|---|---|
| W2-06 | H3 | D2–D4 prose never shows `deps ?? DEFAULT_DEPS`; "deps.write" with `deps?` optional | real, low (a writer infers it) | inputs/W2-06.md:31-41 (`deps?: ExternalDeps`, "No TTY → deps.write(path)", DEFAULT_DEPS private) |
| W2-06 | H4 | WHY omits W2-11 as a `page` consumer | real, trivial | 02-contracts.md:162 (loop-clarify: "the paging happens before it, W2-06 `page`") |
| W2-06 | H5 | STEP 3 lacks "one Write per new file" (all files new) | real, low | inputs/W2-06.md:87 vs 01-writer-brief.md:130 |
| W2-07 | H4 | SITES header says "verified at 36ffe5b4" for sites a predecessor creates (M1: `post-<Id>`) | real, low | inputs/W2-07.md:18-22 |
| W2-07 | H5 | STEP 3 lacks "one Write per new file" | real, low | inputs/W2-07.md:130 |
| W2-07 | H8 | "W1-10 does not export the leads — a known DRY duplication, document it" | **wrong** (the RUNBOOK says W2-07 reads W1-10 as fixed; W1-10 exports them) | briefs/W1-10.md:46-49 (`export const REFUSED_LEAD = …`); = Opus #4 inverted |
| W2-08 | H3 | the irSet/irValidate objects in D4 prose omit `cli`, which W2-05 requires | real, low | inputs/W2-08.md:93-96 vs briefs/W2-05.md:43-44 (`readonly cli: readonly string[]`) |
| W2-08 | H5 | PATTERN "verbatim" runScreen is not W2-01b's (async + `for(;;)` vs non-async `prompt = DEFAULT_PROMPT` + `step`) | real, low–med | inputs/W2-08.md PATTERN vs briefs/W2-01b.md:116-135 |

Precision of the blind review: **19/20 real** (1 wrong: W2-07 H8). Real findings Opus did not list: **7** (all low).

## B. Compare (`outputs/W2-0x.compare.md`)

- **Accepted all 39 Opus findings as real**, rejected none (on W1 the same model rejected 3 Opus findings).
- Verification was partly its own: the ENOENT spawn probe (session 08:57Z), eslint on its own D1 probe for the import
  order (09:15Z), file:line reads for the W2-08 zod limits. Partly copied: W2-06 row 8 cites a `spawn('code --wait')`
  probe that was never run (the only spawn probe in the session is `no-such-editor-xyz`).
- Mapping errors: W2-08 row 3 maps its own `cli` finding as "partially" Opus #3 (a different defect: the fake's plan has
  one entry); row 18 maps its own runScreen-not-verbatim finding to Opus #18 (wrong sibling) — different defects.
  W2-07 H8 has no row although the progress line counts it as "not real: 27B 1" (the RUNBOOK asks one row per defect).

## C. Fix

| Brief | Opus corrected-code lines reused | Brief lines in → out | Lint of the model's own final probe (re-run, `tools/scripts/__probe.ts`) | Re-check claim |
|---|---|---|---|---|
| W2-06 | n/a (Opus gave no code) | 116 → 131 | `factory.ts` (the new `externalTools`): **9 errors** (6 arrow-parens, 2 max-statements-per-line, 1 simple-import-sort) + 1 warn (max-lines-per-function) | "eslint: probe-implementation only" — **not clean**, M11 says a fix is not done until its probe is clean |
| W2-07 | 56/89 (63%) | 160 → 188 | `d2d3.ts` 0/0 · `d1.ts` (on disk, pre-sort) 1 error; the brief's D1 import line is sorted (outputs/W2-07.md:44) | clean (true for the brief text) |
| W2-08 | 164/245 (67%) | 184 → 315 | its extraction of the fixed brief (`fixed-code.ts`) **does not parse**; it then linted `opus-code.ts` (Opus's code): 0/0 | "clean" — **for Opus's code, not for the brief** |

- The W2-07/W2-08 fixes are mostly an adoption of Opus's corrected code; W2-06, the one brief with no Opus code, is the
  one whose own code fails lint.
- SITES headers keep `base 36ffe5b4`; step C asks for the HEAD sha (`de110510`) — not written in any of the three.
- Counts lines (deliverables, tests, FILES, STEPS ranges, FINAL REPORT ids) are present for all three.

## D. Record, runbook compliance, behaviour (`metrics.json`)

- progress.md: 3 W2 lines, format OK. No Opus file opened before its blind review was written; no edit outside the
  allowed files; no commit attempt; main checkout untouched.
- 1 call, no resume; wall 2471 s (41 min); 165 turns; 161 tool calls (Bash 88, Read 43, Edit 23, Write 7); 8 tool
  errors; 2 auto-compactions (189,736 → 14,535 and 138,150 → 20,034 tokens); 1 empty turn; output 256,514 tokens;
  thinking 716,470 chars.
- **One runaway thinking block** (corrected 2026-10-30; an earlier version of this file said "no loop seen"): ending
  09:07:53Z, 246,214 chars, 55 distinct of 1,072 non-empty lines, thinking-only, ended by the 64k output cap (Claude
  Code's "Output token limit hit" follow-up is the next user turn) — MEASURED, `session-0.jsonl`. During it the server's
  mean acceptance length sat at 7.8–7.9 of a max 8 (09:02:03–09:07:53Z) vs 4–7 around it — MEASURED,
  `server-container.log`. The same signature as RedHat's loops; heretic recovered after one, RedHat did not
  (see `../redhat-loop-research.md`).
