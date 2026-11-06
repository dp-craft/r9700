<!-- meta
date: 2026-10-30 15:52
slug: dpf-brief-fix-heretic-vs-redhat
title: dp-forge brief review+fix (W2-06..08) - Swift-1.5 heretic vs RedHat MXFP4 (DFlash2, Sly 1.8.1 and 1.9.1) vs Opus, and the Cactus loop fix
takeaway: On an agentic brief review+fix task, RedHat MXFP4 failed at Sly's default Cactus δ 0.5 (9 runaway thinking loops, 0/3 briefs in 3 h) because the lossy spec-decode acceptance locks in repetition; with CACTUS_DELTA=0 it ran W2-08 loop-free and out-reviewed heretic (9/19 vs 4/19 Opus findings blind, 2 reasoned rejections, own lint-clean fix) at 29-38 % slower decode and ~9x the time (6.8x the generated tokens x 1.35x slower decode, plus 6 compactions fed by the template's reasoning replay; not context size, not literal repetition). Rerun on Sly 1.9.1 (δ 0.5 + fade/cap, template v22.5-sly2 that drops old reasoning, budget RUNBOOK): W2-08 in 87 min (-22 %), 2 compactions instead of 6, decode 102 tok/s, all 6 high Opus findings fixed with a clean probe - but the blind review collapsed to 1/19 (no probes) and 3 decision loops returned (one to the output cap); the template alone cuts prompt tokens 25 % (calculated on the δ 0 session). Added 2026-10-31: unsloth Q4_K_XL on llama-swap (sharp template) found 12/19 blind (high 3/6) vs RedHat δ 0's 9/19 (4/6) under one blind re-grade - grey zone at n = 1; the re-grade also turned one RedHat δ 0 extra finding to wrong (precision 13/14). Then RedHat δ 0 with only the chat template swapped to sharp: 11/19 (high 4/6, 14/14) with 38 % less thinking and 35 % fewer tool calls - no quality loss, +2 not significant; template held equal, Q4_K_XL vs RedHat is a tie (12 vs 11, 4-way blind grade).
-->

# dp-forge brief review + fix: Swift-1.5 heretic vs RedHat MXFP4 vs Opus, and the Cactus loop fix

- **Date:** 2026-10-30 · **Track:** agentic quality (one-off driver, see "Method") · **Card:** Radeon AI PRO R9700 (gfx1201, 32 GB)
- **Question:** run the same dp-forge brief review+fix task (RUNBOOK `review/27b-fix`, briefs W2-06/07/08) with the
  Swift-1.5 heretic model and the RedHat MXFP4 model, and compare them with each other and with the Opus reviews.
- **Answer (short):** at the Sly default (`RADIANCE_CACTUS_DELTA=0.5`) RedHat is unusable for this task: it loops. With
  `CACTUS_DELTA=0` the loops are gone and RedHat is the better reviewer of the two on W2-08. That costs decode speed and a
  lot of wall time. Heretic is fast and finishes, but finds less and mostly copies Opus's code in the fix.
  On Sly 1.9.1 (δ 0.5 + fade/cap, template `v22.5-sly2`, budget RUNBOOK) RedHat finished W2-08 22 % faster, with a
  good fix, but a collapsed blind review (1/19) and short decision loops; see "RedHat on Sly 1.9.1".

## Summary

Run key (the first five rows are the configuration; everything not listed is identical: DFlash2 k = 7, fp8 KV, window
262000, MAXSEQS 1, util 0.93, Claude Code effort `high`, which both templates turn into `xhigh`):

| W2-08 (19 Opus findings, 6 high) unless noted | heretic | RedHat | RedHat | **RedHat (new)** |
|---|---|---|---|---|
| Server image | Sly 1.8.1 | Sly 1.8.1 | Sly 1.8.1 | **Sly 1.9.1** |
| Cactus (spec-decode acceptance) | δ 0.5 (1.8.1 has no fade/cap) | δ 0.5 | **δ 0** | δ 0.5 + fade 4096→16384 out tok + cap R 0.5 (code defaults) |
| Chat template | `v22.5`: replays every old reasoning block | `v22.5` | `v22.5` | **`v22.5-sly2`**: newest step's reasoning only |
| RUNBOOK | original | original | original | **budget** (§ 0b + anti-loop line, `sly191-w208/RUNBOOK.diff`) |
| Briefs in the prompt | W2-06/07/08 | W2-06/07/08 | W2-08 | W2-08 |
| Finished | all 3 briefs, 41 min | **0/3**, 3 h cap | W2-08, ~111 min | W2-08, **87 min** (1 call) |
| Blind review: Opus findings found | 4/19, high 3/6 (all briefs: 11/39, high 6/10) | not reached (W2-06: 3/9) | **9/19, high 4/6** | **1/19, high 1/6** (0 probes in A) |
| Findings real (precision) | 6/6 on W2-08 (4 = Opus findings, 2 own; all briefs 19/20) | 3/3 (W2-06) | **13/14** (10 rows = 9 Opus findings, 3 own real, 1 wrong; corrected 2026-10-31, see "Blind review") | 1/1 |
| Compare: own checking before agreeing with Opus | accepted all 19 | accepted all 9 (W2-06), 0 tool calls | **~30 tool calls; rejected 2 with reasons** (O7, O18) | 7 tool calls; rejected 3: O18 defensible, **O12 and O19 wrong** |
| Fix: Opus findings in the fixed brief | — (not graded per row) | — | 20/20 of its real findings | 15/19 + 2 partial, all 6 high; O7 open (the code stayed in the probe) |
| Fix: Opus code reused (unchanged brief: 9 %) | **67 %** | — | 21 % (own design) | 12 % |
| Fix: lint of the final probe | its own extraction did not parse; it linted Opus's code | W2-06 probe: 5 errors | **0 errors**, 1 warn; tsc clean | 0 errors, 0 warn; tsc exit 0 (re-run by the grader) |
| Runaway thinking blocks (> 100k chars) | 1 (whole run) | **9** | **0** | 2: 106k (not repetitive) + **241k loop to the output cap** |
| Loop windows (acceptance ≥ 7 of 8) | 1 of 71 (1.4 %) on W2-08; 38 of 245 whole run | **777 of 1,067 (72.8 %)** | 7 of 650 (1.1 %) | 58 of 514 (11.3 %) |
| Compactions OK · failed | 2 · 0 | 3 · **15** | 6 · 0 | **2 · 0** |
| Decode tok/s, non-loop windows | 102.9 | 113.2 | **70.4 / 80.1** (part 1 / 2); 74.5 whole | **102.0** |
| Generated tokens, server | 72k (W2-08) | 1.6M (whole run) | **490k** | 567k |
| Prompt tokens sent, whole W2-08 session | 4.2M | — | 19.0M | 15.0M (32.1M with template `v22.5`, INFERRED) |
| Context per request, median · max | 103k · 134k (W2-08) | **223k · 239k** (whole run) | 90k · 136k | 88k · 132k |
| Time on W2-08 | ~12 min | — | ~111 min (104 min of session time) | **87 min** |

