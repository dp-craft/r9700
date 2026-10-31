<!-- meta
date: 2026-10-31 17:45
takeaway: Transcript-only analysis of seven W2-08 agentic runs (no GPU). (1) Old reasoning is rarely needed. Only 3.4-6.7% of the identifiers a step emits existed solely in thinking two or more steps back, and a keep-newest (k=1) run re-derives 3.6% on its own. A blind judge rated 6 of 32 keep-all reuse cases real dependencies, all from a running findings ledger (2 of them risky), and 0 of 8 in the k=1 run. A written conclusion of ≤15% would have kept everything later steps used in 7 of 10 blocks; the block's own last paragraph in only 2 of 10. → k=1 plus an externalized findings ledger. (2) "sharp" is a third-party template: froggeric v22.5 plus a 3-line TERSENESS system block. Its measured effect is −35-38% work with no demonstrated quality change (+2 findings, below the pre-registered ≥5) and weaker severity calibration. Five clauses can over-reach in an agent run; a scoped wording is proposed for an A/B. (3) The buun Qwen3.6 template disables thinking whenever tools are present by default, and blanks thinking after two short error-looking tool results (our tsc/eslint probes trigger it). Not usable as-is. (4) Cactus δ0.5 loops are inherent to its lossy acceptance rule, not a code bug. On 1.8.1 any drafted token with target p ≥ 0.5 is accepted with certainty, so a loop has no exit (0 of 3 top loops escaped, all hit 64k). The 1.9.1 cap restores half the stock escape, but 4 of the 6 measured 1.9.1 loop onsets were before the fade start (4,096 tokens). Under the cap, δ0.3 equals δ0.5 for every drafted token with p ≥ 0.29. (5) Correction: δ0.3's "15.8% loop signal" was repeated import lines, not a loop; δ 0 runs show 13.8-15.8% repeated-line blocks with no loop either.
-->

# Analysis: how much old reasoning is reused, the sharp and buun templates, and why Cactus δ 0.5 loops (W2-08 agentic transcripts, R9700)

