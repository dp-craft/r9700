# Why RedHat is slow: speed, tokens, context, repetition, chat template

Post-run analysis of this run root (2026-10-30). Numbers come from `slowness.json` (built by `slowness.py`) unless a
line says otherwise. Sources: the stream-json sessions, the Claude Code transcripts (`*/claude-project/`) and the vLLM
container logs. Provenance tags follow iron rule 1.

## Answer

On W2-08, RedHat δ0 took **8.7× the session time** of heretic (104 min vs 12 min). That is almost entirely
**generation volume × decode rate**: RedHat δ0 generated **6.8× more tokens** (490k vs 72k) and decoded them
**1.35× slower** (75 vs 102 tok/s). 6.8 × 1.35 = 9.2×.

It was not context size: the median request was 90k tokens vs 103k. It was not tools: 2.4 % of the time. It was not
literal looping: within-block distinct lines were 0.96 vs 0.93. It was:

- **~4.8× more steps.** 208 requests vs 43, and 242 tool calls vs 51.
- **~1.4× more thinking per step.** 5.2k vs 3.6k chars.
- **6 compactions vs 1.** 21 min vs 1.5 min, about 100k extra generated tokens (INFERRED: 1,286 s × 75 tok/s).

The compactions are partly a template effect. Both arms re-render every old reasoning block into each new prompt, so
a model that thinks 7× more reaches the ~137k compaction trigger 7× sooner.

The RedHat δ 0.5 run (the original 3 h run) is a different story: it was **looping**.
- **Duplicate thinking:** 75 % of thinking lines within a block were duplicates, and one line was repeated 1,012 times
  in one block.
- **A tool loop:** 133 "Wasted call" re-reads of the same file, 80 and then 34 in a row.
- **Failed compactions:** 15 compactions failed with "summarization produced empty response".
- **Context overflow:** the context grew to 239k.

## W2-08: heretic vs RedHat δ0 (the same task, both finished)

| Metric | heretic | RedHat δ0 | Ratio | Source |
|---|---:|---:|---:|---|
| Session time, model + tool (s) | 719 | 6,261 | 8.7× | stream-json timestamps, MEASURED |
| … of which compaction (s) | 90 (1×) | 1,286 (6×) | | `compact_metadata.duration_ms`, MEASURED |
| … of which tool execution (s) | 10 | 152 | | stream-json, MEASURED |
| Requests · tool calls | 43 · 51 | 208 · 242 | 4.8× | MEASURED |
| Output tokens, normal turns | 62.8k | 387.1k | 6.2× | transcript usage, MEASURED |
| Generated tokens, server (incl. compaction summaries) | 72.3k | 489.8k | 6.8× | vLLM 10 s windows, MEASURED |
| Thinking chars · per request | 155k · 3.6k | 1,078k · 5.2k | 7.0× · 1.4× | MEASURED |
| Decode rate (tok/s) · mean acceptance | 101.8 · 5.02 | 75.3 · 3.59 | 0.74× | vLLM log, MEASURED |
| Context per request, median · max | 103.5k · 134.3k | 90.4k · 135.6k | ~1× | transcript usage, MEASURED |
| Compaction trigger (`pre_tokens`) | 138k | 136–139k | | MEASURED |
| Prefilled tokens · cached share | 191k · 95.5 % | 1,259k · 93.5 % | 6.6× | MEASURED |
| Step A blind review (s) | 348 | 2,556 | 7.3× | per-step split, MEASURED |
| Steps B + C compare + fix (s) | 360 | 3,553 | 9.9× | MEASURED (heretic interleaved B and C) |

Notes on the table:
- **Step boundaries:** A ends at the first Read of the Opus review. B ends at the first write of the compare file.
  Heretic wrote its fix before the compare file, so only B + C is comparable.
- **Prefill share:** prefill tokens were 6.6× higher because of the 6 compactions and the two server restarts. Prefill
  still overlaps generation in the 10 s windows: decode-active windows cover the whole session (6,500 s of 6,261 s +
  boot). Its share is small but cannot be separated at this granularity (INFERRED).

## Whole runs: heretic vs RedHat δ 0.5

| Metric | heretic (all 3 briefs, done) | RedHat δ 0.5 (W2-06 only, 3 h cap) |
|---|---:|---:|
| Model time (s) | 2,418 | 9,375 |
| Generated tokens, server · transcript | 277k · 257k | 1,599k · 888k |
| Decode rate (tok/s) · acceptance · windows ≥ 7 | 113 · 5.5 · 15.5 % | 150 · 7.18 · **72.8 %** |
| Context median · max | 92k · 134k | **223k · 239k** |
| Compactions OK · failed · OK time (s) | 2 · 0 · 193 | 3 · **15** · 1,781 |
| Thinking chars | 716k | 3,120k |

Two readings:
- **Loops look fast.** The drafter predicts repetition well, so RedHat δ 0.5's decode rate is high exactly because
  the output is repetitive. Its high generation rate is the loop signature.
- **Missing transcript tokens.** About 0.7M of the server-generated tokens never reached the transcript: capped or
  discarded loop outputs and failed compaction attempts (INFERRED).

## Repetition

Deterministic (`slowness.py`, MEASURED; lines ≥ 40 chars, 8-word shingles):

