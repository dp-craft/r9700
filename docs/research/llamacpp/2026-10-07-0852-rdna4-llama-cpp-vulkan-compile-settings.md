<!-- meta
date: 2026-10-07 08:52
takeaway: RDNA4 (gfx1201, R9700) Vulkan + llama.cpp compile/runtime settings as of Oct 2026. The repo's current baseline flags are already the recommended set; the meaningful change since b10969 is **int8 cooperative-matrix MMQ matmul** (#27952, RDNA3/4) plus an RDNA4 `mat_vec` tuning fix (#29934) and quantized-KV sparse FA (#28105/#29639). Two open gfx1201 issues to watch in the bench: #29314 (flash-attention CI failure) and #26663 (token-generation slowdown, high head-dim). Long-context stability env vars: `RADV_PERFTEST=nogttspill` (#22898, UNVERIFIED here) and `GGML_VK_SUBALLOCATION_BLOCK_SIZE=4294967296` (#27734).
-->

# RDNA4 (gfx1201 / R9700) — llama.cpp Vulkan compile & runtime settings

- **Date:** 2026-10-07 08:52 · **Track:** external research (sourced, Tier-1 first)
- **GPU/Host:** AMD Radeon AI PRO R9700 (RDNA4, gfx1201), 32 GB · Ubuntu 24.04 · Mesa RADV 26.2.4
- **Provenance (iron rule 1):** external claims are `CLAIMED` with the Tier-1 URL; on-machine facts
  (SDK version, glslc) are `MEASURED`. One lead (#22898) could not be fully retrieved and is tagged
  `UNVERIFIED`.

## Summary — what to set

| Setting | Value / flag | Status | Source |
|---|---|---|---|
| Core Vulkan build flags | `-DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DGGML_NATIVE=ON` | **Already the recommended baseline** — no change needed | [ggml/CMakeLists.txt](https://github.com/ggml-org/llama.cpp/blob/master/ggml/CMakeLists.txt) |
| Optional LTO | `-DGGML_LTO=ON` (general option, not Vulkan-specific) | Available; optional | [ggml/CMakeLists.txt](https://github.com/ggml-org/llama.cpp/blob/master/ggml/CMakeLists.txt) |
| Vulkan debug/validate options | `GGML_VULKAN_CHECK_RESULTS`, `_DEBUG`, `_MEMORY_DEBUG`, `_SHADER_DEBUG_INFO`, `_VALIDATE`, `_RUN_TESTS` | Diagnostics only — leave OFF for perf builds | [ggml/CMakeLists.txt](https://github.com/ggml-org/llama.cpp/blob/master/ggml/CMakeLists.txt) |
| `GGML_VULKAN_XFB` | **Does not exist** in current tree | Do not set | [ggml/CMakeLists.txt](https://github.com/ggml-org/llama.cpp/blob/master/ggml/CMakeLists.txt) |
| glslc / shaderc | Must support the `cooperativeMatrix` API (new SDK required for master) | **SDK 1.4.363.0 satisfies this** (MEASURED on-machine, shaderc v2026.4) | [PR #29409](https://github.com/ggml-org/llama.cpp/pull/29409) |
| Long-context decode env | `GGML_VK_SUBALLOCATION_BLOCK_SIZE=4294967296` | Fixes ~78% decode cliff at 131072 ctx (suballocation fragmentation) | [Issue #27734](https://github.com/ggml-org/llama.cpp/issues/27734) |
| Long-context decode env | `RADV_PERFTEST=nogttspill` | Claimed to fix RDNA4 long-context decode collapse (GTT spill) — **UNVERIFIED** this pass | [Issue #22898](https://github.com/ggml-org/llama.cpp/issues/22898) |

**Bottom line:** the build side needs nothing new — the repo's existing flags are correct, and the
self-managed SDK 1.4.363.0 already meets the cooperative-matrix requirement that master now enforces
(#29409). The performance story for RDNA4 since b10969 is **shader-side** (coopmat MMQ + mat_vec
tuning + sparse FA), which is exactly what the one-by-one bench in step 3b measures.

## What changed for RDNA4 since b10969 (all merged, all `CLAIMED` from Tier-1)

| PR / commit | What it does | Affected quants / models | Perf stated |
|---|---|---|---|
| [#27952](https://github.com/ggml-org/llama.cpp/pull/27952) — int8 coopmat MMQ matmul (RDNA3/RDNA4) | New `MMQ cm1` cooperative-matrix shader path | q4_0, q4_1, q5_0, q5_1, q8_0, q3_k, q4_k, q5_k, q6_k, mxfp4, nvfp4, iq4_nl | Up to **1.43× MoE prompt-processing** on Strix Halo; RDNA4 "modest" on dense, "substantial" on MoE |
| [#29934](https://github.com/ggml-org/llama.cpp/commit/16c163d5) — `vulkan: fix rdna4 mat_vec tuning` | Broadens the RDNA arch check to include RDNA4; static **4 rows** for all types above 4 columns | all mat_vec (token generation) | "bench faster than the default" on RDNA3/4 |
| [#28105](https://github.com/ggml-org/llama.cpp/pull/28105) + [#29639](https://github.com/ggml-org/llama.cpp/pull/29639) — sparse FA, then quantized-K/V | Sparse Flash Attention; #29639 extends it to **quantized K/V** (was f16-only), 16× min ctx/kept ratio | long-context attention | **#29639 author benchmarked on an R9700** alongside a 7900 XT |
| [#29988](https://github.com/ggml-org/llama.cpp/pull/29988) / [#29591](https://github.com/ggml-org/llama.cpp/pull/29591) / [#29280](https://github.com/ggml-org/llama.cpp/pull/29280) — stability | FA shared-memory OOB write fix; stale `prealloc_y` reuse fix; descriptor-set reuse | correctness / no-DeviceLost | bug fixes, not perf |

These are the deltas step 3b (b10969 → b11448, Vulkan) attributes. #27952 and #29639 are the two most
likely to move an R9700 number; both were exercised on RDNA4-class hardware by their authors.

## Open gfx1201 issues — bench-watch items for step 3b/4b

| Issue | Claim | Status | Why it matters here |
|---|---|---|---|
| [#29314](https://github.com/ggml-org/llama.cpp/issues/29314) | Flash-attention failure on **gfx1201** in `test-backend-ops` CI | open | If our `-fa on` benches hit it, an FA cell may be a false regression — cross-check before trusting a delta |
| [#26663](https://github.com/ggml-org/llama.cpp/issues/26663) | 5–7× **token-generation** slowdown on RX 9070 XT (gfx1201), tied to `hidden_size >= 4096` (8B/14B-class, not 4B); ~100 GB/s effective BW vs HIP | open (labeled stale) | Our 27B/35B models are high head-dim — a tg regression in step 3b could be this, not the build |

## Build flags — full reference (from current master)

`-DGGML_VULKAN_*` options present in [ggml/CMakeLists.txt](https://github.com/ggml-org/llama.cpp/blob/master/ggml/CMakeLists.txt):
`GGML_VULKAN`, `GGML_VULKAN_CHECK_RESULTS`, `GGML_VULKAN_DEBUG`, `GGML_VULKAN_MEMORY_DEBUG`,
`GGML_VULKAN_SHADER_DEBUG_INFO`, `GGML_VULKAN_VALIDATE`, `GGML_VULKAN_RUN_TESTS`, and
`GGML_VULKAN_SHADERS_GEN_TOOLCHAIN` (auxiliary, not a core debug flag). `GGML_LTO` exists as a **general**
option. **No `GGML_VULKAN_XFB` option exists.** [docs/build.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)
recommends the LunarG Linux tarball (`source setup_env.sh`) or `apt-get install libvulkan-dev glslc
spirv-headers`, then `cmake -B build -DGGML_VULKAN=1`; it gives **no RDNA4-specific guidance**.

## On-machine facts (MEASURED this pass)

- Self-managed Vulkan SDK **1.4.363.0** installed, glslc = shaderc v2026.4 (`llamacpp/vulkansdk/1.4.363.0`) —
  satisfies the cooperative-matrix requirement of #29409.
- Baseline build `b10969-vulkan-1.4.357.1` and new `b10969-vulkan-1.4.363.0` (same source) are built; the
  step-3a bench isolates SDK/shaderc, step-3b isolates the llama.cpp shader changes above.

## Open items

- **#22898 (`RADV_PERFTEST=nogttspill`)** could not be fully retrieved this pass (rate-limited) — tagged
  `UNVERIFIED`. Re-pull before relying on it; if confirmed, it is a candidate addition to the long-context
  runtime env (iron rule 9: propose as a follow-up, don't change `bench/lib/gpu_env.sh` unprompted).
- The two open gfx1201 issues (#29314, #26663) are the bench's tripwires — if a Vulkan cell regresses in
  step 3b, check these before attributing it to b11448.

## Sources (accessed 2026-10-07)

- PRs: [#27952](https://github.com/ggml-org/llama.cpp/pull/27952) · [#29934 / commit 16c163d5](https://github.com/ggml-org/llama.cpp/commit/16c163d5) · [#28105](https://github.com/ggml-org/llama.cpp/pull/28105) · [#29639](https://github.com/ggml-org/llama.cpp/pull/29639) · [#29988](https://github.com/ggml-org/llama.cpp/pull/29988) · [#29591](https://github.com/ggml-org/llama.cpp/pull/29591) · [#29280](https://github.com/ggml-org/llama.cpp/pull/29280) · [#29409](https://github.com/ggml-org/llama.cpp/pull/29409)
- Issues: [#29314](https://github.com/ggml-org/llama.cpp/issues/29314) · [#26663](https://github.com/ggml-org/llama.cpp/issues/26663) · [#27734](https://github.com/ggml-org/llama.cpp/issues/27734) · [#22898](https://github.com/ggml-org/llama.cpp/issues/22898) (UNVERIFIED)
- Tree: [ggml/CMakeLists.txt](https://github.com/ggml-org/llama.cpp/blob/master/ggml/CMakeLists.txt) · [docs/build.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)
