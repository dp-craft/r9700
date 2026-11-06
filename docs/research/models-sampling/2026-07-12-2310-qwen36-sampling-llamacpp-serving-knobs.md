<!-- meta
date: 2026-07-12 23:10
takeaway: Qwen3.6 thinking mode officially wants temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 (never greedy) — our earlier campaign ran temp 1.0, the likely root of the runaways/divergence. llama.cpp b9950 already exposes every lever we need: --reasoning-budget (cap thinking), --cache-reuse/--cache-ram (agentic prefix reuse), --spec-draft-n-max/-p-min (MTP/draft tuning). For a harder agentic eval, borrow IFEval/AgentIF verifiable multi-constraint tasks.
-->

# Qwen3.6 sampling + llama.cpp serving/thinking/MTP/cache knobs + hard-eval landscape

- **Date:** 2026-07-12 23:10
- **Scope:** the tuning reference for the Round-2 (quality) campaign on the R9700 — recommended
  sampling for Qwen3.6, the llama.cpp b9950 flags that control thinking/cache/speculation, and how
  to build a *harder, auto-gradable* agentic-coding eval.
- **Provenance:** sampling recommendations = **CLAIMED** (Qwen model cards/docs). Flag *existence* =
  **MEASURED** (local `llama-server --help`, build b9950-961e4b26a). Flag *behavior* + eval
  benchmarks = **CLAIMED** (project docs / papers). One key inference (temp 1.0 caused our
  instability) is tagged **INFERRED**.

## Summary

1. **Sampling: our earlier run was mis-configured.** Qwen3.6 **thinking mode** officially wants
   **temp 0.6 / top_p 0.95 / top_k 20 / min_p 0**, and **explicitly no greedy decoding** (causes
   repetition/degradation). The 27B fine-tune campaign used **temp 1.0** — far too hot. **INFERRED:**
   this is the most likely root of the observed instability (hauhau's empty-answer runaways, rico's
   markdown-leak, and the MTP trajectory divergence are all classic over-temperature symptoms). Fix
   the baseline before blaming the models.
2. **Every lever we want already exists in llama.cpp b9950** — no new engine needed (see the vLLM
   dead-end in the companion doc). `--reasoning-budget` caps thinking tokens; `--cache-reuse` +
   `--cache-ram` give agentic prefix reuse; `--spec-draft-n-max/-n-min/-p-min` tune MTP/drafting.
3. **A harder eval is required to answer "does thinking help".** Puzzle tasks (primes/clock) are too
   easy and saturate. Borrow the **verifiable multi-constraint** style of IFEval/AgentIF: many
   simultaneous rules + tool-call schema adherence + long code context, still auto-graded.

## Recommended sampling (Qwen3.6) — CLAIMED (Qwen docs/cards)

| Mode | temp | top_p | top_k | min_p | notes |
|------|-----:|------:|------:|------:|-------|
| **thinking** (`enable_thinking=true`) | **0.6** | 0.95 | 20 | 0 | **never greedy**; repetition/degradation if temp too low or greedy |
| non-thinking (`enable_thinking=false`) | 0.7 | 0.8 | 20 | 0 | more focused output |
| repetition control | — | — | — | — | `presence_penalty` 0–2 (caution: high values → language mixing, slight quality drop) |
| output length | — | — | — | — | 32768 typical; up to 38912 for hard math/competition-code |

⚠️ **Verify on the 27B card specifically** — there's a public note that Qwen3.6-27B and
Qwen3.6-35B-A3B may carry *different* recommended params, and the 35B-A3B card itself has an
"inconsistent parameters" thread. Treat 0.6/0.95/20/0 as the thinking-mode default, then A/B
temp 0.6 vs 0.7 on our hard tasks.

## llama.cpp b9950 serving knobs — MEASURED (exist in our build) / CLAIMED (behavior)

| Flag | Default | What it does | Use in our plan |
|------|--------:|--------------|-----------------|
| `--reasoning-budget N` | −1 (unbounded) | token budget for thinking; **0 = no-think**; injects an end-of-thinking tag at the cap | cap runaways; sweep {−1,4096,2048,1024,0} for quality-per-latency |
| `--reasoning-budget-message` | — | message injected before the forced `</think>` | steer a graceful "answer now" |
| `--reasoning-format` | auto | whether thought tags are allowed/extracted | keep thinking parseable |
| `--chat-template-kwargs '{...}'` | — | extra params to the jinja template (e.g. `enable_thinking`) | toggle thinking per model |
| `--cache-reuse N` | off | min chunk size (≈256) to reuse cached KV via **KV-shifting** for a shared *prefix + changed tail* | agentic tool-turn reuse |
| `--cache-ram N` (`-cram`) | 8192 MiB | **host-memory** prompt cache ("extra slots"), prefix hot-swap | keep a 10–20K system+code prefix warm across turns |
| `--ctx-checkpoints N` | — | SWA/context checkpoints | long multi-turn stability |
| `--context-shift / --no-context-shift` | on | context shift on infinite generation | control eviction behavior |
| `--spec-draft-n-max N` | 3 | draft tokens per speculative step | MTP throughput vs acceptance sweep {2,3,5,8} |
| `--spec-draft-n-min N` | — | minimum draft tokens | pair with n-max |
| `--spec-draft-p-min P` (`--draft-p-min`) | **0.00** | **min speculative probability** — only speculate when confident | **raise (0.5/0.75) to curb MTP trajectory divergence / runaways** |
| `--spec-draft-type-k/-v` (`-ctkd/-ctvd`) | — | draft-model KV type | keep draft KV cheap |
| `--spec-type draft-mtp` | off | enable the embedded MTP draft head | the MTP on-switch (already wired via `MTP=1`) |

