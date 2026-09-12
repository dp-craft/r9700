# vLLM 4-bit (W4A16) and FP8 kernel paths on ROCm gfx1201 — technical

**Brainstorm:** [vllm-qwen38-r9700](../vllm-qwen38-r9700.md)
**Type:** technical
**Date:** 2026-09-11

---

Everything marked VERIFIED was read directly from source (local 0.19.1 image via CPU-only `docker run`,
or `raw.githubusercontent.com/vllm-project/vllm/v0.29.0/...`). Runtime selection is **not** load-tested.

## 1. vLLM 0.29.0 — the path the chosen checkpoint should take

### ROCm mixed-precision (W4A16) kernel order — `vllm/model_executor/kernels/linear/__init__.py` `_POSSIBLE_KERNELS[ROCM]` (VERIFIED)
1. `RDNA3W4A16LinearKernel` — gfx1100 only (`on_gfx1100()`), fp16/bf16 → **not us**
2. **`RDNAHybridW4A16LinearKernel`** ← expected pick on gfx1201
3. `TritonW4A16LinearKernel` — group sizes −1/32/64/128/256, fp16/bf16, gfx1x-tuned branch
4. `ConchLinearKernel` — group sizes −1/128 only
5. `ExllamaLinearKernel` — fp16 activations only

(For contrast, the CUDA list is Cutlass/Machete/AllSpark/Marlin/Conch/Exllama/Triton/Humming.)

