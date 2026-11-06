<!-- meta
date: 2026-10-31 17:25
takeaway: Preserving earlier reasoning in agent loops is worth a few points over dropping it all: MiniMax M2 SWE-bench 69.4 vs 67.2, BFCL multi-turn about +2-5% on Qwen3 8B/4B. On search and agent tasks the gain can be large (Tau² 87 vs 64). "Keep all" is not the optimum, though. The only Qwen3.x comparison (Sly 1.9.1) puts keep-newest-only at 25/32 multi-turn tasks, keep-all at 22/32 and drop-all at 17/32. Its no-result (loop) rate is 6/64 for keep-newest vs 35/64 for keep-all. A long-agent paper found full history (0.627) worse than deleting all reasoning (0.718) or entropy-pruning 80% of it (0.738). No published curve exists for keep-last-k with k=2..N. Recommendation for our Qwen3.8-27B Claude Code sessions: keep the newest turn only (k=1, sly2 rule), and test k=2-3 only if recall failures show up. Keep-all is unsafe with Cactus δ>0 and doubles context growth.
-->

# Options Comparison: how much earlier reasoning to replay in long agent sessions (preserve_thinking)

**Date:** 2026-10-31 · **Asked by:** the user ("based on research, how much does preserve_thinking add to quality, and how many
turns are worth keeping?") · **Method:** a `/research` options pass. One Sonnet web-research subagent gathered external evidence
(Tier-1 first). Local template and run facts were checked by hand and are tagged MEASURED.
**Provenance:** external = `CLAIMED` with URL. "snippet" = seen only in a search snippet. Fetch summaries were model-paraphrased
and are flagged where it matters.

### Strategic Summary

There are three options: keep every earlier turn's reasoning, keep only the newest turn's, or keep none.
- **Preserving reasoning beats dropping it all.** The gain is a few points on coding and tool benchmarks and more on search and
  agent benchmarks.
- **"Keep all" is not the optimum for long sessions.** The only Qwen3.x measurement finds keep-newest better than keep-all on
  multi-turn quality (25 vs 22 of 32) with roughly 6× fewer runaway generations. A long-agent paper finds full history worse than
  dropping it.
- **Recommendation: keep the newest turn only (k = 1), the `v22.5-sly2` rule.** That is the opposite of what our `sharp` template
  does today.

### Context

A Claude Code session is one user task followed by 60-150 tool calls, all after the last user message. Claude Code sends each turn's
thinking back. The chat template decides what reaches the prompt (MEASURED):

| Template | Default for earlier assistant turns in the agent chain | Source |
|---|---|---|
| Stock Qwen3.8 (`model-stock-qwen3.8.chat_template.jinja`) | **keep all**: `preserve_thinking` undefined → replay. With `false` it still keeps every turn after the last user query, which in an agent chain is all of them | local file, line 116; `render_test.txt` |
| froggeric `v22.5.0` and our **`sharp`** (= v22.5.0 + terseness block) | **keep all** (`_preserve_thinking = true`) | campaign copy of `sharp-chat_template.jinja`, line 13 |
| Sly 1.9.1 `v22.5-sly2` (`/opt/qwen-fixed.jinja`) | **keep newest only**; older turns get an empty think block, unless `preserve_thinking` / `preserve_reasoning` is set | template lines 8-13, 341-349 |

Our measured cost of keep-all (2026-10-30 `template_tokens.json`): over the same work, context grows 503k vs 216k tokens if sly2
(2.3×), with compactions estimated at 4.3 vs 1.9. A compaction then wipes all reasoning anyway.

### Decision Criteria

1. **Task quality in long agent sessions.** This is the goal. Weight: High.
2. **Loop or runaway risk,** especially with Cactus δ > 0 (Sly #164). Weight: High.
3. **Context growth → compactions and wall time.** Weight: Med.
4. **Multi-turn recall,** meaning the agent re-uses a value it derived earlier. Weight: Med.
5. **Prefix-cache reuse and engine cost.** Weight: Low. Prefill is fast here; cached share was 91.9% vs 93.5% (MEASURED 2026-10-30).

### Evidence

| Claim | With vs without | Model | Benchmark | Source | Tier |
|---|---|---|---|---|---|
| Interleaved thinking (keep vs drop) | SWE-bench Verified 69.4 vs 67.2; Tau² 87 vs 64; BrowseComp 44.0 vs 31.4; GAIA 75.7 vs 67.9; xBench 72.0 vs 66.0 | MiniMax M2 | as listed | [MiniMax blog](https://www.minimax.io/news/why-is-interleaved-thinking-important-for-m2) | 1 (vendor) |
| Retaining thinking history across turns | about +2-5%; about 3-5% for Qwen3-8B/4B (figure only); full history kept afterwards, no last-k test | Qwen3 8B/4B and others | BFCL multi-turn | [arXiv 2606.00135 §3.3](https://arxiv.org/html/2606.00135) | 1 |
| Reasoning items passed back | "about 3%" (Responses vs Chat Completions, not an isolated ablation); cache utilization 40% → 80% | OpenAI o-series/GPT-5 | SWE-bench | [OpenAI cookbook](https://developers.openai.com/cookbook/examples/responses_api/reasoning_items) | 1 |
| Keep all prior thinking by default on recent models | "no negative effect on model performance" (no numbers); the trade-off is context size; older models keep the last turn only | Claude | — | [Anthropic docs: thinking block preservation](https://platform.claude.com/docs/en/build-with-claude/thinking) | 1 |
| Preserved thinking recommended | no numbers; on by default on the Coding Plan endpoint | GLM-4.6/4.7 | — | [z.ai docs](https://docs.z.ai/guides/capabilities/thinking-mode) | 1 |
| `reasoning_content` must be returned with tools | 400 error if omitted; no quality numbers | DeepSeek V3.2 | — | [DeepSeek docs](https://api-docs.deepseek.com/guides/thinking_mode) | 1 |
| `preserve_thinking` introduced, recommended for agents | "can enhance decision consistency"; no numbers. Older Qwen3 guidance: history should hold the final output only | Qwen3.6-27B / Qwen3-32B | — | [Qwen3.6-27B card](https://huggingface.co/Qwen/Qwen3.6-27B), [Qwen3-32B card](https://huggingface.co/Qwen/Qwen3-32B) | 1 |
| **Pruning reasoning from history** | full history **0.627**; delete all **0.718**; entropy-prune lowest 80% **0.738**; random 5-40% ≈ 0.68. Warns that deletion can raise reasoning tokens and repeated calls | DeepSeek V4 Flash agent | WorkBuddyBench (80 tasks; abstract: 0.699-0.718 on 260) | [arXiv 2609.29875](https://arxiv.org/abs/2609.29875) | 1 (one benchmark, fetch summary) |
| **Sly 1.9.1, Qwen3.x: keep-all vs keep-newest vs drop-all** | 32 multi-turn tasks (16 recall + 16 variant), pass counts: keep-all **22/32**, keep-newest (sly2) **25/32**, drop-all (sly1) **17/32**. No-result (loop) rate: keep-all 35/64 vs sly2 **6/64**; a "head of older reasoning" variant (sly3) 7/64, dropped. NLL cost vs keep-all: sly2 +0.31 nats, sly1 +1.03. Blind judge, 12 real sessions: 2 keep-all wins, 1 drop, 9 ties. Decode 84.1 vs 66.2 tok/s | Qwen3.x on Sly (hermes-agent traffic) | internal | [Sly v1.9.1 release](https://github.com/SlyBase/vllm-sly-radiance/releases/tag/v1.9.1) | 1 (vendor, task source and grading unpublished) |
| Same experiment, template comment | one 163k agent request looped 11/16 seeds with replay vs 1/32 without (bf16 cloud reference 6/16 vs 0/32); recall 6/16 keep-all → 1/16 drop-all → 9/16 keep-newest | Qwen3.x | internal | `/opt/qwen-fixed.jinja` in the 1.9.1 image (MEASURED: file read) | 1 (vendor) |
| Keep the 3 newest + up to 8 selected older turns | 43.4% vs rolling summary 36.1% vs GRPO 28.9% (RL-trained method, not a template setting) | — | BrowseComp-Plus | [arXiv 2606.31650](https://arxiv.org/abs/2606.31650) | snippet |

**Our own data (MEASURED, n = 1 each, all on W2-08):**
- **Keep-all + exact sampling (δ 0, sharp):** no loops (repeated lines 0-0.6%), Opus-weighted 21-22.
- **Keep-all + δ 0.3 (sharp, 1.9.1):** no loop. Its "15.8% loop signal" is repeated `import` lines (corrected 17:45; the loop-window
  detector finds none). The blind review was skipped (protocol failure, cause OPEN), and the run was short (514 s).
- **Keep-all + δ 0.5 (sharp, 1.9.1):** a 272k-character thinking block, 96.2% repeated lines ("Let me reconsider. Let me check if
  tools/dpf is registered in the eslint config.").
- **Keep-newest + δ 0.5 + fade/cap (sly2, 1.9.1, 2026-10-30):** 3 decision loops, and the review collapsed to 1/19. That run is
  confounded with the "budget" RUNBOOK and δ 0.5. So k = 1 does **not** prevent δ 0.5 loops on our workload. Most loops start
  fresh inside one response rather than being copied from replayed reasoning (3 of 15 loop blocks inherited the previous step's line).

**Keep-newest + δ 0 has never been run on our workload.**

**Our transcripts: how much later steps reuse older thinking** (added 17:45, MEASURED lexical + a blind Sonnet judge; full method in
[the analysis](../../findings/agentic/2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops.md) §2):
- **Identifiers:** 5.4-6.7% of the identifiers a δ 0 keep-all step emits existed only in thinking ≥ 2 steps back. ~25% of those reach a
  tool input or text. A k = 1 run, which never saw old thinking, re-derives 3.6% by itself.
- **Blind judge:** 6 of 32 keep-all cases are real dependencies, all of them the running **findings ledger** (ids, severities,
  verdicts). 2 are risky, both 2 steps back. 0 of 8 in the k = 1 run.
- **Conclusion-only:** a written conclusion of ≤ 15% would keep what the next 4 steps use in 7/10 blocks (3 partly). The block's own
  last paragraph would in only 2/10.

### Options

**Option A: keep all (stock Qwen3.8, froggeric v22.5.0, our `sharp`)**
- Quality: OK. Keep-vs-drop gains are real, but keep-all scored below keep-newest on Qwen3.x (22 vs 25/32) and below drop-all in the long-agent paper.
- Loop risk: Poor. 35/64 no-result on Sly. Our δ 0.5 runs looped (δ 0.3 did not; corrected 17:45).
- Context: Poor. 2.3× growth, about twice as many compactions (MEASURED estimate).
- Recall: Good, everything is there.
- Cache: Good, 100% prefix parity (froggeric README).
- **Score: 5/10.** Acceptable only with δ 0 and short sessions.

**Option B: keep the newest assistant turn only, k = 1 (Sly `v22.5-sly2`)**
- Quality: Good. Best of the three on the only Qwen3.x comparison (25/32). The blind judge on real sessions shows mostly ties.
- Loop risk: Good. 6/64 vs 35/64 (vendor).
- Context: Good. About half the growth, fewer compactions.
- Recall: Good. The value "lives one turn back" (9/16 vs 6/16 keep-all on recall tasks); NLL +0.31 nats vs keep-all.
- Cache: OK. The previous step's reasoning leaves the prompt, so the cache stops matching there (91.9% vs 93.5% cached share, no prefill penalty on our task).
- **Score: 8/10.**

**Option C: keep the newest k = 2-3 turns (not shipped; a small template change)**
- Quality: Unknown. No published k-curve. ECHO's "3 newest + selected" is an RL method, not a template rule.
- Loop risk: likely between A and B (INFERRED: the loop source is replayed text, which scales with k).
- Context: between A and B.
- Recall: possibly better than B for multi-step derivations (INFERRED).
- **Score: 6/10 until measured.**

**Option D: keep none (Sly `sly1`, Qwen3's older "final output only" guidance)**
- Quality: Mixed. Worst on Qwen3.x multi-turn (17/32, recall 1/16), yet best in the DeepSeek long-agent paper (with entropy pruning even better).
- Loop risk: Good. 1/32 on the vendor's request.
- Context: Best.
- Recall: Poor. NLL +1.03 nats.
- **Score: 4/10** for our workload.

### Comparison Matrix

| Criterion (weight) | A keep all | B keep newest (k=1) | C keep k=2-3 | D keep none |
|---|---|---|---|---|
| Quality, long agent (High) | OK (22/32) | **Good (25/32)** | unknown | Mixed (17/32; 0.718 > 0.627 in one paper) |
| Loop risk (High) | **Poor** (35/64; ours looped at δ 0.5) | **Good** (6/64; ours still looped at δ 0.5) | likely OK | Good |
| Context growth (Med) | Poor (2.3×) | Good | OK | Best |
| Multi-turn recall (Med) | Good | Good (9/16) | Good? | Poor (1/16) |
| Cache reuse (Low) | Best | OK | OK | OK |

### Recommendation

**Option B (k = 1).** It is the only option measured on Qwen3.x that beats keep-all on quality, and it cuts the loop rate about
6× and our context growth about 2×. It also directly addresses our two observed problems: the replay-plus-Cactus loops and
compactions every ~136k.

What preservation adds over dropping everything is a few points on coding and tool benchmarks (MiniMax +2.2 SWE-bench; BFCL about
+2-5%) and more on search and agent tasks. Almost all of that is captured by keeping the most recent turn's reasoning. That turn
holds the agent's current plan and scratchpad, while older turns mostly add length and loop seeds (INFERRED from the Sly k=1 > all
result and the long-agent pruning paper).

**Refined by our transcripts (17:45):** the one thing k = 1 loses on our review task is the findings ledger held only in thinking. Two
fixes: make the RUNBOOK write each finding to a draft file as it goes (then k = 1 loses nothing the judge flagged), or use k = 2,
which would have kept both risky cases. Keep-all buys ~2-3 pp of lexical reuse over k = 1, most of it re-derivable, at 2.3× context.

### Runner-up

**Option C (k = 2-3).** Choose it if a B run shows recall failures, for example the agent re-deriving a value it computed two
steps earlier, or repeating probes it already ran. Switch cost: a few lines in the template. sly2 already tracks
`last_assistant_index`, and a k-window needs a count of assistant turns from the end.

### Implementation Context

<claude_context>
<chosen>
- option: keep-newest-only (k=1), i.e. the `v22.5-sly2` replay rule
- install: build a `sharp-sly2` template = Sly 1.9.1 `/opt/qwen-fixed.jinja` + the `sharp` terseness block. The two diffs are independent (MEASURED diff: sharp vs sly2 differ only in the terseness/suppress-tools block and the replay rule)
- config: do NOT set `preserve_thinking` / `preserve_reasoning` (setting either restores keep-all)
- patterns: verify with the `render_test.py` approach (which steps' reasoning reaches the prompt) and with `template_tokens.py`'s residual check on the transcripts
- docs: Sly v1.9.1 release notes; this file
</chosen>
<runner_up>
- option: keep the last k=2-3 assistant turns
- when: the findings ledger cannot be externalized to a file, or B shows recall failures (re-derivations, repeated probes); k = 2 kept both risky dependency cases in our transcripts
- switch_cost: small template edit plus one A/B run
</runner_up>
<integration>
- existing_code: profiles mount `CHAT_TEMPLATE` (serve_vllm.sh). llama.cpp rows use `--chat-template-file`, and the same template works there
- gotchas: Cactus δ 0.5 loops with keep-all **and** with k = 1 (Sly #164, our δ 0.5 runs; δ 0.3 did not loop in its one short run); compaction drops all reasoning regardless of k; the buun template is not a drop-in (thinking off with tools by default, see the analysis §3)
- testing: plan P1 in the analysis §6: W2-08 step A at δ 0 on 1.9.1, sly2 as shipped vs `sharp-sly2` (vs a scoped terseness variant), n = 2, blind-graded with an anchor; Cactus only afterwards with a stronger cap and an early fade
</integration>
</claude_context>

**Next Action:** prototype `sharp-sly2` and run W2-08 at δ 0 (needs approval).

### Sources (accessed 2026-10-31)
- MiniMax, interleaved thinking: https://www.minimax.io/news/why-is-interleaved-thinking-important-for-m2
- BFCL multi-turn thinking-history study: https://arxiv.org/html/2606.00135
- OpenAI cookbook, reasoning items: https://developers.openai.com/cookbook/examples/responses_api/reasoning_items
- Anthropic, extended thinking / block preservation: https://platform.claude.com/docs/en/build-with-claude/thinking
- Z.ai thinking mode: https://docs.z.ai/guides/capabilities/thinking-mode
- DeepSeek thinking mode: https://api-docs.deepseek.com/guides/thinking_mode
- Qwen3.6-27B card: https://huggingface.co/Qwen/Qwen3.6-27B · Qwen3-32B card: https://huggingface.co/Qwen/Qwen3-32B
- Reasoning pruning in long agents: https://arxiv.org/abs/2609.29875
- ECHO (snippet): https://arxiv.org/abs/2606.31650
- Sly v1.9.1 release: https://github.com/SlyBase/vllm-sly-radiance/releases/tag/v1.9.1 · issue #164: https://github.com/SlyBase/vllm-sly-radiance/issues/164
- froggeric template cache discussion (snippet, T2): https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates/discussions/80
- Local (MEASURED): `campaigns/agentic/2026-10-30-0947-dpf-brief-ab/templates/{model-stock-qwen3.8.chat_template.jinja,render_test.txt,froggeric-README.md}`,
  `campaigns/agentic/2026-10-30-0947-dpf-brief-ab/results/template_tokens.json`, the 1.9.1 image's `/opt/qwen-fixed.jinja`,
  `campaigns/agentic/2026-10-31-0000-redhat191-sharp-w208-blind/sharp-chat_template.jinja`, and the run dirs cited above.
