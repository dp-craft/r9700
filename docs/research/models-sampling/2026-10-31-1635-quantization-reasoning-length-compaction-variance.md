<!-- meta
date: 2026-10-31 16:35
takeaway: Companion research for the thinking-volume analysis. (1) 4-bit weight-only quantization does not lengthen reasoning traces (Liu et al. 2025: W4G128 lengths ≈ BF16, only W3 / W4A4KV4 lengthen, mostly at 1.5B), so a Q4-vs-MXFP4 thinking gap is not expected from the format; MXFP4 W4A4 recovers less than NVFP4/INT4 on Llama (87.8-93.3% vs 94.7-96.1%), not measured on reasoning models. (2) Claude Code's auto-compact window is set by CLAUDE_CODE_AUTO_COMPACT_WINDOW (100k-1M, capped at the model window); PCT_OVERRIDE can only lower the trigger; compaction keeps ≤5 recent files and turns files >5k tokens into path-only references. (3) Agentic step counts vary run to run (CV ~15% at best, snippet); ~6 runs per arm is established practice.
-->

# Deep Dive (companion): quantization vs reasoning length, Claude Code compaction, agentic run-to-run variance

**Date:** 2026-10-31 · **Method:** a `/research` deep-dive pass with one Sonnet web-research subagent, run sequentially after the KV
pass ([2026-10-31-1630-kv-cache-quantization-long-context.md](2026-10-31-1630-kv-cache-quantization-long-context.md)).
**Why:** the user asked why the Q4_K_XL arm "thought much less" than RedHat MXFP4. These are the external facts the
[analysis](../../findings/agentic/2026-10-31-1640-agentic-thinking-volume-and-levers.md) needs. External facts are `CLAIMED`. "snippet" means the
number was not on a fetched page.

## Strategic Summary

Nothing in the literature predicts that the 4-bit weight format changes how much a reasoning model thinks. Changes in output length
appear only at 3 bits or with 4-bit activations plus a 4-bit KV cache, and mostly in tiny models. The Claude Code compaction knobs
explain the ~136k trigger seen in every run. The variance literature says one run per arm cannot resolve a 20% step-count difference.

## Key Questions → answers