### `RDNAHybridW4A16LinearKernel` (`mixed_precision/rdna_hybrid_w4a16.py`, VERIFIED)
Docstring: *"Hybrid W4A16 kernel: Triton for prefill, HIP skinny for decode. Routes based on batch size M:
M ≤ MAX_SKINNY_BATCH_SIZE → HIP skinny GEMM (`wvSplitK_int4_g`); M > → Triton W4A16 fused dequant GEMM.
Stores the weights ONCE as int8 [N, K//2] (ExLlama shuffle packed)."* `MAX_SKINNY_BATCH_SIZE = 5`.

`can_implement` gates (lines 463–499):
| Gate | RedHatAI/Qwen3.8-27B-INT4 |
|---|---|
| ROCm | ✅ |
| `_on_gfx1x()` — gfx11 or gfx12 | ✅ gfx1201 |
| weight type in `SUPPORTED_QUANT_TYPES` (uint4 with bias 8 = symmetric; raw zero-points also handled) | ✅ symmetric int4 |
| activations fp16 **or bf16** | ✅ → **no `--dtype float16` needed** (keeps native bf16, removes fp16-overflow risk) |
| no `g_idx` | ✅ `actorder: static` (reorder folded at quant time) |
| group size ∈ {32, 64, 128} | ✅ 128 |
| K % 16 == 0 and K % group == 0 | ✅ expected (hidden 5120) |

### HIP decode kernel is compiled for gfx12 (`csrc/rocm/skinny_gemms_int4.cu`, VERIFIED)
`#if defined(__GFX11__) || defined(__GFX12__)` → "Combined RDNA macro (gfx11 + gfx12) — both use 32-wide
wavefronts" → `__HIP__GFX1X__`; `wvSplitK_int4_hf_sml_` / `wvSplitK_int4_hf_` bodies sit under
`#if defined(__HIP__GFX1X__)`; entry point `wvSplitK_int4_g`. The wheel's arch list includes gfx1201.

### Design consequence — MTP draft length (CORRECTED during execution; source + model config)
The brainstorm said "M = 1+k ≤ 5 keeps MTP verification on the HIP skinny kernel". **Incomplete:** the installed
`apply` routes to `wvSplitK_int4_g` only if `M <= MAX_SKINNY_BATCH_SIZE (5) and K*M <= LDS_CAPACITY_ELEMENTS
(32768 fp16 = 64 KiB/workgroup)`. With Qwen3.8-27B dims (hidden 5120, intermediate 17408):

| M | K=5120 (qkv / o / gate / up) | K=17408 (down_proj) |
|---|---|---|
| 1 (plain decode) | HIP skinny | HIP skinny |
| 2 (MTP k=1) | HIP skinny | **Triton skinny** (34,816 > 32,768) |
| 4 (MTP k=3) | HIP skinny | **Triton skinny** (69,632) |

→ **any MTP (k ≥ 1) runs down_proj verification on the Triton skinny kernel**; k ≤ 4 only protects the other
matmuls. k=3 stays (recipe).

### Attention decode falls back to Triton on this model (VERIFIED source; runtime warning seen)
Server log: *"Cannot use ROCm custom paged attention kernel, falling back to Triton implementation."*
`vllm/platforms/rocm.py::use_rocm_custom_paged_attention`, non-CDNA branch: requires `_ON_GFX1X` **and
`head_size == 128` and `block_size == 16`** and `3 <= gqa_ratio <= 16`, KV dtype `auto`, no sliding window /
alibi / sinks, `max_seq_len <= 128K`. Qwen3.8-27B: **head_dim 256** and the hybrid KV **block size 1568** (vLLM sets
it so the attention page ≥ the mamba page) → both fail → Triton paged attention for the 16 full-attention layers.

### MTP=0 measurement context (MEASURED, run `bench/runs/2026-09-11-2047-vllm-qwen38-27b-int4/mtp0`)
Log confirms `Using RDNAHybridW4A16LinearKernel for CompressedTensorsWNA16`; pp512/tg256 decode **14.67 t/s**
(σ 0.01) with the GPU at 100 % busy, ~179 W, mclk at 1258 MHz 97 % of samples → GPU-kernel-bound, not
CPU/launch-bound or clock-throttled (INFERRED from coarse busy %). Which kernel dominates (HIP int4 skinny,
GDN Triton, Triton attention) is **OPEN** — needs a profile. A `_triton_w4a16_skinny_fmt_kernel` JIT during the
first 512-token prefill (warning in log) is the likely cause of one slow run (334 vs ~900 t/s prefill).

### Why this matters
July's vLLM 0.19.1 decode was CPU/launch-bound at 8.6–19.7 t/s (MEASURED then). 0.19.1 had no RDNA W4A16
kernel at all (see §2). 0.29.0's dedicated skinny decode kernel is the first plausible fix — INFERRED, to be
measured.

## 2. vLLM 0.19.1 (local image) — why July failed (VERIFIED)

| Item | Finding |
|---|---|
| ROCm `supported_quantization` | awq, awq_marlin, gptq, gptq_marlin, fp8, compressed-tensors, fbgemm_fp8, gguf, quark, mxfp4, petit_nvfp4, torchao — **no bitsandbytes** |
| mixed-precision kernels present | allspark, conch, cpu, cutlass, dynamic_4bit, exllama, machete, marlin, xpu — **no RDNA kernel, no triton_w4a16** |
| conch | `_CONCH_SUPPORTED_GROUP_SIZES = [-1, 128]`; `conch` package installed → **group 32 rejected** (July's 27B was g32 → LOAD_FAIL) |
| exllama | `if c.act_type != torch.float16: return False, "Exllama only supports float16 activations"` |
| marlin | `if not current_platform.is_cuda(): return False …` → **not available on ROCm** (the names `awq_marlin`/`gptq_marlin` in the quant list are misleading) |

## 3. FP8 on ROCm in 0.29.0 (VERIFIED list; perf CLAIMED)
`_POSSIBLE_FP8_KERNELS[ROCM]`: `AiterHipbMMPerTokenFp8…`, `AiterPreshuffledPerTokenFp8…`, `AiterPerTokenFp8…`,
`ROCmFP8ScaledMMLinearKernel`, … ; INT8: `AiterInt8…`, `TritonInt8…`. AITER kernels are unusable on gfx1201
(aiter#3294 OPEN; the v0.29.0 Dockerfile strips gfx1xxx from the aiter/flash-attn build). Block-FP8 checkpoints
(Qwen/unsloth FP8) reportedly fall back to FP32 (vllm#28649, CLAIMED) — and they don't fit memory anyway.

## 4. Other runtime pieces (CLAIMED — research agent; not verified)
- Attention: `ROCM_ATTN` default since v0.19.0; `TRITON_ATTN` fallback. Linear-attention (Gated-DeltaNet)
  layers run on Triton FLA-style kernels (`--mamba-backend triton` per recipe).
- First boot JIT of the GDN Triton kernels reportedly ~15–20 min, 3–5 min thereafter (vllm#42960,
  sglang#31594 — CLAIMED, unverified).
- `--kv-cache-dtype fp8` works on ROCm (CLAIMED). Not needed at 34k ctx.
- `HSA_OVERRIDE_GFX_VERSION` not needed on ROCm ≥ 7.11 (CLAIMED); setting 12.0.1 on a gfx1201 is an identity.

## 5. Research-agent claims corrected in this session
| Agent claim | Correction |
|---|---|
| "Marlin (AWQ/GPTQ) works on ROCm via Triton" | **Refuted** — marlin `can_implement` requires `is_cuda()` |
| "AWQ group 32/64/128 validated on gfx1201" | Unverified; but 0.29.0 `RDNAHybrid` does accept 32/64/128 (source) |
| "Compressed-tensors W4A16 works (Triton)" | Partly: in 0.29.0 the first ROCm pick is `RDNAHybrid`, Triton is the next fallback |

## Sources
- https://raw.githubusercontent.com/vllm-project/vllm/v0.29.0/vllm/model_executor/kernels/linear/__init__.py
- …/v0.29.0/vllm/model_executor/kernels/linear/mixed_precision/{rdna_hybrid_w4a16,rdna3_w4a16,triton_w4a16,conch}.py
- …/v0.29.0/csrc/rocm/skinny_gemms_int4.cu · …/csrc/rocm/skinny_gemms.cu
- https://huggingface.co/RedHatAI/Qwen3.8-27B-INT4/raw/main/config.json
- https://github.com/vllm-project/vllm/issues/28649 · https://github.com/ROCm/aiter/issues/3294
- https://github.com/vllm-project/vllm/issues/42960 · https://github.com/sgl-project/sglang/issues/31594 (CLAIMED)
