# Grading — redhat (RedHatAI/Qwen3.8-27B-MXFP4 + DFlash2, served `qwen38-27b-redhat-mxfp4-dflash`)

Graded by Opus 5.5 (the session that ran the test) on 2026-10-30, against `../opus-reference/` and the code/briefs at
dp-forge `de110510`, same rules as `../heretic/grading.md`. Provenance: counts, timings, lint results = MEASURED (files in
this dir); "match", "real" verdicts = INFERRED (my reading, evidence quoted). Opus reviews are the reference, not ground truth.

**Outcome: did not finish.** 3 h cap reached with 0/3 progress lines. Only W2-06 got through A and B, and step C of
W2-06 got one of nine fixes. W2-07 and W2-08 were never started. Cause: thinking-repetition loops, see section E and
`../redhat-loop-research.md`.

## A. Blind review (`outputs/W2-06.refine-27b.md`) vs the Opus findings

| Brief | Opus # (sev) found blind | Opus # missed | RedHat # → Opus # |
|---|---|---|---|
| W2-06 | 1 (high), 4 (med; rated low), 5 (med) = **3/9** | 2, 3 (med) · 6, 7, 8, 9 (low) | R1→O1, R2→O5, R3→O4 |
| W2-07 | not reached | | |
| W2-08 | not reached | | |

- Model-only findings: **0**. Precision **3/3 real**.
- Evidence checked:
  - R1 cites `briefs/W2-01b.md:163-165`, the "two levels below tools/dpf" note. It's there.
  - R3 cites the C7 comment "drops piped lines", which is at `02-contracts.md:172`.
- R2 = O5 is the 4-parameter vs C7's-3 / `max-params` 3 defect. Heretic missed it. RedHat wrote its fix as "BLOCKED" (it
  read C7 as un-editable). Opus's fix was a factory (`externalTools(deps)`), which keeps the C7 signatures.
  This is the design question its thinking looped on for most of the session (section E).
- Same W2-06 count as heretic (3/9), but a different set: heretic had O6 where RedHat has O5. Heretic also had 3 real
  low findings of its own.
- Order rule kept: the Opus W2-06 file was first opened at 11:17:04Z, after the blind review was written (11:07:31Z).

## B. Compare (`outputs/W2-06.compare.md`)

- **Accepted all 9 Opus findings as real**, as heretic did. Its own three are mapped correctly (rows 1, 4, 5 = "both").
- **No verification of its own in step B.** There was no tool call between reading the Opus review (11:17:04Z) and
  writing the compare (11:22:21Z) (MEASURED, `session-2.jsonl`).
  - The evidence it cites comes from earlier reads and is accurate where checked: row 2 = `04-check-method.md:45` (M4,
    ENOENT then 'close' -2); row 5 = `eslint.config.mjs:46` (`'max-params': ['warn', 3]`).
  - Heretic ran its own ENOENT spawn probe in B.

## C. Fix

| Brief | Fixes applied to the brief | Brief lines in → out | Probe | Lint of the probe (re-run, `tools/scripts/__probe.ts`) |
|---|---|---|---|---|
| W2-06 | **1/9**: row 1, the test import `../src` → `../../src` (`outputs/W2-06.md:67`, a one-line diff) | 116 → 116 | `dp-refine/w2-06/external.ts`: the factory per C7 (row 5), the `'error'` path (row 2), the editor split on spaces (row 3), the `OPENERS` map (row 7) | **5 errors** (1 simple-import-sort, 1 arrow-parens, 3 max-statements-per-line) + 1 warn (explicit-module-boundary-types) |
| W2-07 | not reached (brief byte-identical to input) | 160 → 160 | — | — |
| W2-08 | not reached (brief byte-identical to input) | 184 → 184 | — | — |

- Rows 2, 3, 5 and 7 exist only in the probe, not in the brief. The probe isn't lint-clean.
- `opus_reuse.py` on these unchanged briefs gives the baseline overlap with Opus's code: W2-07 7/89 (8%), W2-08 22/245
  (9%).
  - This calibrates heretic's 63% / 67%: about 55 and 58 points of those came from its fix pass.

## D. Record, runbook compliance

- progress.md: **0 W2 lines** (none written).
- Rules: no edit outside the allowed files; no commit attempt; main checkout untouched (`main-fp-*` identical).

