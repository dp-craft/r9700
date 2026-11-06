<!-- meta
date: 2026-10-22 16:43
slug: vllm-mxfp4-atiled-fault-and-llama-swap-serving
title: Sly radiance vLLM + MXFP4 + DFlash2 under llama-swap / Claude Code — A-tiled GEMM fault, RAM-tier sizing, fp8-KV claims
takeaway: SOLVED 2026-10-23 (see 2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg) — the GPU memory fault in Sly's MXFP4 GEMMs was a corrupted kernel-argument pointer (bit 44), fixed by HIP_FORCE_DEV_KERNARG=0; this report keeps the llama-swap serving, RAM-tier and fp8-KV findings
-->

# Sly radiance vLLM under llama-swap / Claude Code — A-tiled GEMM fault, RAM-tier sizing, fp8-KV claims — R9700 (gfx1201)

> **SOLVED 2026-10-23 → `docs/analysis/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md`.** The fault is NOT in Sly's kernels: a kernel-argument pointer arrives with bit 44 cleared; `HIP_FORCE_DEV_KERNARG=0` (now the default in the vLLM profiles) gives 3/3 boots × 4 Claude turns clean at full speed. The "over-read" hypothesis below was tested and ruled out (padding did not help).

- **Date:** 2026-10-22 13:55–16:43 local · **Track:** serving incident + config investigation (no campaign)
- **GPU/Host:** AMD Radeon AI PRO R9700, 32624 MiB, 210 W cap (unchanged) · Ryzen 5 3600, 31 GB RAM, no swap · kernel 7.0.0-38
- **Runtime:** `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` (vLLM 0.31.0) · profile `sly-radiance/qwen38-mxfp4-dflash`
  (`bench/engine-bench/vllm/profiles/sly-radiance/`) · launched by llama-swap via `serve_vllm.sh run`
- **Model:** `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` + DFlash2 drafter `syvai/Qwen3.8-27B-DFlash2-W4A16` (k=7) · fp8 KV · util 0.90 ·
  max-model-len 180000 · `max_num_batched_tokens` 2048 · `max_num_seqs` 1 · attention R4D_HYBRID · sharp template · RAM KV tier 8 GiB
- **Data:** llama-swap log `~/.config/llama-swap/logs/llama-swap.log`; upstream (container) log captured from llama-swap's
  `/logs/stream/upstream` buffer (the container runs `--rm`, so `docker logs` is gone after exit). No `bench/runs/` dir.

## Current status — 2026-10-22 evening (read this first; supersedes the Summary and the 17:20 RAM-tier suspicion)

