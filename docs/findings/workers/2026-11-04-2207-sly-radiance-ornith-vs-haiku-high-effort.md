<!-- meta
date: 2026-11-04 22:07
takeaway: Local-agent Ornith 1.5 on native Radiance is eligible for high-volume mechanical doc extraction up to about 110k tokens / 7 docs per session (117k: 32/35 facts on the exact line, 0 fabricated, 9/9 planted incidents at 185k context), but not unattended for judgement: on the same 4 reports at depth, two blind passes gave verdicts of 8-9/12 against Haiku high's 11-12/12. Across its 6 deep notes it had 3 critical errors (2 in both Opus passes, 1 found by a later Haiku check), 19 incidents missed and 0 cross-report conflicts found. Haiku medium had the best path recall (43/45) and clean formatting but missed more incidents than high or low. Ornith has no effort levels (only thinking on/off), reasoning replay costs 7.4-9.2k of window per doc, and local-agent.sh loads CLAUDE.md plus 48 tools (33.2k tokens) unless given clean flags.
campaign: campaigns/workers/2026-11-04-2207-docanalysis-ornith-vs-haiku, campaigns/workers/2026-11-05-0320-ornith-usecases
-->

# Benchmark: local-agent Ornith vs Haiku on document analysis — R9700 (gfx1201)

- **Date:** 2026-11-04 22:07 · **Track:** agent-level document analysis, one-off harness (no campaign dir)
- **GPU/Host:** R9700, 32624 MiB, power cap 210 W (`MEASURED`, hwmon `power1_cap`), kernel 7.0.0-38-generic, CPU governor `powersave`
- **Local arm:** `keptn/ornith-1.5-35b-a3b-w4a8` @ `cfed0f8f` on **native Radiance** `stilldeadcode/radiance:1.16.0` @ `sha256:b1017ce0e615…`, MTP K=3, KV fp8, `--max-model-len 262144`, `--temp 1.0 --top-p 0.95 --top-k 20 --presence-penalty 1.5`, thinking on, Claude Code 2.1.312 via `local-agent.sh`
- **Remote arms:** `claude-haiku-5-5` as `general-purpose` subagents, effort `high`, `medium` and `low`
- **Data:** `campaigns/workers/2026-11-04-2207-docanalysis-ornith-vs-haiku/`

**Naming:** this was requested as "sly-radiance Ornith". `stack/serve/radiance/ornith_rad_mtp.sh` serves native Radiance, not vLLM Sly, so that is the engine measured here.

**Arm names:** an arm is a model plus a session size. S, L and X say how much one session read; they are not quality or effort levels.

| Size | Meaning | Reports in one session | Content tokens | Run by |
|---|---|---:|---:|---|
| **S** | Small | 4 | 27.0k | All arms |
| **L** | Large: 2 more reports, read before S's 4 | 6 | 109.1k | All arms |
| **X** | Extra large: L plus 1 more report | 7 | 117.3k | Ornith only |

So "Haiku low S" is Haiku at effort `low` on the small session, and "Haiku low L" is the same setting on the large one. `low`, `medium` and `high` are Haiku's effort setting; Ornith has no effort levels, so its arms are only "Ornith S", "Ornith L" and "Ornith X".

## Summary

Ornith is **eligible for high-volume mechanical extraction and not eligible for unattended judgement** (`MEASURED`, n=1 per size). At 117k tokens across 7 reports it placed 32 of 35 numbers on the exact cited line, fabricated none, invented no paths and found 9 of 9 planted incidents, with context at 185k. Its conclusions were weaker: on the same 4 reports at depth, two blind grading passes gave verdicts of 8/12 and 9/12, against Haiku high's 12/12 and 11/12. Both Opus passes found 2 critical errors and 19 missed incidents in Ornith's deep notes, a later Haiku check found a third critical error that Opus had missed, and it found no cross-report conflicts in either synthesis. Haiku is not error-free: the second pass found 1 critical error each for its high and medium deep notes.

**Maximum size per session is about 110k tokens across 7 documents.** At 117k all 7 notes fit, but compaction fired at 185k before the synthesis. Haiku high was also faster: 132 s vs 170 s at 27k, and 209 s vs 375 s at 109k.

