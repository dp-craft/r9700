<!-- meta
date: 2026-10-31 13:55
slug: redhat-sharp-w208-blind
title: RedHat Qwen3.8-27B-MXFP4 δ 0 with the sharp chat template - W2-08 blind review quality, the δ 0 baseline with only --chat-template changed; four-way blind re-grade (Q4_K_XL, RedHat δ 0, RedHat + sharp, heretic)
takeaway: Swapping only the chat template (froggeric v22.5 → sharp = v22.5 + a terseness directive) on the RedHat MXFP4 δ 0 server cut step-A work by about a third (thinking 304k vs 489k chars, 101 vs 156 tool calls, ~144k vs ~200k generated tokens) with no quality loss. Blind-graded at 11/19 Opus findings (high 4/6, 14/14 findings real) vs δ 0's 9/19 (high 4/6, 13/14). +2 is below the pre-registered grey zone, so the gain is not demonstrated, but the loss is ruled out at n = 1. With the template equal, Q4_K_XL vs RedHat is 12 vs 11 findings and 3 vs 4 highs, a tie. The earlier Q4_K_XL efficiency edge is mostly the template (n = 1 per config, one blind grader for all four).
-->

# Benchmark: RedHat Qwen3.8-27B-MXFP4 δ 0 + sharp chat template - W2-08 blind review quality - R9700 (gfx1201)

- **Date:** 2026-10-31, session 12:46:11-13:33:11 local · **Track:** agentic quality (`gen_campaign.py` kind `agentic`,
  `engine: "vllm"` + `stop_when`) · **Write-up:** this file, co-located with `spec.json` / `run.sh` / `README.md`
- **GPU/Host:** Radeon AI PRO R9700 (gfx1201, 32624 MiB), kernel 7.0.0-38-generic. Power state at launch: `power1_cap`
  210 W (default 300 W), `power_dpm_force_performance_level=manual`, profile `POWER_SAVING`
  (`bench/runs/2026-10-31-redhat-sharp-w208-blind/pre-launch-provenance.txt`, 12:42:50).
- **Runtime:** `ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1`, digest `sha256:9b918ac0…850a` (vLLM 0.32.0), profile
  `sly-redhat/redhat-mxfp4-dflash`, `RADIANCE_CACTUS_DELTA=0`. Claude Code 2.1.312. Source: `rep1/redhat-d0-sharp/server.txt`.
- **Model:** `RedHatAI/Qwen3.8-27B-MXFP4@16a86728` + draft `syvai/Qwen3.8-27B-DFlash2-W4A16@4d30ec73`. Both are the same as
  the δ 0 baseline.
- **Chat template:** `campaigns/2026-10-31-redhat-sharp-w208-blind/sharp-chat_template.jinja`, sha256 `cdff39fb…a84a`
  (a copy of `~/.config/llama-swap/templates/sharp-chat_template.jinja`, the same file the Q4_K_XL run used). It is mounted at
  `/templates/sharp-chat_template.jinja`, and the container checks are in `server-info.txt`.
- **Data:** `bench/runs/2026-10-31-redhat-sharp-w208-blind/` (run, `blind-grading/`)
- **Baselines (earlier runs, not re-run):**
  - RedHat δ 0 and heretic W2-08: `bench/runs/2026-10-30-0947-dpf-brief-ab/`, written up in
    `docs/analysis/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md`.
  - Q4_K_XL: `campaigns/2026-10-31-q4kxl-sharp-w208-blind/analysis.md`.
- **Question:** how much does the chat template alone change RedHat's review? The δ 0 baseline is held fixed and only
  `--chat-template` is swapped to sharp. Quality only; speed is out of scope.
- **Answer (short):** it reduces the work by about a third without a measurable quality loss. +2 Opus findings is within
  noise. The earlier Q4_K_XL vs RedHat gap shrinks to a tie once both use the same template.

## Summary

