## Summary

| W2-08, step A (blind review), 19 Opus findings: 6 high · 7 med · 6 low | **Q4_K_XL (this run)** | RedHat δ 0 | heretic |
|---|---|---|---|
| Weights | unsloth UD-Q4_K_XL GGUF | `RedHatAI/Qwen3.8-27B-MXFP4` | `Swift-1.5-…-heretic-MXFP4-GPTQ` |
| Engine | llama.cpp b11448 Vulkan via llama-swap | vLLM 0.32.0, Sly 1.8.1 | vLLM 0.32.0, Sly 1.8.1 |
| Spec decoding | MTP head (`--spec-type draft-mtp`), drafts verified by the target sampler | DFlash2 k = 7, Cactus δ 0 | DFlash2 k = 7, Cactus δ 0.5 |
| KV · window | q8_0 · 260000 (`n_ctx` 260096) | fp8 · 262000 | fp8 · 262000 |
| Chat template | sharp = froggeric `v22.5.0` + a TERSENESS directive in the system prompt (sha256 `cdff39fb…a84a`); otherwise the same as v22.5 | froggeric v22.5 (effort high → xhigh, replays old reasoning; sharp has the same logic) | froggeric v22.5 |
| Session shape | 1 call, fresh context, W2-08 only | 4.5-min capture + 1 resumed call, W2-08 only | one session, W2-08 after W2-06 and W2-07 |
| **Opus findings found (blind grader)** | **12/19** | **9/19** | **4/19** |
| high · med · low | 3/6 · 4/7 · 5/6 | **4/6** · 3/7 · 2/6 | 3/6 · 1/7 · 0/6 |
| Severity-weighted (3/2/1, max 38) | **22** (21 without the borderline #16) | 20 | 11 |
| Findings: total · matched · real, not in Opus · wrong | 15 · 11 · 4 · **0** | 14 · 10 · 3 · 1 | 6 · 4 · 2 · 0 |
| Precision (matched + real) / total | **15/15** | 13/14 | 6/6 |
| False claims outside findings | 4 (2 substantive, 2 wrong line cites) | **1** | 2 |
| Earlier non-blind grade (2026-10-30) | — | 9/19, high 4/6 (same nine numbers) | 4/19, high 3/6 (same four numbers) |
| Step A wall (s) | 3,790 | 2,556 | 348 |
| Tool calls · thinking chars in step A | 71 · 242k | 156 · 489k | — |
| Compactions in step A · max context per request | 1 · 134.6k | 2 · 135.6k | — |
| Generated tokens in step A (server) | 102,490 | ~200k (179.9k MEASURED + ~20k INFERRED for the capture) | — |
| VRAM at load · peak (MiB) · peak GTT (MiB) | 28,043 · 28,975 · **1,017** | 30,441 · 31,503 · 168 (whole session) | 30,454 · 31,525 · 174 (whole run) |

Provenance: configuration, wall, tool calls, thinking chars, compactions, context, tokens and memory are MEASURED (this run
dir; baselines from `…/delta0-w208/` and `…/heretic/` session files, `gpu_samples.csv` summary lines and `slowness.md`). Every
"found", "real", "wrong" and "false claim" is INFERRED: one Opus 5.5 grader, blind to which config wrote which review, with
evidence quoted per row in `blind-grading/grading-blind.md`. The Opus review is the yardstick, not ground truth.

- **Pre-registered decision rule (fixed before the run):** a difference counts as significant at ≥ 5/19 Opus findings,
  together with ≥ 2/6 high or a precision drop; 3–4 is a grey zone that calls for a second Q4_K_XL rep before a RedHat +
  sharp-template run. **Result: +3 findings, −1 high, precision +1 finding. Grey zone.**
- **The blind grader reproduced both earlier grades exactly.** It matched the same nine Opus numbers for RedHat δ 0 and the
  same four for heretic as the non-blind grading of 2026-10-30. The rubric is stable across graders and days (agreement of
  two INFERRED gradings).
- **The profiles differ.** Q4_K_XL is broader: 5 of 6 lows, two schema edge cases and the max-params warning, all with
  runtime probes. RedHat is stronger on highs (both halves of the import-sort error, #6) and on probe fidelity. Q4_K_XL
  dismissed #6 as a probe artefact, but its probe had re-written the imports instead of copying them (false claim F-Z2).
- **Q4_K_XL did the review with about half the work:** 242k vs 489k thinking chars and 71 vs 156 tool calls. Its template
  differs from RedHat's in one thing: sharp adds a terseness directive to the system prompt of v22.5 (MEASURED diff,
  32 lines). The engine differs too: whether llama.cpp passes effort and thinking kwargs to the template as vLLM does is
  not verified. The difference therefore cannot be assigned to the model.
- **Shared blind spots:** no config found #1, #4, #7 or #11. Under the strict rule none matched #18; all three flagged the
  PATTERN block for a different, real defect.

## Results per Opus finding

Columns: review finding number(s) that matched, or `—`. Mappings from `blind-grading/grading-blind.md` (INFERRED).

| # | sev | Item | Problem (short) | Q4_K_XL | RedHat δ 0 | heretic |
|---|---|---|---|---|---|---|
| 1 | high | D3, D4 (C3, C8) | edited goals can never be confirmed (`w` writes goals.json, not confirmed.json) | — | — | — |
| 2 | high | D2, D3 | the walk duplicates every goal | Z4 | X2 | Y4 (rated med) |
| 3 | high | D4, TESTS | T3 cannot pass: the fake plan has one entry, D4 spawns twice | Z3 (runtime replica of the fake) | X3 | — |
| 4 | high | TESTS | T3 asserts a value calls.jsonl cannot hold (`--value @<tmp>`) | — | — | — |
| 5 | high | TESTS | `'../src/…'` from tests/screens resolves to tests/src | Z1 | X1 | Y1 |
| 6 | high | D2, D4 | import lines fail simple-import-sort (error) | **— (dismissed as a probe artefact, F-Z2)** | X4 + X5 (rated med) | Y2 (D2 half, rated med) |
| 7 | med | D2, D3 | the screen is a prose state machine, M9 cannot run | — | — | — |
| 8 | med | D3 | `r` then Enter writes `''`, the schema refuses, applyResolve throws | — | X10 | — |
| 9 | med | D3 | dropping every goal → `goals: []` refused by `.min(1)` | Z10 | — (reasoned away) | — |
| 10 | med | D4 | applyResolve has 4 params (warn, hidden by `--quiet`) | Z5 (probe: max-params warning) | X11 (rated low) | — |
| 11 | med | ResolveConfirmInput | nobody turns residue rows into `cuts` | — (seen in Compared, not raised) | — | — |
| 12 | med | TESTS | T1/T2 assert order only; `a`, `c`, `q` untested | Z8 + Z13 | — (judged the `a` deferral legitimate) | — |
| 13 | med | STEPS | "T1-T4" vs the defined T1-T3 | Z2 (rated high) | X8 | Y6 (rated low) |
| 14 | low | D2 | `ResolveConfirmInput.record` never read | Z12 | — | — |
| 15 | low | D2, D3 | `goalsChanged`/`nonGoalsChanged` never read | Z12 | X12 | — |
| 16 | low | D3 | `q` from the walk summary leaves a partial walk | Z4 (borderline) | — | — |
| 17 | low | FILES, S1 | package-relative vs repo-root paths | Z9 (rated med) | X13 | — |
| 18 | low | PATTERN | runScreen is the loop; the sibling to copy is clarifyScreen | — (flagged PATTERN for another real defect: Z7) | — (X7) | — (Y5) |
| 19 | low | DO NOT | line 2 is the old text | Z14 | — | — |

Review findings outside the 19 (all INFERRED, evidence in `grading-blind.md`):
- **Q4_K_XL:**
  - Z6, real med: the T1 drift half is vacuous;
  - Z7, real low: PATTERN is not W2-01b's code and returns before writing the last `out`;
  - Z11, real low: the S8 line range misses `ResolutionIr`;
  - Z15, real trivial: STEPS 3 says "one Edit per site" for new files.
- **RedHat δ 0:**
  - X6, real med: the TESTS imports fail lint;
  - X7, real low: PATTERN;
  - X9, real med: the non-goal walk branch is untested;
  - X14, **wrong**: "change the base to de110510"; `tools/` is byte-identical at both commits.
- **heretic:**
  - Y3, real trivial;
  - Y5, real low: PATTERN.

False claims outside findings:
- **Q4_K_XL:**
  - F-Z1: says the wave file names no `a` scenario; `wave-2-dpf-cli.md:64` does;
  - F-Z2: "eslint: none" on D2; its probe had re-written the imports;
  - F-Z3, F-Z4: wrong line cites.
- **RedHat:**
  - F-X1: irSet writes and irValidate refuses; in fact `ir set` validates before writing.
- **heretic:**
  - F-Y1: D2/D4/TESTS called "prose", so no probes were run;
  - F-Y2: "no post-<Id> site".

## What differs between Q4_K_XL and RedHat δ 0

| Change (Q4_K_XL vs RedHat δ 0) | Value | Provenance |
|---|---|---|
| Opus findings | +3 (12 vs 9): +1 med, +3 low, −1 high | INFERRED (grading) |
| Severity-weighted coverage | +2 (22 vs 20); +1 without the borderline #16 | INFERRED |
| Precision | 15/15 vs 13/14 (RedHat has one wrong finding, X14) | INFERRED |
| Substantive false claims | 2 vs 1 | INFERRED |
| Thinking chars in step A | −51 % (242k vs 489k) | MEASURED |
| Tool calls in step A | −55 % (71 vs 156) | MEASURED |
| Generated tokens in step A | about −49 % (102.5k vs ~200k) | MEASURED / partly INFERRED (see table) |
| Wall time in step A | +48 % (3,790 vs 2,556 s) | MEASURED; speed is out of scope, and the power cap differs (210 W now) |

## Consequences & root causes

1. **No demonstrated quality gap, and Q4_K_XL is at least not worse on this task (INFERRED, n = 1 each).**
   - **Observation:** +3 Opus findings and one more correct finding row, against −1 high.
   - **Explanation:** one session per config cannot separate model from run-to-run variation. Under the pre-registered rule
     +3 is grey.
   - **Consequence:** the next measurement is a second Q4_K_XL rep. It measures the noise and is cheaper than a RedHat +
     sharp run. If rep 2 also lands ≥ 12/19, the RedHat + sharp run becomes the right next test.
2. **Q4_K_XL's one high miss is a probe-fidelity failure, not a blind spot (INFERRED).**
   - **Observation:** Z's D2 probe re-wrote the brief's imports as one sorted `import type`, got "eslint: none", and called
     the real import-sort error a probe artefact. The grader re-ran the brief's lines verbatim and got `1:1 error`.
   - **Explanation:** the RUNBOOK's probes only test the brief when they copy it verbatim. RedHat's verbatim probes found
     both halves.
   - **Consequence:** for Q4_K_XL in this workflow, a "probe verbatim" reminder in the RUNBOOK is the cheapest quality lever.
     That is a RUNBOOK change, so it is not part of this measurement.
3. **Breadth with less work, but the template is a confound (MEASURED work counts; attribution INFERRED).**
   - **Observation:** Q4_K_XL covered 12 Opus findings with half the thinking and tool calls.
   - **Explanation:** the sharp template adds a terseness directive to v22.5. Both templates map effort high to xhigh and
     replay old reasoning, which inflated RedHat δ 0's work across the whole session (brief A/B doc, "Chat template and
     effort").
   - **Consequence:** the efficiency gap is what the RedHat + sharp run isolates
     (`campaigns/2026-10-31-redhat-sharp-w208-blind/`, the δ 0 baseline with only `--chat-template` changed).
   - **Result (added 2026-10-31):** RedHat + sharp needed 304k thinking chars and 101 tool calls (vs δ 0's 489k · 156),
     at 11/19 Opus findings, high 4/6. The gap to Q4_K_XL shrinks to −20 % thinking and −30 % tool calls. Most of the
     efficiency edge was the template, not the model (MEASURED counts; attribution INFERRED, n = 1).
4. **Shared blind spots are task- or RUNBOOK-level, not config-level (INFERRED).**
   - **Observation:** #1 (edits never confirmed), #4 (calls.jsonl cannot show the value), #7 (prose state machine) and #11
     (who builds `cuts`) were missed by all three configs.
   - **Explanation:** all four need cross-brief or protocol reasoning (C3/C8, the fake's argv shape, M9's scope, C11 item 6),
     not a probe.
   - **Consequence:** no 27B config here replaces the Opus pass on these classes.
5. **The blind grader is consistent with the earlier grader (MEASURED agreement).** It matched the identical Opus number sets
   for RedHat δ 0 (nine) and heretic (four). This licenses comparing this run's 12/19 with the earlier tables in the brief A/B
   doc. It disagreed on one extra finding: RedHat's "stale base sha" (X14), counted real on 2026-10-30, is wrong.
   `tools/dpf` exists at neither commit, and `git diff --stat 36ffe5b4 de110510 -- tools/` is empty (MEASURED, checked
   2026-10-31). The brief A/B doc is corrected to 13/14.
6. **GTT is about 850 MiB above the vLLM runs (MEASURED; cause OPEN).**
   - **Observation:** peak GTT was 1,017 MiB (p50 976, min 754 from load) against 168/174 MiB for the vLLM baselines.
   - **Explanation:** VRAM peaked at 28,975 of 32,624 MiB, about 3.6 GiB below physical, so this is not a capacity spill.
     The likely cause is the llama.cpp Vulkan backend's host-visible buffers, not verified (INFERRED).
   - **Consequence:** it does not touch quality. It stays OPEN for the throughput track.

## Recommended next step

The rule's next step was a second Q4_K_XL rep. The user chose the RedHat + sharp-template run first:
`campaigns/2026-10-31-redhat-sharp-w208-blind/` (done 2026-10-31, see its `analysis.md`). In the 4-way blind re-grade
there, Q4_K_XL scored 12/19 again (#11 credited via its NEEDS block, #16 no longer; weighted 23) against
RedHat + sharp's 11/19. That is a tie. It is the RedHat δ 0 baseline (Sly 1.8.1, same image digest, δ 0,
DFlash2 k = 7, fp8, 262000, `settings-redhat.json`) with only `--chat-template` changed to this sharp file. The second
Q4_K_XL rep remains the noise check, same campaign: the driver skips rep 1 (done marker) and creates a fresh worktree
`dpf-bench-q4kxl-sharp-r2`.

```
REPS=2 campaigns/2026-10-31-q4kxl-sharp-w208-blind/run.sh
```

Then grade blind again with the same package recipe (`blind-grading/make_blind.py`, rep-2 review + probes added). Server
command line used (llama-swap row, expanded; `${PORT}` is assigned by llama-swap):

```
/home/dev/work/dp-craft/amd/build/latest-vulkan/bin/llama-server -b 1024 -ub 512 --port ${PORT} \
  --model /home/dev/models/gguf/unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf -ctk q8_0 -ctv q8_0 \
  --perf --host 127.0.0.1 -ngl 999 -fa on --jinja --rope-scale 1.0 -tb 12 -t 4 \
  --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0 \
  --chat-template-file /home/dev/.config/llama-swap/templates/sharp-chat_template.jinja \
  --spec-type draft-mtp -c 260000 -np 1 --kv-unified --cache-ram 12288      # env GGML_VK_ALLOW_GRAPHICS_QUEUE=1
```

## Methodology & caveats

**Held equal to the RedHat δ 0 run (MEASURED):**
- dp-forge base `de110510`, with the original RUNBOOK (sha256 `b90c543e…`, the file at the base).
- The same inputs: `heretic/inputs/W2-0{6,7,8}.md` + `progress.md`, with the same path rewrites in the briefs and
  `01-writer-brief.md`, and the same five `node_modules` symlinks. A pre-existing `/tmp/dp-refine` is moved aside.
- The prompt and resume prompt are verbatim from `run_redhat_w208.sh`; the prompt was checked against the δ 0 transcript's
  first user message.
- Claude Code 2.1.312.
- Claude settings are a clone of `settings-redhat.json`. Only `ANTHROPIC_BASE_URL` (:9292), the four model names and
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (260000 vs 262000, to stay under the row's ctx) differ. `AUTO_COMPACT_WINDOW` is 180000 in
  both, and max context per request was 134.6k vs 135.6k.

**Not equal (confounds, listed, not removable at n = 1):**
- weights and quant;
- engine and spec decoding (llama.cpp MTP vs vLLM DFlash2 at δ 0);
- KV q8_0 vs fp8;
- chat template (sharp = v22.5 + a terseness directive);
- session shape (RedHat: a 4.5-min capture plus a resumed call; heretic: after W2-06/07);
- power cap (210 W now; the δ 0 run drew up to 270 W). Speed only.

**Step A boundary:**
- `stop_when` `{"tool_regex": ".", "input_regex": "\"(file_)?path\": \"[^\"]*27b-fix/opus|\\b(cat|sed|head|tail|less|more|grep|rg|awk|diff|nl|bat|python3?|node)\\b[^;&|\\n]*27b-fix/opus/"}`.
- It fired at the `Read` (line 69169), after a `test -f … && wc -c` existence check (line 69118, reveals the size only).
- The review was written at line 17533 (Write) and line 69085 (Edit), both before the boundary, and never after.
- The regex was replayed on the RedHat δ 0 sessions and fires exactly at the known boundary (`session-1.jsonl` line 39106,
  13:43:36Z).

**Attempt 1 quarantined (iron rule 18):**
- Its first regex (`input_regex "review/27b-fix/opus/"`, any tool) fired at 7 min on `test -f …/opus/W2-08.md`, before any
  review was written.
- Status `stopped` was a false result. The run dir was renamed `…-attempt1-falsestop/` with `QUARANTINE.txt`; its worktree
  was removed after collection and its project dir moved into the quarantine dir.

**Blind grading:**
- One Opus 5.5 subagent graded all three reviews with one rubric.
- The package: `blind-grading/pkg/` (reviews, probes, the input brief, the Opus review, `findings-W2-08.tsv`), built by
  `make_blind.py`; key in `key.json`.
- The baselines' probe dirs were collected at the end of their sessions, after the boundary. heretic's dir holds Opus's
  corrected code (`opus-code.ts`). The grader noticed and graded on the review text only. Q4_K_XL's probe dir is the boundary
  state.

**Borderline calls that the ranking rests on** (from the grader):
- Z4 → #16 (without it 11/19);
- PATTERN vs #18 (would add +1 low to every config);
- X6's severity (med; high under the protocol's "lint error = high" would narrow the gap).

**Charts:** none. No tool turns `grades.json` into charts (`report.py` and `make_charts.py` consume probe/capture outputs),
so the tables carry it. Tool gap: a `grades.json` → per-finding heatmap in `bench/lib/report.py`.

**Tool gaps found (iron rule 6):**
1. The llama-swap log follower (`serve_llamaswap.sh start` with `LOG_OUT`) replays llama-swap's history from earlier loads.
   This arm's `server-container.log` holds two earlier loads (lines 1–346: the launcher's stress test and attempt 1); token
   and acceptance counts here use only the segment from the last `llama_server: initializing` (line 347). Fix: start the
   follower without history or record the boundary.
2. The agentic driver does not record `claude --version`; it was recorded by hand in `pre-launch-provenance.txt`.
3. `docs/GUIDE.md` §7 and the CLAUDE.md tool table still describe the agentic kind as vLLM-only.

## Legend

| Term | What it is | In this run | Source |
|---|---|---|---|
| Step A | RUNBOOK `review/27b-fix` step A: blind review `review/W2-08.refine-27b.md`, written before the Opus review is read | ends at the first content read of `27b-fix/opus/W2-08.md` (same definition as `slowness.md`) | RUNBOOK sha256 `b90c543e…` = the file at `de110510` |
| `stop_when` | new `gen_campaign.py` agentic key: a watcher follows the session's stream-json and SIGINTs the session at the first matching tool call; status `stopped` is a result | fired on `Read …/27b-fix/opus/W2-08.md` at 11:21:22Z (`stop_when.txt`, `session-0.jsonl` line 69169) | MEASURED |
| Opus finding #n | numbered rows of the reference review, `opus-reference/findings.tsv` (W2-08: 19) | sev high/med/low from that file | reference |
| matched | review finding = same defect at the same brief item as an Opus finding; same section but another defect = no match | many review findings may map to one Opus finding | `grading-blind.md` |
| real, not in Opus | review finding outside the 19, checked true at `de110510` (file:line or a re-run probe) | | INFERRED |
| wrong | review finding that is false at `de110510` | | INFERRED |
| false claim | factual statement in the review (not a finding row) that is wrong | counted against care, not precision | INFERRED |
| precision | (matched + real) / all review findings | | INFERRED |
| weighted | Opus coverage weighted high 3 · med 2 · low 1, max 38 | | INFERRED |
| blind grading | reviews relabelled X/Y/Z by a seeded shuffle (seed 20261031); worktree paths → `<WT>`; leak scan for model/engine names (none found); grader barred from `bench/runs/`, `campaigns/`, `docs/`, `~/.claude/projects/` and the key | key: X = RedHat δ 0, Y = heretic, Z = Q4_K_XL | `blind-grading/make_blind.py`, `key.json` |
| sharp template | `~/.config/llama-swap/templates/sharp-chat_template.jinja`: `template_version` `qwen3.8-froggeric-v22.5.0`. It is v22.5 (the 1.8.1 image's `/opt/qwen-fixed.jinja`, sha256 `e57684ba…`) plus a TERSENESS directive appended to the system prompt and a tool-protocol guard that is inactive here. `models.yaml` describes it as v22.1, which is outdated. | used as is (the row's `--chat-template-file`) | `server.txt`; `diff` of the two files |
| MTP (llama.cpp) | the GGUF's own MTP head drafts tokens; the target verifies them with its own sampler, so the output distribution does not change | acceptance 66,432 / 108,054 drafted = 61.5 % | MEASURED (server log); "unchanged distribution" INFERRED from the verify-by-sampling design |
| Cactus δ | Sly's lossy acceptance rule for spec decoding; δ 0 = exact | RedHat baseline δ 0; heretic δ 0.5 | brief A/B doc |