- **Date:** 2026-10-31 17:45 · **Track:** cross-run transcript analysis. **No GPU time**: the GPU was busy, and only finished runs
  were read. The one Docker command (an earlier `sed` of the 1.9.1 image's sampler source) ran with `--network none` and no device.
- **Runtimes read:** Sly radiance 1.8.1 and 1.9.1 (vLLM 0.32.0, RedHat Qwen3.8-27B-MXFP4, DFlash2 k = 7, fp8 KV) and llama.cpp b11448
  Vulkan (Q4_K_XL, MTP). Claude Code 2.1.312. Sampler temp 1.0 / top_p 0.95 / top_k 20 / min_p 0 / presence 0. Power cap 210 W.
- **Arms (all W2-08 step A, one session each):**

  | Arm | Template (replay rule) | Cactus | Run dir |
  |---|---|---|---|
  | q4kxl-sharp | sharp (keep all) | — (llama.cpp MTP) | `bench/runs/2026-10-31-q4kxl-sharp-w208-blind/rep1/q4kxl-sharp` |
  | redhat181-sharp-d0 | sharp (keep all) | δ 0 | `bench/runs/2026-10-31-redhat-sharp-w208-blind/rep1/redhat-d0-sharp` |
  | redhat191-sharp-d0 | sharp (keep all) | δ 0 | `bench/runs/2026-10-31-redhat191-sharp-w208-blind/rep1/r191-sharp-d0` |
  | redhat181-oldtpl-d0 | froggeric v22.5 (keep all) | δ 0 | `bench/runs/2026-10-30-0947-dpf-brief-ab/delta0-w208-part2` |
  | redhat191-sharp-d03 | sharp (keep all) | δ 0.3 + fade/cap | `…/r191-sharp-d03` |
  | redhat191-sharp-d05 | sharp (keep all) | δ 0.5 + fade/cap | `…/r191-sharp-d05` |
  | redhat191-sly2-d05-k1 | Sly `v22.5-sly2` (**keep newest only**) | δ 0.5 + fade/cap | `bench/runs/2026-10-30-0947-dpf-brief-ab/sly191-w208` (budget RUNBOOK) |
  | redhat181-redhat-d05 | froggeric v22.5 (keep all) | δ 0.5, no fade/cap | `bench/runs/2026-10-30-0947-dpf-brief-ab/redhat` (loop study only) |

- **Tools.** No repo tool covers transcript-level reasoning reuse or loop onset (rule 6). Two one-off scripts sit next to the data
  they produce, beside `thinking_digest.py`:
  - `bench/runs/2026-10-31-agentic-thinking-volume/thinking_reuse.py` → `thinking_reuse.jsonl`
  - `…/loop_onset.py` → `loop_onset.jsonl`

  Both were stress-tested on synthetic transcripts with hand-computed answers. Two bugs were caught and fixed before the real run:
  `json.dumps` glued `\n` onto identifiers, and blank lines capped the window share at ~50%. The blind judge inputs and outputs are in
  the session scratchpad (`reuse-test/judge_{input,out}_{A,B}.jsonl`, keys separate).
  - **Recommended tool change** (needs approval): fold the loop-window criterion into `bench/lib/report.py`'s loop signal (see §4).
- **Builds on:**
  - [thinking volume + levers](2026-10-31-1640-agentic-thinking-volume-and-levers.md)
  - [preserved-thinking research](../research/2026-10-31-1725-preserved-thinking-how-much-to-keep.md)
  - [sharp-template campaign](../../campaigns/2026-10-31-redhat-sharp-w208-blind/analysis.md)
  - [Cactus known issue](../vllm/known-issues.md)

## Summary

| Question | Answer | Provenance |
|---|---|---|
| Is "sharp" the froggeric template? | **No.** It is a third-party HF template, "Qwen Sharp Chat Templates" (`base_model: froggeric/Qwen-Fixed-Chat-Templates`). It is froggeric's template plus a TERSENESS system-prompt block and a tool-protocol guard, which is inactive here. Our file is the Sly 1.8.1 image's froggeric v22.5 plus that block (a 32-line diff). Its version string still reads `qwen3.8-froggeric-v22.5.0` | MEASURED (diff, `~/.config/llama-swap/templates/sharp-README.md`) |
| Do we have a quality measurement of sharp? | **Yes, one A/B, n = 1.** RedHat δ 0, only `--chat-template` changed: Opus findings 11 vs 9 (weighted 22 vs 20), highs 4 vs 4, precision 14/14 vs 13/14. That is +2, below the pre-registered ≥ 5, so a gain is **not demonstrated** and no loss is seen. Work fell 35-38%. Severity calibration was weaker (one grader) | MEASURED work · INFERRED grades ([campaign analysis](../../campaigns/2026-10-31-redhat-sharp-w208-blind/analysis.md)) |
| How much does a later step need older reasoning? | **Little.** 3.4-6.7% of emitted identifiers existed only in thinking ≥ 2 steps back, and ~25% of those reach a tool input or text. A k = 1 run re-derives 3.6% without seeing old thinking. Blind judge: 6/32 real dependencies (keep-all), 0/8 (k = 1); 2/32 risky, both from 2 steps back (k = 2 would have kept them) | MEASURED (lexical) · INFERRED (judge) |
| Would the reasoning's conclusion be enough? | **A written conclusion, yes; a truncated tail, no.** A ≤ 15% conclusion covers what the next 4 steps used in 7/10 blocks (3 partly). The block's own last paragraph covers it in 2/10. The last 20% holds 31-38% of the reused identifiers | INFERRED (judge) · MEASURED (tail) |
| buun Qwen3.6 template: anything for us? | **Not as-is.** By default it turns thinking **off** whenever tools are present. Its replay rule keeps everything in an agent chain. After two short error-looking tool results it forces an empty think block, which our tsc/eslint probes trigger. One idea is worth borrowing: a history-based warning injected into the prompt | MEASURED (file read) |
| Why does δ 0.5 loop: bug or inherent? | **Inherent to lossy acceptance, plus a 1.8.1 design flaw; not a coding bug.** δ inflates the accept probability of the drafter's token toward the drafter's mode. On 1.8.1 a token with target p ≥ 1/(1+2δ) = 0.5 is accepted with certainty, so a loop has no exit. The 1.9.1 cap restores half the stock escape, but most onsets come before the fade starts | MEASURED (code, onsets) · INFERRED (mechanism) |
| Correction | δ 0.3's "15.8% loop signal" is repeated `import` lines in code, not a loop. The loop-window detector finds none in that run, and δ 0 runs have 13.8-15.8% repeated-line blocks with no loop window either | MEASURED |

**Recommendation for the next runs** (plan in §6, all need approval, none needs to start before the GPU is free):
- keep newest only (k = 1, sly2);
- externalize the findings ledger into a file;
- A/B the terseness block at δ 0 with a scoped variant;
- revisit Cactus only with a stronger cap and an early fade.

## 1. The sharp template: what it adds, and where it can over-reach

### 1.1 The block (verbatim, `sharp-chat_template.jinja` lines 167-187)

```jinja
{%- if ns_state.thinking %}
    {%- set _terse_lead = 'Answer directly, after thinking. Lead with the answer, then only what it needs to be correct and usable.' %}
{%- else %}
    {%- set _terse_lead = 'Answer directly and concisely. Give the answer with only what it needs to be correct and usable.' %}
{%- endif %}
{%- set _terse_core %}
Never: open with preamble or pleasantries; restate the question; add filler transitions; hedge with niceties; or repeat a point you've already made.
Always: keep essential steps, caveats, uncertainties, and specifics — never drop correctness or a needed warning for brevity. Keep the final answer lean. Use the least structure that conveys it (plain prose when short; lists or code only when they earn their place). If genuinely uncertain, say so and explain why — never omit uncertainty for the sake of brevity.
If a user request is genuinely ambiguous, ask a sharp question, don't guess.
{%- endset %}
{%- set _terse_on = terse if terse is defined else true %}
{%- if _terse_on %} … _sc = (_sc | trim) ~ '\n\n' ~ (_terse | trim) … {%- endif %}
```

- **Placement (MEASURED, lines 196-242):** the block is the **last text of the system message**. It comes after the tool list, the
  tool-format reminder and Claude Code's own system prompt, so it has the recency slot.
- **Default:** kwarg `terse`, default true. Claude Code cannot pass template kwargs, so in our runs it is always on.
- **Author's claims (CLAIMED, T2, `sharp-README.md`):** ThinkingCap-Qwen3.6-27B on Claw-Eval: answer score +7.4, overall +3.8,
  answer tokens −59%. SWE-bench-Live "half the time" ("provisional, judge-free, still settling"). The README also notes "It is not tuned per
  model … measure yours".

### 1.2 Gaps, side effects, edge cases in an agentic review run

| # | Clause | Possible side effect here | Our evidence | Narrowing (proposal) |
|---|---|---|---|---|
| 1 | "Answer directly, after thinking. Lead with the answer…" | In an agent loop "the answer" is undefined. The model applies the directive to its whole trajectory: thinking −38%, tool calls −35%. Fewer verification probes can mean fewer runtime findings | highs equal (4/6 vs 4/6), lows +2, n = 1 (MEASURED/INFERRED). No loss seen, none excluded | scope it to prose: "these rules govern the prose you write; they never limit how much you think or verify, or which tools you run" |
| 2 | "Never … restate the question" | A review must quote the brief line it criticizes (our RUNBOOK has an "Evidence (quoted)" column) | precision 14/14, quotes present (INFERRED) | "quoting evidence or a field a format requires is not restating" |
| 3 | "… or repeat a point you've already made" | Ledgers and tables repeat ids and values, and summaries repeat findings. It may also discourage re-checking a claim | not observed | "repeating what a required format needs is not repetition" |
| 4 | "Keep the final answer lean" | The deliverable is a file written through a tool, so a lean review compresses severity rationale | **weaker severity calibration**: lint error #6 rated low, #10 "no change" (INFERRED, one grader) | "brevity never lowers a severity, drops a finding, or removes the evidence for one" |
| 5 | "If a user request is genuinely ambiguous, ask a sharp question, don't guess." | `claude -p` has no user. A question ends the session with no deliverable | not observed: δ 0.3's early stop was a skip to step B, not a question (MEASURED, last actions) | "if you cannot ask (a non-interactive run), state your assumption and continue" |
| 6 | "Use the least structure … lists or code only when they earn their place" | Conflicts with a RUNBOOK that mandates tables | reviews kept the mandated tables (MEASURED) | low risk; precedence line (row 7) covers it |
| 7 | Placement after the caller's prompt | Stacks on Claude Code's own concision rules, and recency gives it priority over the caller's format instructions where they clash | — | "where the instructions above set a format or level of detail, they take precedence" |
| 8 | Applies to every request (compaction summaries, sub-agents) | A shorter compaction summary loses more state | summaries 24-34k chars (sharp) vs 26-37k (v22.5), no visible shrink (MEASURED, `isCompactSummary` rows) | none needed |

**Scoped variant to A/B** (design proposal, not yet a file). It keeps the original lines, adds one scope line and replaces the
ambiguity line. Wording rule (user, 2026-10-31 17:50): minimal and terse, and biased to let more through rather than cut
something important. So one inclusion default ("if unsure, keep it") replaces the per-row carve-outs of the table above:

```text
Answer directly, after thinking. Lead with the answer, then only what it needs to be correct and usable.
Never: open with preamble or pleasantries; restate the question; add filler transitions; hedge with niceties; or repeat a point you've already made.
Always: keep essential steps, caveats, uncertainties, and specifics — never drop correctness or a needed warning for brevity. Keep the final answer lean. Use the least structure that conveys it (plain prose when short; lists or code only when they earn their place). If genuinely uncertain, say so and explain why — never omit uncertainty for the sake of brevity.
Scope: prose only — never how much you think, verify or run, nor what a required format, quote or file must hold. If unsure whether something is needed, keep it; never soften a judgment for brevity. Format rules above take precedence.
If a request is genuinely ambiguous, ask a sharp question; if you cannot ask, state your assumption and continue.
```

Coverage of the table rows: "prose only … verify or run" → 1; "required format, quote" → 2, 3, 6; "keep it; never soften a
judgment" → 4; "Format rules above take precedence" → 7; the last line → 5.

**The trade-off to measure (INFERRED):** the scope sentence may give back part of the −35-38% work cut, which is sharp's only
measured benefit. The A/B decides whether the narrowing costs speed and whether it buys back calibration.

## 2. Reasoning replay: how much older thinking a later step uses

**Method:** `thinking_reuse.py`.
- For each assistant step j, every identifier is classed by what was visible before j: user prompt, tool results, earlier text or
  tool inputs. Identifiers are paths and names with `. / _ : # @ -`, digits or camelCase, ≥ 3 chars.
- An identifier counts as "only older than k" if, apart from visible content, it appeared only in thinking more than k steps back.
  Keep-last-k would drop exactly those.
- A compaction resets the history; the compact summary counts as visible.
- Window: session start to the first read of the Opus reference.
- Lexical reuse ≠ dependency, so a blind Sonnet judge rated a sample (arm labels hidden).

**Identifiers emitted per step (MEASURED, `thinking_reuse.jsonl`)**

| Arm | replay | steps | ids out | visible | novel | from newest thinking | only older than k=1 | >k2 | >k3 | >k5 | of >k1: reach a tool input/text | of >k1: in an older block's last 20% |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| q4kxl-sharp | all | 65 | 3,007 | 61.0% | 31.0% | 2.6% | **5.4%** | 4.7% | 4.0% | 2.1% | 24.7% | 38.3% |
| redhat181-sharp-d0 | all | 101 | 3,569 | 66.0% | 26.3% | 1.0% | **6.7%** | 4.9% | 4.4% | 3.5% | 23.1% | 30.7% |
| redhat191-sharp-d0 | all | 62 | 3,160 | 68.9% | 23.8% | 1.3% | **6.0%** | 3.7% | 3.0% | 2.4% | 25.4% | 33.9% |
| redhat181-oldtpl-d0 | all | 143 | 5,197 | 65.3% | 27.1% | 1.3% | **6.3%** | 5.2% | 4.1% | 3.2% | 25.0% | 31.7% |
| redhat191-sharp-d03 | all | 32 | 1,046 | 80.3% | 15.2% | 1.1% | 3.4% | 3.0% | 2.1% | 1.8% | 5.6% | 25.0% |
| redhat191-sharp-d05 | all | 118 | 3,453 | 70.8% | 22.5% | 2.2% | 4.5% | 3.9% | 2.7% | 1.5% | 15.4% | 32.1% |
| **redhat191-sly2-d05-k1** | **newest** | 40 | 1,313 | 73.4% | 20.3% | 2.7% | **3.6%** (re-derived: old thinking was not in its prompt) | 3.2% | 3.1% | 3.1% | 31.9% | 29.8% |

- **Thinking mostly works over visible material:** 62-69% of the identifiers inside thinking were already visible (δ 0 arms).
- **Phrases (word 5-grams) show the same picture:** 1.3-2.0% of a δ 0 step's phrases were only in thinking ≥ 2 steps back.

**Blind judge (Sonnet, 40 reuse cases that reached a tool input or text + 10 whole thinking blocks with the next 4 steps)**

| Sample | Result |
|---|---|
| 32 keep-all cases | 20 re-derivable · **6 dependency** · 6 incidental; loss if dropped: 20 none · 10 recheck · **2 risk** |
| 8 cases from the k = 1 run | 8 re-derivable · 0 dependency (the model had already re-derived them without old thinking) |
| All 6 dependencies | **conclusion-type origin**: the running numbered findings list, a verdict, or a finding id with its severity (e.g. "F1 high: import depth `../src/…` resolves to tests/src — wrong") |
| 10 thinking blocks: composition | restate 27% · explore 29% · plan 21% · **derive 17.5%** · repeat 0% · other 5.5% |
| Items the next 4 steps used | 18; only 3 already written into an action; only 3 in the block's last paragraph |
| A ≤ 15% written conclusion would suffice | **7 yes · 3 partly · 0 no** |
| The block's own last paragraph would suffice | 2 yes · 4 partly · 4 no |

**Consequences**
1. **Keep-newest (k = 1) loses little, and what it loses is specific (INFERRED from MEASURED rates + judge).**
   - About 2-3 pp of output identifiers depend on older thinking beyond what a k = 1 run re-derives (5.4-6.7% vs 3.6%).
   - About 1 in 5 of those is a real dependency.
   - The dependency class is narrow: **the findings ledger**, i.e. finding ids, severities and verdicts the model keeps only in its
     head.
   - A longer window helps lexically but not by much. k = 2 recovers 0.7-2.3 pp and k = 3 1.4-3.0 pp of the 5.4-6.7%. The rest
     (2.1-3.5%) is > 5 steps back, which a compaction wipes anyway, and the k = 1 run re-derives 3.1% at that range by itself.
   - Of the 6 judged dependencies, 3 were 2 steps back (**both risk cases**), 1 was 3 back and 2 were 5 back. **k = 2 is the cheap
     hedge** if the ledger cannot be externalized.
2. **Externalize the ledger instead of replaying reasoning.** If the review protocol makes the agent append each finding (id,
   severity, evidence, verdict) to a draft file as it goes, the ledger becomes a visible tool input. Then k = 1 loses nothing the
   judge flagged. This is a dp-forge RUNBOOK change (outside this repo, lever L9).
3. **"Keep only the conclusion" needs a conclusion the model writes.**
   - A template can cut text but cannot summarize it.
   - The tail of a block is a poor proxy (2/10 sufficient).
   - A workable variant is a marker the model writes at the end of each thinking block (e.g. `STATE: findings so far …; next: …`),
     which a template could keep from older turns while dropping the rest. It depends on format adherence, so it is a test variant,
     not a default (INFERRED).

## 3. The buun Qwen3.6 template (`spiritbuun/buun-Qwen3.6-chat_template`)

Read byte-exact from `resolve/main/chat_template.jinja`: 19,947 bytes, sha256 `5ad30c14c77b36fa…`. Saved in its own empty
scratchpad dir and only grepped. A haiku summary of the card and discussions came first. It got one default wrong
(`auto_disable_thinking_with_tools`), which the file read corrected.

| Feature (fix #) | What it does (MEASURED, file) | For our Claude Code runs |
|---|---|---|
| Base | the official Qwen3.6-27B template plus 25 numbered fixes; credits froggeric (v19) | Qwen3.6-targeted; our models are 3.8 |
| #19 `auto_disable_thinking_with_tools` | **default `true`**: thinking off whenever tools are present ("prevents `<tool_call>` leaking into `<think>`") | **disables thinking in every Claude Code request**; would need `false`, which Claude Code cannot pass (a server default would) |
| #23 `preserve_thinking` | default false → reasoning only for turns after the last user query | an agent chain has one user query, so this **keeps everything** (= stock) |
| #24 retry-stall escalation | a tool result < 500 chars containing `error:` / `traceback` / `failed to` …, without `$ ` or `took `, increments a counter. 1 → "⚠️ SYSTEM: Tool call returned an error…". ≥ 2 → "…Use a fundamentally different approach" **and an empty `<think></think>`** for the next step | our probes run tsc/eslint/vitest **on purpose to see errors**. Two short error outputs would push "a different approach" and blank thinking exactly when the output needs analysis. Over-filtering by design |
| #16 `max_tool_arg_chars` / `max_tool_response_chars` | truncate with a `[TRUNCATED — original length N chars]` marker; default 0 = off | a context-growth knob; loses data; Claude Code already caps tool output |
| #22, #25, #17, #20 | no whitespace in disabled think; fuzzy `</think>` parsing; no-user-query fallback; unknown roles → user | robustness fixes; nothing we have hit |
| Loop handling | none for thinking repetition (no dedup, no truncation, no penalty) | — |
| Measurements | none (card and discussion #1 have no numbers; "prevents ~80% premature turn aborts" in a comment, no data) | — |

**Idea to borrow:** #24's mechanism, an *observable history pattern* that injects a short system note into the prompt. Pointed at
reasoning repetition rather than tool errors, it is the template half of the "loop warning" in §4.

## 4. Cutting loops out of thinking, and a "loop warning"

Where a guard can sit, and what it can and cannot do:

| Place | What it can do | What it cannot do | Edge cases that cause over-filtering | Status |
|---|---|---|---|---|
| **Offline metric** (`report.py` loop signal) | flag loops in finished runs | — | **code lines repeat legitimately**: δ 0.3's 15.8% was `import { type Screen } …` ×5 | proposed fix: count only lines ≥ 20 chars, require a 40-line window with ≥ 80% repeats (`loop_onset.py` rule: no false hit in δ 0 / δ 0.3, every real loop caught). Optionally exempt fenced code |
| **Template, at replay** (sly2's newest turn) | collapse repeated lines in the replayed reasoning to the first occurrence plus `[loop: line repeated N×, elided]`; inject one line, "your previous reasoning repeated itself; decide and act" | stop a loop already running (the 30-60k generated tokens are already spent) | tables, checklists, code, repeated paths: apply only above the window threshold and outside fences | design only; under k = 1 a loop carries one turn forward (sly2 17:22: the previous step's line ×84 → ×139 next), and this stops that carry-over |
| **Proxy, while streaming** (`capture_proxy.py` sits in the request path) | detect the window rule on the live reasoning stream and log a `loop_warning` event (time, offset, line); optionally abort | an abort makes Claude Code retry, and the retry may loop again | as above; abort is risky, warn-only first | development item; saves the time, unlike the template |
| **Server** (Sly kernel) | turn δ to 0 for a request once its recent output repeats (a repetition-aware Cactus gate) | — | — | an upstream suggestion for #164 (outward-facing, only on request) |

## 5. Why δ 0.5 loops: the mechanism

**The rule** (MEASURED, image `vllm-sly-radiance:1.9.1-rocm10.1`,
`vllm/v1/worker/gpu/spec_decode/rejection_sampler_utils.py:771-785`; in the code `q_n` is the **target** probability `p` of the
drafted token):

```python
req_delta = cactus_delta * fade          # fade = clamp((16384 - out_len) / (16384 - 4096), 0, 1)
h_n = min(max(p + sqrt(2 * req_delta * p * (1 - p)), 0), 1)
h_n = min(h_n, 1 - cactus_cap_r * (1 - p))      # 1.9.x cap, R = 0.5 ("keeps an escape at every q")
accepted = log(h_n) > log(u) + draft_logprob     # stock (δ = 0): p > u * q_draft
```

`(h − p)² = 2δ·p(1 − p)` makes δ a per-token divergence budget: the χ² approximation of KL(Bern(h) ‖ Bern(p)) equals δ. On a
confident draft (q_draft ≈ 1, the loop case) the accept probability becomes h instead of p. Computed from the formula
(INFERRED arithmetic):

| target p of the drafted token | 0.05 | 0.2 | 0.5 | 0.6 | 0.9 |
|---|---:|---:|---:|---:|---:|
| stock (δ 0): accept / **escape** | 0.05 / **0.95** | 0.2 / **0.8** | 0.5 / **0.5** | 0.6 / **0.4** | 0.9 / **0.1** |
| 1.8.1 δ 0.5, no cap | 0.268 / 0.73 | 0.6 / 0.4 | 1.0 / **0** | 1.0 / **0** | 1.0 / **0** |
| 1.9.1 δ 0.5, cap 0.5 | 0.268 / 0.73 | 0.6 / 0.4 | 0.75 / 0.25 | 0.8 / 0.2 | 0.95 / 0.05 |
| 1.9.1 δ 0.3, cap 0.5 | 0.219 / 0.78 | 0.51 / 0.49 | 0.75 / 0.25 | 0.8 / 0.2 | 0.95 / 0.05 |
| 1.9.1 δ 0.1, cap 0.5 | 0.147 / 0.85 | 0.379 / 0.62 | 0.724 / 0.28 | 0.8 / 0.2 | 0.95 / 0.05 |
| δ 0.5, cap 0.8 | 0.24 / 0.76 | 0.36 / 0.64 | 0.6 / 0.4 | 0.68 / 0.32 | 0.92 / 0.08 |

- **Saturation:** h = 1 when p ≥ 1/(1+2δ). That is 0.5 at δ 0.5, 0.625 at δ 0.3 and 0.833 at δ 0.1.
- **Cap:** with R = 0.5 the cap binds for p ≥ 0.25/(2δ+0.25). That is 0.2 at δ 0.5, 0.29 at δ 0.3 and 0.56 at δ 0.1.

**The loop cycle (INFERRED, each link sourced):**
1. Repetition is an attractor of the target model itself. The probability of repeating a sentence rises with the number of times it
   has already repeated: Xu et al. 2022, *Learning to Break the Loop*, arXiv 2206.02369, NeurIPS (CLAIMED). Qwen warns that greedy
   decoding of its thinking models "can lead to … endless repetitions" (Qwen3 model card, CLAIMED).
2. In a repeating context the drafter proposes the copy with q ≈ 1 and the target gives it rising p. Stock sampling at temp 1 keeps
   an escape chance of 1 − p at every drafted token.
3. Cactus moves that mass to the copy. On **1.8.1**, once p ≥ 0.5 the escape is **zero**: confident positions are effectively greedy,
   the exact failure Qwen warns about. Only the bonus token after a fully accepted block (1 in 8 at k = 7) is still sampled exactly.
4. The more repetitions, the higher p, the more positions saturate. The loop becomes absorbing.

**What our transcripts show (MEASURED, `loop_onset.jsonl`; onset = first 40-line window ≥ 80% repeated, up to 8 lines early;
tokens = char offset × that message's tokens/char)**

| Run | Cactus | Replay | Loop blocks (≥ 40k chars, a line ≥ 50×) | Onset, est. output tokens (δ at onset) | How they ended |
|---|---|---|---:|---|---|
| redhat181-redhat-d05 | δ 0.5, no fade/cap | all | 8 | top three: ~35, ~1,155, ~5,169 (all δ 0.5) | top three: **all at `max_tokens` 64,000, no escape** |
| redhat191-sharp-d05 | δ 0.5 + fade/cap | all | 4 | top three: ~571, ~3,247 (δ 0.5), ~8,066 (δ 0.34) | 1 at 64,000; **2 escaped** after 46.7k and 39.1k tokens, i.e. 23-30k tokens after δ had faded to 0 (at 16,384) |
| redhat191-sly2-d05-k1 | δ 0.5 + fade/cap | newest | 3 | ~1,065, ~1,527 (δ 0.5), ~12,792 (δ 0.15) | 1 at 64,000; 2 ended in a tool call |
| redhat191-sharp-d03 | δ 0.3 + fade/cap | all | 0 (15.8% = code lines) | — | run was short (32 steps, 514 s): too little exposure to call δ 0.3 safe |
| δ 0 arms (four runs, all checked) | δ 0 | all | 0 (their most repetitive blocks: 3.9-15.8% repeated lines, no loop window) | — | — |

- **Where loops come from:** most loop blocks start fresh. The top loops' signature line had never appeared in earlier thinking, so
  replay is not literally copied. In 3 of 15 loop blocks the line was inherited from the immediately previous step, which k = 1 also
  replays.
- **What a loop costs:** on the 1.8.1 run (no fade/cap), all three largest loops hit the cap; one 64k-token block takes about 13-19
  min of decode at 55-84 tok/s (INFERRED from the δ 0 / δ 0.3 decode rates).

**Verdict**
- **Not an implementation bug (MEASURED):** the kernel implements its formula; δ = 0 takes the stock branch bit-exactly
  (`tl.where(req_delta == 0.0, target_logprob, …)`).
- **Inherent to lossy acceptance (INFERRED):**
  - Cactus bounds the per-token divergence. A trajectory of tens of thousands of tokens compounds it, and the target model has a
    repetition attractor.
  - Any rule that shifts mass toward a copy-happy drafter lowers the escape rate.
  - Loops that start under full δ continue after δ = 0, because by then the target itself predicts the copy (two of the three 1.9.1
    loops escaped only 23-30k tokens after δ had faded to 0).
- **A design flaw in 1.8.1, fixed in part in 1.9.x (INFERRED):**
  - Saturation (h = 1 for p ≥ 0.5) removes all randomness at confident positions. That is the #164 lock-in.
  - The 1.9.x cap guarantees at least half the stock escape, and its loops did escape (2/3, vs 0/3 on 1.8.1).
  - But the fade starts at 4,096 output tokens, and 4 of the 6 tabulated 1.9.1 onsets were before that, at full δ.
- **δ 0.3 is not a safe middle (INFERRED):** under the 1.9.x cap, δ 0.3 and δ 0.5 accept identically for every drafted token with
  target p ≥ 0.29, which is where loops live. They differ only on low-p tokens.
- **The knobs that change loop risk are:**
  - `CACTUS_CAP_R`: 0.8 keeps ≥ 80% of the stock escape;
  - an early, short fade: `FADE_START=0`, `FADE_END` a few thousand;
  - or δ 0.

## 6. Plan (prepared while the GPU is busy; every item needs approval)

| # | What | Why | Design | GPU | Gate |
|---|---|---|---|---|---|
| **P0** | Finish the δ 0.5 sharp arm: blind grade + campaign `analysis.md` | approved earlier; the review exists | 2-way/3-way blind grade with the sharp δ 0 anchor; δ 0.3 reported FAILED (protocol skip); loop table from §5 | none | — |
| **P0b** | `report.py` loop signal → window rule (§4) | removes the code-line false positive | port `loop_onset.py`'s rule plus a unit test case of repeated imports in `test_report.py` | none | approve change to `bench/lib/report.py` |
| **P1** | Template A/B at **δ 0**, Sly 1.9.1 RedHat, W2-08 step A | decides replay rule + terseness with one variable at a time | **arms:** (a) `v22.5-sly2` as shipped (k = 1, no terse; no new file); (b) `sharp-sly2` = sly2 + the original terse block; (c) optional `sharp-scoped-sly2` = sly2 + the §1.2 wording. Reference: the two existing sharp keep-all δ 0 runs (22, 21/38). **n = 2 per arm** (3 if time allows). **Measures:** blind weighted score, highs, precision, severity calibration, thinking/tool calls, compactions, wall, loop blocks. **Rule:** pre-registered Δ ≥ 5; on a tie take the cheaper | ~45-60 min per run → 4-6 runs ≈ 4-6 h | approve new template files (copies; current templates stay restorable) |
| **P2** | Findings ledger written to a file during step A | removes the only dependency class k = 1 loses (§2) | RUNBOOK line: "append each finding (id, severity, evidence, verdict) to `review/<W>.draft.md` as you go" | rides on P1's winner, 1-2 runs | dp-forge change (outside this repo) |
| **P3** | Cactus retry on the P1 winner | the +51% decode (δ 0.3) is the largest speed lever | δ 0.5 + `CACTUS_CAP_R=0.8` + `FADE_START=0 FADE_END=4096` vs δ 0. Report decode with the mclk trace, acceptance, loop blocks, onsets, blind grade | 2-4 runs | after P1 |
| **P4** | Loop guard | time lost to loops (up to 64k tokens per block) | (i) replay dedup + warning in the template (k = 1 turn); (ii) warn-only `loop_warning` events in `capture_proxy.py`; (iii) a repetition-gated δ, suggested upstream on #164 | none to build; validated in P3 | approve each; (iii) is outward-facing |
| **P5** | k = 2 or a `STATE:` marker variant | if P2 (ledger file) is not adopted, or P1/P2 show recall failures (re-derivations, repeated probes); k = 2 would have kept both risk cases of §2 | template: keep the last 2 assistant reasoning blocks, or only the `STATE:` tail of older ones | 2 runs | conditional |

**Before any run (rule 14):** `bench/lib/gpu_exclusive.sh` with the RedHat working set as the floor, since the GPU is currently
in use by someone else.

## Methodology & caveats

- **n = 1 per arm** everywhere in §2 and §5. The k = 1 run differs in more than the template (budget RUNBOOK, δ 0.5), so its 3.6%
  re-derivation rate is a rough baseline, not a controlled contrast.
- **Lexical proxy.**
  - It misses semantic carry-over with no shared identifier, and counts coincidences.
  - The blind judge corrects for both on a 40-case sample only. The judge saw excerpts (±300 chars), not full contexts.
  - Two judge outputs were spot-checked by recount (MEASURED counts match its summary).
- **Onset tokens are estimates:** char offset × that message's tokens/char (3.6-4.3). The thinking block is assumed to dominate the
  message's output. The detector can fire up to 8 lines early, which makes it conservative.
- **The acceptance table assumes a confident drafter** (q_draft ≈ 1). With q_draft < 1 acceptance is min(1, h/q_draft). Same
  ordering, larger numbers.
- **Not measured:** δ 0.3 over a full session (its only run was 514 s), sly2 at δ 0, and the scoped terseness wording.
