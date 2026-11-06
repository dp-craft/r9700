<!-- meta
date: 2026-07-12 23:00
takeaway: On gfx1201/RDNA4, AITER's C++/ASM kernels don't run (VLLM_ROCM_USE_AITER=0 required) and gfx1201 is missing from AITER's arch table → FP8 silently falls back to FP32 (~18–22 vs ~35–40 tok/s). vLLM supports the Qwen3.6-27B hybrid arch, but FP8 is gated to NVIDIA Ada/Hopper — so the AITER/Triton/unified-attn env-vars are non-viable on the R9700 today; treat any vLLM spike as gated on a load-test first.
-->

# vLLM on RDNA4 (gfx1201): AITER, FP8, and the Qwen3.6-27B hybrid arch — current status

- **Date:** 2026-07-12 23:00
- **GPU/Host:** AMD Radeon AI PRO R9700 (RDNA4, **gfx1201**, 32 GB), ROCm 7.x, Ubuntu 24.04
- **Why:** the 27B fine-tune campaign raised whether the vLLM/ROCm perf knobs
  (`VLLM_ROCM_USE_AITER=1`, `FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE`, `ROCM_AITER_UNIFIED_ATTN`)
  are worth testing on this box. Short answer: **not today** — documented here so we don't burn GPU
  time on a known dead end, and so a scoped feasibility spike has a clear go/no-go gate.
- **Provenance:** all external → **CLAIMED**, corroborated across ROCm/aiter, vLLM, and
  TransformerEngine issue trackers + the vLLM forum. Nothing here is MEASURED on our box yet.

## Summary

1. **AITER's C++/ASM kernels do not run on RDNA4** — they must be disabled
   (`VLLM_ROCM_USE_AITER=0`). AITER is built for CDNA (MI300-class); its hand-written kernels are
   not compiled for gfx1201.
2. **gfx1201 is missing from AITER's architecture table** (`_ARCH_TO_DEVICE` in
   `aiter/ops/triton/utils/arch_info.py`). vLLM's FP8 path imports AITER's *Triton* kernels
   (`aiter.ops.triton.gemm_a8w8_blockscale`); with gfx1201 unrecognized, FP8 weights are **silently
   dequantized to FP32** — no error, just a **~18–22 tok/s** result where **~35–40** was expected.
3. **vLLM native FP8 for RDNA4 is not merged.** It needs local patches + kernel config files
   (community workaround: patch the arch table to add gfx1201, then `VLLM_ROCM_USE_AITER=0` so the
   Triton path compiles native WMMA).
4. **The Qwen3.6-27B *architecture* is supported by vLLM** — it ships official
   `Qwen3.6-27B-FP8` checkpoints and vLLM recipes. The blocker is **not** the hybrid arch; it's the
   FP8 execution path on AMD consumer silicon.
5. **Consequence for us:** the three env-vars the user floated ride on the AITER/FP8 path and are
   **counterproductive on gfx1201** right now. Any vLLM spike must first pass a **load + first-token
   gate**; realistic expectation is a dead end until upstream lands gfx1201.

## The env-vars, decoded

| Env-var | What it toggles | State on gfx1201 (CLAIMED) |
|---------|-----------------|----------------------------|
| `VLLM_ROCM_USE_AITER=1` | AITER C++/ASM + Triton fused kernels | **Must be 0** — C++/ASM kernels aren't built for RDNA4; leaving it on breaks/degrades FP8 |
| `FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE` | Triton flash-attention on ROCm | Triton FA path exists but shares AITER's arch detection; gfx1201 unrecognized → fallback |
| `ROCM_AITER_UNIFIED_ATTN` | AITER unified attention kernel | Same AITER arch-table dependency → not viable |

## Qwen3.6-27B arch (for context)

Mixed/hybrid: **64 layers = 16 groups of (3× Gated-DeltaNet → 1× Gated Attention)**. Gated-DeltaNet
(a linear-attention/SSM form) keeps a fixed-size state (no growing KV); only the ~16 gated-attention
layers cache KV → the 64 KiB/tok f16 figure our `bench/gguf_kv.py` reports. FP8 is attractive because
Gated-DeltaNet is numerically stable under quantization — but **FP8 block-wise is gated to NVIDIA
compute capability > 8.9 (Ada/Hopper+)**, which is exactly why RDNA4 falls back.

## Feasibility-spike gate (if we still try vLLM ROCm)

The user opted to spike it anyway. Scope it tightly with a hard go/no-go:

- **Gate 0 — does it load & emit a token?** Try `Qwen3.6-27B-FP8` on vLLM ROCm. Expect the FP32
  fallback (won't fit 32 GB unquantized-equivalent, or crawls). If it won't load or is <½ the
  llama.cpp-Vulkan decode rate, **STOP and record**.
- GGUF-in-vLLM for this hybrid arch is experimental; unquantized FP16 ≈ 54 GB (won't fit); an AWQ
  route depends on a published AWQ checkpoint *and* ROCm-RDNA4 support for the Gated-DeltaNet
  kernels. Treat all three as high-risk.
- If Gate 0 passes, only then compare AITER-off/Triton-FA/unified-attn vs our llama.cpp baseline.

**Revisit trigger:** upstream merges gfx1201 into AITER's arch table + vLLM FP8 for RDNA4. Track the
issues below.

## Sources (Tier-1: vendor/project trackers)
- ROCm/aiter #900 — "Is GFX1201 support planned?": https://github.com/ROCm/aiter/issues/900
- vllm-project/vllm #28649 — upstream gfx1201/RDNA4 FP8 patch request: https://github.com/vllm-project/vllm/issues/28649
- ROCm/TransformerEngine #520 — gfx1201 not in AITER arch table, FP8 WMMA → FP32 fallback: https://github.com/ROCm/TransformerEngine/issues/520
- vLLM forum — Native FP8 WMMA for RDNA4 (RX 9070 XT / R9700): https://discuss.vllm.ai/t/native-fp8-wmma-support-for-amd-rdna4-rx-9070-xt-r9700-in-vllm/1900
- vLLM recipes — Qwen/Qwen3.6-27B: https://recipes.vllm.ai/Qwen/Qwen3.6-27B
- vLLM blog — FP8 KV-cache & attention quantization: https://vllm.ai/blog/2026-04-22-fp8-kvcache
