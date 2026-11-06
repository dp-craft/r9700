# Review package: Ornith misses incidents that Haiku finds

Self-contained, for review in another session. All numbers `MEASURED` unless marked. Written 2026-11-06.
Folder: `bench/runs/2026-11-05-0320-ornith-usecases/review-incident-recall/`.

## The question

In "notes on one report", Ornith lists the planted incidents every time, but it misses some real incidents
that Haiku lists. Ten prompt and brief variants were tried to close that gap. Is the test fair, and what moved it?

## Short answer

- **The test is fair: Haiku solves it.** The same brief, field and fixture gave Haiku the buildcmp cold-start
  exclusion in 6 of 6 notes, and Ornith 0 of 3 (the earlier run, `2026-11-04-2207-docanalysis-ornith-vs-haiku`).
- **One combination passed the cheap gate:** the operator's 4-rule prompt **replacing** Claude Code's prompt
  (`briefs/sysprompt-rr3-operator.txt`), on brief V6 (`briefs/ornith-V6.txt`): 2 of 3 runs. Every other
  variant scored 0 or 1 of 3. That is 3 runs on one report, so it is a lead, not a result.
- **The gate had a bug that hid this.** It only accepted the footnote lines L52 and L64. Run `rr3-2` cited L24,
  the report's summary caveat about the same exclusion. Fixed: L24, L52 and L64 now count as one item.

## Why some counts are out of 3 and others out of 6

- **The earlier run (`2026-11-04-2207`)** put several reports in one session. Ornith ran 3 session sizes
  (S = 4 reports, L = 6, X = 7), which gives 3 buildcmp notes. Haiku ran S and L only, at 3 effort levels
  (`low`, `medium`, `high`), which gives 6 notes. Haiku wasn't run on X.
- **This session** ran one report per session, 3 runs per variant.

## What is missed: the items, with the source text

"Found" means an `INCIDENT|<line>|…` line citing that line, or an alias for the same item. The fixtures are in
`fixtures/`, with the same bytes and line numbers that Ornith and Haiku read. The planted lines are fiction
added to the fixture, for example buildcmp L66 (disk full). The real items come from the union of all notes
by Ornith and Haiku, each checked against the source.

| Report, line | Source text (shortened) | Why it counts | Haiku (old run) | Ornith (old run) |
|---|---|---|---:|---:|
| buildcmp L52 (alias L24, L64) | "¹ Anomalous first-shape cold-start (no warmup, REPS=1). Decode drops from 20.0→16.4 on stew675-rocm. Exclude from delta interpretation." | A measurement **excluded**, a word in the definition | 4/6 | 0/3 |
| buildcmp L64 (same item) | "¹ (128,64) is the first PG shape with `--no-warmup`. stew675-vulkan prefill (507 tok/s) is clearly a cold-start artifact …" | Same exclusion, prefill table | 6/6 | 0/3 |
| sharp L282 | "It fired at the `Read` on `session-0.jsonl` line 27272 (rc 137, status `stopped`, a result)." | **Borderline:** the planned stop of the `stop_when` regex, not a failure | 5/6 | 0/3 |
| sharp L293–294 | "The baselines' probe dirs were collected … after the boundary. The δ 0 dir may hold post-boundary files." | Possible **contamination**, hedged | 5/6 | 0/3 |
| depth L308 | "6. **Incident 3 - self-kill.** Stopping the DFlash chain with `pkill -f …` … terminated it (exit 144)" | Labelled "Incident 3", the last of three in a numbered list | 3/3 | 0/2 |
| hardest L528 | "10. **One reply lost its judge row** (… the 31,093-token runaway; the judge column shows `—`) …" | Lost data | 1/3 | 0/2 |
| hardest L180 | "`rb16384` and `rbmax` are identical on 14 of 15 replies … unlimited [ran away]" | **Borderline:** a finding, not a run problem | 1/3 | 0/2 |

Haiku isn't perfect either: hardest L528 and L180 were 1 of 3. The clearest cases are buildcmp (an exclusion,
stated outright), sharp L293 (contamination) and depth L308 (labelled "Incident").

**Expectation:** every one of these appears as an `INCIDENT` line. The brief's definition reads: "one line for
each place where a run crashed, faulted, was interrupted, discarded, contaminated, excluded, redone or
re-collected".

## Prompts and setup, Haiku vs Ornith

