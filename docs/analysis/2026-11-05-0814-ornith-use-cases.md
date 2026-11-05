<!-- meta
date: 2026-11-05 08:14
takeaway: Ornith 1.5 on native Radiance is a good free worker when the task is clear and a script can check the result: JSON to **131k**, code inventory to **88k**, document splitting with **0 lost lines in 6 of 6** runs, tests, renames and clear bug fixes. Draft only for bug classification and code from a spec; never retype text (6k took **480 s**, two more runs didn't finish). Haiku `max` wins on exhaustive lists and path extraction, and Ornith is about **4× faster** on the median task. Mostly n=1.
-->

# Ornith use cases: what to give it, how much, and how to check it

- **Date:** 2026-11-05 · **Track:** agent-level use cases, one-off harness (no campaign dir)
- **GPU/Host:** R9700 (gfx1201), 32 GB, kernel 7.0.0-38-generic
- **Local arm:** `keptn/ornith-1.5-35b-a3b-w4a8` on native Radiance `stilldeadcode/radiance:1.16.0` @ `sha256:b1017ce0e615…`, MTP K=3, KV fp8, `--max-model-len 262144`, `--max-num-batched-tokens 2048`, thinking on, Claude Code 2.1.312 through `skills/ornith/scripts/ornith.sh`
- **Default preset (P0):** temp 1.0, top_p 0.95, top_k 20, presence penalty 1.5; server log shows min_p 0.00. **P2:** temp 0.6, presence penalty 0.
- **Remote arm:** `claude-haiku-5-5` as `general-purpose` subagents, effort `max`
- **Data:** `bench/runs/2026-11-05-0320-ornith-usecases/`. Skill: `/home/dev/work/dippe/skills-agents/skills/ornith/`

**Provenance:** every score, time, token and memory figure is `MEASURED` and comes from the arm named beside it or from `summary.jsonl`. Recommended sizes and verdicts are `INFERRED` from those runs. Most arms are one run, so a difference under 0.05 is a tie.

**Reading arm names:** `task.size.brief.preset[.rN]`.
- **Size:** source material of about S 6–18k, M 15–150k, L 25–340k tokens, depending on the task (exact sizes in the table). `P` is a second small document with a preamble, `HU` a Hungarian report, and `-` a small fixed code fixture.
- **Brief:** V0 task and format. V1 adds rules. V2 adds validation or a checker. V3 computes with a tool, or uses a line-range manifest so a script moves the text. Per-document notes use V2 with a table-search step.
- **rN:** repeat number N.

## Summary

| Use case | Recommended size per session | Largest tested | Ornith score (arm size) | Haiku `max` score | Ornith s / Haiku s | Peak VRAM / GTT | Verdict |
|---|---:|---:|---|---|---:|---|---|
| JSON and JSONL questions (V3) | 131k, no limit seen | 131k | 1.0 S, M, L | 1.0 S | 17 / 68 | 31.3–31.8 GiB / 129–258 MiB | Use |
| Python code inventory (V0) | 88k | 88k | 1.0 S, 1.0 M, .995 L | 1.0 S | 10 / 66 | 31.5–31.8 GiB / 129–240 MiB | Use |
| Split a document (V3) | No limit found | 55k | 0 lost lines, 6 of 6 | 0 lost, S | 39 / 142 | 31.6–31.8 GiB / 129–131 MiB | Use |
| Sort sections into topic files (V3) | 15k unreviewed | 25.5k | Content intact 6 of 6; placement 18/18, 20/20, then 17, 19, 21 of 22 at L | Intact, 18/18 S | 125 / 143 | 31.6–31.8 GiB / 129–131 MiB | Use; review placement above 15k |
| Write tests (V0) | Small module | Fixture | 1.0, 16 of 16 mutants killed | 1.0 | 41 / 515 | 31.5–31.8 GiB / 129–171 MiB | Use, run the tests |
| Rename, mechanical edit (V0) | Small repo | Fixture | 1.0 | 1.0 | 45 / 174 | 31.5–31.8 GiB / 127–171 MiB | Use, run the tests |
| Clear bug fix (V0) | Small module | Fixture | 1.0 | 1.0 | 14 / 110 | 31.5–31.8 GiB / 129–268 MiB | Use, run the tests |
| Fixed-form summary (V1) | 55k | 55k | Numbers 1.0; blind conclusion 2–3 of 3 on most | Numbers 1.0; blind 2–3 of 3 | 19 / 149 | 31.3–31.8 GiB / 129–239 MiB | Use, spot-check |
| Notes on one document (V2) | One document | About 29k (978 lines, bytes/4) | Conclusion 10 of 12, config 4 of 8 | Haiku `high`: 9 of 12, 8 of 8 | n/a | 31.8 GiB / 129–133 MiB | Use, not for full configs or incident lists |
| Log triage (V2) | 100k | 340k | .897 S, 1.0 M, .798 L; planted faults 6 of 6 at every size | 1.0 S, 1.0 L | 61 / 325 | 31.5–31.8 GiB / 129–257 MiB | Finds faults; not a full class list |
| Group documents by type (V2) | 17k | 67k unfinished | .90, .85 S; M cut at 840 s | .925 S, .931 M | 178 / 188 | 31.5–31.8 GiB / 129–300 MiB | Spot-check, batch |
| Code from a clear spec (V0) | Small module | Fixture | 34 of 34, then 26 of 34 hidden tests | 34 of 34 | 163 / 400 | 31.5–31.8 GiB / 129–246 MiB | Draft |
| Classify bug text (V1) | 10k | 33k | .705 S, .579 M | .699 S, .706 M | 229 / 387 | 31.5–31.8 GiB / 129–245 MiB | Draft; get paths with `grep` |
| Retype a document (V0, V1) | Don't | 6k | Clean once in 480 s; two runs cut at 600–720 s | Clean, 242 s | 480 / 242 | 31.6 GiB / 129–131 MiB | Don't use |

Memory is the range across all arms of that task. Haiku runs remotely, so it has no local memory figure. No arm spilled: GTT stayed at 127–300 MiB with no growth, and prompt drops were 0 in all 67 finished arms.

## What decides a good result

1. **Whether a tool does the exact work.** Moving JSON to `jq` or `python3` took time from 48–89 s (V0–V2) to 17 s at the same score (`json.S.*`). Moving document text with a script took a 6k split from 480 s to 39 s (`docsplit.S.V0.P0`, `docsplit.S.V3.P0`), and its size then stopped mattering: 54.5k took 51–76 s.
2. **Reasoning, not generation speed.** On `bugs.M.V1.P0`, 100.1k of 103.9k generated tokens were reasoning, and one generation hit the 64k output limit. `classify.M.V2.P0` used 93.2k of 95.3k on reasoning before its 840 s cut. Generation ran at 89–241 tokens/s across arms.
3. **Rules rarely help a clear task.** At S size, V1 and V2 mostly matched V0 and cost more time. Only `bugs` clearly gained, from .568 to .705.
4. **One document per session helps notes.** Fresh sessions scored 10 of 12 on conclusions with 1 critical flag, against 7 of 12 with 4 flags from several reports in one session.

## Ornith vs Haiku

On the 15 arm pairs with both results, Haiku `max` took 1.1× to 12.7× as long, median 3.9× (`arms-haiku/ledger.jsonl` against `summary.jsonl`). Those are wall times of a remote subagent, so they include API latency. The ledger totals about 78.5 min and 2.09M subagent tokens for 17 arms. Ornith costs no API tokens.

| Where they differ | Ornith | Haiku `max` | Arm |
|---|---:|---:|---|
| Error classes found at 340k | 16 of 21 | 21 of 21 | `log.L.V2` |
| Path recall, bug text S / M | .756 / .569 | .969 / .941 | `bugs.*.V1` |
| Bug kind accuracy S / M | .795 / .723 | .718 / .664 | `bugs.*.V1` |
| Severity exact S / M | .564 / .445 | .41 / .513 | `bugs.*.V1` |
| Grouping at 67k | Not finished in 840 s | .931 in 486 s | `classify.M.V2` |
| Retyping 6k | 480 s, or no finish | 242 s, no loss | `docsplit.S` |

Ornith's bug labels are as good as Haiku's or better; the gap is paths. Haiku's setup wasn't identical: effort `max` against `high`, a different system prompt, and different tools (see next section).

## Is the system prompt a factor? Not tested yet

Ornith ran as a main session, and Haiku as subagents. The captured requests are in `bench/runs/2026-11-05-0320-ornith-usecases/prompt-capture/`.

| Session shape | First request, tokens | Note |
|---|---:|---|
| Main session, default | 3,062 | About 750 of this is system text; the rest is 4 tool definitions, template and brief |
| One-sentence `--system-prompt` | 2,336 | Same tools |
| `--agents` + `--agent` | 2,355 | No parent session |
| Real subagent | 2,872 | Delegation took 5 requests instead of 2, with a 4.6k parent prompt |

Size is not the issue, since all shapes are within about 700 tokens. The wording does differ. The subagent prompt says "Be thorough" and "Complete the task fully", and the main prompt says "When you have enough information to act, act". Whether that affects the weak spots is untested, and it's the first open experiment below.

## Presets

P2 ran on 7 finished arms and showed no clear benefit: `bugfix` 1.0 vs 1.0, `edit` 1.0 vs 1.0, `log` .897 vs .897, `docreorg` S clean vs clean, `testgen` .938 vs 1.0, `bugs` .653 vs .705, `impl` .706 vs 1.0 and .765. It didn't fix retyping either (`docsplit.S.V1.P2` cut at 720 s, `docreorg.S.V1.P2` stopped at the 80-turn cap). All are single P2 runs, so this isn't proof that P2 is worse. **P0 stays the default.**

## Blind grading

Haiku `max` graded without knowing the authors. An earlier check against Opus on 40 notes gave these agreements: verdict 28 of 38, config 32 of 40, facts 36 of 40, wrong meaning 37 of 40, unsupported incidents 40 of 40, missed incidents 28 of 40. So a verdict gap under 4 of 18 counts as a tie. I checked every critical flag against its source.

**Document notes** (4 reports, one pass):

| Author | Conclusion /12 | Config /8 | Relevant facts /20 | Real incidents | Missed | Invented | Critical flags |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ornith, one report per session | 10 | 4 | 18 | 10 | 8 | 0 | 1 |
| Ornith, several per session | 7 | 5 | 18 | 9 | 9 | 0 | 4 |
| Haiku `high`, several per session | 9 | 8 | 19 | 16 | 3 | 0 | 0 |

Of the 5 flags, 4 are real (a sign easy to misread, a range omitting one cell, "nothing changed" when prefill was 2–6% faster, one config applied to all runs). The fifth is partly real: the stated cause is the report's own, but the note dropped its single-run caveat.

**Summaries** (two passes, conclusion out of 3):

| Source | Ornith V1 | Haiku `max` V1 | Other Ornith briefs |
|---|---|---|---|
| S, 6k | 3, 3 | 3, 3 | V0 3, 3 · V2 2, 2 |
| HU, 6.6k | 3, 2 | not run | |
| M, 20k | 1, 2 | not run | |
| L, 55k | 2, 3 | 2, 2 | |

Key lines correct were 4–5 of 5. Of the 4 flags, I rejected the one behind M's score of 1, because the source itself says "outcome-neutral" at lines 3 and 311. One flag overstated a wording issue. Two were real but small: a stray backend name, and a right number under a wrong label.

## Limits of this report

- **Fixtures are partly synthetic.** Coding tasks were written for this test and show simple-task ability, not real repository work. The log and notes fixtures contain planted fictional lines.
- **Mostly n=1.** Only `docsplit` L, `docreorg` L, `classify` S and `impl` V0 have repeats.
- **No large-size repeats for weak tasks.** `bugs` and `classify` limits rest on few runs.
- **Interrupted arms are quarantined** (iron rule 18) and count only as "didn't finish": `classify.M.V2.P0`, `docsplit.S.V1.P0`, `docsplit.S.V1.P2`, `docreorg.S.V1.P2`.
- **Corrections during the run.** The `log` scorer rejected a format deviation and was fixed. Stats overlapped between arms and were fixed. The `impl` score divided by 35 instead of 34 hidden tests; it's corrected here, and `longrun.jsonl` keeps the old values as logged.

## Open experiments

1. **System prompt wording:** subagent text through `--system-prompt-file` against the current prompt, 3 runs each on `bugs` S, `log` L, `impl`, `docreorg` L, then one run each of `bugs` M and `classify` M. About 1.5 h (`INFERRED`).
2. **Reasoning limit:** `--thinking-token-budget` exists in Radiance 1.16.0 and is untested. It might cut the cost on `bugs` and `classify`.
3. **P2 repeats on `impl`,** because the current evidence is inconclusive.

**Tooling note (iron rule 6):** no tool covers this. `gen_campaign.py` has no kind for per-task agent sessions with task-specific scorers, so the harness is hand-written in `bench/runs/2026-11-05-0320-ornith-usecases/harness/`. Recommended: add a `usecase` kind to `gen_campaign.py`.

## All Ornith arms

Finished arms, from `bench/runs/2026-11-05-0320-ornith-usecases/summary.md`.

| Arm | Score | Clean | s | Gen | Source tok | Source/min | Gen per 1k | Peak | Drops | VRAM MiB | GTT MiB |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bugfix.-.V0.P0 | 1.0 |  | 14.3 | 2613 |  |  |  | 7810 | 0 | 32250 | 229 |
| bugfix.-.V0.P2 | 1.0 |  | 27.7 | 4499 |  |  |  | 9862 | 0 | 32513 | 129 |
| bugfix.-.V1.P0 | 0.909 |  | 24.1 | 4693 |  |  |  | 10479 | 0 | 32443 | 268 |
| bugfix.-.V2.P0 | 1.0 |  | 29.3 | 4198 |  |  |  | 10240 | 0 | 32324 | 129 |
| bugs.M.V1.P0 | 0.579 |  | 759.2 | 103914 | 32824 | 2594 | 3166 | 78808 | 0 | 32529 | 129 |
| bugs.S.V0.P0 | 0.568 |  | 92.3 | 17741 | 8653 | 5625 | 2050 | 30275 | 0 | 32312 | 245 |
| bugs.S.V1.P0 | 0.705 |  | 228.7 | 42526 | 8653 | 2270 | 4915 | 55315 | 0 | 32271 | 183 |
| bugs.S.V1.P2 | 0.653 |  | 126.5 | 19969 | 8653 | 4104 | 2308 | 32859 | 0 | 32513 | 129 |
| bugs.S.V2.P0 | 0.67 |  | 276.0 | 50307 | 8653 | 1881 | 5814 | 64183 | 0 | 32327 | 164 |
| classify.S.V0.P0 | 0.85 |  | 163.0 | 30174 | 16700 | 6147 | 1807 | 53417 | 0 | 32303 | 244 |
| classify.S.V1.P0 | 0.875 |  | 234.3 | 38961 | 16700 | 4277 | 2333 | 66027 | 0 | 32260 | 167 |
| classify.S.V2.P0.r2 | 0.85 |  | 170.0 | 22939 | 16700 | 5894 | 1374 | 47030 | 0 | 32529 | 129 |
| classify.S.V2.P0 | 0.9 |  | 178.3 | 30666 | 16700 | 5620 | 1836 | 55086 | 0 | 32440 | 300 |
| codeinv.L.V0.P0 | 0.995 |  | 76.0 | 6702 | 87534 | 69106 | 77 | 116684 | 0 | 32531 | 131 |
| codeinv.M.V0.P0 | 1.0 |  | 49.1 | 6643 | 35839 | 43795 | 185 | 40208 | 0 | 32529 | 129 |
| codeinv.S.V0.P0 | 1.0 |  | 10.0 | 1929 | 7585 | 45510 | 254 | 14399 | 0 | 32268 | 240 |
| codeinv.S.V1.P0 | 1.0 |  | 14.1 | 2531 | 7585 | 32277 | 334 | 15463 | 0 | 32265 | 162 |
| codeinv.S.V2.P0 | 1.0 |  | 9.5 | 1776 | 7585 | 47905 | 234 | 14475 | 0 | 32292 | 154 |
| docnotes.buildcmp.V2.P0 | 1.0 |  | 46.7 | 7373 |  |  |  | 15805 | 0 | 32529 | 129 |
| docnotes.depth.V2.P0 | 0.881 |  | 152.2 | 22017 |  |  |  | 52417 | 0 | 32529 | 131 |
| docnotes.hardest.V2.P0 | 1.0 |  | 96.7 | 11962 |  |  |  | 76739 | 0 | 32527 | 133 |
| docnotes.sharp.V2.P0 | 0.952 |  | 37.2 | 5709 |  |  |  | 20425 | 0 | 32525 | 131 |
| docreorg.L.V3.P0.r2 | 0.8636 | True | 220.5 | 29824 | 25514 | 6943 | 1169 | 63290 | 0 | 32529 | 129 |
| docreorg.L.V3.P0.r3 | 0.9545 | True | 277.7 | 36796 | 25514 | 5513 | 1442 | 73274 | 0 | 32529 | 129 |
| docreorg.L.V3.P0 | 0.7727 | True | 248.8 | 32894 | 25514 | 6153 | 1289 | 69044 | 0 | 32531 | 129 |
| docreorg.M.V3.P0 | 1.0 | True | 95.1 | 14183 | 15092 | 9522 | 940 | 38014 | 0 | 32529 | 129 |
| docreorg.S.V3.P0 | 1.0 | True | 124.5 | 18560 | 8540 | 4116 | 2173 | 36080 | 0 | 32326 | 129 |
| docreorg.S.V3.P2 | 1.0 | True | 98.4 | 15655 | 8540 | 5207 | 1833 | 32487 | 0 | 32515 | 131 |
| docsplit.L.V3.P0.r2 | 1.0 | True | 54.2 | 8949 | 54529 | 60364 | 164 | 15651 | 0 | 32529 | 129 |
| docsplit.L.V3.P0.r3 | 1.0 | True | 76.0 | 11495 | 54529 | 43049 | 211 | 18353 | 0 | 32529 | 129 |
| docsplit.L.V3.P0 | 1.0 | True | 51.1 | 8241 | 54529 | 64026 | 151 | 13974 | 0 | 32525 | 129 |
| docsplit.M.V3.P0 | 1.0 | True | 34.8 | 5837 | 20211 | 34847 | 289 | 11546 | 0 | 32525 | 129 |
| docsplit.P.V3.P0 | 1.0 | True | 44.1 | 6487 | 8591 | 11688 | 755 | 14077 | 0 | 32326 | 131 |
| docsplit.S.V0.P0 | 1.0 | True | 480.5 | 69235 | 6029 | 753 | 11484 | 87024 | 0 | 32324 | 131 |
| docsplit.S.V2.P0 | 1.0 | True | 89.7 | 12405 | 6029 | 4033 | 2058 | 24664 | 0 | 32326 | 129 |
| docsplit.S.V3.P0 | 1.0 | True | 38.7 | 6358 | 6029 | 9347 | 1055 | 11729 | 0 | 32324 | 129 |
| edit.-.V0.P0 | 1.0 |  | 44.8 | 9058 |  |  |  | 16286 | 0 | 32238 | 171 |
| edit.-.V0.P2 | 1.0 |  | 46.8 | 7691 |  |  |  | 14329 | 0 | 32525 | 127 |
| edit.-.V1.P0 | 1.0 |  | 124.3 | 22941 |  |  |  | 31056 | 0 | 32321 | 166 |
| edit.-.V2.P0 | 1.0 |  | 51.6 | 8179 |  |  |  | 14605 | 0 | 32378 | 161 |
| impl.-.V0.P0.r2 | 0.765 |  | 148.2 | 19285 |  |  |  | 26740 | 0 | 32525 | 129 |
| impl.-.V0.P0 | 1.0 |  | 163.1 | 28422 |  |  |  | 38419 | 0 | 32290 | 246 |
| impl.-.V0.P2 | 0.706 |  | 98.9 | 14236 |  |  |  | 23143 | 0 | 32523 | 131 |
| impl.-.V1.P0 | 0.853 |  | 76.1 | 13790 |  |  |  | 20401 | 0 | 32303 | 162 |
| impl.-.V2.P0 | 1.0 |  | 177.9 | 27910 |  |  |  | 40060 | 0 | 32374 | 165 |
| json.L.V3.P0 | 1.0 |  | 18.9 | 3150 | 130524 | 414362 | 24 | 9162 | 0 | 32529 | 131 |
| json.M.V3.P0 | 1.0 |  | 14.1 | 2200 | 40479 | 172251 | 54 | 7877 | 0 | 32523 | 129 |
| json.S.V0.P0 | 1.0 |  | 64.9 | 13358 | 8120 | 7507 | 1645 | 32105 | 0 | 32312 | 241 |
| json.S.V1.P0 | 1.0 |  | 48.0 | 11399 | 8120 | 10150 | 1404 | 24795 | 0 | 32059 | 145 |
| json.S.V2.P0 | 1.0 |  | 88.6 | 18575 | 8120 | 5499 | 2288 | 39955 | 0 | 32300 | 172 |
| json.S.V3.P0 | 1.0 |  | 17.3 | 3403 | 8120 | 28162 | 419 | 9657 | 0 | 32435 | 258 |
| log.L.V2.P0 | 0.798 |  | 137.8 | 19939 | 339533 | 147837 | 59 | 26936 | 0 | 32529 | 129 |
| log.M.V2.P0 | 1.0 |  | 99.0 | 15020 | 150552 | 91244 | 100 | 22831 | 0 | 32527 | 129 |
| log.S.V0.P0 | 0.897 |  | 94.2 | 17232 | 18213 | 11601 | 946 | 52103 | 0 | 32402 | 257 |
| log.S.V1.P0 | 0.897 |  | 190.9 | 33553 | 18213 | 5724 | 1842 | 65430 | 0 | 32245 | 180 |
| log.S.V2.P0 | 0.897 |  | 61.1 | 12380 | 18213 | 17885 | 680 | 19971 | 0 | 32319 | 158 |
| log.S.V2.P2 | 0.897 |  | 67.4 | 11365 | 18213 | 16213 | 624 | 18634 | 0 | 32515 | 129 |
| summary.HU.V1.P0 | 1.0 |  | 35.4 | 4963 | 6618 | 11217 | 750 | 16166 | 0 | 32527 | 129 |
| summary.L.V1.P0 | 1.0 |  | 50.8 | 5745 | 54529 | 64404 | 105 | 51974 | 0 | 32527 | 131 |
| summary.M.V1.P0 | 1.0 |  | 71.3 | 9943 | 20211 | 17008 | 492 | 35615 | 0 | 32527 | 129 |
| summary.S.V0.P0 | 1.0 |  | 11.3 | 2344 | 6029 | 32012 | 389 | 12454 | 0 | 32305 | 239 |
| summary.S.V1.P0 | 1.0 |  | 18.7 | 3924 | 6029 | 19344 | 651 | 14163 | 0 | 32059 | 144 |
| summary.S.V2.P0 | 1.0 |  | 38.8 | 8157 | 6029 | 9323 | 1353 | 19572 | 0 | 32296 | 154 |
| testgen.-.V0.P0 | 1.0 |  | 40.5 | 8223 |  |  |  | 15726 | 0 | 32243 | 171 |
| testgen.-.V0.P2 | 0.938 |  | 39.4 | 6499 |  |  |  | 13787 | 0 | 32523 | 129 |
| testgen.-.V1.P0 | 1.0 |  | 62.2 | 12636 |  |  |  | 19924 | 0 | 32304 | 150 |
| testgen.-.V2.P0 | 1.0 |  | 85.6 | 12828 |  |  |  | 20309 | 0 | 32360 | 161 |

Quarantined: classify.M.V2.P0, docreorg.S.V1.P2, docsplit.S.V1.P0, docsplit.S.V1.P2
