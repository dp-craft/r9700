# Approaches — full evaluation

**Brainstorm:** [vllm-qwen38-r9700](../vllm-qwen38-r9700.md)
**Type:** approaches
**Date:** 2026-09-11

---

The option space has four axes; approaches below are combinations that survived or were eliminated.

| Axis | Options considered |
|---|---|
| Runtime packaging | host venv (official wheels full / trimmed) · host venv (TheRock torch + vLLM source build) · Docker 0.19.1 (local) · Docker 0.23.0 rdna |
| Weights | GGUF (downloaded) · RedHat INT4 g128 · community GPTQ g128 · AWQ g32 · FP8 (Qwen/Unsloth) · Unsloth bnb-4bit · MXFP4 |
| Decode | MTP off · MTP on (k=3) |
| Measurement | llama-benchy (both engines / vLLM only) · reuse llama-bench b10909 · `vllm bench serve` · capture_engine probe |

## A. Host venv + official vLLM 0.29.0 ROCm wheels (full) + RedHat INT4 + MTP off/on + llama-benchy — **CHOSEN**
- **What:** `pip install vllm==0.29.0+rocm723` from `wheels.vllm.ai/rocm` into a Python 3.12 venv; serve
  `~/models/vllm/Qwen3.8-27B-INT4`; two boots (MTP off / on); two llama-benchy invocations each.
- **How:** vLLM picks `RDNAHybridW4A16` (Triton prefill + HIP skinny decode) for the INT4 g128 weights;
  CUDA/HIP graphs on (default); MTP k=3 keeps verify M=4 on the skinny kernel.
- **Strength:** newest vLLM with gfx1201 in its build and RDNA-specific 4-bit kernels; no Docker; one pip command.
- **Weakness:** ~10.5 GB venv (5.4 GB of it unusable aiter/flash-attn); torch built for ROCm 7.2.3 runs on host
  ROCm 10.0 (ABI risk); needs the old Docker image removed for disk.
- **Complexity:** S · **Reversibility:** Easy (delete venv + model dir) · **Architectural impact:** Local (one
  root script `start_vllm.sh`, one run dir, one analysis doc).

## B. Same as A, trimmed install (~5 GB) — VIABLE
- `--no-deps` for vllm/torch/triton + pure-Python deps; skip amd-aiter + flash-attn (imported only if enabled —
  verified in source). Closest to the 4 GB wish; costs dependency fiddling and a hand-maintained requirements list.
- Complexity S/M · Reversible · Local. Fallback if disk becomes the constraint again.

## C. Host venv, TheRock gfx120X torch + vLLM built from source — VIABLE (not simple)
- Smallest torch (0.34 GB + ~0.7 GB sdk libs, gfx120X-only); vLLM compiled with hipcc (30–60 min).
  Could link to the matching ROCm (7.13/7.14) instead of the 7.2.3-built official torch → removes the ABI risk.
- Complexity L · Reversible · Local. Keep in reserve if A's torch fails on host ROCm 10.

## D0. Official AMD image `rocm/vllm:rocm10.0.0_ubuntu24.04_py3.14_pytorch_2.12.0_vllm_0.27.0` + RedHat INT4 — ELIMINATED (user: no Docker), documented as the official AMD image
- User-designated official AMD vLLM image (2026-08-27, 27.2 GB compressed). VERIFIED: gfx1201 in
  `PYTORCH_ROCM_ARCH`; AITER built for gfx942/gfx950 only; ROCm 10.0.0 (= host) shipped as pip SDK wheels.
- vLLM 0.27.0 (older than the 0.29.0 wheel). Whether 0.27.0 already has `RDNAHybridW4A16` — NOT CHECKED.
- Relevance: AMD's ROCm-10 wheel stack is the fallback for approach C if A's ROCm-7.2.3-built torch fails on host ROCm 10.

## D. Docker `rocm/vllm:rocm7.14.1_rdna_…_vllm_0.23.0` + RedHat INT4 — ELIMINATED (user: no Docker)
- Would have been the most "known-good" environment (AMD-built for RDNA). 24.9 GB compressed pull.

## E. Docker 0.19.1 (already local) + RedHat INT4 — ELIMINATED (user: no Docker; image to be removed)
- Could load g128 via conch (source-verified), but has no RDNA W4A16 kernel → July-class slow decode.

## F. vLLM + the downloaded GGUF — ELIMINATED (BLOCKER)
- qwen35 not in transformers GGUF mapping; vllm#36456 open; no ggml kernels in the ROCm image; "highly experimental".

## G. FP8 (Qwen/Qwen3.8-27B-FP8 or unsloth FP8, 30.9 GB) — ELIMINATED
- ~3 GB left for KV + graphs + runtime at 34k ctx; block-FP8 routes through AITER (gfx1201 missing) → FP32 fallback.

## H. Unsloth bnb-4bit (22.3 GB) — ELIMINATED
- No bitsandbytes in ROCm quant list (0.19.1); gfx1201 bnb needs a source build; dequant-heavy → slow.

## I. AWQ g32 checkpoints (cyankiwi / abhishekchohan, 21.0 GB) — VIABLE ALTERNATIVE (new in 0.29.0)
- `RDNAHybrid` accepts group 32 — July's failure mode (conch-only [-1,128]) no longer applies. g32 = slightly
  higher quality, ~1.5 GB larger, more scale reads per token. Not chosen: RedHat is the maintainer-published,
  higher-download g128 build.

## Comparison matrix

| Dimension | A (chosen) | B trimmed | C TheRock+src | D Docker 0.23 | F GGUF | G FP8 |
|---|---|---|---|---|---|---|
| Solves the core problem | Y | Y | Y | Y | N | N |
| Complexity | S | S/M | L | S | — | — |
| Risk | Med (ABI, bimodal) | Med | Med (build) | Low/Med | Blocker | Blocker |
| Reversible | Y | Y | Y | Y | — | — |
| Architectural side effects | Local | Local | Local | Local | — | — |
| Maintenance burden | Low | Med | High | Low | — | — |
| Disk | ~10.5 GB + 19.5 GB | ~5 + 19.5 | ~3–4 + 19.5 (est.) | ~50 + 19.5 | — | 30.9 |
| Honors user constraints | yes (4 GB cap overridden by user) | closest to 4 GB | yes | **no (Docker)** | — | — |
| Future optionality | Opens (same venv serves any vLLM model) | Opens | Opens | Neutral | — | — |
