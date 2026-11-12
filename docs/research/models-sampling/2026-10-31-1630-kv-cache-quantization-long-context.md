<!-- meta
date: 2026-10-31 16:30
takeaway: 8-bit KV (llama.cpp q8_0, calibrated fp8) is near-lossless at short context (Qwen3 8B q8_0 PPL 7.3195 vs f16 7.3203; Qwen3.5-9B KLD 0.00076) and, on NVIDIA with calibrated or even scale-1.0 fp8, holds on Qwen3.x to 256k-1M (MRCR ~94-98% recovery, Qwen3.5-27B ≤0.7 pt loss). But no evidence exists for our exact stack (hybrid Qwen3.8-27B, ROCm radiance R4D fp8 / Vulkan q8_0) above ~130k. The KV delta (0-3 pts) is far smaller than the model's own context rot (NoLiMa: 11/13 models <50% of baseline at 32k), and in our agentic runs Claude Code's auto-compaction at ~136k is the dominant "forgetting". The RedHat MXFP4 checkpoint ships calibrated per-tensor fp8 k/v scales (MEASURED). Next step: own needle/MRCR at 64k/128k/190k, accept at ≥95% recovery.
-->

# Deep Dive: KV-cache quantization (q8_0 / fp8) quality at long context

**Date:** 2026-10-31 · **Asked by:** the user ("up to what size is q8 KV stable, with low hallucination and forgetting? Is there a link or benchmark?")
**Method:** a `/research` deep-dive pass using one Sonnet web-research subagent (WebSearch + WebFetch, Tier-1 first). Local facts were
checked by hand and are tagged MEASURED. The companion pass on quantization vs reasoning length, compaction and variance is in
[2026-10-31-1635-quantization-reasoning-length-compaction-variance.md](2026-10-31-1635-quantization-reasoning-length-compaction-variance.md).
**Provenance:** everything external is `CLAIMED` and cited. "snippet" means the number was seen only in a search snippet, not on
the fetched page. Our own inspection is `MEASURED`.

## Strategic Summary

The short answer is that 8-bit KV is near-lossless wherever it has been measured, and it has been measured to 256k-1M only on
NVIDIA fp8 paths. For our two engines on a hybrid Qwen3.8-27B there is no published measurement above ~130k, so the honest ceiling
is: **near-lossless to ~128k by strong analogy, plausible to 256k, unverified on our stack**. More important for practice: in our
agentic sessions the model's own long-context decay and Claude Code's auto-compaction at ~136k (MEASURED: it drops 109-122k tokens
of working context per event) matter far more than 8-bit KV precision.

