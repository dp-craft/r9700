# Grading — RedHat with CACTUS_DELTA=0 (W2-08 only; served `qwen38-27b-redhat-mxfp4-dflash`)

Graded by Opus 5.5 (the session that ran the test) on 2026-10-30, against `../opus-reference/` and the code/briefs at
dp-forge `de110510`, same rules as `../heretic/grading.md`. Provenance: counts, timings, probe results = MEASURED (files in
this dir); "match", "real" verdicts = INFERRED (my reading, evidence quoted). Opus reviews are the reference, not ground truth.

Same model and server as `../redhat/` except `RADIANCE_CACTUS_DELTA=0` (`server.cmdline`). W2-08 only, one session:
`session-0.jsonl` (the replay capture, 4.5 min, Part 1 of the blind review) + `session-1.jsonl` (60 min, 1 h cap) +
`../delta0-w208-part2/` (the same session resumed). Not comparable 1:1 with the full arms: this session started at W2-08
with a fresh context, the arms reached W2-08 after W2-06 and W2-07.

## A. Blind review (`outputs/W2-08.refine-27b.md`) vs the 19 Opus W2-08 findings

Written in two steps: Part 1 (Derived) at 12:43:42Z, Parts 2-3 (Compared, Probes, Findings) by one Edit at 13:43:28Z. The
first read of `27b-fix/opus/W2-08.md` is at 13:43:36Z, after both (MEASURED, `session-0/1.jsonl`). Order rule kept. The
review was not edited after that (part 1 and part 2 copies are byte-identical).

| | Opus # (sev) found blind | Opus # missed | Model # → Opus # |
|---|---|---|---|
| **RedHat δ 0** | 2, 3, 5, 6 (high) · 8, 10, 13 (med) · 15, 17 (low) = **9/19** (high **4/6**) | 1, 4 (high) · 7, 9, 11, 12 (med) · 14, 16, 18, 19 (low) | R1→O5, R2→O2, R3→O3, R4+R5→O6, R8→O13, R10→O8, R11→O10, R12→O15, R13→O17 |
| heretic (from `../heretic/grading.md`) | 2, 5, 6 (high) · 13 (med) = 4/19 (high 3/6) | the other 15 | H1→O5, H2→O6, H4→O2, H6→O13 |

Severity: R4/R5 rate O6 med (Opus high); R11 rates O10 low (Opus med). The others agree.