| # | Question | Answer | Source | Tier |
|---|---|---|---|---|
| 1 | Does 4-bit weight quantization lengthen reasoning? | **No.** W4G128 (AWQ/GPTQ) output lengths stay close to BF16. Longer outputs appear only with W3G128 or W4A4KV4, mainly in the 1.5B model. W4 accuracy drop −0.4…−3.9 pts (AWQ) and −0.9…−2.4 (GPTQ); W3 −3.9…−18.6. Qwen3-8B: W4 −1.3 (AWQ) / −1.5 (GPTQ), W3 −13.0 / −14.5. Gains from longer reasoning grow more slowly for quantized models | [Liu et al. 2025, arXiv 2504.04823](https://arxiv.org/html/2504.04823) (figures read via the fetch tool's page summary) | T1 |
| 1b | Is MXFP4 weaker than other 4-bit formats? | **Yes, in W4A4 PTQ.** Llama-3.1-8B recovery RTN / GPTQ / MR-GPTQ: INT4 92.6 / 92.8 / not reported; NVFP4 94.7 / 95.9 / 96.1; MXFP4 87.8 / 89.5 / 93.3. Llama-3.2-1B RTN: MXFP4 67.7 vs NVFP4 83.9. The study covered no reasoning models: Qwen3 thinking was turned off | [arXiv 2509.23202](https://arxiv.org/html/2509.23202v3) | T1 |
| 1c | What is our RedHat checkpoint? | Its README says "GPTQ with AWQ activation smoothing … quantizing the **weights and activations** of the linear operators", i.e. W4A4-class MXFP4. Q4_K_XL is weight-only | local README (MEASURED) | — |
| 2 | Sampler | The Qwen3 (original) card gives thinking mode temp **0.6** / top_p 0.95 / top_k 20 / min_p 0 and warns against greedy decoding. For presence_penalty it says "adjust between 0 and 2 to reduce endless repetitions", and that higher values may cause language mixing. **We follow the Qwen3.8 recipe the user chose: temp 1.0 / 0.95 / 20 / 0, presence 0, repetition 1.0** (user decision, not re-litigated). No source ties temperature to reasoning length | [Qwen3-32B card](https://huggingface.co/Qwen/Qwen3-32B) | T1 |
| 3 | Compaction trigger | `CLAUDE_CODE_AUTO_COMPACT_WINDOW` sets the window: 100k-1M, capped at the model window, and it takes precedence over the setting and flag. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is 1-100 and **can only lower** the trigger ("values above the default percentage are ignored"). `CLAUDE_CODE_MAX_CONTEXT_TOKENS` applies directly to unrecognized model IDs like ours, which otherwise default to an assumed 200k | [code.claude.com env-vars](https://code.claude.com/docs/en/env-vars), [model-config](https://code.claude.com/docs/en/model-config.md) | T1 |
| 3b | Exact threshold formula | User reconstruction: `threshold = min(floor(W × pct/100), W − 13000)`, which gives 153k at W = 180k. That does **not** match our measured 136.0-142.7k. **Fitted: 0.85 × (180000 − 20000) = 136000** matches the low end. The 20000 reserve is undocumented. Variation up to 142.7k is consistent with the check running between requests | [claude-code#31806](https://github.com/anthropics/claude-code/issues/31806) (unofficial) + our data | T1 issue / INFERRED |
| 3c | What compaction keeps | CLAUDE.md and auto-memory are re-injected. **Up to 5 recently touched files** are re-read, and any file >5,000 tokens comes back as a path-only "Referenced file". Skills are capped at 5k each and 25k total. Everything else is summarized | [code.claude.com context-window](https://code.claude.com/docs/en/context-window.md) | T1 |
| 4 | Run-to-run variance | SWE-agent GPT-4, 6 runs on SWE-bench Lite: 17.33-18.67% (sd ≈ 0.49), pass@6 32.67%. Single-run pass@1 spread 2.2-6.0 pp across 60k trajectories. SWE-Doctor sd 2.0 pts over 5 runs. Step-count CV ≈ 15.2% at best (source identity conflicting) | [arXiv 2405.15793](https://arxiv.org/pdf/2405.15793), [2608.13867](https://arxiv.org/pdf/2608.13867), [2607.00990](https://arxiv.org/pdf/2607.00990), [2603.25764](https://arxiv.org/pdf/2603.25764) | all snippet |

## Key Takeaways

1. **The weight format is not expected to change thinking volume at 4 bits** (T1). A thinking-volume gap between two 4-bit arms is,
   a priori, trajectory variance or something else. The analysis confirms per-step thinking is equal (MEASURED).
2. **MXFP4 W4A4 is the weaker 4-bit recipe on paper** (T1, Llama, non-reasoning). Our blind grades show no quality gap at n = 1, so
   the risk is unmeasured, not refuted.
3. **The ~136k compaction is our own configuration**: `AUTO_COMPACT_WINDOW=180000` with `PCT_OVERRIDE=85`, on servers that accept
   260-262k. The knob to move it is the window, not the percentage.
4. **One run per arm cannot separate a 20% step difference.** With CV ≈ 15%, n ≈ 8-9 per arm would be needed (INFERRED, two-sample
   power at 80%/α 0.05). Quality comparisons need more reps, or the Δ≥5 pre-registered rule we already use.

## Remaining Unknowns

- [ ] The official compaction formula, including the 20000 reserve, and whether `DISABLE_AUTO_COMPACT` / `DISABLE_COMPACT` exist as documented (not read).
- [ ] MXFP4 vs Q4_K on Qwen3.x **thinking** traces (no source found).
- [ ] Temperature vs reasoning length for Qwen3.x (no source found).

### Sources (accessed 2026-10-31)
- Liu et al. 2025, *Quantization Hurts Reasoning?*: https://arxiv.org/html/2504.04823
- MXFP4 / NVFP4 / INT4 PTQ comparison: https://arxiv.org/html/2509.23202v3
- Qwen3-32B model card: https://huggingface.co/Qwen/Qwen3-32B
- Claude Code env vars: https://code.claude.com/docs/en/env-vars · model config: https://code.claude.com/docs/en/model-config.md · context window: https://code.claude.com/docs/en/context-window.md
- claude-code issue #31806 (threshold reconstruction): https://github.com/anthropics/claude-code/issues/31806
- Variance (snippets): https://arxiv.org/pdf/2405.15793 · https://arxiv.org/pdf/2608.13867 · https://arxiv.org/pdf/2607.00990 · https://arxiv.org/pdf/2603.25764