| Question | Short answer | Strength |
|---|---|---|
| q8_0 KV vs f16, short context | Indistinguishable: Qwen3 8B PPL 7.3195 vs 7.3203; Qwen3.5-9B KLD 0.000757 | T1 (llama.cpp PR #21038) |
| fp8 KV at long context | Qwen3.5-27B: ≤0.7 pt lost, MRCR to 1M matches baseline; Qwen3-30B-A3B MRCR 256k ~94-98% recovery | T1 (vLLM blog, NVIDIA only) |
| Failure mode to watch | Kernel accumulation bug: needle at 128k 91% → **13%** (Hopper FA3, fixed by two-level accumulation) | T1 (vLLM blog) |
| Calibrated vs scale 1.0 | Calibrated per-tensor scales are recommended. **Our RedHat checkpoint ships them** (16 layers × k/v) | T1 docs + MEASURED |
| K vs V | K is the sensitive side (channel outliers); moot at 8 bits, matters at 4 | T1 (KIVI) + T2 consensus |
| KV delta vs model decay | KV 8-bit 0-3 pts vs NoLiMa: 11/13 models below 50% of their short baseline at 32k | T1 |
| Hybrid Qwen3.8 at 130-200k, ROCm/Vulkan | **No evidence found** → measure it ourselves | gap |

## Key Questions

- Up to what context length is 8-bit KV near-lossless, and where does the evidence stop?
- Is llama.cpp `q8_0` (block int8) or vLLM `fp8` (per-tensor E4M3) the riskier format?
- Is K or V more sensitive?
- How does the KV-quant delta compare with the model's inherent long-context degradation ("context rot")?
- What is unknown for hybrid Qwen3.8-27B (16 full-attention layers of 64) at 130-200k on our AMD stack?

## Overview

A KV cache stores, per token and per full-attention layer, the key and value vectors that later tokens attend to. Quantizing it to
8 bits halves its memory and lets the same VRAM hold twice the context. The cost is a small error in every attention score, and that
error is paid against **all** history, so it can in principle grow with depth. That is why the question is depth-dependent and not
answered by short-context perplexity.

Qwen3.8-27B is a hybrid. Only 16 of 64 layers are full (gated) attention with a KV cache: 4 KV heads, head_dim 256. The other 48 are
Gated DeltaNet linear-attention layers with a fixed-size recurrent state. That state is kept in bf16 in vLLM
(`--mamba-ssm-cache-dtype bfloat16`, MEASURED from our argv). This shrinks the KV cache about 4×, so the VRAM motive is weaker. It also
means **all exact long-range retrieval runs through those 16 layers**, so their KV precision may matter more per layer than in a dense
model (INFERRED; no ablation found).

## How It Works — the two formats we run

| | llama.cpp `-ctk q8_0 -ctv q8_0` (Q4_K_XL arm) | vLLM `--kv-cache-dtype fp8` (RedHat arm) |
|---|---|---|
| Number format | int8, symmetric, **one fp16 scale per 32 values** | FP8 E4M3: 3-bit mantissa, 4-bit exponent |
| Scale granularity | per 32-value block (adapts locally) | **per tensor**, one k_scale and one v_scale per layer (per-head is FlashAttention-backend only) |
| Scale source | computed on the fly | checkpoint (`kv_cache_scheme`) or default **1.0** if absent |
| Outlier handling | since PR #21038 (merged 2026-04-01) a Hadamard rotation on Q/K/V before quantizing (our b11448 build postdates it, INFERRED from build order) | E4M3's exponent gives dynamic range. A wrong scale wastes it |
| Our checkpoint | n/a (computed) | **MEASURED:** `RedHatAI/Qwen3.8-27B-MXFP4` `config.json` → `kv_cache_scheme: {type: float, num_bits: 8, strategy: tensor, observer: static_minmax, symmetric: true}`; `model.safetensors.index.json` has **32** `*.self_attn.{k,v}_scale` tensors (16 attention layers × 2) |
| Attention kernel on our box | Vulkan FA (`-fa on`) | target: radiance `R4D_HYBRID` (libr4d 0.5.0; prefill q ≥ 512 runs `attn_prefill_h256_gqa6_fp8kv`); DFlash drafter: `TRITON_ATTN` (MEASURED: server log "Using R4D_HYBRID backend", "R4D_ATTN_DB: prefill instance …") |

## Evidence (CLAIMED unless tagged)

| Claim | Number(s) | Model | Context | Benchmark | KV dtype | Source | Tier |
|---|---|---|---|---|---|---|---|
| q8_0 ≈ f16 after rotation | Qwen3 8B PPL q8_0 7.3195 vs f16 7.3203; q4_0 7.5012 (7.6451 before rotation). Gemma3 4B q8_0 7.6914 vs f16 7.6905. Qwen3.5 4B q8_0 8.3261 vs f16 8.3266 | Qwen3, Gemma3, Qwen3.5 | short (wiki chunks) | PPL | q8_0/q5_1/q4_0 | [llama.cpp PR #21038](https://github.com/ggml-org/llama.cpp/pull/21038) | T1 |
| Same PR, KLD (comment) | Qwen3.5-9B KLD q8_0 0.000866 → 0.000757 with rotation; q5_1 0.001821; q4_0 0.005059 | Qwen3.5-9B | n/s | KLD | K=V type | same | T1 (comment) |
| Community KLD vs f16 | q8_0 0.024 (27B), 0.039 (35B-A3B); q4_0 0.087-0.117; q4_0 "long documents" 0.581 | Qwen3.6 27B / 35B-A3B | n/s | KLD | K=V | [localbench](https://localbench.substack.com/p/kv-cache-quantization-benchmark) | T2 |
| FA + quantized KV PR | speed only, no PPL/KLD in the thread | Llama 7B | — | speed | q8_0/q4_0 | [llama.cpp PR #7527](https://github.com/ggml-org/llama.cpp/pull/7527) | T1 (negative) |
| vLLM fp8 docs | default fp8 uses scale 1.0; calibrate with llm-compressor; per-tensor default; per-head needs FlashAttention + calibration; no accuracy numbers | — | — | — | fp8 | [docs.vllm.ai quantized KV cache](https://docs.vllm.ai/en/latest/features/quantization/quantized_kvcache/) | T1 |
| Kernel accumulation failure | needle at 128k: BF16 91%, FP8 **13%** before fix, 89% after two-level accumulation; appears from ~100k | Llama-3.1-8B | 128k | NIAH | fp8, scale 1.0 | [vLLM blog: fp8 KV cache](https://vllm.ai/blog/fp8-kvcache) | T1 (vendor) |
| Uncalibrated fp8 on Qwen | Qwen3.5-27B ≤0.7 pt lost (lowest recovery 99%, AIME25), MRCR AUC = baseline to 1M. Qwen3-30B-A3B MRCR 256k ~94% (bf16 model) / 98% (fp8 model) on H100, ~93/96% on B200. Rule: avoid fp8 KV if recovery <95% on your workload | Qwen3.5-27B, Qwen3-30B-A3B | ≤1M | MRCR, reasoning | fp8 scale 1.0 | same | T1 (vendor) |
| Same blog, hardware scope | Hopper (FA3) and Blackwell (FlashInfer) only; **ROCm/Triton not covered** | — | — | — | — | same | T1 |
| Calibrated fp8, our model family | one-shot calibration of the 16 attention layers → per-tensor scales 0.016-0.203; needle 9/9 at 32k, 131k, 262k (= BF16); 10-task avg 70.04 vs 70.29 | Qwen3.8-27B (GPTQ-INT4 + FP8 KV) | ≤262k | NIAH + 10 tasks | fp8 calibrated | [friendli.ai model card](https://friendli.ai/models/abhishekchohan/Qwen3.8-27B-GPTQ-INT4-FP8KV) | T2, single author, NVIDIA |
| Architecture | 64 layers = 16 × (3 Gated DeltaNet + 1 Gated Attention), 4 KV heads, head_dim 256, native 262,144 | Qwen3.6-27B (same layout as 3.8) | — | — | — | [Qwen3.6-27B card](https://huggingface.co/Qwen/Qwen3.6-27B) | T1 |
| Integer KV8 at 16k | LongEval 16k: LLaMA2-7B FP16 57.80 / W8KV8 56.40 / W8KV4 37.00; Vicuna-13B 41.60 / 40.80 / 29.00. KV8 "almost lossless" on Vicuna/ChatGLM, degrades LongChat | LLaMA2, Vicuna, ChatGLM | ≤16k | LongEval | int8/int4 | [arXiv 2402.18158](https://arxiv.org/html/2402.18158) | T1 |
| 4-bit KV to 32k | KIVI-4 within ~3 pts of full KV on LongBench (−2.56 … +2.95 over 12 cells) | Llama-3.1-8B, Mistral-7B | 1k-32k | LongBench | 2/4-bit | [arXiv 2607.05399](https://arxiv.org/html/2607.05399) | T1 |
| K has channel outliers | keys quantized per-channel, values per-token; 2-bit "almost the same quality" | Llama, Falcon, Mistral | — | — | 2-bit | [KIVI, arXiv 2402.02750](https://arxiv.org/abs/2402.02750) | T1 |
| Retrieval cliff moves with quantized cache | Qwen2.5-72B retrieves through 96k at FP16 but only through 32k with a quantized cache (bit width not visible) | Qwen2.5-72B | 4k-128k | needle | "quantized" | [NeurIPS 2026 "Length, Not Bit Width"](https://neurips.cc/virtual/2026/173781) | snippet only |
| Context rot | 11 of 13 models fall below 50% of their short-context baseline at 32k; GPT-4o 99.3 → 69.7 | 13 LLMs | 32k | NoLiMa | — | [NoLiMa, arXiv 2502.05167](https://arxiv.org/abs/2502.05167) | T1 |
| Context rot, Qwen3 | Qwen3-235B/32B/8B degrade with input length, faster at low needle-question similarity; LongMemEval ~113k full vs ~300 tok focused | Qwen3 | ≤113k | NIAH-ext, LongMemEval | — | [Chroma: Context Rot](https://www.trychroma.com/research/context-rot) | T2 |
| Model decay 128k → 256k | Qwen3.5-4B Base RULER 82.63 → 72.56 | Qwen3.5-4B | 128k-256k | RULER | bf16 | [arXiv 2608.30567](https://arxiv.org/pdf/2608.30567) | snippet |

## History & Context

Quantized KV in llama.cpp arrived together with flash attention (PR #7527), and q8_0 has been the "safe" setting ever since. The
2026 rotation PR (#21038) narrowed the q8_0 gap further and mostly helped 4-bit. In vLLM, fp8 KV has been available for years. The
2026 vendor blog is the first broad long-context accuracy report. It found that the main failure was a **kernel accumulation bug**,
not the 8-bit format: on Hopper FA3 at ≥100k, needle accuracy fell from 91% to 13% until two-level accumulation fixed it. The
literature (KIVI, KVQuant, LongEval studies) focused on 2-4 bits and treated 8 bits as the lossless baseline. That is why few papers
test 8-bit KV at 128k+ at all.

## Patterns & Best Practices

- **Prefer calibrated scales for fp8.** vLLM's docs recommend calibration, and the RedHat checkpoint already ships per-tensor k/v
  scales. Keep using it as-is. Do not use a checkpoint without `kv_cache_scheme` for fp8 KV without measuring.
- **Validate on your workload with a recovery threshold.** vLLM's own rule is to keep fp8 KV only if accuracy recovery is ≥95%.
- **At 8 bits, K vs V does not matter. At 4 bits, keep K at 8** (K8/V4). That is T2 consensus and is not measured on Qwen3.x.
- **Separate the format from the kernel.** A depth cliff can come from attention-kernel accumulation, not quantization. A test must
  run on the exact backend: radiance `R4D_HYBRID` / libr4d on ROCm here, not "fp8 in general".
- **Context rot is the bigger budget.** Keep the working context lean: compaction policy, focused reads. That buys more than
  f16-vs-q8 KV (INFERRED from the magnitudes above).

## Limitations & Edge Cases

- **No hybrid-model ablation.** Whether the 16 attention layers of Qwen3.8 are more sensitive per layer is unknown. Mitigation: test.
- **No ROCm or Vulkan long-context data.** All long-context fp8 numbers are NVIDIA kernels. The vLLM blog flags head_dim 256 (our
  case) as a place where the accumulation fix is optional and needs accuracy testing.
- **q8_0 long-context data is missing entirely.** There is short-context PPL/KLD only, and no needle or RULER on any hybrid.
- **Snippet-only items** (not verified on the fetched page): the "Length, Not Bit Width" cliff, the Qwen3.5-4B RULER drop, the
  Qwen3.5-27B LongBench v2 score, a Gemma-4 q8_0 KLD of 0.108, and "K more sensitive" as stated in llama.cpp PR #7412.

## Current State & Trends

Rotation before quantization (llama.cpp #21038) and two-level accumulation (vLLM) are the 2026 fixes. Both target the tails rather
than the mean. Per-head fp8 scales exist in vLLM (vllm#30833, #30141), but without published accuracy results. Research has moved to
2-4-bit KV and to "bit width vs length" interactions (the NeurIPS 2026 snippet), and finds that quantization *moves the retrieval
cliff earlier* rather than shifting accuracy uniformly.

## Key Takeaways

1. **8-bit KV is the lossless default wherever it is measured.** It is measured to 256k-1M on Qwen3.x only for NVIDIA fp8. For our
   stack the evidence stops at short context (q8_0) or does not exist (ROCm fp8).
2. **The failure mode is a cliff, not a slope.** Accumulation bugs and quantization-shifted retrieval cliffs show up as sudden drops
   past ~100k. A test must sample depths (64k/128k/190k), not one point (iron rule 16 applied to quality).
3. **Our RedHat fp8 KV is the "good" fp8 variant: calibrated per-tensor scales (MEASURED). The open risk is the ROCm R4D/libr4d attention kernel,
   not the format.**
4. **Practical ceiling today: treat ≤128k as safe by analogy and 128-200k as plausible but unverified.** Above 128k the model's own
   decay and Claude Code's compaction policy dominate. See
   [the levers analysis](../../findings/agentic/2026-10-31-1640-agentic-thinking-volume-and-levers.md).

## Remaining Unknowns

- [ ] Needle/MRCR recovery of RedHat fp8 (R4D_HYBRID, ROCm) vs `--kv-cache-dtype auto` (bf16) at 64k / 128k / 190k.
- [ ] Needle recovery of Q4_K_XL with `-ctk/-ctv q8_0` vs f16 on Vulkan at the same depths.
- [ ] Whether the hybrid's 16 attention layers make Qwen3.8 more KV-sensitive than dense models (per-layer ablation).
- [ ] The NeurIPS 2026 "quantized cache moves the cliff" result: bit width and setup.

## Implementation Context

<claude_context>
<application>
- when_to_use: deciding the KV dtype and the context/compaction ceiling for long agentic sessions on the R9700 (Q4_K_XL llama.cpp with q8_0 KV; RedHat MXFP4 vLLM with fp8 KV)
- when_not_to_use: as proof that q8/fp8 is lossless at 130-200k on ROCm/Vulkan. That is unmeasured.
- prerequisites: fp8 KV only with a checkpoint that has `kv_cache_scheme` (calibrated scales) unless measured otherwise
</application>
<technical>
- libraries: llama.cpp (`-ctk/-ctv q8_0`, rotation since PR #21038); vLLM `--kv-cache-dtype fp8` + llm-compressor `kv_cache_scheme`
- patterns: depth-sampled quality probes (≥3 depths incl. ~190k); accept a KV dtype at ≥95% recovery vs bf16/f16
- gotchas: kernel accumulation cliffs at ≥100k (seen on Hopper FA3); head_dim 256; per-head scales only on the FA backend; ROCm untested
</technical>
<integration>
- works_with: bench/core/gguf_kv.py and gen_campaign.py vram-ctx for the VRAM side; the f16-vs-q8_0 ≤5% speed rule (sweep.py) for the speed side
- conflicts_with: bf16 KV at 262k on 32 GB (does not fit with the 27B + drafter, INFERRED from the 2026-10-22 KV-pool measurement)
- alternatives: bf16 KV at a lower ctx (e.g. 131k) as the quality reference arm; compaction-window tuning to keep the working context smaller
</integration>
</claude_context>

**Next Action:** add a long-context retrieval probe (needle/MRCR at 64k/128k/190k, KV dtype as the A/B variable) to the tool layer.
No tool owns this today: `capture_engine.py probe` measures throughput only (rule 6 gap). The proposal is in the levers analysis.

### Sources (accessed 2026-10-31)
- llama.cpp PR #21038 (KV rotation): https://github.com/ggml-org/llama.cpp/pull/21038
- llama.cpp PR #7527 (FA + quantized KV): https://github.com/ggml-org/llama.cpp/pull/7527
- vLLM docs, quantized KV cache: https://docs.vllm.ai/en/latest/features/quantization/quantized_kvcache/
- vLLM blog, fp8 KV cache: https://vllm.ai/blog/fp8-kvcache
- Qwen3.6-27B model card: https://huggingface.co/Qwen/Qwen3.6-27B
- Qwen3.8-27B GPTQ-INT4-FP8KV (third party): https://friendli.ai/models/abhishekchohan/Qwen3.8-27B-GPTQ-INT4-FP8KV
- Evaluating Quantized LLMs: https://arxiv.org/html/2402.18158
- KIVI: https://arxiv.org/abs/2402.02750 · KVQuant: https://arxiv.org/abs/2401.18079
- KV compression benchmark (Yuan et al. 2024, abstract only): https://arxiv.org/abs/2407.01527
- Agrawal & Mayer 2026: https://arxiv.org/html/2607.05399
- Mekala et al. 2025 (weights, not KV; snippet): https://arxiv.org/pdf/2505.20276
- NeurIPS 2026 "Length, Not Bit Width" (snippet): https://neurips.cc/virtual/2026/173781
- NoLiMa: https://arxiv.org/abs/2502.05167 · Chroma Context Rot: https://www.trychroma.com/research/context-rot
- localbench KV KLD (T2): https://localbench.substack.com/p/kv-cache-quantization-benchmark
- Local inspection (MEASURED): `/mnt/Lin1/work/vllm/sly-radiance/models/RedHatAI__Qwen3.8-27B-MXFP4@16a86728/{config.json,model.safetensors.index.json}`;
  `campaigns/agentic/2026-10-31-0000-redhat191-sharp-w208-blind/rep1/r191-sharp-d0/{server.txt,server-container.log}`