Model-only findings (not in Opus's 19):

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| R6 | the TESTS block's imports (one at the top, two mid-file) fail simple-import-sort | real, low–med (O6's defect in the test block, which O6 does not name) | probe `dp-refine/W2-08/b4`: eslint errors at L2 and L32 |
| R7 | PATTERN "verbatim" `runScreen` is not W2-01b's (a loop + `let` vs W2-01b's recursive `step`); TS2345 on `io.ask(prompt)` | real, low–med (same as heretic's H5; not O18, which says runScreen is the wrong thing to copy) | probe `b1/pattern.ts`; W2-01b brief L41-43 |
| R9 | fixture `nonGoals: []`, so the non-goal branch of the walk is never exercised | real, low–med (a test gap; O12 is a different gap: weak assertions, no a/c/q tests) | brief TESTS L121, T3 L140-141 |
| R14 | header `base 36ffe5b4` is a docs-only commit; `tools/dpf` does not exist there | real, low | `git ls-tree -r 36ffe5b4 -- tools/dpf` is empty (MEASURED, checked by the grader); `git log -1 36ffe5b4` = "docs(plans): dpf-tui — W2-03, W2-04, W2-05 briefs" |

Precision: **14/14 real**: 10 rows match 9 Opus findings (R4 and R5 both map to O6), 4 are model-only and real.

Judgement on the misses (from the review's own Compared section):
- O9 (drop every goal → `goals: []` → throws): looked at and ruled "Not a finding" because D4 states what happens.
- O11 (nobody turns residue rows into `cuts`): mapped to "the flow extracts entry.text" without checking that a flow row
  names it.
- O1, the deepest high (`w` never writes `confirmed.json`, so the flow re-pauses into the operator): not found blind. In the
  compare step it was re-reading C8's re-pause guard when part 1 hit the cap (14:56Z text).

How the evidence was produced: every high finding has a probe behind it — 4 probe files + 6 type stubs under
`/tmp/dp-refine/W2-08/` (now `dp-refine/`), tsc and eslint runs. One probe loop first linted directories instead of files;
the model saw the all-clean result as suspicious and re-ran it. It then spent ~13 min (13:19-13:32Z) working out
simple-import-sort's exact ordering via ESLint's API (`fix-probe.cjs`).

## B. Compare (`../delta0-w208-part2/outputs/W2-08.compare.md`, written 14:11:39Z)

- 22 rows: 9 shared, 3 27B-only, 10 Opus-only. Its own mapping matches mine (R1-R5, R8, R10-R13 ↔ O5, O2, O3, O6, O13, O8,
  O10, O15, O17); R7, R9, R14 are its 27B-only rows (R6 folded into the shared import-sort row).
- **It checked before it agreed.** About 30 tool calls between the first Opus read (13:43:36Z) and the compare write,
  spanning the part-1 cap. It read C8's re-pause guard for O1, `tools/spec-pipeline/src/ir/command.ts` (`commitEdit` refuses
  `goals: []`) for O9, W2-05's temp-file rule for O4, `residue.ts` and C11 for O11, and the current DO NOT template for O19.
  Rows quote file:line.
- **It rejected 2 Opus findings with reasons** (the only model in this test that disagreed with Opus at all; heretic and
  RedHat δ 0.5 accepted every Opus finding):
  - O7 "prose state machine, M9 cannot run on prose" → "no": prose behaviour is the established brief format (W2-05's
    clarify screen is prose too); M9 probes the code blocks. Defensible; Opus's point (#2 hid in that prose) stands too.
    INFERRED: a judgement call, not an error.
  - O18 "copy clarifyScreen, not runScreen" → "no (as proposed)": the PATTERN header says it is the Screen contract every
    screen copies, which is W2-01b's. Defensible.
- Real count: 20 yes, 2 no, 0 unsure.
- Flaw: the Fix column already says "applied: …" for most rows, but at 14:11Z the brief had not been edited yet (no Write
  or Edit to `briefs/W2-08.md` before it). See C.

## C. Fix (`../delta0-w208-part2/outputs/W2-08.md`, written 14:42-14:47Z)

| | RedHat δ 0 | heretic (`../heretic/grading.md`) |
|---|---|---|
| Brief lines in → out | 184 → 292 | 184 → 315 |
| Opus corrected-code lines reused (`opus_reuse.py`; the unchanged brief already shares 22/245 = 9 %) | **51/245 (21 %)** | 164/245 (67 %) |
| Fixes in the brief | **20/20** of the findings it rated real (my reading, item by item below) | mostly Opus's code adopted |
| Lint of the model's final probes (re-run by the grader, repo eslint config via `--stdin-filename`) | module (as `tools/scripts/__probe.ts`): **0 errors**, 1 warn (`max-lines-per-function`, 83 > 20) · test (as `tools/dpf/tests/screens/resolve-confirm.test.ts`, 163 rules active): **0/0** | its extraction of the fixed brief did not parse; it linted Opus's code instead |
| Type check of the final probes (the model's own `tsc --strict` command, re-run) | **clean** (against its PROBE-ONLY stubs for W2-01b/W2-02/W2-05 files, which do not exist at base) | — |
| Brief code ↔ probe | 89/92 brief code lines are in the probes; the 3 others are the signature lines (`… ): T;`) whose bodies the probe implements | — |
| Header base sha | updated to `de110510` (step C asks for it) | kept `36ffe5b4` |

The fixes, checked against the brief text (INFERRED, my reading):
- O1 (edits never confirmed): new flow. `w` stages the writes and returns to main, `a` accepts with them, and applyResolve
  runs every irSet, then copies the template to `confirmed.json` (D2 L81-82, D3 L100-105, D4 L111-114). The step completes.
- O2: the walk iterates the input lists into a `walked` log, and `w` rebuilds from it (D3 L91-104).
- O3: irValidate removed ("irSet already validates", D4 L114-115); T7's plan has two entries for two writes.
- O4: T7 asserts the `--value` argv matches `/^@/u`, not the content.
- O5: `../../src/…` (L138). O6: imports sorted, lint-clean in the probe. O8: blank → re-ask (D3 L97-98).
- O9: `w` with no goal left prints a line and stays (D3 L105-107). O10: 3 params (L110). O11: new D5 `resolveCuts`.
- O12: T1 = `toEqual(MAIN)` (full content), T2 covers a/c/q/other. O13: T1-T10 everywhere.
- O14: `record` dropped from the input. O15: flags dropped. O16: `q` drops the walk (D3 L107-108).
- O17: FILES repo-relative. The D lines still say `src/screens/…`, but the header names the package.
- O19: DO NOT line 2 = the current template.
- R7: PATTERN = W2-01b's contract (signatures, L29-33). R9: NG-1 in the fixture, T5. R14: base `de110510`.
- Not adopted: O7 and O18 (rejected in B). D2 does ask for one helper per phase to stay inside the complexity limit,
  but the probe's factory still warns `max-lines-per-function`. STEP 5's `--quiet` hides that, the same blind spot as O10.

## D. Record, runbook compliance

- progress.md: `W2-08 | 27B 14 | Opus 19 | both 9 | real: 27B-only 3, Opus-only 8, both 9 | not real: 27B 0, Opus 2 |
  unsure 0 | fixed 20 | ESLINT-UNCHECKED? no | BLOCKED: none`. The format matches the RUNBOOK regex (`metrics.py`). Counts
  match the compare file.
- No Write/Edit outside the allowed files; probes only under `/tmp/dp-refine/W2-08/`; no commit attempt; main checkout
  untouched (`main-fp-*` identical in both parts).
- Order oddity, for comparison: heretic wrote its fixed W2-08 brief (09:30:36Z) before its compare (09:31:39Z). RedHat δ 0
  kept A → B → C → D.

## E. Behaviour (`metrics.json` of both parts, `server-container.log` of both parts)

| Metric | RedHat δ 0, W2-08 (both parts) | RedHat δ 0.5 (`../redhat/`, 3 h, all briefs attempted) | heretic δ 0.5 (41 min, all 3 briefs) |
|---|---|---|---|
| Claude call time | 4.5 + 60 (cap) + 46.7 min = **~111 min, W2-08 only** | 180 min, W2-06 unfinished | 41 min (W2-08 portion: **~12 min**, 09:19:53-09:31:49Z) |
| Runaway thinking blocks (> 100k chars) | **0** | 9 | 1 |
| Output-cap hits · empty turns · nudges | 0 · 0 · 0 | 8 · 19 · 8 | 1 · 1 · 0 |
| Compactions OK · failed | **6 · 0** (3 per part) | 3 · 15 | 2 · 0 |
| Largest thinking block | 98,147 chars, 793/1,083 lines distinct (drafting the fixed code) | 260,925 chars, 56/1,397 distinct | 246,214 chars, 55/1,072 distinct |
| Assistant messages · tool calls · tool errors | 157 + 51 · 178 + 64 · 8 + 2 | 241 · 251 · 18 | 149 · 161 · 8 |
| Spec-decode acceptance, normal windows (mean) | 3.40 (part 1, 352 windows) · 3.72 (part 2, 264) | 5.28 (290 windows) | 5.08 (207 windows) |
| Windows with acceptance ≥ 7 (loop signature) | **0 of 352 · 7 of 271** (code copying, no long block) | **777 of 1,067 (73 %)** | 38 of 245 |
| Decode tok/s in normal windows (mean) | **70.4** (part 1) · 80.1 (part 2) | 113.2 | 102.9 |

Windows = the server's 10 s metric lines with generation > 5 tok/s, each paired with the next acceptance line
(MEASURED, `*/server-container.log`). The decode cost of δ 0 is about −29 to −38 % vs the δ 0.5 normal windows (INFERRED: different
content and context depth).

Effort on W2-08 alone (MEASURED from the session logs; heretic = its W2-08 time window):

| | RedHat δ 0 | heretic | ratio |
|---|---|---|---|
| Assistant messages · tool calls | 208 · 242 | 43 · 51 | ~4.8× |
| Thinking chars | 1,077,696 | 154,793 | ~7× |
| Visible text + tool-input chars | 236,517 | 53,670 | ~4.4× |
| Time | ~111 min | ~12 min | ~9× (≈ 5-7× more work × 1.5× slower decode, INFERRED) |

Not like-for-like (INFERRED): heretic reached W2-08 as its third brief with a warm, compacted context; this session started
at W2-08 from a fresh context and re-read the rule files.