**Bottom line:** the root cause is **not proven**. The fault is inside Sly's own MXFP4 W4A8 prefill GEMM kernels
(both variants), it is triggered by specific prefill chunk shapes (Claude Code's first request hits one every time), and
whether it fires depends on GPU memory layout. **No fix exists yet for the fast config.** Two stable but slow fallbacks exist.

| | |
|---|---|
| **Issue** | GPU memory fault `HSA_STATUS_ERROR_MEMORY_FAULT` ("Page not present") → engine hangs 5–16 min (`/health` stays OK) → `EngineDeadError`. Qwen3.8-27B MXFP4 (`amd/…Quark-AWQ-MXFP4`) + DFlash2 on `vllm-sly-radiance:1.6.0-rocm10.1` (MEASURED) |
| **Where** | `radiance_mxfp4_fp8_gemm_folded<2,true,true,false>` and `radiance_mxfp4_fp8_gemm_atiled<2,true,128,false,4,false,0>`: Sly's W4A8 **prefill** GEMMs, a compiled `.so` (no source in the image) (MEASURED) |
| **Trigger** | Prefill chunks whose token count M is a chunk remainder. Claude Code's first request (fixed system prompt + tools) always ends in an **M=1760** chunk, so it faults on the first request whatever the user typed (MEASURED faults #3, #5, `claude-direct`, `claude-baseline-2`) |
| **Reproducible?** | **Yes, 2/2** with the unchanged baseline served directly on `:8000`, no llama-swap, real `claude -p` (`claudetest.sh`): faulted 5–10 s into the first request (MEASURED) |
| **Root cause** | **Not proven.** Leading hypothesis (INFERRED): the kernels read activation rows past M up to their row tile when M is not a tile multiple. The read only faults when it crosses into an unmapped page, so the outcome depends on where the allocator put the buffer |
| **Ruled out** | llama-swap (faults without it) · RAM KV tier (faults without it; refutes the 17:20 suspicion) · sharp template · ctx 180k · A-tiled-only / stale `data_ptr` (folded faults too) · KV dtype (the faulting kernel is the weight GEMM) (MEASURED) |
| **Fix** | **None confirmed.** |
| **Fallbacks** | `RADIANCE_MXFP4_W4A8=0` (W4A4): stable n=1, ~12× slower steady state · upstream `stilldeadcode/vllm-radiance:0.9.3`: stable n=2 (direct + llama-swap), ~7–8× slower (MEASURED, `PLAN.md` results) |

**Evidence for the hypothesis**
1. **Same launch every time** (MEASURED): both direct-`:8000` faults and fault #5 are `folded<2,true,true,false>`,
   `grid=[20480,7,1]`, workgroup 256 → 80 workgroups (consistent with N=5120) × **7 row tiles**. Fault #3 is the A-tiled
   kernel at **M=1760** N=16384 K=5120, on the same first request. INFERRED: with a 256-row tile, M=1760 → 7 tiles (1792
   rows) → 32 rows read past the end. The tile size is not documented; 7 tiles fits M ∈ [1537, 1792].
2. **The code** (Sly `main` `radiance_mxfp4.py`, 1.7.0; FROM-CODE, 1.6.0 assumed to match): the row-major activation is
   allocated at exactly M×K bytes (`scaled_fp8_quant`), and the A-tiled layout pads only to 16 rows. The author documents
   "zero out-of-bounds **writes**" (`layer_is_supported` docstring) but nothing about reads. The `PADOUT` comment records
   that "perturbing the allocator" changed earlier failures, which points at memory adjacency.
3. **Layout sensitivity** (MEASURED): the `mhist` run (baseline + `RADIANCE_MXFP4_MHIST=1`, ctx 160000 instead of 150000)
   ran the same M=1760 / N=5120 shape **without** faulting for 3 turns; its KV pool was 349,295 tokens vs 345,297.
   `B1` (no DFlash, chunk 4096, util 0.85, PADOUT) also survived the first request. The fixture test (`vllmtest.sh`) on the
   unchanged baseline faulted once (p4) and passed once. Small changes hide the fault, so **a single PASS proves nothing**.
4. **Upstream** (CLAIMED, checked 2026-10-22): Sly `main` is 1.7.0 (2026-10-20, vLLM 0.32.0); its changelog has no fix
   for this. The newest published image is still `1.6.0-rocm10.1`.

**Caveats:** the tile size is inferred. `MHIST` instruments only `mxfp4_linear`, not the pre-quantized
`mxfp4_linear_pq` path, so the faulting call's exact (N, K, M) is still not captured. The hypothesis could still be wrong.

**Solution path (in order)**
1. Capture the faulting shape: the same `mhist` run at ctx 150000 (the layout that faulted 2/2).
2. If it is confirmed, test a patched `radiance_mxfp4.py` that allocates the activation with spare rows up to the next tile
   multiple (one small copy of the remainder chunk, no numerics change), bind-mounted into the container. This needs a
   generic `EXTRA_MOUNTS` knob in `serve_vllm.sh` (not built yet).
3. Report upstream to SlyBase with the exact kernel, grid, M and the `claudetest.sh` repro (draft only, the user decides).
4. Until then, use a fallback, or accept the fault on the fast config.

**Test method changes (2026-10-22):** the fault gate is now `docs/plans/2026-10-22-mxfp4-qwen38-options/claudetest.sh`
(boots like `vllmtest.sh`, then runs a real `claude -p` session). Real Claude requests hit the fault far more reliably
than the fixtures. A PASS only counts if the exact baseline layout passes it again.

**Config state now** (all uncommitted): the llama-swap row `qwen38-27b-mxfp4-dflash` is at ctx **180000** (id
`qwen38-27b-mxfp4-dflash-kvfp8-vllm`). `~/.config/claude/local_muxik` (via llama-swap) and `local_vllm_direct` (`:8000`,
started by `local_vllm_direct/vllm.sh`) differ only in URL and model id: max output 33000, context 180000, auto-compact
81% (≈145.8k). vLLM accepts prompts only up to 180000 − 33000 = 147k, so compaction now fires before that limit (the
earlier 85% left a 147k–153k HTTP 400 gap). Via llama-swap the 180k row also faults on the first fixture prompt
(`swap-180k`, `_atiled`, grid [20480,7,1]). The upstream radiance row `qwen38-27b-mxfp4-radiance` (ctx 150000) is available.
`serve_vllm.sh` now checks each profile's required fields, auto-pulls a missing image, and creates only the cache dirs
the profile names. Full run list: `PLAN.md` § Results and `results.tsv`.

## Summary

The new llama-swap row works (boot, Anthropic `/v1/messages`, thinking split, sharp template, RAM tier). However, the
first real Claude Code request of the boot **hit a GPU memory fault in `radiance_mxfp4_fp8_gemm_atiled`**. That is the
same kernel as the two faults in the DFlash campaigns. The engine hung for ~16 min (`/health` kept answering) and then died. This is
the 3rd fault, and the first on a **first** request at ordinary Claude Code depth, so the earlier "2nd deep conversation"
pattern does not hold. **The faulting kernel is opt-in**: the image default is off, and our profile enables it by copying the Sly
README quickstart (`RADIANCE_MXFP4_A_TILED_MIN_M=513`). Turning it off is a one-variable fix candidate with a CLAIMED
≤12–16 % prefill cost. It is **untested**. Until it is tested, this config is **not reliable enough to be Claude Code's main model**.

## Results / findings table

| # | Finding | Provenance | Consequence |
|---|---------|-----------|-------------|
| 1 | Fault #3: `radiance_mxfp4_fp8_gemm_atiled<2,true,128,false,4,false,0>`, `M=1760 N=16384 K=5120`, A-tiled call #1000, "Page not present", on the **first long prefill** of the boot (Claude Code's first request) | MEASURED (upstream log) | Not depth-gated. Roughly 1 in 3 boots dies early in practice |
| 2 | After the fault the engine **hangs**: `/health` stays OK, Claude Code's request ran 5 m 0 s → empty reply, retry 1 m 33 s → no valid JSON, then 500 + `EngineDeadError` at ~16 min, container exits | MEASURED (llama-swap + upstream log) | A hang, not a crash: llama-swap cannot see it until the engine dies |
| 3 | The A-tiled path is **off by default** (`A_TILED_MIN_M` default `0`, `radiance_mxfp4.py:37`). **Our profile sets 513** (`qwen38-mxfp4.env:10`, README quickstart verbatim) | FROM-CODE | The fault is in an opt-in speed path we enabled |
| 4 | Tiled-vs-row-major layout is handed producer→consumer through a dict **keyed by `data_ptr`, not popped on consume**. The code comment itself says a stale entry can be matched by a later row-major tensor at the same address with the same (M, K) (`radiance_mxfp4.py:53-63`) | FROM-CODE, cause INFERRED | Plausible root cause: a row-major buffer is read as WMMA fragments → out-of-bounds read. Sporadic, allocator-dependent, which fits the observed pattern |
| 5 | Author's claim for the A-tiled path: **12–16 % faster than the folded kernel at M ≥ 2048** (2026-09-01); values identical in both layouts | CLAIMED (`radiance_mxfp4.py:29-33`, `radiance_fused_norm.py:103-110`) | Cost of disabling it is ≤ ~16 % prefill; decode is untouched (the decode band reads row-major A) |
| 6 | `--enable-chunked-prefill` is **already on**: vLLM V1 always chunks, the chunk is `max_num_batched_tokens=2048`, and the faulting `M=1760` *is* a chunk | MEASURED (args) + INFERRED | Not a fix |
| 7 | fp8 KV is **not** in the faulting kernel. "fp8" in its name = fp8 *activations* of the W4A8 weight GEMM | FROM-CODE | Changing the KV dtype does not address the fault |
| 8 | The two earlier faults (DFlash campaigns) ran **without** the RAM KV tier | MEASURED | The RAM tier is not the cause |
| 9 | RAM tier: `kv_ram_gib 9` pinned **16.28 GiB** (`/dev/zero` mapping in EngineCore; host MemAvailable 1.9 GB). `4` → 4.28 GiB, `8` → **8.28 GiB** (MemAvailable 6.5 GB) | MEASURED | Pinned host buffer is rounded up to a power of two (INFERRED from 3 points). **Use a power of two** (8). Deployed |
| 10 | GPU KV pool at ctx 180000: **335,974 tok** (1.87× window); VRAM 29,667 MiB, GTT 94 MiB with the RAM tier | MEASURED | The active request's KV is entirely in VRAM. The RAM tier only keeps evicted prefixes for reuse |
| 11 | fp8 KV runs with **scale 1.0** (`Using KV cache scaling factor 1.0 for fp8_e4m3`). The checkpoint has 0 k/v scale tensors | MEASURED (log + checkpoint scan) | No overflow risk (keys ≪ ±448), but quality at depth was **never measured**. OPEN |
| 12 | vLLM **rejects** `prompt + max_tokens > max-model-len` (HTTP 400, verified with max_tokens 179990) | MEASURED | Claude Code sends `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` → requests fail once the prompt passes ~116k, before compaction (~150k). Recommended 28000; **not applied (awaiting OK)** |

## The pasted "FP8 crashes Radiance vLLM" claims — checked

| Claim (external, unsourced) | Verdict | Evidence |
|---|---|---|
| fp8 KV + large max-model-len OOMs at pre-allocation | **False here** | MEASURED: fp8 KV booted at 150k/170k/180k, pool sized by util after profiling, hybrid model handled (16 of 64 layers full-attention, `full_attention_interval: 4`) |
| Our crashes are fp8 KV | **False** | Finding 7 |
| "FP8 scales uniformly, can't handle outliers → use int8" | **Backwards** | fp8 is floating point (relative precision). int8 is uniform and worse with outliers under one scale |
| `--kv-cache-dtype int8` / q8_0 | **Not an option** | `q8_0` is llama.cpp. vLLM 0.31 offers `int8_per_token_head` / `fp8_per_token_head` only on TRITON_ATTN. R4D_HYBRID/AITER supports `auto/float16/bfloat16/fp8*` (FROM-CODE `rocm_aiter_unified_attn.py:57`, `triton_attn.py:294`) |
| FP4 KV accelerated by RDNA4 matrix cores | **False** | gfx1201 has no FP4 WMMA (CLAUDE.md fixpoint) |
| `--enable-chunked-prefill` mandatory | **Already on** | Finding 6 |
| 262k window reachable | True, but not because of int8 | fp8 pool (336k) already exceeds 262k. 180k was the user's choice |
| util 0.94 | Not recommended | 0.90 = 29.7 GB, near the user's stable 30.8 GB ceiling |

## Candidate fixes (simplest first)

| # | Change | Expected cost | Confidence it stops the fault | Status |
|---|--------|---------------|-------------------------------|--------|
| 1 | **`RADIANCE_MXFP4_A_TILED_MIN_M=0`** (drop it from `MODEL_ENV`) | prefill ≤ 12–16 % slower at M ≥ 2048 (CLAIMED); decode unchanged (INFERRED) | High that the kernel is no longer used; medium that the fault is gone | **Recommended, not applied** |
| 2 | Keep 513 but lower `max_num_batched_tokens` below it | more prefill chunks, cost UNKNOWN | Low–medium (any M ≥ threshold still triggers it) | Not recommended |
| 3 | `RADIANCE_MXFP4_W4A8=0` (whole plugin off → aiter Triton W4A4) | prefill 1.6–1.9× slower (CLAIMED, `radiance_mxfp4.py:7-8`) | High | Last resort |
| 4 | Diagnostics `RADIANCE_MXFP4_DEBUG/CHECKX/SANITIZE=1` | debug overhead | Not a fix. Would confirm finding 4 | Only for an upstream report |
| 5 | Serve Claude Code's main/opus/sonnet from llama.cpp until 1 is verified | llama.cpp speeds (slower decode, no fault) | n/a | Fallback |

**How to apply fix 1 with minimal change (proposal):** add a profile `qwen38-mxfp4-dflash-noatiled.env` that sources
`qwen38-mxfp4-dflash.env` and rewrites `RADIANCE_MXFP4_A_TILED_MIN_M=513` → `0` in `MODEL_ENV`. Then point the llama-swap row's
`vllm_profile` at it and regenerate. The A/B is then one variable. **How to check it manually:** after boot, the upstream log
must **not** contain `[radiance.mxfp4] A-tiled GEMM path`. Then use it normally. A fault would show up as
`HSA_STATUS_ERROR_MEMORY_FAULT` in `/logs/stream/upstream`. Statistics: at the old rate (3 in ~90 requests), ~100 clean
requests give ~95 % confidence that the rate dropped (INFERRED, Poisson). Fewer only make it "not obviously worse".

## Upstream

No issue or release mentioning `radiance_mxfp4_fp8_gemm_atiled`, slybase or this fault was found (web search, 2026-10-22).
`github.com/slybase/vllm-sly-radiance` exists. Its issues/releases and newer tags were **not inspected** (ghcr tag list needs
auth). The kernel source (`.hip`) is not in the image, only `radiance_mxfp4_fp8.so`. Related lineage (not inspected):
`hub.docker.com/r/stilldeadcode/vllm-radiance`, `hub.docker.com/r/magiccodingman/vllm-radiance`,
`github.com/drwolfen/radiance-vllm-r9700`, Level1Techs "Ultimate 2x R9700 guide for Qwen 3.8 27B MXFP4". A report to
Sly with the log excerpt and the `data_ptr` hypothesis is worthwhile (outward-facing → user decides).

## Configuration state at the time of writing (all uncommitted)

- llama-swap (`~/.config/llama-swap/`): row `qwen38-27b-mxfp4-dflash-kvfp8-vllm-sharp` (ctx 180000, fp8, sharp, `kv_ram_gib 8`),
  inference group `exclusive`, coding rows and old int4 vLLM rows removed. Generator tests pass (252).
- Claude (`~/.config/claude/local_muxik/settings.json`): main/opus/sonnet → the vLLM row, haiku → 35B llama.cpp, max context
  180000. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` still 64000 (finding 12).
- `serve_vllm.sh`: `run` mode, `CONTAINER_NAME`, `FLOOR_WAIT`, `CHAT_TEMPLATE`, `KVCACHE=ram` knobs.

## Open ideas (not done)

- Apply fix 1 (needs OK), then test manually.
- Lower `CLAUDE_CODE_MAX_OUTPUT_TOKENS` to 28000 (needs OK).
- Persist the upstream log: llama-swap's buffer is 100 KB and the container is `--rm`. Teeing `serve_vllm.sh run` output to
  `bench/.servers/<name>.log` would keep fault evidence.
- Fault watchdog: `/health` stays OK during the hang (as hipfire, CLAUDE.md rule 15). A watcher on the upstream log for
  `MEMORY_FAULT` that kills the container would cut the ~16 min hang to seconds.
- fp8 KV quality at depth (finding 11): the user does not want custom needle/quality tests. Desk research only if wanted.
- Report to Sly upstream (user decision).
- Haiku-swap caveat: a haiku call (35B llama.cpp) unloads vLLM in the exclusive group. Switching back costs a ~4–7 min boot.

## Update 17:00 — fix 1 applied, first test

- **Fault #4** (MEASURED, llama-swap upstream buffer): a boot at 16:48 local, still on the old profile (`a_tiled_min_m=513`),
  faulted in the same kernel on its **first** Claude Code request. Tally with the A-tiled path on: **4 faults**, 3 of them
  in llama-swap/Claude Code serving or campaign boots, 2 on the first long request of a boot.
- **Fix applied:** profile `sly-radiance/qwen38-mxfp4-dflash-noatiled` (sources `qwen38-mxfp4-dflash.env`, sets
  `RADIANCE_MXFP4_A_TILED_MIN_M=0`). The llama-swap row `qwen38-27b-mxfp4-dflash-kvfp8-vllm-sharp` now uses it (id unchanged).
  Generator tests: 252 passed.
- **Test 1** (headless `claude --settings ~/.config/claude/local_muxik/settings.json -p …`, read-only summary task): boot +
  3 turns in **249 s**, 40,064 input tokens (30,800 served from the prefix cache), 2,294 output tokens, correct answer.
  Container log: `a_tiled_min_m=0`, **0 A-tiled GEMM calls, 0 faults** (MEASURED). n=1 → proves the kernel is off and
  serving works, **not** that the fault rate dropped (needs ~100 clean requests).
- **Side effect:** GPU KV pool **354,661 tok** vs 335,974 with A-tiled on (+5.6 %, MEASURED, same ctx/util). INFERRED: the
  tiled-layout scratch buffers are no longer reserved.
- Prefill speed with the fix is not yet measured cleanly. The engine's 10 s averages (3,181 tok/s on the first chunk window)
  are not comparable to the campaign numbers. A one-probe re-run of the DFlash campaign's cr depths would quantify the
  CLAIMED ≤12–16 % cost.

## Update 17:20 — A-tiled hypothesis REFUTED; RAM tier is the new suspect

- **Fault #5** (MEASURED, user's interactive `claude --settings …local_muxik/settings.json`, prompt "test", boot with the
  `-noatiled` profile, `a_tiled_min_m=0` confirmed in the container log): first request → `HSA_STATUS_ERROR_MEMORY_FAULT` in
  **`radiance_mxfp4_fp8_gemm_folded<2, true, true, false>`** (grid [20480,7,1]), "Page not present", then ~7 min hang.
  The folded kernel is the one that runs when A-tiled is off. **So the bug is not specific to the A-tiled path.** The
  stale-`data_ptr` hypothesis (finding 4) is refuted as *the* cause. The fault sits in the MXFP4 W4A8 plugin generally, or in
  whatever hands it a bad address. Turning A-tiled off bought nothing and costs prefill, so the profile is reverted to 513.
- **Pattern** (MEASURED, small n, correlation only):

  | Setup | Boots / requests | Faults on 1st request | Later faults |
  |---|---|---|---|
  | Campaigns: no RAM tier, ctx 150k/170k, no sharp | 4 boots / 84 req | 0 | 2 (2nd deep conversation of a boot) |
  | llama-swap, RAM tier on, interactive Claude Code | 3 boots | **3** (2 atiled, 1 folded) | — |
  | llama-swap, RAM tier on, curl / headless `claude -p` | 4 boots | 0 | — |

  The serving rate is far above the campaign rate. Main config differences: **RAM KV tier (OffloadingConnector: async GPU↔pinned-host KV
  copies)**, ctx 180k, sharp template. INFERRED: the RAM tier is not *necessary* (campaign faults happened without it) but
  is the top suspect for the rate jump. Earlier statement "the RAM tier is not the cause" (finding 8) is downgraded to "not
  the only cause".
- **Next A/B (applied):** llama-swap row without `kv_ram_gib` (no RAM tier), original profile (`A_TILED_MIN_M=513`), ctx 180000,
  fp8 KV, sharp unchanged. If interactive sessions survive several boots → the RAM tier is the trigger. If not → candidates are
  `RADIANCE_MXFP4_W4A8=0` (whole plugin off, CLAIMED 1.6–1.9× slower prefill, no quality loss: falls back to the
  checkpoint's native W4A4 path), the sharp template / ctx 180k (back to campaign settings), or an upstream report.
- The research prompt for keeping the A-tiled 12 % is **shelved**: its premise (A-tiled-specific bug) is refuted.
