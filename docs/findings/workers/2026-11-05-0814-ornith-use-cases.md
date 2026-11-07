<!-- meta
date: 2026-11-05 08:14
takeaway: Ornith 1.5 on native Radiance is a good free worker when the task is clear and a script can check the result: JSON to **131k**, code inventory to **88k**, document splitting with **0 lost lines in 6 of 6** runs, tests, renames and clear bug fixes. Draft only for bug classification and code from a spec; never retype text (6k took **480 s**, two more runs didn't finish). Haiku `max` wins on exhaustive lists and path extraction, and Ornith is about **4× faster** on the median task. Mostly n=1. Repeats with 3 sessions in parallel (**1.46×** throughput) make the operator's `dp` prompt the default: a quality tie on 29 of 34 tasks with **17% fewer** generated tokens. Per-profile add-ons don't earn their place, and the `code` allow-list blocks most of Ornith's test commands (7–15 denials per `impl` session).
campaign: campaigns/workers/2026-11-05-0320-ornith-usecases
-->

# Ornith use cases: what to give it, how much, and how to check it

- **Date:** 2026-11-05 · **Track:** agent-level use cases, one-off harness (no campaign dir)
- **GPU/Host:** R9700 (gfx1201), 32 GB, kernel 7.0.0-38-generic
- **Local arm:** `keptn/ornith-1.5-35b-a3b-w4a8` on native Radiance `stilldeadcode/radiance:1.16.0` @ `sha256:b1017ce0e615…`, MTP K=3, KV fp8, `--max-model-len 262144`, `--max-num-batched-tokens 2048`, thinking on, Claude Code 2.1.312 through `skills/ornith/scripts/ornith.sh`
- **Default preset (P0):** temp 1.0, top_p 0.95, top_k 20, presence penalty 1.5; server log shows min_p 0.00. **P2:** temp 0.6, presence penalty 0.
- **Remote arm:** `claude-haiku-5-5` as `general-purpose` subagents, effort `max`
- **Data:** `campaigns/workers/2026-11-05-0320-ornith-usecases/results/2026-11-05-0320-ornith-usecases/`. Skill: `/home/dev/work/dippe/skills-agents/skills/ornith/`

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
| Group documents by type (V2) | 17k | 67k | .90, .85 S; M cut at 840 s, then .89–.93 in 5 runs under an 1800 s cap | .925 S, .931 M | 178 / 188 | 31.5–31.8 GiB / 129–300 MiB | Spot-check, batch |
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

## Does the system prompt matter? First pass, one run per arm

The repeats in the next section replace this direction; this section is kept as the record of the first pass.

Ornith ran as a main session and Haiku as subagents, so the prompts differ. This test gives a direction only: **one run per arm**, while repeats of one brief have differed by up to .235. The arms ran on the same P0 server, with no restart.

| Condition | What changed | How | First request |
|---|---|---|---:|
| Baseline | Earlier P0 arms; `classify` S reran as `base2` on its rebuilt fixture | Main session prompt | 3,062 tokens |
| `sa` | The subagent text replaces the main prompt; the captured request matches a real subagent's | `--system-prompt-file` | About 2,870 |
| `dp` | The operator's prompt from their 27B template is added to the main prompt | `--append-system-prompt-file` | About 3,355: 293 more than baseline on the same brief |

Both prompt files are in `2026-11-05-0320-ornith-usecases/harness/sysprompts/`. A delegated subagent took 5 requests instead of 2 with a 4.6k parent prompt, so the flags were used instead. The main prompt's system text is about 750 tokens, so size isn't the difference between these conditions; their wording is.

| Arm | Baseline | `sa` | `dp` | Direction |
|---|---|---|---|---|
| `classify` M, 67k | Cut at 840 s | 149 of 160, 458 s | 148 of 160, 407 s | Both better; both match Haiku's .931 |
| `log` L, 340k | 16 of 21 classes, 138 s | not run | 21 of 21, 69 s | `dp` better |
| `docreorg` L, right file of 22 | 17, 19, 21; 221–278 s | 20, 274 s | 21, 97 s | Within baseline's range, `dp` faster |
| `classify` S, of 40 | 33 (`base2`) | 37 | 34 | `sa` possibly better |
| `impl`, hidden tests of 34 | 34, then 26 | not run | 34, 115 s | Inconclusive |
| `bugs` S | .705, 229 s | not run | .637, 190 s | `dp` slightly worse, faster |
| `bugs` M | .579, 759 s | not run | .531, 461 s | `dp` slightly worse, faster; path recall .569 to .433 |
| `docsplit` L | Clean, 51–76 s | Clean, 48 s | Clean, 50 s | No change |
| `summary` M, blind conclusion of 3 | 3 | 3 | 2 | No gain |

The document tasks both conditions shared (`docsplit` L, `docreorg` L, `summary` M, 4 notes, `classify` S) took 826 s at baseline, 719 s with `sa` and 639 s with `dp`.

**Document notes, graded blind together** (4 reports):

| Condition | Conclusion /12 | Config /8 | Relevant facts /20 | Wrong meaning | Real incidents | Missed | Critical flags |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 8 | 4 | 20 | 0 | 10 | 6 | 0 |
| `sa` | 6 | 7 | 19 | 0 | 9 | 7 | 2 |
| `dp` | 6 | 7 | 18 | 2 | 9 | 7 | 2 |

Both new prompts give fuller configurations. Neither improved conclusions: the same baseline notes scored 10 of 12 in the earlier grading, so a gap of 2 is about grader noise. I checked the flags against the sources. Real: `dp` said a loss had no clear cause when the report names one, and it reversed which Cactus setting raises acceptance; `sa` overstated a budget gain against quant choice. Partly real: `sa`'s stated cause is the report's own (line 89), though its open question remains. Also real: the baseline `summary` M caveat that no model appears in two passes, against source line 293.

**Direction:** both prompts look helpful on large, list-like document work. Neither helps fine judgement, and `dp` may hurt it. Nothing here changes the skill's default until repeats confirm it.

**Memory:** VRAM peaked at 32396–32539 MiB and GTT at 87–154 MiB across these arms, with 0 drops. No arm was cut, and the run took 53.9 min.

| Arm | Score | s | Gen | Reasoning | Peak context | Drops | VRAM MiB | GTT MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| classify.S.V2.P0.base2 | 0.825 | 122.3 | 16309 | 13852 | 40541 | 0 | 32521 | 94 |
| docsplit.L.V3.P0.sa | 1.0 | 48.4 | 8277 | 5720 | 13814 | 0 | 32521 | 87 |
| docsplit.L.V3.P0.dp | 1.0 | 49.7 | 8156 | 5596 | 15516 | 0 | 32521 | 105 |
| docreorg.L.V3.P0.sa | 0.9091 | 273.8 | 38433 | 33869 | 73311 | 0 | 32539 | 99 |
| docreorg.L.V3.P0.dp | 0.9545 | 97.3 | 18474 | 16035 | 54314 | 0 | 32523 | 122 |
| summary.M.V1.P0.sa | 0.97 | 9.1 | 1328 | 540 | 26801 | 0 | 32479 | 114 |
| summary.M.V1.P0.dp | 1.0 | 24.0 | 4408 | 2632 | 30500 | 0 | 32479 | 123 |
| docnotes.buildcmp.V2.P0.sa | 0.933 | 25.9 | 5501 | 4423 | 13743 | 0 | 32494 | 128 |
| docnotes.buildcmp.V2.P0.dp | 1.0 | 26.3 | 5625 | 4598 | 14349 | 0 | 32494 | 132 |
| docnotes.sharp.V2.P0.sa | 1.0 | 41.4 | 8444 | 7149 | 22973 | 0 | 32481 | 130 |
| docnotes.sharp.V2.P0.dp | 1.0 | 87.8 | 17734 | 15896 | 33208 | 0 | 32479 | 129 |
| docnotes.depth.V2.P0.sa | 0.964 | 78.3 | 15073 | 12593 | 45817 | 0 | 32479 | 142 |
| docnotes.depth.V2.P0.dp | 0.881 | 134.3 | 25820 | 24113 | 56510 | 0 | 32477 | 145 |
| docnotes.hardest.V2.P0.sa | 0.833 | 111.8 | 18083 | 16144 | 82917 | 0 | 32493 | 141 |
| docnotes.hardest.V2.P0.dp | 1.0 | 56.6 | 8816 | 6863 | 73840 | 0 | 32480 | 138 |
| classify.S.V2.P0.sa | 0.925 | 130.0 | 23365 | 21509 | 46881 | 0 | 32483 | 145 |
| classify.S.V2.P0.dp | 0.85 | 162.6 | 28931 | 26341 | 53010 | 0 | 32460 | 149 |
| classify.M.V2.P0.dp | 0.925 | 407.4 | 60903 | 56826 | 151691 | 0 | 32475 | 154 |
| bugs.M.V1.P0.dp | 0.531 | 460.8 | 88319 | 85433 | 63519 | 0 | 32475 | 152 |
| bugs.S.V1.P0.dp | 0.637 | 189.7 | 36623 | 34957 | 50103 | 0 | 32398 | 107 |
| impl.-.V0.P0.dp | 1.0 | 114.5 | 20535 | 15639 | 27057 | 0 | 32396 | 118 |
| log.L.V2.P0.dp | 1.0 | 69.3 | 14566 | 10088 | 22595 | 0 | 32398 | 113 |
| classify.M.V2.P0.sa | 0.931 | 457.5 | 69608 | 66349 | 159202 | 0 | 32411 | 115 |

## System prompt repeats: `dp` becomes the default

**Result:** `dp` ties the default on quality and generates 17% fewer tokens, so `ornith.sh` now appends it on every profile (`ORNITH_PROMPT=none` turns it off). The per-profile add-ons didn't earn their place. The biggest problem found here isn't the prompt: the `code` profile's allow-list blocks most of the ways Ornith tries to run tests.

**Setup:** repeats of the hard rows (3 runs per arm), one `dp` run on every other tested row, and three short add-ons on top of `dp`. 62 arms ran in 82.2 min, then a 7.1 min follow-up and 5 code arms, 3 sessions at a time on the same P0 server (`--max-num-seqs 3`). Driver `harness/prompt_run.py`, log `prompts.jsonl`, per-arm table `prompts.md`. The default prompt's arms are tagged `b2`, `b3`, `r2`, `r3` and `base2`, and `dp`'s are `dp`, `dp2` and `dp3`. `dps*` add the profile's add-on, `dpc*` the code add-on that lists the allowed commands, and `dpw*` use a wider code allow-list. `bdata` is the default prompt on the `data` profile, and `q1`–`q4` are smoke runs. The prompts are in `harness/sysprompts/` (`dp.txt` 285 tokens; add-ons 60–111).

**Before the GPU:** the wrapper patch and the drafts were stress-tested on a mock server. It checked the exact prompt per profile, `ORNITH_PROMPT=none`, combined flags, that a missing prompt file stops before any request, hostile brief text, 4 parallel sessions with no cross-talk, and that a cut stream returns rc=1. Three draft rules were dropped for conflicting with tested tasks: "no outside knowledge", "write once" and "think briefly". After the final patch, a caller's `--append-system-prompt-file` adds to `dp`, but the text flag `--append-system-prompt` replaces it (MEASURED on the mock).

| Comparison | Pairs | Generated tokens | Score |
|---|---:|---|---|
| Default vs `dp` | 34 tasks | `dp` .83×, lower on 21 | 29 ties. `dp` ahead on `docreorg` L (.864 to .955) and `impl` (.873 to 1.0); behind on `bugs` S (.682 to .629), `log` L (.865 to .599, one format failure) and `testgen` (1.0 to .938) |
| `dp` vs `dps` | 16 tasks | `dps` 1.10× | 13 ties. `dps` ahead on `log` L (.599 to .992); behind on notes `hardest` (1.0 to .933) and `log` S V0 (.897 to .811) |

Pair scores are arm means. A difference under 0.05 counts as a tie.

| Task | Default | `dp` | Other | Reading |
|---|---|---|---|---|
| `bugs` S V1 | .705, .67, .67 | .637, .574, .675 | `dps` .638, .674, .642 | About .05 lower with either; still a draft |
| `log` L V2, classes of 21 | 16, 16, 21 | 21, 16, and 0 for format | `dps` 21, 21, 21, one with 8 extra rows | The 0 wrote `WARNING\|150\|1\|msg` instead of `CLASS\|line\|count\|level\|msg`. Its planted faults were there, but no script can read it |
| `impl` V0, hidden tests of 34 | 1.0, .853, .765 | 1.0, 1.0, .824 | `dps` 1.0 ×3; `dpc` 1.0, .765, 1.0; `dpw` 1.0, .912, 1.0 | `dp3` wrote a parser that loops forever on `a=`. The scorer now runs each test under a 40 s limit and records it as hung |
| `docreorg` L V3 | .773, .864, .955 | .955, 1.0, .909 | `dps` .955, .864 | The first pass's 97 s, 18.5k-token `dp` run was luck: the repeats used 34.5k and 32.8k, about the same as the default |
| `classify` M V2, 67k | .912 (`b2`, 1095 s) | .925, .912 | `dps` .887; `sa` .931 | Finishes with any prompt under a 1800 s cap. The first-pass cut was the 840 s cap |
| `testgen` V0 | 1.0 | .938, 0.0 | `dpc` .875, .938; `dpw` .938, 1.0 | The 0.0 never managed to run vitest (every form denied), so it shipped 41 tests that fail on the original code |

**Rows never run with `dp` before:** `json` S and L, `codeinv` L, `edit`, `bugfix`, `log` M, `docsplit` S and M, `docreorg` S and M, and `summary` S and L all scored 1.0. `log` S scored .897, the same as the default. None scored lower.

**Short briefs (V0):** on `read`, the add-on gained nothing. `bugs` scored .568, .588 and .624 (default, `dp`, `dps`), `log` S .897, .897 and .811, and `classify` S .85, .80 and .775, while `summary` scored 1.0 with all three. So the tuned briefs still matter there. On `data`, the plain brief scripted the work, whatever the prompt. `docsplit` S V0 scored 1.0 in 86 s (`bdata` and `dp`), against 480 s of retyping on `read`. `docsplit` L V0 `dp` scored 1.0 in 60 s with 8.1k generated tokens on the 55k document. `json` S V0 scored 1.0 in 28–38 s, against 65 s on `read`. The profile makes the difference here, not the prompt.

**Document notes, graded blind** (4 reports, Haiku `max`, `grader-check/prompts2/`, unblinded with its `label-key.json`):

| Condition | Conclusion /12 | Config /8 | Relevant facts /20 | Wrong meaning | Incidents | Missed | Critical flags, checked |
|---|---:|---:|---:|---:|---:|---:|---|
| Default | 8 | 4 | 18 | 0 | 12 | 6 | 0 |
| `dp` | 6 | 6 | 16 | 2 | 11 | 7 | 1 real: Cactus δ 0 effect reversed |
| `dps` | 5 | 6 | 16 | 3 | 11 | 7 | 1 real: "ruled out at n=1" against source line 201. 1 half-true: "costs nothing" leaves out +60 s per reply. 1 unfair: "monotonic" is the report's own word at line 85 |

This is the same pattern as the first pass: fuller configurations, and conclusions no better. With one note per arm per report, a gap of 2 is within grader noise, but nothing here argues for an add-on on notes.

**`code` profile permissions:** these are independent of the prompt. Every `impl` session hit 7–15 denials on the current allow-list:

| Arms | Allow-list | Denials per session | Scores |
|---|---|---|---|
| `impl` `dp`, `dps`, `dpc` (9) | Current | 7–15, mean 12.0 | 7 of 9 at 1.0 |
| `impl` `dpw` (3) | Wider | 3, 8, 6 | 1.0, .912, 1.0 |
| `testgen` `dp`, `dpc` (4) | Current | 3–8 | .938, 0.0, .875, .938 |
| `testgen` `dpw` (2) | Wider | 6, 3 | .938, 1.0 |

The denied forms were `npx --no-install`, `./node_modules/.bin/*`, `python -m`, `python3 -c`, `node`, compound commands (`;`, `&&`) and pipes into `head` or `tail`. Listing the allowed commands in the prompt (`dpc`) didn't reduce them (11, 13, 7). The wider list adds `npx --no-install`, the `node_modules/.bin` runners, `node`, `python -m pytest`, `echo`, `head`, `tail` and `wc`. On the mock, it let those forms run while `rm` outside the work directory, `curl`, `npx cowsay`, `git push` and redirection to `/tmp` stayed denied. Most denials left on `dpw` came from parts still off the list (`cat`, `find`, `mkdir`, `sed`) and from the fixture's `node_modules`, a symlink to a directory outside the work directory. In a real repo `node_modules` sits inside, so those wouldn't happen (INFERRED). `node` runs any code, like `python3` on `data` and the tests themselves, so the wider list adds little real risk (INFERRED). It is **not applied**: it widens a permission boundary, so it waits for the operator's approval.

**Throughput and memory:** with 3 sessions, the server produced 254 tokens/s in total against a serial mean of 174, about 1.46×, and each session ran at about 100 tokens/s. Times in this section include waiting on the other sessions. VRAM peaked at 29,239–29,914 MiB and GTT at 43–91 MiB across all 79 finished arms, with 0 drops. One arm, `impl.-.V0.P0.dp3`, was flagged by the driver only because the scorer hung on its loop; the session finished and was rescored by hand (`note` in its `result.json`). All rows are in `prompts.md`.

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
- **Mostly n=1.** Only `docsplit` L, `docreorg` L, `classify` S and M, `impl` V0, `bugs` S V1 and `log` L V2 have repeats; the prompt repeats ran 3 sessions in parallel, so their times aren't comparable with the serial arms.
- **No large-size repeats for weak tasks.** `bugs` and `classify` limits rest on few runs.
- **Interrupted arms are quarantined** (iron rule 18) and count only as "didn't finish": `classify.M.V2.P0`, `docsplit.S.V1.P0`, `docsplit.S.V1.P2`, `docreorg.S.V1.P2`.
- **Corrections during the run.** The `log` scorer rejected a format deviation and was fixed. Stats overlapped between arms and were fixed. The `impl` score divided by 35 instead of 34 hidden tests; it's corrected here, and `longrun.jsonl` keeps the old values as logged.

## Open experiments

1. **Wider `code` allow-list:** recommended in "System prompt repeats", tested on 5 arms and the mock, not applied. It needs the operator's approval, then a few `impl` and `testgen` repeats in a real repo, where `node_modules` isn't a symlink.
2. **Reasoning limit:** `--thinking-token-budget` exists in Radiance 1.16.0 and is untested. It might cut the cost on `bugs` and `classify`.
3. **P2 repeats on `impl`,** because the current evidence is inconclusive.

**Tooling note (iron rule 6):** no tool covers this. `gen_campaign.py` has no kind for per-task agent sessions with task-specific scorers, so the harness is hand-written in `bench/workers/`. Recommended: add a `usecase` kind to `gen_campaign.py`.

## All Ornith arms

Finished arms, from `campaigns/workers/2026-11-05-0320-ornith-usecases/results/2026-11-05-0320-ornith-usecases/summary.md`.

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
