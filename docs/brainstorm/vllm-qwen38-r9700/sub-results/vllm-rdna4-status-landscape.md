# vLLM on RDNA4 / gfx1201 — status landscape (Sept 2026)

**Brainstorm:** [vllm-qwen38-r9700](../vllm-qwen38-r9700.md)
**Type:** landscape
**Date:** 2026-09-11

---

Provenance tags: **CLAIMED** = external source (cited); **VERIFIED** = we read it directly from the
source/registry/index ourselves this session; **INFERRED** = reasoning. No benchmark was run.

## 1. Releases and images

| Item | Value | Provenance |
|---|---|---|
| Newest vLLM on the official ROCm wheel index | `vllm-0.29.0+rocm723` (also `0.29.0rc7.dev1`, `0.29.1.dev1+g98dff2a81.rocm723`), cp312, manylinux_2_39 | VERIFIED — `https://wheels.vllm.ai/rocm/vllm/` listing |
| Research agent's "latest release v0.28.0 (Aug 2026)" | **Contradicted** by the index above (0.29.0 exists) | — |
| Newest `rocm/vllm` RDNA image | `rocm7.14.1_rdna_ubuntu24.04_py3.14_pytorch_2.11_vllm_0.23.0`, pushed 2026-09-01, 24.9 GB compressed | VERIFIED — Docker Hub API |
| Previous RDNA image | `rocm7.14.0_rdna_…_vllm_0.23.0`, 2026-07-15, 24.5 GB | VERIFIED — Docker Hub API |
| Image we have locally | `rocm7.13.0_gfx120X-all_…_vllm_0.19.1`, 2026-05-19, 10.8 GB compressed / **50.4 GB on disk** | VERIFIED — Docker Hub API + `docker images` |
| Older | `rocm7.12.0_gfx120X-all_…_vllm_0.16.0`, 2026-03-27, 8.4 GB | VERIFIED — Docker Hub API |
| gfx1200/gfx1201 in vLLM's ROCm build arch list | `PYTORCH_ROCM_ARCH=gfx90a;gfx942;gfx950;gfx1100;gfx1101;gfx1200;gfx1201;gfx1150;gfx1151` in `docker/Dockerfile.rocm_base` @ v0.29.0 (base `rocm/dev-ubuntu-22.04:7.2.3-complete`) | VERIFIED — GitHub raw @ tag |
| Same Dockerfile strips `gfx1xxx` for one GPU-kernel build (`sed -e 's/;gfx1[0-9]\{3\}//g'`, line 323) | → at least one bundled kernel lib (flash-attn or aiter) is **not** built for RDNA | VERIFIED (which lib exactly: INFERRED) |
| "Radeon RX 9000 series (gfx1200/1201)" on docs.vllm.ai ROCm GPU list | listed; since-version not stated | CLAIMED — docs.vllm.ai installation/gpu |

## 1b. Official AMD vLLM Docker image (user-designated, documented 2026-09-11)

The user designated **`rocm/vllm:rocm10.0.0_ubuntu24.04_py3.14_pytorch_2.12.0_vllm_0.27.0`** as the official
AMD vLLM image. Not used in this plan (user: no Docker), documented for reference. VERIFIED via Docker Hub API +
registry manifest/config blob (no layers pulled):

