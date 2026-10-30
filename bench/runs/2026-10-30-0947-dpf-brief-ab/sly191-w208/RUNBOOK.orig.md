# 27B brief fix — runbook

One 27B session runs this file top to bottom, one brief at a time: a blind review, a comparison with the Opus review, a fix of the findings that hold at the code. After a context reset: read this file again, resume after the last line of `progress.md`.

- P = `docs/plans/2026-10-28-2239-dpf-tui-f0-f1` (the plan dir); O = `P/review/27b-fix` (this dir).
- Run every command from the repo root.

## 0. Rules — re-read them; your memory of them is stale

1. `P/04-check-method.md`, whole: E, S, M1–M11, § Severity, the stack profile.
2. `P/01-writer-brief.md`: `sed -n '/^## REFINE prompt/,/^## RESUME brief/p'` — items 1–9, the Brief template (SITES header, STEPS, the two fixed DO NOT lines).
3. `P/03-review-protocol.md`: `sed -n '/^### REFINE-CHECK/,/^### REVERSE/p'`.
4. `P/02-contracts.md` § C7: runScreen writes every turn's `out`, the result turn's too; lineIO is node:readline's async iterator, never readline/promises `question()`.
5. `P/briefs/W2-04.md`: a brief that passes the rules. Match its density.

Do NOT open `O/opus/` or `docs/reviews/` before step B of a brief.

## 1. Work list, in this order

W1-06b · W1-07a · W1-07b · W1-07c · W1-07d · W1-08 · W1-08b · W1-09 · W1-10 · W2-06 · W2-07 · W2-08

Skip a brief whose line is already in `O/progress.md`. Every row is todo: a site in a file an earlier row changes is `post-<Id>` and matches that row's brief (M1) — W2-07 reads W1-10's brief as already fixed.

## 2. Per brief: A review → B compare → C fix → D record

**A. Review, blind.** § REFINE-CHECK with `<out>` = `P/review/<Id>.refine-27b.md`: Part 1 before you read the brief body, then Parts 2 and 3. Change no other file in A.

**B. Compare.** Now read `O/opus/<Id>.md`; absent → write "no opus review" and go on with your own findings. Write `O/<Id>.compare.md`, one table:

| # | Finding | Found by | Real? | Evidence | Fix |
|---|---|---|---|---|---|

- One row per distinct defect; the same defect from both shares a row: Found by = `both (27B #n, Opus #m)`, else `27B #n` or `Opus #m`.
- Real? — check every row at the code yourself (grep, Read ≤ 80 lines, a probe, tsc or eslint per M9): `yes` · `no` (why, quoted) · `unsure` (what you could not check). A finding is not true because Opus wrote it, nor because you did.
- Evidence (E): file:line with the text, or the probe's command and output.
- A fix that needs another brief: `<Id>: <change>` in the Fix cell; do not edit that brief.

**C. Fix.** Apply every `yes` row; re-verify the SITES at HEAD and write that sha in the SITES header. Then M11, appended to the compare file as `## Re-check`:
- one Probes line per changed block, probed in place with the lines that read its result (a helper you extract: its call site too): `id · probe file · tsc: … · eslint: …`;
- one line per count and list (deliverables, tests, STEPS ranges such as "Do D1-D4", FILES, FINAL REPORT ids): `<what>: <n> = <n>`;
- a miss found here is fixed and re-checked before D. A fix is not done until its probe is clean.

If `npx eslint` is denied, put `ESLINT-UNCHECKED` on the brief's first line.

**D. Record.** Append one line to `O/progress.md`:

`<Id> | 27B n | Opus m | both k | real: 27B-only a, Opus-only b, both c | not real: 27B x, Opus y | unsure u | fixed f | ESLINT-UNCHECKED? | BLOCKED: <why>`

## 3. Limits

- Edit only: the briefs in the work list, `P/review/<Id>.refine-27b.md`, `O/<Id>.compare.md`, `O/progress.md`, files under `/tmp/dp-refine/`.
- Never edit `O/opus/`, the rule files (`P/0*.md`), the wave files, or any other brief.
- No commit.

## 4. Final reply

The `O/progress.md` lines, one totals line over all briefs (same columns), then every `unsure` row and every BLOCKED brief with its reason.