| W2-08, step A (blind review), 19 Opus findings: 6 high · 7 med · 6 low | **RedHat + sharp (this run)** | RedHat δ 0 | Q4_K_XL + sharp | heretic |
|---|---|---|---|---|
| Weights | `RedHatAI/Qwen3.8-27B-MXFP4` | same | unsloth UD-Q4_K_XL GGUF | `Swift-1.5-…-heretic-MXFP4-GPTQ` |
| Engine · spec decoding | vLLM 0.32.0 (Sly 1.8.1) · DFlash2 k = 7, δ 0 | same | llama.cpp b11448 Vulkan (llama-swap) · MTP head | vLLM 0.32.0 (Sly 1.8.1) · DFlash2 k = 7, δ 0.5 |
| KV · window | fp8 · 262000 | same | q8_0 · 260000 | fp8 · 262000 |
| Chat template | **sharp** (v22.5.0 + TERSENESS directive) | froggeric v22.5 | **sharp** | froggeric v22.5 |
| Session shape | 1 call, fresh context | 4.5-min capture + 1 resumed call | 1 call, fresh context | W2-08 after W2-06 and W2-07 |
| **Opus findings found (blind, 4-way)** | **11/19** | 9/19 | **12/19** | 4/19 |
| high · med · low | **4/6** · 3/7 · 4/6 | **4/6** · 3/7 · 2/6 | 3/6 · **5/7** · 4/6 | 3/6 · 1/7 · 0/6 |
| Severity-weighted (3/2/1, max 38) | 22 | 20 | **23** | 11 |
| Findings: total · matched · real, not in Opus · wrong | 14 · 11 · 3 · **0** | 14 · 11 · 2 · 1 | 16 · 13 · 3 · **0** | 6 · 4 · 2 · 0 |
| Precision (matched + real) / total | **14/14** | 13/14 | **16/16** | 6/6 |
| False claims: all · substantive | 2 · 1 | 1 · **0** | 3 · 2 | 2 · 2 |
| Same config in the 3-way grade (earlier today) | — (new) | 9/19, same nine numbers | 12/19, #16 in place of #11 | 4/19, same four numbers |
| Step A wall (s) | 2,820 | 2,556 | 3,790 | 348 |
| Tool calls · thinking chars in step A | **101 · 304k** | 156 · 489k | 71 · 242k | — |
| Compactions · max context per request | 2 · 135.7k | 2 · 135.6k | 1 · 134.6k | — |
| Generated tokens in step A (server) | **~144.4k** | ~200k (179.9k MEASURED + ~20k INFERRED for the capture) | 102,490 | — |
| VRAM at load · peak (MiB) · peak GTT (MiB) | 30,884 · 32,057 · 261 | 30,441 · 31,503 · 168 | 28,043 · 28,975 · **1,017** | 30,454 · 31,525 · 174 |

Provenance: configuration, wall, tool calls, thinking chars, compactions, context, tokens and memory are MEASURED (this run
dir; baselines as cited in the Q4_K_XL analysis). The tool-call and thinking-char counts cover the session up to the step-A
boundary. Server tokens are vLLM's 10 s `Avg generation throughput` windows × 10 s, the same method as `slowness.md`. Every
"found", "real", "wrong" and "false claim" is INFERRED. One Opus 5.5 grader, blind to which config wrote which review,
graded all four reviews in one pass (labels W/X/Y/Z, a fresh shuffle), with evidence quoted per row in
`blind-grading/grading-blind.md`. The Opus review is the yardstick, not ground truth.

- **Template effect (this run vs RedHat δ 0, only `--chat-template` differs in the server argv): quality the same or
  better, work −35 to −38 %.**
  - +2 Opus findings: it gained #12, #16 and #19 and lost #8.
  - Highs are equal at 4/6.
  - +1 correct finding row (14/14 vs 13/14).
  - Thinking −38 %, tool calls −35 %, server-generated tokens about −28 %.
- **Pre-registered decision rule:** significant at ≥ 5/19 together with ≥ 2/6 high or a precision drop; 3–4 is a grey zone.
  **Result: +2, highs ±0, precision +1 row. Not significant.** This is below the grey zone, so the template's quality gain is
  not demonstrated. A quality loss from the terseness directive is not seen either.
- **Model + engine effect with the template held equal (Q4_K_XL vs RedHat + sharp): a tie.**
  - Findings 12 vs 11, highs 3 vs 4, weighted 23 vs 22.
  - Wrong findings 0 vs 0, substantive false claims 2 vs 1.
  - The work gap shrinks from −51 % to −20 % in thinking chars (242k vs 304k) and from −55 % to −30 % in tool calls
    (71 vs 101).
  - So most of Q4_K_XL's earlier efficiency edge over RedHat δ 0 came from the template, not the model (INFERRED, n = 1).