**Haiku medium** (added afterwards) matched high on facts and needles, had the best path recall of any arm (43/45) and generated 16–25% fewer tokens than high, but missed more incidents (13 against 9). Choose high when incident recall matters most, and medium when token use does. Low is unsuitable for scripts, because at the large size (L) every FACT line broke the format.

**Caveat:** every arm is one run at temperature 1.0, and the judge graded a small sample. The direction is usable; the exact gaps are not precise. The second grading pass moved several scores, and the 6-report verdict gap between Ornith and Haiku high shrank from 3 points to 0.

| Use on Ornith | Eligible? | Evidence |
|---|---|---|
| Numbers, paths, explicitly stated incidents | **Yes**, up to ~110k / 7 docs per session | 0 fabricated facts, 9/9 needles, 44/51 exact paths at depth |
| One-paragraph conclusions | **Only with review** | Verdicts 8–9/12 at depth on 4 reports; 3 critical errors across 6 deep notes |
| Faults recorded only in tables | **No** | 19 incidents missed at depth in both passes vs Haiku high's 8–9 |
| Cross-report conflicts, recommendations | **No** | 0 conflicts found in 2 syntheses; the deep recommendation scored 1/3 in both passes |

## Legend

| Term | What it is | Effect in this run | How it was tested |
|---|---|---|---|
| Needle | A fictional incident sentence planted in a fixture copy of a report | Recall lower bound; explicit sentences are the easy case | Scored by cited line or keyword |
| Fact exact / wrong line / fabricated | Number on the cited line / elsewhere in the report / absent | No arm fabricated a number | `score.py` against the fixture text |
| Malformed FACT | A FACT line without the separate `number` and `meaning` fields | All 30 in Haiku low L, 0 elsewhere | `score.py`, after the fix under Methodology |
| Exact paths | Paths matching a grep oracle of `bench/runs/` and `campaigns/` | Ornith improved once it grepped by itself | `score.py` |
| Invented path | A path string not in the report | 4 in Ornith L, 0 elsewhere | `score.py` |
| Deep / shallow | The same report read late or first in a session | Separates document difficulty from depth | Nested fixtures: S is the tail of L and X |
| Reasoning replay | Earlier reasoning resent as prompt on later turns | 7.4–9.2k tokens of window per document | Prompt growth in the server log |
| Effort | `output_config.effort` or `reasoning_effort` | No effect on Ornith; changes Haiku's output | Temp-0 probe; Haiku medium's setting confirmed in its transcripts |
| Clean flags | `--tools --strict-mcp-config --setting-sources "" --disable-slash-commands` plus `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` | First prompt 33.2k → 3.0k tokens | Wire capture |

## Results

All `MEASURED`. Tokens-as-read use Ornith's tokenizer, with Read's line-number prefix. Haiku's context figures use its own counting, so **compare context between arms only roughly**.

| Arm | Content / docs | Wall | Generated (reasoning) | Peak context | Compaction | Facts exact / wrong line / fabricated | Needles | Exact paths (invented) | Run dirs | Peak VRAM MiB | Peak GTT MiB |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Ornith S | 27.0k / 4 | 170 s | 32,712 (28,919) | 64.4k | none | 20 / 0 / 0 | 4/4 | 7/15 (0) | 10/10 | 32,227 | 94 |
| Ornith L ⚠ | 109.1k / 6 | 375 s | 63,130 (51,858) | 147.8k | at 147.6k | 30 / 0 / 0 | 7/8 | 20/45 (4) | 27/37 | 32,227 | 103 |
| Ornith X | 117.3k / 7 | 564 s | 88,521 (73,768) | 185.3k | at ~185k | 32 / 3 / 0 | 9/9 | 44/51 (0) | 33/40 | 32,231 | 100 |
| Haiku high S | 27.0k / 4 | 132 s | 23,484 | 103.5k | none | 20 / 0 / 0 | 4/4 | 15/15 (0) | 10/10 | n/a (remote) | n/a |
| Haiku high L | 109.1k / 6 | 209 s | 36,738 | 210.3k | none | 30 / 0 / 0 | 8/8 | 39/45 (0) | 31/37 | n/a | n/a |
| Haiku medium S | 27.0k / 4 | 97 s | 17,661 | 97.7k | none | 20 / 0 / 0 | 4/4 | 15/15 (0) | 10/10 | n/a | n/a |
| Haiku medium L | 109.1k / 6 | 201 s | 30,990 | 205.0k | none | 30 / 0 / 0 | 8/8 | 43/45 (0) | 36/37 | n/a | n/a |
| Haiku low S | 27.0k / 4 | 114 s | 13,660 | 93.6k | none | 20 / 0 / 0 | 4/4 | 15/15 (0) | 10/10 | n/a | n/a |
| Haiku low L | 109.1k / 6 | 149 s | 25,374 | 199.5k | none | **all 30 malformed**; first number on the cited line 30/30 | 7/8 | 27/45 (0) | 26/37 | n/a | n/a |