| Metric | heretic W2-08 | RedHat δ0.5 all | RedHat δ0 W2-08 |
|---|---:|---:|---:|
| Distinct lines within a block (weighted) | 0.93 | **0.25** | 0.96 |
| Blocks with < 0.7 distinct (≥ 20 lines) | 1 | **24** | 0 |
| Cross-block repeated 8-word sequences | 6.5 % | **45 %** | 4.8 % |
| Identical tool calls repeated | 0 | **185** | 10 |
| "Wasted call — file unchanged" re-reads | 1 | **133** | 0 |
| "wait" · "hmm" · "let me re" per 10k chars | 4.1 · 0.7 · 7.2 | 7.7 · 3.7 · 23 | 7.1 · 5.3 · 1.6 |

The 133 re-reads in RedHat δ 0.5 were all of `briefs/W2-06.md`, in session-4 at 11:58–12:03Z. They were interleaved
with failed Edits ("String to replace not found"), and every one of them got the "Wasted call" reply.

Qualitative review (one haiku subagent over `thinking-digest/`; samples only, confidence low-medium):

- **heretic:** no literal loops. Some re-planning: it restated its 7-item fix plan twice, and flip-flopped once on
  PATTERN TO COPY. Waste estimate ~20 %.
- **RedHat δ0:** no literal loops, but frequent re-verification and re-planning.
  - **Restated plans:** the 56k-char "Resuming" recap (block 28), and the 98k-char design re-list "Step 1 … Step 9"
    (block 163).
  - **Re-quoted clauses:** C3/C8 contract clauses were quoted again in blocks 146–155.
  - **Self-inflicted confusion:** an awk command truncated a probe file to 0 lines, and the model spent several turns
    confused before it noticed (block 184).
  - **Real verification:** the C8 re-pause semantics, the missing spec-pipeline path, EXIT_STEP_FAILED = 3 against
    the source, and that irSet needs `cli`.
  - **Estimates:** waste ~35 %; 5 of 15 consecutive compare-step blocks restate earlier conclusions (heretic 4 of 14).
- **RedHat δ 0.5:** literal loops dominate the largest blocks.
  - "Let me reconsider. Let me verify the max-lines-per-function by other means." ×1,012 (block 239, 12:33Z).
  - "Actually, I think the '## Probes' section is …" ×535 (block 55).
  - **Trigger:** a contract conflict it never decides: the C7 3-param signatures vs an injected spawn vs lint
    max-params 3. Saying "I'm going in circles" does not break the loop.
  - The 7 sampled loop blocks alone hold ~51 % of the run's thinking chars.

## Chat template and effort level (identical for both arms)

- **Served template.** Both servers pass `--chat-template /opt/qwen-fixed.jinja`, which is **froggeric v22.5**.
  - It is byte-identical (MEASURED, `cmp`) to the latest upstream `chat_template.jinja` in
    https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates (fetched 2026-10-30).
  - The README changelog has nothing after v22.5. Copy: `templates/sly-1.8.1.qwen-fixed.jinja`, README:
    `templates/froggeric-README.md`.
- **The model's own template is not used.** RedHat ships the stock Qwen template unchanged (MEASURED): the same
  sha256 `c3cf9e34…` as heretic, Qwen/Qwen3.8-27B-FP8 and amd Quark (copy: `templates/model-stock-qwen3.8.chat_template.jinja`).
  So RedHat did not change it, and `--chat-template` overrides it anyway. The stock template defaults
  `reasoning_effort` to `xhigh`; froggeric changed that default to `medium`.
- **Effective effort is xhigh for both arms.**
  - Claude Code sends `output_config.effort: "high"` (MEASURED in `replay/body-W2-08.json`, a request of the δ0
    W2-08 session).
  - vLLM maps it to `reasoning_effort` (CLAIMED, `redhat-loop-research.md`).
  - v22.5 maps `high` to `xhigh` (MEASURED, template lines 26–27), which injects the system line "Reasoning effort is
    set to xhigh. Please think carefully … consider plausible alternatives …".
- **Old reasoning is replayed.** `_preserve_thinking` defaults to `true` (MEASURED, line 13). Test on thinking-heavy
  turns: next-prompt growth divided by this turn's output, median **1.10 (heretic) and 1.07 (RedHat δ0)**, with 100 %
  of tested turns replayed (MEASURED). Every thinking token stays in the prompt until a compaction.
- **What would change it.**
  - **Sly 1.9.1 template.** 1.9.1 bundles `qwen3.8-froggeric-v22.5-sly2`, which replays only the MOST RECENT assistant
    turn's reasoning (CLAIMED, https://github.com/SlyBase/vllm-sly-radiance/releases/tag/v1.9.1). In this agentic
    loop that would remove most of the context growth that drives the compactions (INFERRED). 1.9.0/1.9.1 also add
    the Cactus fade/cap against the loops (CLAIMED, `redhat-loop-research.md`).
  - **`preserve_thinking: false` on v22.5.** It keeps reasoning after the latest *user query*. Claude Code's tool
    results are not user queries, so within one task it would strip little (INFERRED, not tested).
  - **`effortLevel: "medium"` in the client settings.** It removes the xhigh line ("zero injected tokens", CLAIMED,
    froggeric README). Untested here.

## Files

- `slowness.py RUNROOT > slowness.json`: time split, compactions, per-step split, repetition, transcript context and
  replay test, server rates.
- `digest.py RUNROOT OUTDIR`: per run, the largest and least-distinct thinking blocks plus 15 consecutive
  compare-step blocks → `thinking-digest/*.md` (the subagent's input).
- `templates/`: the served template, the model's stock template, the froggeric README.
- Both scripts are one-off post-run tools, like `metrics.py`. No repo tool reads Claude Code transcripts. Recommended:
  fold them into the proposed `bench/agentic/` runner (see the analysis doc, "Method and tooling").