| Item | Value |
|---|---|
| Pushed | 2026-08-27 · amd64 · **27.2 GB compressed** |
| Stack | ROCm **10.0.0** (matches the host's ROCm 10.0.0), Python 3.14, PyTorch 2.12.0, vLLM 0.27.0 |
| `PYTORCH_ROCM_ARCH` | `gfx90a;gfx942;gfx950;gfx1100;gfx1101;gfx1102;gfx1103;gfx1150;gfx1151;gfx1152;gfx1153;gfx1200;gfx1201` → **gfx1201 included** |
| `AITER_ROCM_ARCH` | `gfx942;gfx950` → AITER built for MI-series only (keep `VLLM_ROCM_USE_AITER=0` on gfx1201) |
| ROCm packaging | TheRock-style Python SDK: `ROCM_PATH=HIP_PATH=/opt/python/lib/python3.14/site-packages/_rocm_sdk_devel` (ROCm shipped as pip wheels inside the image) |
| Other env | `HIP_FORCE_DEV_KERNARG=1`, `RAY_EXPERIMENTAL_NOSET_HIP_VISIBLE_DEVICES=1` |

Note: the tag carries no `rdna`/`gfx120X` suffix, yet its arch list covers RDNA3/3.5/4. Relevance to the chosen
host-venv plan: it shows AMD's own current stack is ROCm 10 + wheel-packaged SDK — the natural fallback if the
official vLLM wheel's torch (built against ROCm 7.2.3) fails the ABI gate on the host's ROCm 10.

## 2. Known issues (status per research agent)

| Issue | Status | Meaning for us | Provenance |
|---|---|---|---|
| vllm#40081 — vLLM fails to start on gfx1201 in containers (amdsmi / circular import / device_count 0) | CLOSED via PR #41585 | fixed in newer builds | CLAIMED |
| vllm#28649 — gfx1201 FP8 WMMA upstream patch | OPEN | FP8 on gfx1201 still needs local patching | CLAIMED |
| ROCm/ROCm#6347 — R9700 **bimodal decode** (~33 vs ~26 tok/s, fixed at process spawn) | OPEN, triage | a single boot can land in the slow mode → repeat boots to detect | CLAIMED |
| ROCm/aiter#3294 — gfx1201 missing from AITER arch table | OPEN (filed 2026-05-21, no assignee) | AITER must stay off (`VLLM_ROCM_USE_AITER=0`, which is also the default) | CLAIMED |
| vllm#36456 — "architecture qwen35 is not supported yet" (GGUF) | OPEN, stale | GGUF path dead for Qwen3.5/3.6/3.8 | CLAIMED (see gguf feasibility sub-result) |

## 3. Community numbers on gfx1201 (Tier-2 — corroboration only, not decision-grade)

| Claim | Source | Provenance |
|---|---|---|
| RX 9070 XT: llama-server Vulkan 62 t/s (GGUF Q6_K) vs vLLM ROCm 48 t/s (FP8 falling back to FP32) | github.com/ivangotoy/llama-server-rdna4-vulkan | CLAIMED (Tier-2) |
| 2× R9700 TP=2, Qwen3.6-27B-FP8: prefill 1786–1840 t/s, decode 71–80 t/s | github.com/daimonionnn/amd-r9700-vllm-and-tuning-toolkit | CLAIMED (Tier-2) |
| Single R9700 bimodal decode 33 / 26 t/s | ROCm/ROCm#6347 | CLAIMED |
| No Tier-1 (Phoronix / vLLM) R9700 single-GPU vLLM numbers since July 2026 | — | NOT FOUND |

## 4. Our own prior data (July 2026, vLLM 0.19.1 image)

From `docs/analysis/2026-07-10-1810-rdna4-r9700-tuning-optimum.md` §3.9 (MEASURED there):
- 35B-A3B-AWQ: prefill 545–1048, decode **8.6–19.7 t/s**, 29.2–29.3 GB → "not competitive", CPU/launch-bound decode.
- 27B (compressed-tensors, **group_size 32**): **LOAD_FAIL** (kernel gap).
- Verdict then: "do not use vLLM for these models on R9700; revisit when gfx1201 lands in official kernels."

## 5. What changed since July (the reason this spike is worth doing)

- vLLM 0.29.0's ROCm build **includes gfx1201** (verified above).
- vLLM 0.29.0 adds **RDNA-specific W4A16 kernels** (`RDNAHybridW4A16` — Triton prefill + HIP skinny decode;
  see the kernels sub-result). This targets exactly the slow decode path of July. (VERIFIED in source; perf INFERRED.)
- Qwen3.8 is supported by the vLLM recipe (min vLLM 0.17 per recipe, CLAIMED); 0.29.0 is well past that.

## Sources
- https://wheels.vllm.ai/rocm/vllm/
- https://hub.docker.com/r/rocm/vllm/tags (via `hub.docker.com/v2/repositories/rocm/vllm/tags`)
- https://raw.githubusercontent.com/vllm-project/vllm/v0.29.0/docker/Dockerfile.rocm_base
- https://docs.vllm.ai/en/latest/getting_started/installation/gpu/
- https://github.com/vllm-project/vllm/issues/40081 · /issues/28649 · /issues/36456
- https://github.com/ROCm/ROCm/issues/6347 · https://github.com/ROCm/aiter/issues/3294
- https://github.com/ivangotoy/llama-server-rdna4-vulkan (Tier-2)
- https://github.com/daimonionnn/amd-r9700-vllm-and-tuning-toolkit (Tier-2)