⚠ Ornith L ran with a window of 180,000 that I set by mistake (see finding 2). It is kept as data on mid-job compaction, not as a capacity result. The 3 wrong-line facts in Ornith X are composite values such as `+1.94/+1.69`, not misplaced numbers. Generated tokens for X include about 17k for the compaction summary. Peak GTT stayed near the ~77 MiB idle baseline, so there was no spill. Haiku medium ran about 5 hours after the other Haiku arms, so **remote wall times are not a clean ranking**: it took less time than low at S and more at L. Power median was 208–211 W with brief peaks to 308 W; temperature peaked at 67 °C.

### Blind quality grading

An Opus judge scored shuffled, anonymised notes against the sources, without seeing the scores above. "Deep" is run X for Ornith and run L for Haiku. Pass 1 graded the original arms. Pass 2 regraded all of them with Haiku medium mixed in, under a new shuffle, because grading medium alone would not have been blind or on the same scale. Cells show pass 1 → pass 2. Unblinded with `judge/judge-key.json` and `judge/pass2/judge2-key.json`.

**Agreement between passes on the 30 shared notes:** verdict identical on 23 and within 1 point on all 30; config identical on 27; critical-error flag identical on 28.

| Arm (6 reports, deep) | Verdict /18 | Config /12 | Decision-relevant facts /30 | Incidents listed | Unsupported | Missed | Critical errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Ornith** | **13 → 14** | **8 → 7** | 29 → 29 | 13 | 0 | **19 → 19** | **2 → 2**, plus 1 found later (below) |
| Haiku high | 16 → 14 | 12 → 12 | 29 → 29 | 24 | 0 | 8 → 9 | 0 → 1 |
| Haiku medium | 14 | 12 | 27 | 19 | 0 | 13 | 1 |
| Haiku low | 16 → 15 | 11 → 12 | 26 → 26 | 22 | 0 | 9 → 10 | 0 → 0 |

| Same 4 reports, shallow > deep | Verdict /12 | Config /8 | Decision-relevant facts /20 | Incidents missed |
|---|---|---|---|---|
| Ornith, pass 1 | 11 > **8** | 6 > 6 | 19 > 19 | 14 > 16 |
| Ornith, pass 2 | 10 > **9** | 7 > 5 | 19 > 19 | 14 > 16 |
| Haiku high, pass 1 | 12 > 12 | 8 > 8 | 20 > 19 | 5 > 7 |
| Haiku high, pass 2 | 12 > 11 | 8 > 8 | 20 > 19 | 6 > 8 |
| Haiku medium, pass 2 | 11 > 10 | 8 > 8 | 19 > 18 | 9 > 11 |
| Haiku low, pass 1 | 12 > 12 | 8 > 8 | 19 > 17 | 9 > 8 |
| Haiku low, pass 2 | 10 > 11 | 8 > 8 | 18 > 17 | 10 > 9 |

| Synthesis | Conflicts valid / listed | Important conflicts missed | Recommendation /3 |
|---|---:|---:|---:|
| Ornith S | 0/0 → 0/0 | 1 → 1 | 2 → 3 |
| Ornith X (written after compaction) | 0/0 → 0/0 | 6 → 6 | 1 → 1 |
| Haiku high S | 1/1 → 1/1 | 0 → 0 | 1 → 3 |
| Haiku high L | 4/4 → 4/4 | 1 → 1 | 2 → 2 |
| Haiku medium S | 0/2 | 1 | 3 |
| Haiku medium L | 3/3 | 2 | 1 |
| Haiku low S | 1/2 → 1/2 | 0 → 0 | 3 → 3 |
| Haiku low L | 2/3 → 3/3 | 3 → 2 | 1 → 2 |

