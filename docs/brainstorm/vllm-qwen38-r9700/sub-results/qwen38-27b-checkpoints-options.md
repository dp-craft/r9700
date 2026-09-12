# Qwen3.8-27B — which checkpoint can vLLM serve on a 32 GB R9700

**Brainstorm:** [vllm-qwen38-r9700](../vllm-qwen38-r9700.md)
**Type:** options
**Date:** 2026-09-11

---

Provenance: sizes/quant configs **VERIFIED** via the Hugging Face API (`/api/models/<repo>?blobs=true`
summing `.safetensors`, and each repo's `config.json`). Model-card facts **CLAIMED** (HF / vLLM recipe).

## Model facts

| Item | Value | Provenance |
|---|---|---|
| HF architecture | `Qwen3_5ForConditionalGeneration`, `model_type: qwen3_5` | CLAIMED — HF config.json |
| Multimodal | yes (vision tower; 333 `model.visual.*` tensors in the quantized repos) | VERIFIED (tensor index) |
| Context | 262,144 native (YaRN to ~1M) | CLAIMED — model card |
| Our GGUF (`unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf`, 17.56 GB) | llama.cpp arch `qwen35`, 65 blocks = 16 full-attn KV + 48 linear-attn (Gated-DeltaNet) + 1 nextn/MTP; KV f16 64 KiB/tok | VERIFIED — `bench/gguf_kv.py` header read |
| vLLM MTP config | `--speculative-config '{"method":"mtp","num_speculative_tokens":3}'` | CLAIMED — recipes.vllm.ai/Qwen/Qwen3.8-27B (text verified by fetch) |
| Other recipe flags | `--language-model-only`, `--mamba-backend triton`, `--mamba-cache-mode align` (prefix-cache alignment for hybrid), `--enable-prefix-caching`, `--limit-mm-per-prompt` | CLAIMED — recipe page (verified by fetch) |
| Min vLLM (recipe) | 0.17.0+ | CLAIMED — recipe |
| vLLM #40681 "Until it merges, AMD users…" on the recipe page | concerns **Hy3-preview on 8×MI300X**, not Qwen3.8 | VERIFIED — context read |

## All quantized Qwen3.8-27B checkpoints found (HF search "Qwen3.8-27B")

| Repo | Size | Quant config | Fits 32 GB with 34k ctx? | On gfx1201 (vLLM 0.29.0) | Verdict |
|---|---:|---|---|---|---|
| Qwen/Qwen3.8-27B (BF16) | 55.6 GB | — | no | — | ✗ |
| Qwen/Qwen3.8-27B-FP8 | 30.9 GB | fp8 e4m3, block [128,128] | **no** — leaves ~3 GB for KV (2.2 GB f16 @34k) + graphs + runtime | block-FP8 → AITER Triton path, gfx1201 missing from AITER arch table → FP32 fallback (CLAIMED) | ✗ memory + perf |
| unsloth/Qwen3.8-27B-FP8 | 30.9 GB | fp8 e4m3, block [128,128] | no | same | ✗ |
| orcarouter/Qwen3.8-27B-Uncensored-FP8 | 30.9 GB | (none in config) | no | — | ✗ |
| lued/Qwen3.8-27B-INT8-W8A16-MTP | 31.6 GB | c-t int8 W8A16 g128 | no | — | ✗ memory |
| unsloth/Qwen3.8-27B-unsloth-bnb-4bit | 22.3 GB | bitsandbytes | yes | `bitsandbytes` **absent** from ROCm `supported_quantization` in 0.19.1; bnb needs a gfx1201 source build; dequant-heavy | ✗ perf/support |
| unsloth/Qwen3.8-27B-NVFP4 | n/a | NVFP4 (Blackwell) | — | RDNA4 has no FP4 | ✗ |
| unsloth/Qwen3.8-27B-GGUF | 17–18 GB | GGUF | — | qwen35 GGUF unsupported in vLLM | ✗ (see gguf sub-result) |
| amd/Qwen3.8-27B-Quark-AWQ-MXFP4 | 19.8 GB | quark MXFP4 | yes | MXFP4 = MI350/MI355 only | ✗ |
| TelperionAI/Qwen3.8-27B-NVFP4-AWQ-GPTQ | 24.7 GB | c-t mixed, 8-bit float channel | yes | unclear mixed format | ✗ (low trust) |
| **RedHatAI/Qwen3.8-27B-INT4** | **19.5 GB** | c-t pack-quantized **int4, symmetric, group 128, actorder static**, observer memoryless_minmax | **yes** | **`RDNAHybridW4A16` eligible** (see kernels sub-result) | ✅ **CHOSEN** |
| SergiioB/Qwen3.8-27B-GPTQ-Int4-sym-G128-MTP-BF16 | 19.6 GB | gptq 4-bit g128, sym, desc_act False; MTP excluded from quant | yes | eligible (no g_idx, symmetric) | ✓ fallback |
| dbirks/Qwen3.8-27B-W4A16-AutoRound | 19.5 GB | c-t int4 g128 | yes | eligible | ✓ alt (community) |
| philbert440/…-Uncensored-Aggressive-W4A16-AWQ | 19.5 GB | c-t int4 g128 | yes | eligible | ✗ (modified model) |
| cyankiwi/Qwen3.8-27B-AWQ-INT4 | 21.0 GB | c-t int4 **g32** | yes | g32 **now accepted** by `RDNAHybridW4A16` (group sizes 32/64/128) — July's g32 failure was the old conch kernel | ✓ alt |
| abhishekchohan/Qwen3.8-27B-AWQ-INT4 | 21.0 GB | c-t int4 g32 | yes | same as cyankiwi | ✓ alt (low downloads) |
| JC1DA/…-Heretic-Uncensored-…-INT4-W4A16 | 19.5 GB | auto-round 4-bit g128 | yes | — | ✗ (modified model) |
| syvai/Qwen3.8-27B-DFlash2-W4A16 | 1.3 GB | c-t int4 g128 | — | a DFlash drafter, not the model | n/a |

## The two short-listed checkpoints — contents (VERIFIED from `model.safetensors.index.json` + config)

| | RedHatAI/Qwen3.8-27B-INT4 | SergiioB/…-GPTQ-Int4-sym-G128-MTP-BF16 |
|---|---|---|
| tensors | 2031 | 2399 |
| `model.language_model.*` | 1682 | 2050 |
| `model.visual.*` | 333 (unquantized, in ignore list) | 333 |
| MTP tensors (`mtp.*`) | **15, all unquantized (BF16)** | **15, unquantized (`-:.*mtp.*` dynamic exclusion)** |
| lm_head | BF16 | BF16 |
| ignore list (non-visual sample) | `layers.N.linear_attn`, `.linear_attn.norm`, `.in_proj_a`, `.in_proj_b` (small GDN gates kept BF16) | — |
| quant | c-t int4 sym g128, actorder **static** (no runtime g_idx) | gptq 4-bit sym g128, desc_act False |

→ Both keep the MTP head, so vLLM MTP speculative decoding is possible with either.

## The Unsloth question (user asked "maybe Unsloth would be good")

Unsloth publishes for Qwen3.8-27B: GGUF (our file), FP8 (30.9 GB), bnb-4bit (22.3 GB), NVFP4. On vLLM/RDNA4:
GGUF unsupported (arch), FP8 doesn't fit + falls back, bnb unsupported/slow on ROCm, NVFP4 needs FP4 hardware.
The Unsloth **framework** itself infers through HF `generate()`, which failed to load in July (§3.10 of the
tuning-optimum report) and is slower than vLLM by design. **Unsloth's useful contribution here is the GGUF,
which stays the llama.cpp side of the comparison.**

## Sources
- https://huggingface.co/api/models?search=Qwen3.8-27B · per-repo `/api/models/<id>?blobs=true` and `/raw/main/config.json`
- https://huggingface.co/RedHatAI/Qwen3.8-27B-INT4 · https://huggingface.co/SergiioB/Qwen3.8-27B-GPTQ-Int4-sym-G128-MTP-BF16
- https://huggingface.co/Qwen/Qwen3.8-27B · https://huggingface.co/Qwen/Qwen3.8-27B-FP8
- https://huggingface.co/unsloth/Qwen3.8-27B-GGUF · -FP8 · -unsloth-bnb-4bit · -NVFP4
- https://recipes.vllm.ai/Qwen/Qwen3.8-27B