**Cache-reuse mechanics (CLAIMED):** for a *stable* prefix, requests 2+ restore from cache instead
of re-prefilling — community reports a 128K re-prefill dropping from ~60 s to ~200 ms. **KV-shift
reuse** (`--cache-reuse`) additionally handles a *prefix + small changed tail* (the real agentic
pattern) by shifting the cached slice forward and prefilling only the delta.
⚠️ **Prompt-cache killer:** if the *beginning* of the prompt changes even slightly (timestamps,
reordered blocks, a run-id prefix), reuse silently fails — verify our agent harness keeps a stable
prefix. (Our tracked `agentic-*.txt` deliberately put a unique run-id at the **start** to *defeat*
cache — do not use them to measure reuse.)

**Speculative/MTP (CLAIMED):** effective speculation needs high draft acceptance (70%+). MTP's draft
head shares the model, so acceptance is normally high; but at high temperature the accept/reject
step consumes RNG differently than plain sampling → **same seed ≠ same tokens**, which is how our
MTP-on run diverged into a runaway. Raising `--spec-draft-p-min` makes drafting conservative
(speculate only when confident) → less divergence, at some decode-speed cost. **This coupling means
sampling must be fixed before MTP draft-param tuning.**

## Harder agentic eval — the benchmark landscape (CLAIMED)

To actually detect whether a thinking/sampling change helps for *heavy agentic coding with rules +
tool use*, the eval must be much harder and agentic-shaped, yet still auto-gradable:

| Benchmark | What it contributes | Borrow for our eval |
|-----------|---------------------|---------------------|
| **IFEval** | 25 *verifiable* instruction types, 541 prompts; multi-constraint compliance (length/format/keywords) auto-checked | verifiable multi-rule tasks, no judge needed |
| **AgentIF** | agentic instruction-following; 707 instrs, **avg 11.9 constraints** each, covering **tool specs + conditions + formatting + safety** | our target shape: many simultaneous rules + a tool-call schema to honor |
| **IFBench** | 58 *new* verifiable constraints (generalization to unseen rule types) | guard against overfitting to a fixed rule set |
| **Multi-IF** | multi-turn (3 turns) instruction following | test stability across tool-result turns |

**Design implication:** build ~10–15 tasks that each stack **8–12 verifiable constraints** (output
format, ordering, forbidden tokens, must-cite line numbers, a strict tool-call JSON schema) on top
of a **10–50K real-code context**, plus a couple **multi-turn** cases (tool result appended → must
stay consistent). Grade with the existing deterministic verifiers (extended) so the perf-sensitive
knobs are measured against an objective signal, reserving the LLM-judge for the few open-ended ones.

## Sources
- Qwen3 quickstart / sampling (thinking 0.6/0.95/20/0, non-thinking 0.7/0.8/20/0, no greedy): https://qwen.readthedocs.io/en/latest/getting_started/quickstart.html · https://huggingface.co/Qwen/Qwen3-8B
- Qwen3.6-27B vs 35B-A3B sampling discussion: https://huggingface.co/Qwen/Qwen3.6-27B/discussions/10 · https://huggingface.co/Qwen/Qwen3.6-35B-A3B/discussions/23
- Vendor param quick-reference: https://muxup.com/2025q2/recommended-llm-parameter-quick-reference
- llama.cpp speculative decoding docs: https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md
- llama.cpp host-memory prompt caching (PR #16391): https://github.com/ggml-org/llama.cpp/pull/16391
- llama.cpp KV cache reuse tutorial (#13606): https://github.com/ggml-org/llama.cpp/discussions/13606
- Claude Code + llama.cpp prompt-cache pitfall: https://www.mykolaaleksandrov.dev/posts/2026/06/claude-code-llamacpp-prompt-cache-fix/
- IFEval / AgentIF / IFBench / Multi-IF: https://arxiv.org/html/2505.16944v1 (AgentIF) · https://benchlm.ai/instruction-following (IFEval) · https://github.com/facebookresearch/Multi-IF