**Critical errors (judge's findings):**
- **Ornith, deep, both passes:** it applied the Qwen3.5-35B EMULATION speed (about 16 t/s) to Ornith on Sly, which measured 95/71/67 t/s and never ran EMULATION. Pass 2 also flagged this in the shallow note, so this error is not caused by depth alone.
- **Ornith, deep, both passes:** it overstated the kernarg evidence, saying the ~3% luck figure rules out a random cause when the report calls the evidence strong but not final. Pass 1 also flagged kernels 7.0.0-34/38 listed beside the fix, which is untested on -38.
- **Ornith, deep, found after both passes:** it reversed the 35B budget effect. Its note gives −4.3 as the change "from budget 4096 to 16384", but the report's −4.3 is rb4096 relative to rb16384, so the larger budget gains about 4.3 points. Neither Opus pass flagged it; the Haiku check below did, and the report's line 328 in the fixture confirms it.
- **Haiku medium, deep, pass 2:** it placed the +2 findings gain inside the pre-registered grey zone, when the report puts it below that zone, and omitted the Q4_K_XL vs RedHat tie.
- **Haiku high, deep, pass 2:** it called the 35B coding recipe the best point tested. It is only the best sampling point, and the report forbids calling any quant best.

### Haiku as a third grader

Added 2026-11-05. Haiku at high effort graded the same 40 notes blind, with the same prompt and labels as Opus pass 2 (`MEASURED`, data in `campaigns/workers/2026-11-05-0320-ornith-usecases/results/2026-11-05-0320-ornith-usecases/grader-check/`).

| Field (40 notes) | Exact match with Opus | Within 1 | Mean Haiku − Opus |
|---|---:|---:|---:|
| Verdict (0–3) | 26 | 38 | −0.30 |
| Config (0–2) | 34 | 40 | −0.05 |
| Decision-relevant facts (0–5) | 36 | 39 | −0.12 |
| Facts with wrong meaning | 37 | 40 | +0.07 |
| Unsupported incidents | 39 | 40 | +0.03 |
| Missed incidents | 21 | 40 | +0.03 |

Both models flagged 3 notes as critical errors. Opus alone flagged 2, which Haiku missed. Haiku alone flagged 6; checked against the sources, 1 is real (the reversed budget effect above) and 5 don't hold, for example because the note's own OPEN line states what the flag says is missing. The tables above keep the Opus scores. Haiku is stricter on verdicts, more so on Ornith's deep notes (11 against 14 of 18), so these Haiku scores don't replace them.

## Maximum size

Budget per session (`MEASURED` inputs, `INFERRED` result): **content + 9.2k × documents + 3.8k start + ~8k synthesis ≤ ~187k trigger**.

| Documents | Max content | Status |
|---:|---:|---|
| 1 | ~166k | `INFERRED`, past the largest measured content |
| 3 | ~148k | `INFERRED` |
| 5 | ~129k | `INFERRED` |
| **7** | **~111k** | Closest to measurement: 117k fit the notes but not the synthesis |
| 10 | ~83k | `INFERRED`, within measured content but not at this document count |

- **Keep to about 100k per session as a margin.** The 9.2k overhead is the worst of three measurements (7.4k, 7.8k, 9.2k), and the 24k report with 28 paths alone cost about 15k.
- **The deployed `local-agent.sh` has about 29k less room.** Without clean flags, the first prompt costs 33.2k instead of 3.8k.
- **Total volume isn't capped by this.** Notes go to disk one at a time, so compaction lost nothing in L or X, and split sessions can be chained.
- **There is no safe judgement size yet.** Ornith's verdicts scored below Haiku high's at both depths, and its worst factual error appeared at 27k in pass 2 as well as at 117k. Reducing the batch size alone may not fix this.

## Consequences & root causes

1. **The local agent session is not clean** (`MEASURED`, wire capture). This was expected to have no CLAUDE.md. As deployed, `local-agent.sh` sends 33,154 tokens before any work: 48 tool schemas including 25 Playwright tools (20.8k), the repo CLAUDE.md, skill list and git status (8.7k), and the system prompt (2.5k). The script's extra-argument passthrough reduces this to 3,026 tokens with no CLAUDE.md on the wire. All arms in this test used the clean flags; the script's defaults were not changed.

2. **The real compaction point is about 33k below the configured window.** With a window of 180,000, compaction fired at 147,591 (`MEASURED`). Past sessions on this model compact mostly at 187–196k (`MEASURED`, 23 of 45 compactions), which fits the repo's 220,000 window (`INFERRED`). So the operator's "180k" is about right for the deployed settings, and no settings file sets 180,000.

3. **Ornith has no effort levels, so an xhigh rerun was not run.** `low`, `medium`, `high`, `xhigh` and `bogus` all gave identical token counts at temperature 0, on both `/v1/chat/completions` and `/v1/messages` (`MEASURED`, `thinking-verify.txt` and the probe). The official template reads only `enable_thinking` ([chat_template.jinja](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B/raw/main/chat_template.jinja), `CLAIMED`), and the [keptn model card](https://huggingface.co/keptn/ornith-1.5-35b-a3b-w4a8) documents only on/off (`CLAIMED`). Claude Code's `effort: high` reaches the server and changes nothing. Thinking was on in every run.

4. **Reasoning is the capacity bottleneck.** 82–88% of Ornith's output is reasoning; it drafts each note there, then rewrites it. The template replays all of it, so each generation adds its full size to the next prompt (gen + ~98 tokens, `MEASURED`). "Think briefly" in the brief had no visible effect. In X, reasoning held about 56k of the 185k window at compaction. Haiku high generated 28–42% fewer tokens than Ornith on the same jobs. A template that keeps thinking on but drops old reasoning from history could recover most of that (`INFERRED`, not tested; the repo's `sharp` templates are prior art).

5. **Extraction didn't degrade with depth, and the judgement drop is not established.** Fact accuracy and needle recall held at 185k. Ornith's verdicts on the same reports fell from 11/12 to 8/12 in pass 1 but only from 10/12 to 9/12 in pass 2, and pass 2 found its worst error at both depths. The stable gap is between models, not depths (`INFERRED`; one run per size can't separate depth from sampling noise). Paths moved the opposite way, because in X Ornith chose to grep each document, which matters more than depth.

6. **Ornith under-reports incidents buried in tables.** Planted sentences were found 20 of 21 times, but the judge counted 19 real incidents missed at depth in both passes against Haiku high's 8–9, mostly faults recorded only in test tables. Needle recall therefore overstates real incident recall for every arm.

7. **Synthesis should not be trusted from any arm here.** Ornith found no conflicts, including at S where compaction was not a factor. Haiku's conflicts were mostly valid, though medium's 2 at S were both judged invalid. Its recommendations drew overclaim findings such as "best-graded" or "only". Recommendation scores themselves are not stable: Haiku high S went from 1 to 3 between passes. Treat synthesis output as a draft.

8. **Haiku low is not a safe substitute for scripts at volume.** At L, all 30 FACT lines merged the number and its meaning into one field, which breaks a parser, although the first number was on the cited line every time. At S it matched Haiku high on the scripted scores while using 42% fewer output tokens. Haiku high and medium had no format breaks.

9. **The `local-agent.sh` default of 20 turns is too low for this work.** L used 24 turns and X used 30. These runs set `MAX_TURNS=80`.

10. **Haiku's effort order is not monotonic on quality, except for token use.** Tokens rose with effort at both sizes (S 13.7k / 17.7k / 23.5k; L 25.4k / 31.0k / 36.7k). Medium had the best paths at L (43/45 against high's 39 and low's 27), and the most missed incidents of the three (13 against 9 and 10). With n=1 this doesn't show that medium is better at paths or worse at incidents; it does show that effort alone doesn't order these scores (`INFERRED`).

11. **OPEN:** Haiku reached 210k context with no compaction, and started at 43.7k. Its system context was not captured on the wire, so whether it loaded CLAUDE.md is unverified; its first transcript message did not contain it. This is an asymmetry against Ornith's clean session.

## Recommended config

```bash
# One batch: at most ~100k tokens and ~7 documents. Chain batches for more.
cd <directory holding the output> && \
MAX_TURNS=80 clients/local-agent/local-agent.sh "<brief>" \
  --tools "Read,Grep,Glob,Write" --strict-mcp-config --setting-sources "" --disable-slash-commands
# Also set CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 in the settings passed through LOCAL_AGENT_SETTINGS.
```

- Write one note per document to disk, so compaction can't lose finished work.
- In the brief, tell the agent to Grep each document for paths. Ornith did this unprompted in X, and it took exact paths from 7/15 to 15/15 on the same reports.
- Check the output by script: line-cite every number, as `score.py` does.
- Send conclusions, table-only faults and cross-report synthesis to a stronger model or a human. Haiku high is the better choice for these at this size, and is also faster. Haiku medium is a reasonable lower-token alternative, with weaker incident recall in this run.

## Starter change

`stack/serve/radiance/ornith_rad_mtp.sh` now passes `--chat-template-kwargs '{"enable_thinking":true}' --reasoning-effort-map none=high,minimal=high`, as the operator asked. All benchmark runs above ran before this change, with thinking on by default.

| Request after restart (temp 0) | Generated | Reasoning tokens |
|---|---:|---:|
| Default | 591 | 405 |
| `reasoning_effort: none` | 591 | 405 |
| `reasoning_effort: minimal` | 591 | 405 |
| `reasoning_effort: high` or `xhigh` | 591 | 405 |
| Request `enable_thinking: false` | 26 | **0** |

A request's own `enable_thinking: false` still turns thinking off, and no server flag found here blocks it. `local-agent.sh` doesn't send it.

## Methodology & caveats

- **Harness:** no tool covers agent document analysis, because `gen_campaign.py`'s agentic kind grades code work. It was hand-written under iron rule 6. Recommended tool change: add a `docanalysis` kind reusing `score.py`. No charts were produced, because `report.py` has no kind for this data.
- **Brief:** identical across arms except for the `out-<arm>` token (`harness/brief.txt`, 694 tokens).
- **Corpus:** real repo reports, copied, with planted needles. Fixtures are nested so S is the tail of L and X, and were checked byte-stable across rebuilds. **Planted sentences are fiction.** Fixture documents are not stored in the run dir; `harness/prepare.py` rebuilds them.
- **Sizes:** three, as the operator requested a maximum of 2–3, so no ≥4-point depth fit (rule 16). The planned 143k/11-doc L was dropped after S showed it would need about 228k. Haiku did not run X, so deep comparisons use its L notes; X adds one extra report.
- **Runs:** n=1 per arm and size at temperature 1.0. The card's coding preset `--temp 0.6 --presence-penalty 0` was **not tested** and may improve exact copying (`INFERRED`).
- **Synthesis comparison is confounded:** Ornith X's synthesis was written after compaction.
- **Judge:** two passes by one model, 30 notes and 6 syntheses in pass 1, 40 and 8 in pass 2. A later Haiku pass covered the 40 notes but not the syntheses, so synthesis scores have no second grader. Scores for the same note moved by up to 1 point on verdicts and up to 2 on recommendations, so treat smaller gaps as ties.
- **Scorer fix:** the first `score.py` regex let a FACT value span lines, so it read Haiku low L's two-field lines as 15 exact and 3 wrong-line facts, with 12 unparsed. The report previously said "12 of 30 malformed"; all 30 are. The regex is fixed, malformed lines are now counted, and every arm was rescored. No other arm's fact scores changed.
- **Haiku medium:** the same brief, fixtures and subagent type, run sequentially with no local arm running, about 5 hours after the other Haiku arms. Its fixtures matched the stored manifest and key. `output_config.effort: medium` is in its transcripts.
- **Concurrency:** one local agent at a time. Haiku runs overlapped local arms, but ran remotely. Earlier temp-0 probes ran between runs, and the sampler ran only during local arms.
- **Quality was only tested on this repo's benchmark reports,** in English. Other document types may behave differently.

## Next experiments

1. Rerun S and X with `--temp 0.6 --presence-penalty 0` to see whether verdicts and paths improve.
2. Test a template that drops old reasoning from history, with thinking on, to measure the capacity gain.
3. Run X's 7 documents in fresh per-document sessions with a specific table-search step, then grade blind, to see whether time and table-only incident recall improve.