## E. Behaviour (`metrics.json`, `session-*.jsonl`, `driver.log`)

| Metric | RedHat | heretic (for reference) |
|---|---|---|
| Wall time | 10,800 s (cap) | 2,471 s |
| `claude -p` calls | 6 (first + 5 resumes) | 1 |
| Assistant messages · tool calls · tool errors | 241 · 251 · 18 | 149 · 161 · 8 |
| Output tokens (from the `result` events) | 693,694 (calls 0–4; call 5 killed, no result) | 256,514 |
| Runaway thinking blocks (> 100k chars) | **9** | 1 |
| Output-cap hits ("Output token limit hit", cap 64,000) | **8** | 1 |
| Thinking-only turns · "no visible output" nudges | 19 · 8 | 1 · 0 |
| Compactions OK · failed | 3 · **15** ("summarization produced empty response") | 2 · 0 |
| Max context seen | 237,241 tokens → call 4 ended "Prompt is too long" | — |

`summary.txt` says `calls=7`; the true count is 6 (`session-0..5`). The driver increments `n` before its max-resume
check, so the summary is off by one.

Call by call:

Per call (from each `session-N.jsonl`; times are first and last assistant event, UTC):

| Call | Span (UTC) | Turns | Runaway blocks | What happened |
|---|---|---|---|---|
| 0 | 09:35:54–10:58:54 | 76 | 5 | 2 compactions OK, 5 failed. No file written. Ended with an empty result after a thinking-only turn |
| 1 | 11:01:29–11:04:06 | 2 | 0 | Two thinking-only turns (88k and 85k chars), empty result |
| 2 | 11:05:54–11:29:15 | 17 | 1 | Wrote the blind review (11:07:31Z) and the compare (11:22:21Z). Back on the max-params/C7 dilemma in step C; empty result |
| 3 | 11:32:25–11:43:27 | 5 | 0 | Empty result |
| 4 | 11:47:20–12:03:44 | 150 | 0 | The only brief edit: row 1 (`../src` → `../../src`, 11:56:33Z, OK). It then re-sent the **same Edit 8 more times** (11:56:51–11:58:43Z, each "String to replace not found"). Ended `Prompt is too long` (is_error) |
| 5 | 12:13:52–12:33:12 | — | 3 | Compaction #3 OK (239,119 → 17,280). Then three runaway blocks, the last with 10 distinct lines out of 2,032. Killed at the cap (rc 137), no result event |

Runaway blocks (block end UTC · chars · non-empty lines · distinct lines):

| End (UTC) | Chars | Lines | Distinct |
|---|---|---|---|
| 09:45:07 | 246,747 | 2,585 | 202 |
| 09:54:34 | 216,736 | 2,280 | 207 |
| 10:14:02 | 136,922 | 1,377 | 116 |
| 10:20:09 | 235,414 | 2,565 | 117 |
| 10:48:20 | 235,296 | 2,515 | 104 |
| 11:16:34 | 260,925 | 1,397 | 56 |
| 12:20:13 | 222,137 | 3,567 | 469 |
| 12:25:59 | 120,423 | 1,969 | 201 |
| 12:33:12 | 240,814 | 2,032 | **10** |

What the loops were about:
- **Topic.** Almost every loop circles one undecided design question: the brief's functions take 4 parameters while C7
  names 3 and `max-params` is 3. Should it add a deps parameter (breaks C7) or use a module-level default (mutable
  shared state)? In one block the same six lines repeat 53–54×.
- **Tool loops.**
  - From 10:07 to 10:31Z the same pair (`grep -n 'max-params…' eslint.config.mjs` + `sed -n '/C7/,$p' 02-contracts.md`)
    ran 12× in a row.
  - In call 4, after its one successful W2-06 edit, it re-sent that identical Edit 8×.
- **Server signature.** During every runaway block the server's mean spec-decode acceptance length sits at 7.99–8.00
  of a max 8; normal decode is 4.5–5.5 (MEASURED, `server-container.log`). Heretic's single loop shows the same
  signature at 7.8–7.9.
- **Likely cause and test.** The Sly Cactus acceptance rule (`RADIANCE_CACTUS_DELTA=0.5`, Sly #164) is the likely
  cause. The replay A/B in `../replay/` tests it (see `../README.md`).