- **Test-retest of the grading (two blind graders on the same three reviews, MEASURED agreement):**
  - RedHat δ 0 got the same nine Opus numbers in both blind grades and in the non-blind 2026-10-30 grade, three times in all.
    heretic got the same four numbers every time.
  - Q4_K_XL got 12/19 both times. One borderline credit swapped: #16 (a summary `q` leaves a partial walk, low) out and
    #11 (residue rows → `cuts` have no owner, med) in, via Z's "Cross-row NEEDS" block. That is why its weighted score
    moved 22 → 23.
  - Grader noise on this rubric is therefore about ±1 finding on the borderline credits.
- **Shared blind spots across all four configs:**
  - #1: an edit never writes `confirmed.json`, so the step pauses again (high).
  - #4: T3 asserts a value `calls.jsonl` never holds (high).
  - #7: the screen's state machine is prose, so M9 cannot run (med).
  - #18: under the strict matching rule; all four flagged PATTERN for a different, real defect.

## Legend

| Term | What it is | In this run | Source |
|---|---|---|---|
| Step A | RUNBOOK `review/27b-fix` step A: blind review `review/W2-08.refine-27b.md`, written before the Opus review is read | ends at the first content read of `27b-fix/opus/W2-08.md` | RUNBOOK sha256 `b90c543e…` = the file at `de110510` |
| `stop_when` | `gen_campaign.py` agentic key: a watcher follows the session's stream-json and SIGINTs the session at the first matching tool call; status `stopped` is a result | fired on `Read …/27b-fix/opus/W2-08.md` at 12:33:11Z (`stop_when.txt`, `session-0.jsonl` line 27272) | MEASURED |
| Opus finding #n | numbered rows of the reference review, `opus-reference/findings.tsv` (W2-08: 19) | sev high/med/low from that file | reference |
| matched | review finding = same defect at the same brief item as an Opus finding; same section but another defect = no match | many review findings may map to one Opus finding | `grading-blind.md` |
| real, not in Opus | review finding outside the 19, checked true at `de110510` (file:line or a re-run probe) | | INFERRED |
| wrong | review finding that is false at `de110510` | | INFERRED |
| false claim | factual statement in the review (not a finding row) that is wrong; substantive = it changes a conclusion, minor = a wrong line cite | counted apart from precision | INFERRED |
| precision | (matched + real) / all review findings | | INFERRED |
| weighted | Opus coverage weighted high 3 · med 2 · low 1, max 38 | | INFERRED |
| blind grading (4-way) | reviews relabelled W/X/Y/Z by a seeded shuffle (`BLIND_SEED=7311`); worktree paths → `<WT>`; leak scan for model/engine names (none found); grader barred from `bench/runs/`, `campaigns/`, `docs/`, `~/.claude/projects/`, other scratchpad dirs and the key | key: W = RedHat δ 0, X = RedHat + sharp, Y = heretic, Z = Q4_K_XL | `blind-grading/make_blind.py`, `key.json`, `grader-prompt.md` |
| sharp template | `template_version` `qwen3.8-froggeric-v22.5.0`: v22.5 (the 1.8.1 image's `/opt/qwen-fixed.jinja`, sha256 `e57684ba…`) plus a TERSENESS directive appended to the system prompt (kwarg `terse`, default true) and a tool-protocol guard that is inactive here. Tool format, effort high → xhigh mapping and reasoning replay are unchanged | `--chat-template /templates/sharp-chat_template.jinja` | MEASURED (`diff`, container `sha256sum`) |
| froggeric v22.5 | the template baked into the Sly 1.8.1 image (`/opt/qwen-fixed.jinja`), used by the δ 0 baseline | baseline only | `server-info.txt` |
| Cactus δ | Sly's lossy acceptance rule for spec decoding; δ 0 = exact | δ 0 (`-e RADIANCE_CACTUS_DELTA=0` in `docker_argv`) | `server.txt` |
| DFlash2 k = 7 | diffusion-style draft model proposing 7 tokens per step, verified by the target | draft acceptance 102,449 / 294,084 drafted = 34.8 % in step A | MEASURED (vLLM SpecDecoding windows) |

## Results per Opus finding

Columns: review finding number(s) that matched, or `—`. Mappings from `blind-grading/grading-blind.md` (INFERRED). Review
labels are the 4-way blind labels (X = RedHat + sharp, W = RedHat δ 0, Z = Q4_K_XL, Y = heretic).

| # | sev | Item | Problem (short) | RedHat + sharp | RedHat δ 0 | Q4_K_XL | heretic |
|---|---|---|---|---|---|---|---|
| 1 | high | D3, D4 (C3, C8) | edited goals can never be confirmed (`w` writes goals.json, not confirmed.json) | — | — | — | — |
| 2 | high | D2, D3 | the walk duplicates every goal | F3 | W2 | Z4 | Y4 (rated med) |
| 3 | high | D4, TESTS | T3 cannot pass: the fake plan has one entry, D4 spawns twice | F2 | W3 | Z3 | — |
| 4 | high | TESTS | T3 asserts a value calls.jsonl cannot hold | — | — | — | — |
| 5 | high | TESTS | `'../src/…'` from tests/screens resolves to tests/src | F1 | W1 | Z1 | Y1 |
| 6 | high | D2, D4 | import lines fail simple-import-sort (error) | F8 (rated low; its own text says "error; not hidden by `--quiet`") | W4 + W5 + W6 (rated med) | — (dismissed as a probe artefact) | Y2 (rated med; the fix still errors) |
| 7 | med | D2, D3 | the screen is a prose state machine, M9 cannot run | — | — | — | — (argued the opposite) |
| 8 | med | D3 | `r` then Enter writes `''`, the schema refuses | — | W10 | — | — |
| 9 | med | D3 | dropping every goal → `goals: []` refused by `.min(1)` | — | — (dismissed) | Z10 | — |
| 10 | med | D4 | applyResolve has 4 params (warn, hidden by `--quiet`) | F14 (weak: recommends "no change", against M9) | W11 (rated low) | Z5 | — |
| 11 | med | ResolveConfirmInput | nobody turns residue rows into `cuts` | — | — | Z "Cross-row NEEDS" block (partial) | — |
| 12 | med | TESTS | T1/T2 assert order only; `a`, `c`, `q` untested | F13 (partial: `c`/`q`, rated low) | — | Z6 + Z8 + Z13 | — |
| 13 | med | STEPS | "T1-T4" vs the defined T1-T3 | F7 (rated low) | W8 | Z2 (rated high) | Y6 (rated low) |
| 14 | low | D2 | `ResolveConfirmInput.record` never read | — | — | Z12 | — |
| 15 | low | D2, D3 | `goalsChanged`/`nonGoalsChanged` never read | F10 | W12 | Z12 | — |
| 16 | low | D3 | `q` from the walk summary leaves a partial walk | **F6** (only config; rated med) | — | — | — |
| 17 | low | FILES, S1 | package-relative vs repo-root paths | F9 | W13 | Z9 (rated med) | — |
| 18 | low | PATTERN | runScreen is the loop; the sibling to copy is clarifyScreen | — (F5: another real defect) | — (W7) | — (Z7) | — (Y5) |
| 19 | low | DO NOT | line 2 is the old text | F12 | — | Z14 | — |

Review findings outside the 19 (all INFERRED, evidence in `grading-blind.md`):
- **RedHat + sharp:**
  - F4, real low: the irSet/irValidate objects omit `cli` (W2-05.md:43-44). tsc catches it at STEP 5.
  - F5, real low: PATTERN is not W2-01b verbatim.
  - F11, real trivial: the S8 range stops at :176, but `ResolutionIr` is at resolution.ts:177.
- **RedHat δ 0:**
  - W7, real low: PATTERN.
  - W9, real med: the non-goal walk branch and the `$.nonGoals` write are never exercised by T3.
  - W14, **wrong**: "change the base to de110510". `tools/` is identical at both commits.
- **Q4_K_XL:**
  - Z7, real low: PATTERN; the result is returned before its `out` is written.
  - Z11, real trivial: the S8 range.
  - Z15, real trivial: STEPS 3 drops "one Write per new file".
- **heretic:**
  - Y3, real low: `cli` missing.
  - Y5, real low: PATTERN.

False claims outside findings:
- **RedHat + sharp:**
  - P3, substantive (an evidence artefact): the PATTERN fails tsc with "Cannot find name 'Screen'". The probe held only brief
    lines 29-39; `Screen` is defined at :28.
  - Minor: a wrong line cite for the DO NOT template line.
- **RedHat δ 0:** minor only, two wrong line cites in W2-04.
- **Q4_K_XL:**
  - Substantive: D2 "eslint: none"; its probe did not contain the brief's imports.
  - Substantive: "the wave file names no `a` scenario"; `wave-2-dpf-cli.md:64` does.
  - Minor: wrong line cites.
- **heretic:**
  - Substantive: D2/D4/TESTS called "prose", so it ran no probes.
  - Substantive: "no post-<Id> site, so M1 does not apply".

The δ 0 review's false claim from the 3-way grade (F-X1, irSet writes and irValidate refuses) was not repeated by the
4-way grader. Its substantive count is 0 here and 1 there, which is grader variance on one judgement call.

## What the template changed (RedHat + sharp vs RedHat δ 0)

Server argv identical except `--chat-template` and its `-v` mount (MEASURED: `diff` of the δ 0 run's recorded
`docker run` argv, started 2026-10-30T12:57:01Z, against this run's `serve_vllm.sh print` argv; same image digest, same
`docker run -e` env). Claude settings identical (`settings-redhat.json`). Session shape differs (see caveats).

| Change | Value | Provenance |
|---|---|---|
| Opus findings | +2 (11 vs 9): +2 low (#16, #19), med swap (+#12 partial, −#8), highs ±0 (4 vs 4) | INFERRED (grading) |
| Severity-weighted coverage | +2 (22 vs 20) | INFERRED |
| Precision | 14/14 vs 13/14 (δ 0 has the wrong base-sha finding) | INFERRED |
| Substantive false claims | 1 vs 0 | INFERRED |
| Severity calibration | worse: the import-sort error (#6) is rated low, though the review's own text says "error"; #10 is credited with "no change" | INFERRED (grader judgement) |
| Thinking chars in step A | **−38 %** (304k vs 489k) | MEASURED |
| Tool calls in step A | **−35 %** (101 vs 156) | MEASURED |
| Server-generated tokens in step A | about −28 % (144.4k vs ~200k) | MEASURED / partly INFERRED (baseline capture) |
| Compactions · max context | 2 vs 2 · 135.7k vs 135.6k | MEASURED |
| Wall time in step A | +10 % (2,820 vs 2,556 s) | MEASURED; speed is out of scope, and the cap was 210 W here (the δ 0 run drew up to 270 W) |
| Draft acceptance (DFlash2) | 34.8 % in step A | MEASURED; baseline not recomputed for step A |

## Consequences & root causes

1. **The terseness directive cuts work without measurable quality loss (MEASURED work; quality INFERRED, n = 1).**
   - **Observation:** with only the template swapped, RedHat thought 38 % less and made 35 % fewer tool calls. Its review
     covered the same four highs and two more lows, and had no wrong finding.
   - **Explanation:** sharp is v22.5 plus a TERSENESS block appended to the system prompt. The effort mapping (high →
     xhigh) and the reasoning replay are unchanged, so the drop comes from the directive itself (INFERRED from the
     32-line `diff`; the replay inflation documented in the brief A/B doc, "Chat template and effort", is still there).
   - **Consequence:** for RedHat on this RUNBOOK the sharp template is at least as good on quality and clearly cheaper.
     It is a candidate default for `sly-redhat` reviews. Adopting it is a config change for the user to decide (keep the
     current template restorable, as agreed). n = 1 cannot exclude that the +2 is noise or that a rep lands lower.
2. **With the template equal, Q4_K_XL and RedHat are not separable (INFERRED, n = 1 each).**
   - **Observation:** findings 12 vs 11, highs 3 vs 4, weighted 23 vs 22. The grader rates them "too close to separate".
     The work gap fell from −51 %/−55 % (thinking/tool calls vs δ 0) to −20 %/−30 % (vs RedHat + sharp).
   - **Explanation:** most of what looked like a Q4_K_XL efficiency advantage was the template. The remainder spans
     weights, engine (llama.cpp MTP vs vLLM DFlash2), KV (q8_0 vs fp8) and, possibly, how each engine passes thinking kwargs
     to the template (not verified for llama.cpp).
   - **Consequence:** on quality alone this task gives no reason to prefer one model. The profiles still differ. RedHat
     verifies imports more faithfully (#6 found by both RedHat configs, missed and denied by Q4_K_XL). Q4_K_XL reaches more
     runtime and design edges (#9, #11, #14).
3. **The terseness came with weaker severity calibration (INFERRED, one grader).**
   - **Observation:** RedHat + sharp rated the import-sort *error* low, #13 low and #10 "no change". δ 0 rated #6 med and
     split it per code block.
   - **Explanation:** a review that has to be shorter compresses its severity reasoning. This is plausible but not shown;
     one review cannot separate it from sampling noise.
   - **Consequence:** if the sharp template is adopted for reviews, the fix step (RUNBOOK C) should re-rate severities
     against the check method (M9: "compiles and lints with no output"). A lint error is not low under M9.
4. **Grading noise is about ±1 finding, on borderline credits (MEASURED agreement between two blind graders).**
   - **Observation:** across the 3-way and 4-way grades, three reviews were graded twice. δ 0 and heretic got identical
     Opus sets. Q4_K_XL kept 12/19 with one borderline swap (#16 ↔ #11).
   - **Consequence:** differences of ±1–2 findings between configs are inside the grader's own noise. The pre-registered
     ≥ 5 threshold is not too strict for this rubric.
5. **Shared blind spots are task- or RUNBOOK-level (INFERRED).** #1, #4 and #7 were missed by all four configs (two
   templates, two engines, three weight sets). All three need cross-brief or protocol reasoning (C3/C8 confirmation flow,
   the fake's argv shape, M9 scope), not a probe. No 27B config here replaces the Opus pass on these classes.
6. **Memory: VRAM peak 32,057 MiB is 567 MiB below physical; GTT peak 261 MiB (MEASURED).**
   - **Observation:** this is 93 MiB higher than the δ 0 run's GTT (168). The load was 30,884 vs 30,441 MiB, the same
     `--gpu-memory-utilization 0.93`.
   - **Explanation:** the +443 MiB at load is the same profile on a different day. The likely cause is the desktop's VRAM
     share at launch, not checked (INFERRED). GTT stays near the idle baseline, so there is no spill.
   - **Consequence:** none for quality.

## Recommended next step

1. **Noise check (cheapest, highest information): a second rep of RedHat + sharp** (`REPS=2
   campaigns/2026-10-31-redhat-sharp-w208-blind/run.sh`, fresh worktree `dpf-bench-redhat-d0-sharp-r2`). Grade it blind
   together with rep 1, so the same grader sees both. If rep 2 also lands at ≥ 9/19 with 4/6 highs, the "no quality loss"
   claim is supported by two runs. The second Q4_K_XL rep (still open) is the same check for that config.
2. **Adoption (user's decision):** `sly-redhat/redhat-mxfp4-dflash` with `CHAT_TEMPLATE=` pointing at the sharp file, the
   v22.5 default kept as is. Server argv used:

```
docker run … -e RADIANCE_CACTUS_DELTA=0 … \
  -v /home/dev/work/dp-craft/amd/campaigns/2026-10-31-redhat-sharp-w208-blind/sharp-chat_template.jinja:/templates/sharp-chat_template.jinja:ro \
  ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 --model /model --served-model-name qwen38-27b-redhat-mxfp4-dflash \
  --max-model-len 262000 --speculative-config.method dflash --speculative-config.model /draft \
  --speculative-config.num_speculative_tokens 7 --speculative-config.draft_sample_method probabilistic \
  --max-num-seqs 1 --gpu-memory-utilization 0.93 --kv-cache-dtype fp8 … --tool-call-parser qwen3_xml \
  --reasoning-parser qwen3 --chat-template /templates/sharp-chat_template.jinja \
  --default-chat-template-kwargs '{"enable_thinking": true}' \
  --override-generation-config '{"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0.0, "presence_penalty": 0.0}'
# launcher form:
PROFILE=sly-redhat/redhat-mxfp4-dflash IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 PORT=8000 \
  MAXLEN=262000 MAXSEQS=1 KV_DTYPE=fp8 GPU_UTIL=0.93 CACTUS_DELTA=0 \
  CHAT_TEMPLATE=/home/dev/work/dp-craft/amd/campaigns/2026-10-31-redhat-sharp-w208-blind/sharp-chat_template.jinja \
  bench/engine-bench/vllm/serve_vllm.sh start
```

(full argv: `bench/runs/2026-10-31-redhat-sharp-w208-blind/rep1/redhat-d0-sharp/server.txt`)

## Methodology & caveats

**Held equal to the RedHat δ 0 run (MEASURED):**
- The image digest, model and draft dirs, `docker run` env (`RADIANCE_*`, including δ 0) and vLLM argv, except
  `--chat-template` and the template's `-v` mount. The argv diff was run before launch (δ 0's recorded `docker run` argv vs
  this run's), and the container's `/proc/1/cmdline` is in `server-info.txt`.
- dp-forge base `de110510` with the original RUNBOOK; the same inputs (`heretic/inputs/W2-0{6,7,8}.md` + `progress.md`);
  the same path rewrites and `node_modules` symlinks; the same prompt; Claude Code 2.1.312; `settings-redhat.json` itself
  (not a clone).
- `AUTO_COMPACT_WINDOW` 180000. Max context per request was 135.7k vs 135.6k.

**Not equal (confounds, listed):**
- **Session shape:** this run is one fresh call. δ 0 was a 4.5-min capture, then a resumed call. The same shape as the
  Q4_K_XL run, so the Q4_K_XL vs RedHat + sharp comparison is shape-matched. The template comparison is not.
- **Power cap:** 210 W here (21 of 1,332 samples > 210 W, peak 265 W instantaneous). The δ 0 run drew up to 270 W. This
  affects speed only.
- **n = 1 per config.** The 4-way grade is one grader; the grader-to-grader agreement is measured above (consequence 4).

**Step A boundary:**
- `stop_when` regex is the same as the Q4_K_XL spec
  (`"(file_)?path": "[^"]*27b-fix/opus|\b(cat|sed|head|tail|less|more|grep|rg|awk|diff|nl|bat|python3?|node)\b[^;&|\n]*27b-fix/opus/`).
- It fired at the `Read` on `session-0.jsonl` line 27272 (rc 137, status `stopped`, a result).
- The review was written once (Write, line 27194) before the boundary and never edited after.
- Earlier commands that mention the opus path do not read its content:
  - line 1090 is a `grep` that excludes it, with no opus lines in the result;
  - line 1550 is an `ls` of the directory;
  - lines 27231/27242/27262 are `test -f` / `wc -c` / `wc -l` (size only).

**Blind grading:**
- One Opus 5.5 subagent graded all four reviews with one rubric (`blind-grading/grader-prompt.md`).
- The package is `blind-grading/pkg/` (reviews, probes, the input brief, the Opus review, `findings-W2-08.tsv`), built by
  `make_blind.py` with 4 labels and `BLIND_SEED=7311`. The key is in `key.json`.
- The baselines' probe dirs were collected at the end of their sessions, after the boundary. The δ 0 dir may hold
  post-boundary files. This run's and Q4_K_XL's probe dirs are boundary state.

**Borderline calls the ranking rests on** (from the grader):
- Z's NEEDS block → #11 (without it Q4_K_XL 21, and RedHat + sharp ranks first).
- X F14 → #10 with a "no change" fix (without it RedHat + sharp 20, tied with δ 0).
- PATTERN vs #18 (would add +1 low to every config; no rank change).

**Charts:** none. No tool turns `grades.json` into charts (open tool gap, see the Q4_K_XL analysis), so the tables carry it.

**Housekeeping:**
- The run's worktree `/home/dev/work/dippe/dpf-bench-redhat-d0-sharp-r1` is kept, as is
  `/home/dev/work/dippe/dpf-bench-q4kxl-sharp-r1`. Outputs are collected; the driver keeps worktrees by design.
- The server was stopped by the driver: port 8000 is free, and VRAM was 1,095 MiB used at write-up.