All counts and speeds are MEASURED from the run dir (`bench/runs/2026-10-30-0947-dpf-brief-ab/`). "Found", "real" and
"rejected with reasons" are INFERRED: graded by Opus 5.5 against the Opus reviews and the code, evidence quoted per row in
`*/grading.md`. The Opus reviews are the reference, not ground truth. A "window" is one 10-s row of the vLLM log with
generation > 5 tok/s. The new column changes four things at once (image, Cactus, template, RUNBOOK): its speed and
token rows can be split by mechanism (see "RedHat on Sly 1.9.1" below), its quality rows cannot.

- **Loop cause.** Every runaway block, in both models, coincides with the server's mean spec-decode acceptance length
  pinned at 7.8–8.0 of a maximum 8, vs 4.5–5.5 normally (MEASURED, `*/server-container.log`). The Sly Cactus acceptance
  rule (δ 0.5) is lossy: it changes the sampled distribution (MEASURED in the image's `rejection_sampler_utils.py`). Sly
  #164 reports exactly this repetition lock-in, with `CACTUS_DELTA=0` as the workaround (CLAIMED). In the δ 0.5 RedHat run
  **73 % of all decode windows (777 of 1,067) were loop windows**.
- **The fix works on this task (INFERRED, n = 1).** With `CACTUS_DELTA=0` RedHat ran 111 min of the same kind of work with
  0 runaway blocks, 0 output-cap hits, 0 failed compactions, and 7 of 623 windows ≥ 7 (all during code copying, no long
  block). The δ 0.5 run's rate (~3 loops/h) predicts ~5 in that time.
- **Its cost.** Acceptance falls to 3.4–3.7 and decode to 70.4–80.1 tok/s, about −29 to −38 % vs the δ 0.5 non-loop windows (INFERRED:
  different content and depth). RedHat δ 0 also does far more work: ~7× heretic's thinking and ~4.8× its tool calls on
  W2-08. Together that is ~9× heretic's time.
- **Why it is slow (MEASURED, "Why RedHat δ 0 is slow" below).** The slowdown is 6.8× the generated tokens decoded 1.35×
  slower. The extra tokens come from ~4.8× the steps, ~1.4× the thinking per step, and 6 compactions (21 min).
  It is not context size (the median request is smaller) and not literal repetition (thinking lines are as distinct as
  heretic's). Both models get the same template, and it amplifies thinking: it maps effort high to xhigh and replays every
  old reasoning block into the next prompt.
- **Rule compliance explains most of the extra steps (MEASURED, "Rule compliance" below).** Heretic skipped the
  RUNBOOK's most expensive required work: the blind derivation, the probes in A, checking every Opus row, and per-block
  probes in C. RedHat δ 0 did all of it. That work is also where RedHat's quality edge comes from. No rule bounds the
  work.
- **The quality gap is in judgement, not just recall.** RedHat δ 0 checked Opus's claims before agreeing, rejected two,
  wrote its own design for the hardest defect (O1), and proved its code with lint and tsc probes. Heretic accepted
  everything and adopted Opus's code. That makes heretic's fix-step numbers mostly Opus's work: its W2-08 brief carries
  67 % of Opus's code lines, vs a 9 % baseline.

## Setup

| | heretic | RedHat |
|---|---|---|
| Model | `slybase/Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ`, served `swift-1.5` | `RedHatAI/Qwen3.8-27B-MXFP4`, served `qwen38-27b-redhat-mxfp4-dflash` |
| Server script | dp-forge `vllm-heretic.sh` | dp-forge `vllm.sh` (profile `sly-redhat/redhat-mxfp4-dflash`) |
| Client settings | `local_vllm_direct/settings.json` | `settings-redhat.json` (copy of the heretic one, model name changed) |

Shared (MEASURED, `*/server.cmdline`, `*/server-start.txt`):
- **Engine:** `ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1` (vLLM 0.32.0), sly-official engine layer.
- **Spec decoding:** DFlash2 drafter `syvai/Qwen3.8-27B-DFlash2-W4A16`, k = 7, `draft_sample_method probabilistic`.
- **KV and window:** fp8 KV, window 262000, MAXSEQS 1, GPU util 0.93.
- **Cactus:** `RADIANCE_CACTUS_DELTA=0.5` (default), or `CACTUS_DELTA=0` env for the δ 0 run (`RADIANCE_CACTUS_DELTA=0` in
  its cmdline).
- **Client:** Claude Code 2.1.312, `claude -p` stream-json, `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`, effort high. The server
  forces `enable_thinking: true`.
- **Chat template:** `--chat-template /opt/qwen-fixed.jinja` = froggeric `qwen3.8-froggeric-v22.5`. It turns effort high
  into xhigh and replays all old reasoning (see "Chat template and effort").

Task: dp-forge worktree at `de110510` plus the uncommitted 27B-written briefs W2-06/07/08 and `progress.md`. Prompt = the
user's 2026-10-29 RUNBOOK prompt. Per brief the RUNBOOK asks for:
- **A:** a blind review (`review/W2-0x.refine-27b.md`) written before the Opus review is read;
- **B:** a compare with Opus (`W2-0x.compare.md`);
- **C:** the fix in the brief, with lint probes under `/tmp/dp-refine/`;
- **D:** one `progress.md` line.

Run order:
1. **heretic arm** and **RedHat arm** (09:35–13:35): the full task, 3 h cap, up to 5 resumes.
2. **Replay A/B** (13:35–13:49): one captured Claude Code request replayed across server configs (see "Loop").
3. **RedHat δ 0 on W2-08** (13:39–15:49): the replay's capture session, resumed on a `CACTUS_DELTA=0` server until W2-08 was
   done. Calls: 4.5 min (capture), 60 min (1 h cap), 46.7 min.

## Loop: cause, test, fix

What the loops look like (RedHat δ 0.5; MEASURED, `redhat/grading.md` E, `redhat-loop-research.md`):
- 9 thinking blocks of 120–261k chars. The worst has 10 distinct lines out of 2,032.
- Almost all circle one undecided design question in W2-06: 4 parameters vs C7's 3 and `max-params` 3.
- Tool-level repeats too:
  - a grep+sed pair 12× in a row, and the same Edit 8×;
  - 133 re-reads of `W2-06.md` (80 and 34 in a row, 11:58–12:03Z). Every one was answered "Wasted call — file
    unchanged" and interleaved with failed Edits (`slowness.json`).
- Each block ends at the 64k output cap. Compaction then fails 15 times ("summarization produced empty response"): the
  summary is written by the same looping model. The session ends "Prompt is too long" at 237k tokens.
- Heretic shows the same signature once (246k chars, acceptance 7.8–7.9) and recovers.

How it was tested:
1. **Replay A/B (inconclusive).** One real request was captured at the W2-08 blind-review turn and replayed per config.
   - The capture on δ 0 ran 4.5 min with no loop, but the stop trigger fired on Part 1 of the review (the model writes the
     review in two steps). That is a design error of the driver.
   - Replaying that request on δ 0.5 ×3 gave no loop either (acceptance 3.85). That request does not trigger loops at any
     δ, so it says nothing about the cause.
   - The planned presence-penalty (0.3) and MTP-head arms were skipped once δ 0 looked stable (user's call).
2. **The long run (the evidence).** The same session was resumed on δ 0 and ran to the end of W2-08: 111 min, 0 runaway
   blocks.
   - The δ 0.5 RedHat run averaged ~3 loops/h, its first ~9 min in.
   - INFERRED: n = 1 and a different brief (W2-08 vs the W2-06 dilemma), so this is strong but not proof. The kernel
     semantics and Sly #164 point the same way.

Fix options, best first:
- **`CACTUS_DELTA=0` for RedHat.** Works today without a file change: `CACTUS_DELTA=0 ./vllm.sh start` in dp-forge (the env
  passes through; MEASURED in `delta0-w208/server.cmdline`). Costs ~38 % decode.
- **Sly 1.9.0/1.9.1 image.** Adds a Cactus fade and cap. 1.9.1 also ships the template `v22.5-sly2`, which replays only
  the latest assistant turn's reasoning (CLAIMED, Sly releases). That targets both the loops and the compaction rate
  measured below, and it could keep most of the speed. Untested here.
- **Heretic.** It also looped once at δ 0.5. Whether δ 0 is worth its speed cost for heretic is untested.
- **Client side, untested.** Effort medium; a thinking budget; `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` (halves the waste per
  runaway). Ranked in `redhat-loop-research.md` (F3–F5).
- **Prompt mitigation for the RUNBOOK** (from the research, not applied): *"In the blind review, record a spec
  contradiction (for example a function arity that differs from its contract) as ONE finding line with both quotes, and do
  not decide or design the fix until part C; if you catch yourself re-deriving the same point twice, write the finding and
  move on."*

## Why RedHat δ 0 is slow

Post-run analysis of the logs: stream-json, the Claude Code transcripts and the vLLM container logs. Details are in
`slowness.md` and the numbers in `slowness.json`. All MEASURED unless tagged. W2-08 is the same task for both models:

| W2-08 | heretic | RedHat δ 0 | Ratio |
|---|---:|---:|---:|
| Session time, model + tool | 12.0 min | 104.4 min | 8.7× |
| Generated tokens, server (incl. compaction summaries) | 72k | 490k | 6.8× |
| Decode tok/s · mean acceptance | 101.8 · 5.02 | 75.3 · 3.59 | 0.74× |
| Requests · tool calls | 43 · 51 | 208 · 242 | 4.8× |
| Thinking chars, total · per request | 155k · 3.6k | 1,078k · 5.2k | 7.0× · 1.4× |
| Compactions (time) | 1 (1.5 min) | 6 (21.4 min) | |
| Context per request, median · max | 103k · 134k | 90k · 136k | ~1× |
| Tool execution | 10 s | 152 s (2.4 %) | |
| Step A blind review · steps B + C | 5.8 · 6.0 min | 42.6 · 59.2 min | 7.3× · 9.9× |
| Distinct thinking lines in a block · repeated 8-word sequences across blocks | 0.93 · 6.5 % | 0.96 · 4.8 % | |

- **Time ≈ generated tokens / decode rate.** 6.8 × 1.35 = 9.2×, vs 8.7× measured session time. The whole gap is more
  output, decoded slower.
- **Where the extra output comes from:** ~4.8× the steps, ~1.4× the thinking per step, and ~100k tokens of compaction
  summaries (INFERRED: 1,286 s × 75 tok/s).
- **What it is not:**
  - context size: the median request is smaller;
  - tools: 2.4 % of the time;
  - literal repetition: the distinct-line and shingle rates match heretic's.
- **Waste estimate (INFERRED).** One haiku subagent read samples of the thinking (`thinking-digest/`, low-medium
  confidence). It estimates ~35 % of RedHat δ 0's thinking is re-verification and re-planning; heretic ~20 %.
  - Re-planning: a 56k-char "Resuming" recap, and a 98k-char design re-list "Step 1 … Step 9".
  - Re-verification: C3/C8 clauses quoted again.
  - Self-inflicted detour: an awk command that truncated a probe file to 0 lines.
  - The rest is real checking: C8 re-pause, the spec-pipeline path, exit codes, irSet's `cli`.
- **The template amplifies compactions.**
  - Every thinking token stays in the prompt (next subsection), so ~7× the thinking reaches the compaction trigger ~7×
    sooner.
  - The trigger was 136–139k `pre_tokens`, with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=180000` and
    `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=85`.
  - Heretic compacted once on W2-08, at 138k.

RedHat δ 0.5 is a loop story, not a volume one (whole run vs heretic's whole run):
- **Generated tokens:** 1.6M vs 277k.
- **Decode rate:** 150 tok/s. The drafter predicts the repetition, so 73 % of decode windows are at acceptance ≥ 7.
- **Thinking:** 75 % of lines within a block are duplicates, one line ×1,012 in a single block; 45 % of 8-word sequences
  repeat across blocks.
- **Tools:** 185 repeated identical tool calls.
- **Context:** median 223k, because compaction kept failing.

### Chat template and effort (the same for both models)

- **Served template.** `/opt/qwen-fixed.jinja` is byte-identical (MEASURED, `cmp`) to the latest upstream file at
  https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates (fetched 2026-10-30). The changelog has no entry after
  v22.5, so there is no newer froggeric fix to pick up.
- **The models' own templates are unused and identical.** RedHat = heretic = Qwen/Qwen3.8-27B-FP8 (sha256 `c3cf9e34…`,
  MEASURED), so RedHat did not change the template. The stock template defaults `reasoning_effort` to xhigh; froggeric's
  defaults to medium.
- **Effective effort is xhigh.**
  - Claude Code sends `output_config.effort: "high"` (MEASURED, `replay/body-W2-08.json`).
  - vLLM maps it to `reasoning_effort` (CLAIMED, `redhat-loop-research.md`).
  - v22.5 maps high → xhigh and injects "Reasoning effort is set to xhigh. Please think carefully … consider plausible
    alternatives …" (MEASURED, template lines 26–27 and 84).
- **Old reasoning is replayed.** `_preserve_thinking` defaults to true (MEASURED, template line 13). On thinking-heavy
  turns the next prompt grows by 1.10× (heretic) and 1.07× (RedHat δ 0) of the turn's output, on every tested turn
  (MEASURED).
- **What would change it** (all untested):
  - **Sly 1.9.1** ships `qwen3.8-froggeric-v22.5-sly2`, which replays only the latest assistant turn's reasoning
    (CLAIMED, https://github.com/SlyBase/vllm-sly-radiance/releases/tag/v1.9.1). Now tested: see "RedHat on Sly 1.9.1"
    below (it does exactly that inside a Claude Code tool chain, MEASURED).
  - **`preserve_thinking: false` on v22.5** keeps the reasoning after the latest user query. Claude Code's tool results
    are not user queries, so it would strip little within a task (INFERRED).
  - **`effortLevel: "medium"`** in the client settings drops the xhigh line (CLAIMED, froggeric README).

## Rule compliance: does following the RUNBOOK explain the gap?

**Sources.** The rules are the RUNBOOK and the rule files it cites (`03-review-protocol.md` REFINE-CHECK,
`04-check-method.md`, `01-writer-brief.md` REFINE prompt) plus dp-forge's `CLAUDE.md`. A haiku subagent extracted them,
and the key quotes were re-checked with grep. What each model did on W2-08 comes from `compliance.json` (built by
`compliance.py` from the stream-json; MEASURED).

| Rule (source) | heretic (1.8.1, δ 0.5, original RUNBOOK) | RedHat δ 0 (1.8.1, original RUNBOOK) | RedHat 1.9.1 (δ 0.5 + fade/cap, sly2, budget RUNBOOK) |
|---|---|---|---|
| A Part 1, blind: "Of the brief read only its head: `sed -n '1,/^SITES/p'`" (03 REFINE-CHECK) | **broken.** Read the whole brief 22 s into W2-08 (09:20:15Z), then wrote an 11-line "Derived" | **followed.** 44-line "Derived" written at 12:43:42Z, the body read at 12:43:46Z | **broken.** Read the whole brief at 17:03:49Z (no limit), wrote Parts 1–3 in one Write at 17:16:47Z |
| A Part 3: "each code block probed whole and verbatim (M9)"; "A block with no line was not checked" | **broken.** 0 tsc/eslint runs before step B. Its review argues the rule away: "D2/D3/D4 are prose … the M9 limits apply to the writer's implementation" | **followed.** 59 tsc/eslint runs before step B | **broken.** 0 tsc/eslint runs before step B; the two probe lines say "tsc: none" with a reason |
| B: "check every row at the code yourself … A finding is not true because Opus wrote it" (RUNBOOK) | **broken.** 19/19 rows "yes"; 22 of the 26 file:line references in its Evidence column appear verbatim in the Opus review | **followed.** 26 code checks before writing the table; 5 of 22 references from Opus; 2 rows rejected | **partly.** 3 code checks before writing the table; 3 rows rejected, 2 of them wrongly (O12, O19) |
| C: "one Probes line per changed block … not done until its probe is clean" (RUNBOOK, M11) | **broken.** One combined line, "tsc: none"; it linted Opus's code | **followed.** 7 per-block lines, tsc clean, eslint 0 errors | **broken in form.** One combined line "D1-D5 · probe.ts · tsc: none · eslint: none"; the probe did run clean (re-run: tsc 0, eslint 0) |
| C: "re-verify the SITES at HEAD and write that sha" (RUNBOOK) | **broken.** Kept `36ffe5b4` | **followed.** `de110510` | **broken.** Kept `36ffe5b4` |
| Reset: "After a context reset: read this file again" (RUNBOOK) | **broken.** Compacted once in W2-08, 0 RUNBOOK reads after it | **followed.** Rule files re-read: 01 ×8, 02 ×12, W2-04 ×6 | **followed.** RUNBOOK re-read after both compactions (17:58:06Z, 18:25:30Z); 01 ×8, 02 ×11, W2-04 ×5 |
| "Read ≤ 80 lines" (RUNBOOK B, M1 stack profile); no unbounded Read of a file over 15 KB (dp-forge `CLAUDE.md` L60) | 3 reads returned > 80 lines | **broken.** 13 reads returned > 80 lines; tool results put 427k chars into the context (heretic 77k) | **broken less.** 5 reads returned > 80 lines; 282k chars of tool results |

- **Most of RedHat's extra steps are rule-required work that heretic skipped.**
  - tsc/eslint runs: 68 vs 6.
  - Bash calls: 152 vs 27.
  - Code checks in B: 26 vs ~0.

  The counts are MEASURED. That heretic would have needed the same work is INFERRED.
- **Quality and speed have the same source.** RedHat's compliance produced its quality: 9/19 blind, 2 reasoned
  rejections, an own clean fix. Heretic's speed is partly non-compliance: its "clean" and "yes" claims rest on less
  checking than the RUNBOOK requires.
- **RedHat's own rule break cost it context.** The read-size violations fed context growth and compactions. The effect is
  smaller than that of its thinking volume.
- **Not rule-driven:** the 1.4× thinking per step, the 1.35× slower decode (δ 0) and the template's reasoning replay.
- **No rule bounds the work.** There is no probe or attempt limit, no stop condition, and no "do not design the fix in
  A". The δ 0.5 loops started in A, on a contract contradiction the model tried to resolve; the proposed anti-loop
  sentence ("Fix options") closes that gap.
- **Fairness.** Heretic reached W2-08 as its third brief, with the rules already read. RedHat δ 0 started W2-08 in a
  fresh session and read them first, in under a minute (12:39:23–12:39:55Z).

## RedHat on Sly 1.9.1 with the budget RUNBOOK (W2-08, run added 2026-10-30 evening)

**What ran.** Same model, drafter, inputs, prompt, client settings, 3 h cap and resume policy as the δ 0 W2-08 run; four
things changed at once:
- **Image:** Sly 1.9.1, smoke-tested first (`bench/runs/2026-10-30-1745-sly-1.9.1-smoke/`).
- **Cactus:** δ 0.5 with the 1.9.x fade (δ falls linearly from 4,096 to 0 at 16,384 output tokens of one response) and
  cap R 0.5. These are the code defaults, read from the image's `rejection_sampler_utils.py`.
- **Template:** `v22.5-sly2`.
- **RUNBOOK:** the budget version (`sly191-w208/RUNBOOK.diff`, applied in the bench worktree only):
  - after a reset, re-read only the needed rule section and continue at the first missing part;
  - a new § 0b: Read ≤ 80 lines after `grep -n`, `| head -40`, lint only through `eslint --stdin --stdin-filename <real path>`,
    at most 3 attempts per probe, cite quoted evidence instead of re-reading it, "decide, then act";
  - in A: a spec contradiction is one finding row; do not design its fix in A.

The four changes act on different metrics: Cactus on acceptance and loops, the template on prompt size and compactions,
the RUNBOOK on tool and read counts. So the speed and token results can be split by mechanism. The quality results
cannot. Driver: `sly191-w208/run_redhat_w208.sh` (a one-off, like `run_arm.sh`). Grading: `sly191-w208/grading.md`.

**Result.** The run was faster and the fix was good, but the review collapsed and the loops came back.
- **Time: 87 min vs ~111 min for δ 0 (−22 %).**
  - Compaction time: 614 s (2 compactions) vs 1,286 s (6).
  - Decode in non-loop windows: 102.0 vs 74.5 tok/s (+37 %).
  - Against that, it generated more tokens: 567k vs 490k (+16 %). About 64k of them are one capped loop (INFERRED from
    the block size).
  - All MEASURED, from `slowness.json` and `server-container.log`.
- **A collapsed: 1/19 Opus findings (high 1/6) vs 9/19 for δ 0.**
  - Zero tsc/eslint runs before B. Every derived item is marked "Covered".
  - A took 14 min vs ~64 min. In A it behaved like heretic, not like RedHat δ 0.
- **B was thin.** 7 tool calls before the table, and 2 of its 3 rejections are wrong:
  - O12: the reason misses the point.
  - O19: it judged the finding against its own edit.
- **C was good.**
  - All 6 high findings are fixed: 15/19, plus 2 partial.
  - The final probe is clean: tsc and eslint exit 0, re-run by the grader.
  - Only 12 % of the fix is Opus's code.
  - But O7 stayed open: the corrected screen code (193 lines) exists only in the probe file, not in the brief, while the
    compare claims it is in the brief.
- **Incident.** The blind review was first written into the Opus reference file. The model restored the file with
  `git restore` 13 s later and wrote identical content to the right file. The blind property held, because no Opus content
  had been read before the review existed (MEASURED).
- **Loops (MEASURED).** Three decision loops occurred:
  - 17:20Z: "Let me create the compare table." ×84, then ×139.
  - 17:28Z: the same type definition drafted ×10.
  - 18:14–18:19Z: "fixed = 16 or 17?", repeated in a 241k-char block up to the output cap.

  58 of 514 windows (11.3 %) had acceptance ≥ 7, vs 1.1 % at δ 0 and 72.8 % at δ 0.5 on 1.8.1. The capped loop began
  ~700 tokens into its block, with δ 0.5 fully active. It continued after the fade had brought δ to 0. Once the text
  repeats, high acceptance is a symptom: repetitive text is predictable to the drafter at any δ (INFERRED). **Fade and
  cap shorten and thin the loops; they do not remove them on this task. δ 0 is still the only loop-free setting
  measured.**

### Template effect on prompt tokens (MEASURED vs calculated on the same sessions)

`template_tokens.py` reads each session's transcripts. Per request it takes the prompt size from the usage block and
tokenizes each step's thinking with the model's tokenizer. The old reasoning of a request is every earlier step's
thinking since the last compaction, except the newest step's. That is what `v22.5` replays and `v22.5-sly2` drops.

**Which template ran (MEASURED).** The growth of the next prompt is compared with the step's own tokens; the smaller
median error identifies the template:

| Session | median error if `v22.5` | if `v22.5-sly2` | verdict |
|---|---|---|---|
| RedHat δ 0 W2-08 (Sly 1.8.1) | **41** tok | 370 | `v22.5` |
| heretic W2-08 (Sly 1.8.1) | **41** | 228 | `v22.5` |
| RedHat W2-08 (Sly 1.9.1) | 242 | **46** | `v22.5-sly2` |

**What it saves.** The template column header says which template each number assumes:

| Session (W2-08) | Measured, with the template the server had | Calculated with the other template (INFERRED: same behaviour) |
|---|---|---|
| RedHat δ 0, Sly 1.8.1: prompt tokens, whole session | `v22.5`: 19.0M | `v22.5-sly2`: 14.3M (**−25 %**) |
| same: median · max context | `v22.5`: 90k · 136k | `v22.5-sly2`: 68k · 97k |
| same: context growth (what triggers compaction) | `v22.5`: 503k (6 compactions) | `v22.5-sly2`: 216k (−57 %; ~2–3 compactions) |
| same: old reasoning in the context at each compaction | `v22.5`: 38–58k of ~137k (28–43 %) | `v22.5-sly2`: 0 |
| RedHat Sly 1.9.1: prompt tokens, whole session | `v22.5-sly2`: 15.0M | `v22.5`: 32.1M (×2.1) |
| same: max context | `v22.5-sly2`: 132k (2 compactions) | `v22.5`: 337k without extra compactions, beyond the 262k window |

- The compaction estimate is total growth divided by (trigger − mean post-compaction size). It gives 4.3 for the 6 real
  compactions of the δ 0 run, so it undercounts. The ~2–3 above scales it to the real count.
- **What the template does not change: generated tokens.** It removes re-reading, not writing. The δ 0 slowness was
  6.8× the generated tokens, so the template is a moderate lever. In this run the sessions generated more, not less.
- **Cost (MEASURED):**
  - The previous step's reasoning leaves the next prompt, so the prefix cache stops matching there. The cached share
    was 91.9 % vs 93.5 %.
  - Server prefill for the whole session was 1.22M vs 1.26M tokens, because fewer compactions mean fewer full re-prefills.
  - Net: no prefill penalty on this task.

**Next (proposed, not run).**
- **Keep the 1.9.1 image and the sly2 template, but run δ 0.** The template gain is independent of δ, and δ 0 was the
  only loop-free setting.
- **Then separate the RUNBOOK effect on A with A-only screening runs** (~15–20 min each). Compare the original and the
  budget RUNBOOK on the same server, at least 2 each. A single run cannot say whether the collapse in A came from the
  budget rules (§ 0b's "cite, not probed again" can be read as permission to skip probes), from the template (the
  model no longer sees older reasoning) or from δ.

## unsloth Q4_K_XL on llama-swap, W2-08 blind review only (run added 2026-10-31)

Full write-up: `campaigns/2026-10-31-q4kxl-sharp-w208-blind/analysis.md`.

**Setup:**
- llama.cpp b11448 Vulkan via llama-swap, row `qwen38-27b-q4kxl-q8-mtp-kvq8-mtp-sharp-planning` as is: q8_0 KV, ctx 260000,
  MTP head, sharp template = froggeric v22.5.0 + a terseness directive in the system prompt (otherwise the same as v22.5).
- Same base, RUNBOOK, inputs and prompt as RedHat δ 0.
- The session was stopped at step A's end (first read of the Opus review) by the new `gen_campaign.py` `stop_when`.
- All three W2-08 blind reviews were then re-graded by one blind grader (labels shuffled, paths and names scrubbed).

| W2-08 step A | Q4_K_XL | RedHat δ 0 | heretic |
|---|---|---|---|
| Opus findings (blind re-grade) | **12/19** | 9/19 | 4/19 |
| high · med · low | 3/6 · 4/7 · 5/6 | **4/6** · 3/7 · 2/6 | 3/6 · 1/7 · 0/6 |
| Precision | 15/15 | 13/14 | 6/6 |
| Thinking chars · tool calls in A | 242k · 71 | 489k · 156 | — |

All "found/real" values are INFERRED (grading); work counts are MEASURED.

- **The re-grade reproduced the earlier grades exactly:** the same nine Opus numbers for RedHat δ 0 and the same four for
  heretic.
- **+3 for Q4_K_XL is inside the grey zone fixed before the run.** No quality difference is demonstrated at n = 1.
  Q4_K_XL is broader (5/6 lows); RedHat is better on highs. Q4_K_XL missed #6 because its lint probe re-wrote the imports
  instead of copying them.
- **The half-sized work is confounded** by the template (the terseness directive) and the engine.
- **Next (run, below):** the RedHat δ 0 baseline with only the template changed to sharp. A second Q4_K_XL rep remains the
  noise check.

### RedHat δ 0 + sharp template, W2-08 blind review only (run added 2026-10-31)

Full write-up: `campaigns/2026-10-31-redhat-sharp-w208-blind/analysis.md`.

**Setup:**
- The RedHat δ 0 server (same image digest, model, draft, `RADIANCE_*` env, argv) with only `--chat-template` swapped to
  the sharp file (sha256 `cdff39fb…`, the same file as the Q4_K_XL run).
- One fresh call, stopped at step A's end by `stop_when`.
- All four W2-08 reviews were then re-graded together by one blind grader (fresh shuffle, 4 labels).

| W2-08 step A (4-way blind grade) | RedHat + sharp | RedHat δ 0 | Q4_K_XL + sharp | heretic |
|---|---|---|---|---|
| Opus findings | 11/19 | 9/19 | **12/19** | 4/19 |
| high · med · low | **4/6** · 3/7 · 4/6 | **4/6** · 3/7 · 2/6 | 3/6 · **5/7** · 4/6 | 3/6 · 1/7 · 0/6 |
| Weighted (3/2/1, max 38) | 22 | 20 | **23** | 11 |
| Precision | **14/14** | 13/14 | **16/16** | 6/6 |
| Thinking chars · tool calls in A | 304k · 101 | 489k · 156 | 242k · 71 | — |

All "found/real" values are INFERRED (grading); work counts are MEASURED.

- **Template effect (only `--chat-template` differs):**
  - Thinking −38 %, tool calls −35 %, server-generated tokens about −28 %.
  - +2 Opus findings with the same 4/6 highs and no wrong finding.
  - Below the pre-registered grey zone (3–4), so the quality gain is not demonstrated, but no loss is seen either.
  - Severity calibration was weaker: the import-sort error was rated low.
- **With the template equal, Q4_K_XL vs RedHat is a tie** (12 vs 11, highs 3 vs 4; the grader: "too close to separate").
  Most of Q4_K_XL's earlier work advantage was the template.
- **Grader test-retest:** RedHat δ 0 and heretic got identical Opus sets in both blind grades (and in the 2026-10-30
  grade). Q4_K_XL stayed at 12/19 with one borderline swap (#16 ↔ #11). Grader noise is about ±1 finding.
- **Next (proposed):** a second RedHat + sharp rep and a second Q4_K_XL rep, graded blind together. Adopting sharp for
  `sly-redhat` reviews is the user's call (keep v22.5 restorable).

## Quality, step by step

### A. Blind review

Heretic, all three briefs: 11/39 Opus findings (28 %), high 6/10. Own findings 19/20 real; 7 real findings Opus did not
list.

On W2-08:

| Opus # (sev) | heretic | RedHat δ 0 |
|---|---|---|
| 1 high: edits can never be confirmed (`w` writes goals.json, never confirmed.json; C8 re-pause) | – | – (found in B, verified against C8) |
| 2 high: the walk duplicates every goal | ✓ | ✓ |
| 3 high: the fake's plan has one entry, D4 spawns twice | – | ✓ (probe-backed) |
| 4 high: T3 asserts content the fake never records | – | – |
| 5 high: `../src` import path | ✓ | ✓ (TS2307 probe) |
| 6 high: imports fail simple-import-sort | ✓ | ✓ (eslint probe, also in the test block) |
| 8, 10, 13 (med) | 13 | 8, 10, 13 |
| 15, 17 (low) | – | 15, 17 |
| **Total** | **4/19** | **9/19** |

RedHat δ 0 W2-08 extra findings (INFERRED):
- real: a fabricated "verbatim" PATTERN (heretic found it too);
- real: the non-goal walk branch is never tested;
- real: the test block's import order;
- **wrong** (corrected 2026-10-31): "a stale base sha, move it to `de110510`". `tools/dpf` exists at neither commit, and
  `git diff --stat 36ffe5b4 de110510 -- tools/` is empty, so moving the base fixes nothing. Found by the blind re-grade
  in `campaigns/2026-10-31-q4kxl-sharp-w208-blind/` (finding X14); RedHat δ 0's W2-08 precision is 13/14, not 14/14.

It looked at O9 (drop every goal) and ruled it not a finding. On W2-06 (δ 0.5, before the loops took over) RedHat found 3/9
like heretic, including O5 (the 4-param/C7 conflict), which heretic missed.

### B. Compare with Opus

- **heretic:** accepted all 39 Opus findings. One probe of its own (ENOENT spawn) in W2-06.
- **RedHat δ 0.5:** accepted all 9 on W2-06, with no tool call between reading Opus and writing the compare.
- **RedHat δ 0:** about 30 tool calls of checking before writing: C8's re-pause guard, spec-pipeline's `commitEdit` (refuses
  `goals: []`), W2-05's temp-file rule, `residue.ts`, the current DO NOT template. It rated 20 real and rejected 2:
  - O7 "the screen is a prose state machine": prose behaviour is the established brief format (W2-05 is prose too);
  - O18 "copy clarifyScreen, not runScreen": the PATTERN header says it is the Screen contract every screen copies.

  Both are defensible judgement calls, not errors (INFERRED).
- **Flaw:** its Fix column said "applied" before the brief was edited.

### C. Fix

| | heretic W2-08 | RedHat δ 0 W2-08 |
|---|---|---|
| Brief lines in → out | 184 → 315 | 184 → 292 |
| Opus code reuse (`opus_reuse.py`) | 164/245 (67 %) | 51/245 (21 %) |
| O1 (the deepest defect) | adopted Opus's corrected code | own design: `w` stages the writes, `a` accepts with them, applyResolve writes them, then copies the template |
| Probe lint, re-run by the grader | own extraction did not parse; linted Opus's code: 0/0 | module 0 errors + 1 warn (`max-lines-per-function` 83 > 20) · test 0/0 |
| Type check | — | the model's `tsc --strict` re-run: clean (against its own stubs for W2-01b/02/05 files, absent at base) |
| Base sha | kept `36ffe5b4` | updated to `de110510` |

The one RedHat δ 0.5 fix that landed (W2-06) was a one-line import path; its probe had 5 lint errors.

## What this task shows about each model (weak spots)

**heretic**
- Fast and finishes.
- Shallow blind review: misses most medium and low findings.
- Treats the Opus review as authority (0 rejections in this test, 3 on W1).
- Its fix step is largely a copy of Opus's code, so "fixed" says little about its own ability.
- Claimed "clean" for code it did not write.

**RedHat δ 0.5**
- The deliberation itself looks good (it found O5, which heretic missed).
- Cactus turns hard design questions into loops, and the loops break compaction.
- In practice the run fails.

**RedHat δ 0**
- The deepest reviewer of the three local runs. It probes its claims, disagrees with reasons, and writes its own working
  design.
- Weak spots:
  - very high effort per brief (2 one-hour-plus legs for one brief);
  - long verification detours (13 min working out simple-import-sort's ordering via ESLint's API; a probe loop that first
    linted directories);
  - claims ahead of facts ("applied" before applying);
  - a lint warning hidden by the brief's own `--quiet`, the same blind spot it flagged in O10.

**Opus** (the reference) still found the deepest defect (O1) blind, which neither local model did.

## Limits

- **n = 1 per arm.** RedHat δ 0 covers W2-08 only, from a fresh context. Heretic reached W2-08 as its third brief with a
  compacted context.
- **Grading.** One grader (Opus 5.5) with Opus reviews as the reference: "real", "found" and "defensible" are INFERRED.
  The two rejected Opus findings were not adjudicated further.
- **Speed.** Compared from 10 s server windows of different content and depth (INFERRED). For controlled RedHat decode
  numbers see `docs/analysis/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md` (DFlash2 k = 7, ctx 110000, 256-token
  probes, slower of 2 reps: Sly 1.8.1 δ 0.5 122.27/84.76/87.36 tok/s and Sly 1.9.1 δ 0.5 + fade/cap 122.72/86.34/86.24
  tok/s at 10k/50k/100k - the same within the rep noise; INFERRED from that: the 1.9.1 session's faster non-loop
  windows, 102.0 vs 74.5 tok/s for δ 0 on 1.8.1, come mostly from δ 0.5 vs δ 0, not from the new engine).
- **Untested.** The MTP head and presence-penalty arms; δ 0 on Sly 1.9.1; heretic on Sly 1.9.1; δ 0 for heretic; effort
  medium.
- **The Sly 1.9.1 run changes four things at once** (image, Cactus, template, RUNBOOK), n = 1: its quality change is not
  attributable to any one of them. The template-effect numbers are calculated on fixed sessions (INFERRED: a model that
  sees less of its old reasoning may also behave differently).
- **Repetition shares.** The ~20 % / ~35 % waste estimates are one haiku subagent's judgement over sampled blocks (head and
  tail, middles elided), INFERRED. The deterministic repetition counters in `slowness.json` are MEASURED.
- **Replay design error.** The trigger stopped at the first Write. Its A/B result is inconclusive and is not used as
  evidence.

## Method and tooling (iron rule 6)

- **One-off drivers.** No repo tool runs a headless agentic task in a worktree with resumes and a stop condition, so these
  were hand-written:
  - `run_arm.sh`: the two arms;
  - `run_replay.sh`, `replay.py`, `pick_body.py`: capture and replay;
  - `stop_if_stable.sh`: the early stop;
  - `continue_w208.sh` and `continue_w208_v2.sh`: the δ 0 run;
  - `sly191-w208/run_redhat_w208.sh`: the Sly 1.9.1 run (fresh worktree, budget RUNBOOK, stop on the W2-08 progress line).

  All are kept in the run dir.
- **Post-run tools.**
  - `metrics.py`: behaviour, loop and compliance counters from stream-json.
  - `opus_reuse.py`.
  - `slowness.py`: time split, compactions, per-step split, repetition counters, transcript context and the
    reasoning-replay test, server rates.
  - `digest.py`: bounded thinking samples for a cheap qualitative read.
  - `compliance.py`: RUNBOOK compliance counters per brief window (blind order, Opus access, B checks, probe runs, read
    sizes, tool-result volume). It counts an Opus access only for a real read (Read, or cat/sed/head/tail/grep of the
    file); `ls` and `wc -l` of the directory no longer count (fixed for the 1.9.1 run, other values unchanged except
    heretic W2-07's first Opus read, 2 s later).
  - `template_tokens.py`: which template a session ran (residual check) and the prompt tokens with the other template
    (needs `tokenizers`, run from a scratch venv).
  - `slowness.py`'s replay test (next-prompt growth / output) cannot detect `v22.5-sly2`, which keeps the newest step's
    reasoning; use `template_tokens.py`'s residual check instead.

  Haiku subagents, one at a time: the qualitative read, the froggeric README and Sly release notes, and the rule-file
  digest.
- **Recommended tool.** Turn `run_arm.sh` + `metrics.py` into a reusable `bench/agentic/` runner with these parameters:
  prompt, worktree inputs, resume prompt, stop condition (a file regex), cap, server script and env. It should also have a
  replay mode that triggers on a named write and step (the trigger bug here).

## Data

All under `bench/runs/2026-10-30-0947-dpf-brief-ab/` (`README.md` has the layout and a status table):
- `heretic/`, `redhat/`: the full arms. `grading.md`, `metrics.json`, `session-*.jsonl`, `server-container.log`, outputs.
- `redhat-loop-research.md`: log forensics, server signature, engine knobs, ranked fixes, sources (Sly #164, Sly releases,
  model cards).
- `replay/`: the B capture, the A ×3 replays (`results.jsonl`), server cmdlines and logs.
- `delta0-w208/`, `delta0-w208-part2/`: the δ 0 W2-08 run. `delta0-w208/grading.md` has A–E for both parts.
- `opus-reference/`: the Opus reviews and `findings.tsv` (39 rows).
- `slowness.md`, `slowness.json`: the "why slow" analysis.
- `compliance.json`: the rule-compliance counters (heretic W2-06/07/08, RedHat δ 0.5 W2-06, RedHat δ 0 W2-08, RedHat
  Sly 1.9.1 W2-08).
- `thinking-digest/`: the sampled thinking per run.
- `templates/`: the served templates (1.8.1 `v22.5`, 1.9.1 `v22.5-sly2`) and their diff, the models' stock template, the
  froggeric README, `render_test.py`/`.txt` (which steps' reasoning each template puts into a tool-chain prompt).
- `sly191-w208/`: the Sly 1.9.1 W2-08 run (same layout as `redhat/`), with `grading.md`, `metrics.json`, the RUNBOOK
  original/budget/diff and the driver. `template_tokens.json`: the template analysis of all W2-08 sessions.
- `../2026-10-30-1745-sly-1.9.1-smoke/`: the 1.9.1 smoke test (boot, VRAM, template line, reasoning-replay check).