| | Haiku (old run) | Ornith (old run) | Ornith (this session) |
|---|---|---|---|
| Brief | `briefs/haiku-and-old-ornith.txt`: several reports per session, read only, "Use Grep only to find the line number", "Think briefly" | Same file | `briefs/ornith-V2.txt`: one report; step 2 greps a keyword list, then "keep those that describe a real event in a run"; "Think briefly" |
| NOTE format and `INCIDENT` definition | Identical in all three | | |
| How it ran | `claude-haiku-5-5` as a `general-purpose` subagent, so it had the subagent system prompt; effort low, medium, high | `local-agent.sh`, headless `claude -p`, Claude Code's main prompt; tools Read, Grep, Glob, Write | `ornith.sh --profile read`: the same clean session; system prompt per variant |
| Thinking | Haiku's own | On (Radiance default) | On |
| Model | `claude-haiku-5-5` | Ornith 1.5 35B-A3B W4A8 on Radiance 1.16.0, preset P0 (temp 1.0, presence penalty 1.5) | Same |

Example notes: `notes/haiku-high-S-buildcmp.txt` (finds L52, L64, L66) and `notes/ornith-old-S-buildcmp.txt`
(finds L66 only).

## Every variant tried on buildcmp (3 runs each unless noted; L24/L52/L64 counted as one item)

| Variant | System prompt | Brief | Cold-start exclusion | Planted L66 |
|---|---|---|---:|---:|
| base (no extra prompt) | Claude Code's | V2 | 0/1 | 1/1 |
| `dp`, `dps`, `sa`, `dpr`, `gr`, `gr2` | various, see `harness/sysprompts/` | V2 | 0/1 each | 1/1 each |
| `rd3s` reread as a skeptic | Claude Code's + appended | V2 | 0/3 | 3/3 |
| `rd4` map the source first | Claude Code's + appended | V2 | 0/3 | 3/3 |
| `rd5` draft, then check | Claude Code's + appended | V2 | 0/3 | 3/3 |
| `rr3` operator's 4 rules | **replaces** Claude Code's | V2 | 0/3 | 3/3 |
| base | Claude Code's | V5 (V2 without "Think briefly") | 1/3 | 3/3 |
| base | Claude Code's | V6 (V5, step 2 checks footnotes and caveats against the definition, no "real event in a run" filter) | 0/3 | 3/3 |
| **`rr3` operator's 4 rules** | **replaces** Claude Code's | **V6** | **2/3** | 3/3 |

On sharp (the first test case), `rd1` and `rd2` (appended) found L293 in 0 of 3 runs each; the planted L152 was found in 3 of 3 with `rd1` and 2 of 3 with `rd2`.

The texts are in `../harness/sysprompts/` (`rd1`–`rd5`, `rd3s`, `gr`, `dp`). Brief diffs: V2→V5 removes
" Think briefly."; V5→V6 replaces step 2's second line with "Check each hit, and every footnote, table note
and caveat, against the INCIDENT definition below; keep each that fits it, run failures or not."

The passing runs' notes are in `notes/ornith-buildcmp-V6-rr3-{1,2,3}.txt`: run 1 cites L64, run 2 cites L24,
run 3 cites L66 only.

## Reading it (`INFERRED`)

- System prompts alone, appended or replacing, never moved recall on the V2 brief. The brief's own rules
  ("Think briefly", "a real event in a run") cancelled them.
- Removing those rules alone (V5, V6) gave 0–1 of 3. The operator's rules together with V6 gave 2 of 3.
  So the prompt and the brief seem to need each other.
- n = 3 on one report. The difference between 0/3 and 2/3 could still be noise.

## Open questions for the reviewer

1. Is the gate fair? It counts by cited line, so a note that names the item at an unlisted line is missed. That
   is how L24 was missed. A reviewer could re-gate `../arms/docnotes.*/output/01.txt` by meaning.
2. Are sharp L282 and hardest L180 real incidents, or should they leave the target set?
3. Does `rr3` + V6 generalize? Next cheap check: the same combination on sharp (L293) and depth (L308),
   3 runs each, gate only. Then check the conclusion's certainty, since rule 2 ("include all edge cases") could
   add false incidents. Unsupported incidents aren't counted yet.
4. Why did Haiku find these with the original brief, which still said "Think briefly"?

## Files

- `fixtures/`: the 4 reports exactly as Ornith and Haiku read them, with planted lines.
- `briefs/`: Haiku's brief (also the old Ornith brief), Ornith V2, V5, V6, and the operator's system prompt.
- `notes/`: one Haiku and one old Ornith buildcmp note, and the 3 passing Ornith notes.
- Raw data: `../arms/docnotes.<report>.<brief>.P0.<variant>[-<rep>]/` (`brief.txt`, `raw.json`,
  `output/01.txt`); the old run is in `bench/runs/2026-11-04-2207-docanalysis-ornith-vs-haiku/{S,L,X}/out-*/`.
- Harness: `../harness/prompt_run.py` (plans `rd`, `rr` tags = replace), `../harness/notes_briefs.py`
  (V2, V5, V6). The gate script is `gate.py` in this folder.
