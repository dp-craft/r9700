# W2-08 grading — RedHat MXFP4 on Sly 1.9.1 (δ 0.5 + fade/cap, template v22.5-sly2) with the budget RUNBOOK

Run: `sly191-w208/` · session 18:02:28–19:29:16 local (one `claude -p` call, no resume) · W2-08 only.
Config: image `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1`; `RADIANCE_CACTUS_DELTA=0.5`, fade 4096→16384 output
tokens and cap R 0.5 (code defaults, read from the image's `rejection_sampler_utils.py`); template
`qwen3.8-froggeric-v22.5-sly2` (`template-version.txt`); RUNBOOK = `RUNBOOK.optimized.md` (diff `RUNBOOK.diff`);
everything else as the δ 0 W2-08 run (`../delta0-w208/grading.md`). Reference: `../opus-reference/findings.tsv` (19 rows,
6 high). Verdicts are INFERRED (graded by Opus 5.5; the C table by a haiku subagent, spot-checked: O1, O2, O3, O7).
Times below are UTC as in the logs (local = UTC+1).

## A — blind review (17:02:28–17:16:47, 14 min)

- **Recall 1/19 (high 1/6):** the only finding is O3 (T3's plan has one entry, D4 spawns twice). Precision 1/1.
- The review's "Compared" part marks every derived item "Covered · No GAP · No EXTRA"; the two probe lines say
  `tsc: none` / `eslint: none` with a reason ("the import is verified at …") — **0 tsc/eslint runs in A** (MEASURED,
  `compliance.json` `probe_runs_tsc_eslint` 15, all after the first Opus read). δ 0: 59 probe runs before Opus.
- RUNBOOK breaks: the whole brief was read at 17:03:49 (Read without limit) before Part 1 was written (Part 1 must come
  before the brief body; § 0b caps reads at 80 lines).
- **Incident:** at 17:16:18 the review was written to `review/27b-fix/opus/W2-08.md` (the Opus reference) instead of
  `review/W2-08.refine-27b.md`; at 17:16:31 the model ran `git restore` on it and wrote the same content (6,323 chars,
  identical, MEASURED) to the right file at 17:16:47. No Opus content was seen before the review content existed, so the
  blind property holds. `metrics.json`'s `opus_read_before_blind_review_written` flag is this write, not a read.

## B — compare (17:16:52–17:21:05, 4 min)

- 7 tool calls, 3 code checks before the compare was written (δ 0: 30 / 26). The compare was edited again during C.
- Accepted 16, rejected 3:
  - **O18** (copy clarifyScreen, not runScreen) → "no": the PATTERN is the Screen contract. Defensible (δ 0 rejected
    O18 with the same argument).
  - **O12** (T1/T2 assert order/containment only) → "no — the wave file's tests match": misses the point (the wave
    file says what to test, not how tightly). Wrong.
  - **O19** (DO NOT line 2 lacks the lint-forced helper exception) → "no — the current line 2 has the exception": the
    input brief's line 2 has no exception (`inputs/W2-08.md:163`); the model added it in C (`outputs/W2-08.md:181-182`)
    and then judged the finding against its own edit. Wrong (the finding was real and is fixed).
- The O7 row says "D2 + D3 = the corrected code (probed, clean)"; the brief has no such code (see C). Over-claim.

## C — fix (17:21–18:28, 67 min)

| Opus | sev | in the fixed brief | evidence (`outputs/W2-08.md`) |
|---|---|---|---|
| O1 | high | yes | `w` returns to main; `a` carries the writes, then irValidate, then cpSync (96–101) |
| O2 | high | yes | walk builds walkedGoals/walkedNonGoals from [] (82, 85, 91) |
| O3 | high | yes | plan "two { exit: 0 } entries — one for irSet, one for irValidate" (151); irValidate kept by design (W2-05) |
| O4 | high | yes | T3 asserts argv `value @<tmp>`, not the value (158–160) |
| O5 | high | yes | `'../../src/screens/resolve-confirm.js'` (119) |
| O6 | high | yes | one sorted import block (49–55) |
| O7 | med | **no** | D3 is still prose (81–94); `resolveConfirmScreen` and `applyResolve` are signatures only (67, 96) |
| O8 | med | yes | blank replacement re-prompts (88) |
| O9 | med | yes | `w` with no goals → "keep at least one goal" (90) |
| O10 | med | yes | `applyResolve = (result, record, cli)` (96) |
| O11 | med | partial | `resolveCuts` added as code (105–111); W2-13 (the caller) not updated |
| O12 | med | partial | T1/T2 unchanged; `a` covered by "W2-13a's flow test"; `c`, `q` untested (153–163) |
| O13 | med | yes | "Write T1-T3" (169, 171) |
| O14 | low | yes | `record` removed from ResolveConfirmInput (56–61) |
| O15 | low | yes | flags replaced by `writesOf` (76–79) |
| O16 | low | yes | walk-summary `q` drops the partial walk (92) |
| O17 | low | yes | repo-relative `tools/dpf/…` paths (13–17) |
| O18 | low | no | rejected in B (defensible); PATTERN unchanged (26) |
| O19 | low | yes | exception added (181–182), though B called it "not real" |

- **15 yes, 2 partial, 2 no** (all 6 high fixed). The progress line says `fixed 17`.
- Code in the brief: only D1's constant, D2's imports/types/signature, D4's signature and D5's `resolveCuts` body. The
  193-line probe (`dp-refine/W2-08/probe.ts`) holds the full screen + applyResolve, but they did not reach the brief, so
  the writer gets the corrected behaviour as prose (O7 stays open).
- Final probe (18:25:47): `tsc` exit 0, `eslint --stdin --stdin-filename tools/scripts/__probe.ts` exit 0. Re-run by the
  grader on the saved probe: **tsc exit 0, eslint exit 0** (MEASURED).
- Opus code reuse: 30/245 Opus code lines (12 %) in the brief; brief 184 → 203 lines, unchanged-ratio 0.68
  (`opus_reuse.py`). δ 0: 21 %, 184 → 292; heretic: 67 %, 184 → 315.

## D — progress line

`W2-08 | 27B 1 | Opus 19 | both 1 | real: 27B-only 0, Opus-only 16, both 1 | not real: 27B 0, Opus 3 | unsure 0 | fixed 17 | …`
— format OK. Content: "not real: Opus 3" includes O12 and O19 (wrong rejections). The line cost the run's largest loop:
a 240,904-char thinking block (1,664 lines, 150 distinct) deliberating "fixed = 16 or 17", from ~18:14 (first pinned window) to the output cap
(block logged 18:19:40; acceptance ≥ 7 in 33 of the 10-s windows 18:14–18:19, MEASURED).

## E — behaviour

- Loops (MEASURED, `session-0.jsonl` + `server-container.log`): 17:20–17:22 "Let me create the
  compare table." ×84 then ×139 in two consecutive blocks; 17:28 the same type definition drafted ×10; 18:14–18:19 the
  progress-count loop above (1 output-cap hit). All three started inside one decision and repeated it; the last began
  ~700 tokens into its block (δ 0.5 full) and continued past the fade (δ 0 after 16,384 tokens) to the cap.
- Loop windows (acceptance ≥ 7): 58 of 514 (11.3 %) vs δ 0's 7 of 650 (1.1 %) and δ 0.5 on 1.8.1's 777 of 1,067 (72.8 %).
- Compactions 2 (pre 135,166 and 160,590 tokens; the second right after the capped block), 0 failed.
