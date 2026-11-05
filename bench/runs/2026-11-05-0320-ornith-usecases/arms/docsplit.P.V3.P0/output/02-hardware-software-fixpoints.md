## Hardware / software fixpoints (cite these, don't re-derive)

- **GPU:** AMD Radeon AI PRO R9700 — RDNA4, **gfx1201**, 32 GB (~31.86 GiB usable)
- **Override:** `HSA_OVERRIDE_GFX_VERSION=12.0.1` · ROCm 10.1 (clang 24) · Mesa/RADV 26.2.4 · Ubuntu 24.04 · kernel 7.0.0-38-generic (HWE; -34 kept for the FA-fault attribution test) · Ryzen 5 3600, 31 GB RAM, no swap
- **Runtimes:** llama.cpp (`latest-vulkan` = b11448 · SDK 1.4.363.0; `latest-rocm` = stew675-patched, ROCm-10.0-linked), ollama, vLLM, transformers/HF
- **Models under test:** `Qwen3.6-35B-A3B` (MoE, ~3B active) · `Qwen3.6-27B` · `Ornith-1.0-35B`
  (qwen35moe hybrid) · `Gemma-4-31B-it-qat` (gemma4 dense) · GGUF Q4 / AWQ. New models may live
  in the **HF cache**, not `/home/dev/models/gguf` — see "New-model benchmarking" below for paths.
- **Native support:** FP8 (E4M3) yes, FP4 no WMMA. 32 GB is memory-bound at long context → Q4_K_M is optimal, not a compromise.

