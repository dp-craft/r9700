# ISSUE SUMMARY — Sly radiance vLLM + Qwen3.8-27B MXFP4: intermittent GPU memory fault

> **DO NOT FILE AS IS (2026-10-23):** the fault is not a Sly kernel bug. It goes away with `HIP_FORCE_DEV_KERNARG=0` (a kernel-argument pointer arrives with bit 44 cleared) — see `docs/analysis/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md`. An upstream report, if any, belongs to ROCm/HIP.

- **Written:** 2026-10-22 ~19:00 local (end of session) · **Status:** OPEN, not fixed
- **Companion files:** `PLAN.md` (next steps: Batched search, Batches 1–6; options A–I as the catalog), `vllmtest.sh` / `swaptest.sh` (repro harness), `fixtures/` (repro prompts: a shared-prefix series, NOT independent cold prompts — see PLAN.md Batched search)
- **Earlier write-up** (timeline up to 17:20, partly superseded by this file): `docs/analysis/2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md`
- **Provenance tags:**
  - MEASURED = our logs and runs today.
  - FROM-CODE = read from the image's Python source.
  - CLAIMED = external or code-comment claim.
  - INFERRED = reasoning.

## 1. The issue in one paragraph

Serving `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` + the DFlash2 drafter on `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` (vLLM 0.31.0) on the R9700 (gfx1201) **intermittently crashes the GPU** with `HSA_STATUS_ERROR_MEMORY_FAULT` ("Page not present"). The fault happens inside Sly's MXFP4 **W4A8** weight-GEMM kernels: `radiance_mxfp4_fp8_gemm_atiled` and `radiance_mxfp4_fp8_gemm_folded`. After the fault the engine **hangs**. `/health` keeps answering OK, the request never returns, and after minutes the engine dies with `EngineDeadError`. MEASURED: it happens on ordinary 25k–40k-token prompts, often on the **first** request of a boot, and depends on the prompt content. It reproduces with the exact config that passed the earlier performance campaigns. Those passes were partly luck (2 faults in 84 requests even then).

## 2. Setup

| Item | Value |
|---|---|
| GPU / host | AMD Radeon AI PRO R9700, gfx1201, 32624 MiB · Ryzen 5 3600, 31 GB RAM, no swap · kernel 7.0.0-38 · ROCm 10.1 |
| Image | `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` (vLLM 0.31.0) |
| Model | `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` rev 5233554c (MXFP4 weights; the Sly plugin runs it as **W4A8** = MXFP4 weights × fp8 activations) |
| Drafter | `syvai/Qwen3.8-27B-DFlash2-W4A16`, k=7 |
| Engine args | fp8 KV · `--gpu-memory-utilization 0.90` · `--attention-backend R4D_HYBRID` · `--max-num-batched-tokens 2048` · prefix caching · cudagraph FULL_DECODE_ONLY sizes `[8]` · chat template `/opt/qwen-fixed.jinja` |
| Plugin env (profile `qwen38-mxfp4.env`) | `RADIANCE_MXFP4=1 RADIANCE_MXFP4_W4A8=1 RADIANCE_MXFP4_W4A8_MIN_M=0 RADIANCE_MXFP4_DECODE_MAX_M=128 RADIANCE_MXFP4_A_TILED_MIN_M=513 RADIANCE_MXFP4_WPERM=1 RADIANCE_LMHEAD_INT4=1 RADIANCE_FUSED_NORM_QUANT=1 RADIANCE_KV_GROUP_SIZE=8 RADIANCE_EMBED_INT8=1 RADIANCE_EMBED_BITS=4 RADIANCE_MXFP4_WIDE_MAX_M=192 RADIANCE_ADAPTIVE_WIDTH=perseq` (Sly README quickstart) |
| Launchers | `bench/engine-bench/vllm/serve_vllm.sh` (`start` = detached, used by campaigns; `run` = foreground `--rm`, used by llama-swap). Same docker argv otherwise |
| Client | Claude Code via llama-swap (`~/.config/claude/local_muxik/settings.json`), Anthropic `/v1/messages` |

## 3. What the fault looks like (MEASURED)

- **Log line:** `HSA_STATUS_ERROR_MEMORY_FAULT … Page not present or supervisor privilege`, followed by `kernel: void radiance_mxfp4_fp8_gemm_atiled<2,true,128,false,4,false,0>` or `radiance_mxfp4_fp8_gemm_folded<2,true,true,false>`.
- **Example shape** (fault #3): `M=1760 N=16384 K=5120`, A-tiled call #1000. M=1760 is a prefill chunk remainder, since chunks are 2048 tokens.
- **After the fault**, the request hangs:
  - Claude Code saw an empty reply after 5 min, then a 1.5 min retry with no valid JSON.
  - Then HTTP 500 + `EngineDeadError` (~7–16 min after the fault).
  - The container exits.
- **llama-swap can't detect it:** `/health` never touches the GPU, so it stays OK.

## 4. Chronology of tests (all on a fresh boot unless noted)

| # | Time | Config | Request | Result |
|---|---|---|---|---|
| 1–2 | earlier today | DFlash campaigns: `serve_vllm.sh start`, ctx 150k/170k, np 8, built-in template, no RAM tier | 84 requests over 4 boots | **2 faults** (atiled), both on a 2nd deep conversation. 82 clean requests |
| 3 | 16:3x | llama-swap row: ctx 180k, sharp template, RAM KV tier 8 GiB, A-tiled on | Claude Code's first request | **FAULT** atiled |
| 4 | 16:48 | same | Claude Code's first request | **FAULT** atiled |
| — | 17:00 | profile `-noatiled` (`A_TILED_MIN_M=0`) | headless `claude -p`, 3 turns, 40k tokens | PASS (n=1). KV pool 354,661 vs 335,974 tok |
| 5 | ~17:15 | `-noatiled`, same llama-swap row | user's interactive Claude Code, prompt "test" | **FAULT** in **folded** kernel, so the A-tiled hypothesis was refuted. Reverted to 513 |
| 6 | 17:2x+ | RAM tier **removed** (`kv_ram_gib` dropped), ctx 180k, sharp | interactive / long request | **FAULT**, so the RAM tier is not the cause |
| 7 | | ctx 180k, **np 8** | concurrent short + long | **FAULT** |
| 8 | 18:06 | ctx 180k, sharp, **long request first** (solo, `long.json`, ~25k tok) | long first, then short, then long | **FAULT** on the first. Later requests got 500 (engine dead) |
| 9 | 17:58 | campaign mode exactly: `serve_vllm.sh start`, 170k, np 8, built-in template | `long.json` | PASS (13.0 s) |
| 10 | 18:17 | llama-swap, **ctx 150k**, np 1, **sharp** | `long.json` | **FAULT** |
| 11 | 18:21 | llama-swap, ctx 150k, np 1, **no sharp** (built-in template) | `long.json` | PASS (205 s incl. boot). KV pool 345,297 |
| 11b | same server | | `long-terse.json` (sharp's terse instruction moved into the system prompt) | **FAULT**, so the template file itself is not the cause; the prompt content is what matters |
| 12 | 18:30 | **harness baseline** `fixtest.sh` (campaign config: 150k, np 1, built-in template, no extra env) | p0..p4 (shared-prefix series: p0 ~25k cold; p1/p2 prefix-cache hits; p3/p4 ~5k new tokens each on a cached ~30k prefix — corrected 2026-10-22 ~19:30, earlier text said "cold") | p0 13.1 s, p1 7.3, p2 4.9, p3 5.0 → **FAULT@p4** (atiled) |
| 13 | ~18:35 | baseline + `PYTORCH_HIP_ALLOC_CONF=expandable_segments:True` | — | **BOOT FAILED** (dies silently while loading weights) |
| 14 | ~18:40 | baseline + `RADIANCE_MXFP4_SYNC=1` | — | **BOOT FAILED**: `hipErrorStreamCaptureUnsupported` (a stream sync is illegal during HIP-graph capture) |
| 15 | ~18:42 | baseline + `RADIANCE_MXFP4_W4A8=0` | — | **BOOT FAILED**: `KeyError: 'radiance_wref'`. This was a **stale AOT compile cache** (graph compiled under W4A8=1 was reused), not a W4A4 problem |
| 16 | 18:49 → | baseline + `RADIANCE_MXFP4_W4A8=0` + `VLLM_DISABLE_COMPILE_CACHE=1` | p0..p4 | Booted (KV pool 331,188 tok). **PASS: p0..p4 all HTTP 200, no fault** (p4 is where the baseline faulted). Times p0 295 s · p1 152 · p2 63 · p3 61 · p4 62, against W4A8 13.1 · 7.3 · 4.9 · 5.0 · (fault). Measured after load; p0–p1 include one-time Triton JIT warm-up. **Steady state ≈ 60 s vs ≈ 5 s → ~12× slower** (CLAIMED 1.6–1.9×). Stable (n=1 run) but too slow for Claude Code |

## 5. Hypotheses: tested and refuted

| Hypothesis | Test | Verdict |
|---|---|---|
| A-tiled-specific bug (stale `data_ptr` layout registry, `radiance_mxfp4.py:53-63`) | A-tiled off (#5) | **Refuted**: folded kernel faults too |
| RAM KV tier (OffloadingConnector async copies) | tier removed (#6) | **Refuted** |
| ctx 180k | ctx 150k (#10, #12) | **Refuted** |
| sharp chat template | no sharp, but terse text in the system prompt (#11b) | **Refuted**: prompt content matters, not the template mechanism |
| Concurrency / np 8 | np 1 solo (#8, #10, #12) | **Refuted** |
| Request order (short warm-up before long) | long first (#8) | **Refuted** |
| fp8 KV cache | FROM-CODE: the faulting kernel is the *weight* GEMM; "fp8" in its name = fp8 *activations* | **Not involved** |
| chunked prefill missing | vLLM V1 always chunks (2048); the faulting M=1760 *is* a chunk | **Already on** |
| `serve_vllm.sh run` vs `start` | argv identical except `--rm` vs `-d` | **Not a difference** |

## 6. Why the performance campaigns "passed" and llama-swap "failed immediately"

- **Config check** (answered for the user): the first perf test and the llama-swap row differed only in ctx 180000, the sharp template and np. Each of those was later ruled out (§5).
- **The campaigns were not fault-free.** They had 2 faults in 84 requests (MEASURED). INFERRED reasons the rate looked low:
  - The campaign prompts were a few fixed code-review fixtures.
  - The fault depends on the prompt; it is triggered by particular activation sizes and buffer placements.
  - Claude Code's prompts (big system prompt + tools + varying content) hit it far more often.
- The harness baseline (#12) faults on the 5th distinct prompt with the campaign config itself. That makes the repro deterministic enough to test fixes on (one boot ≈ 7–10 min).

## 7. Current best understanding of the root cause (INFERRED)

- **The bug** is an out-of-bounds **read** past the end of a buffer in the Sly MXFP4 W4A8 GEMM kernels (both variants).
- **A read, not a write:** the plugin author's code comment says the kernel "writes every element, and writes nothing out of bounds" (CLAIMED, `radiance_mxfp4.py` ~line 306).
- **Most likely the activation buffer `x_fp8` (M×K)** is read in whole M-tiles when M is not a tile multiple. A prefill chunk remainder such as M=1760 fits that.
- **Why only sometimes:** usually the over-read lands in memory the caching allocator has mapped, so nothing happens. It faults only when the buffer happens to sit at the end of a mapped segment. That explains prompt dependence (chunk remainders and allocation pattern) and the stochastic look.
- **The author has seen something similar:** another comment says an earlier class of bugs disappeared when "perturbing the allocator", which points at memory adjacency.
- **Can't fix it at the source:** the kernel source is not in the image, only `radiance_mxfp4_fp8.so`, so we can't patch the bounds check.

## 8. Fix candidates evaluated

| Candidate | Quality / ctx impact | Result |
|---|---|---|
| `RADIANCE_MXFP4_A_TILED_MIN_M=0` | none, CLAIMED ≤12–16 % prefill cost | **Fails**: folded kernel faults (#5) |
| Remove RAM KV tier | none (lose the prefix tier) | **Fails** (#6) |
| ctx 150k, no sharp, np 1 | — | **Fails** (#10, #11b, #12) |
| `PYTORCH_HIP_ALLOC_CONF=expandable_segments:True` | none | **Can't boot** (#13) |
| `RADIANCE_MXFP4_SYNC=1` / `=2` (diagnostic syncs) | none | **Can't boot**: incompatible with HIP graph capture (#14) |
| `RADIANCE_MXFP4_PADOUT=<n>` (pads the *output* buffer) | none | **Not tried**: it pads the output, but the suspect is an input over-read (§7), so it's unlikely to help |
| `RADIANCE_MXFP4_CLONE=1` (returns a copy of the output) | none | **Not tried**: same reasoning; it targets output lifetime |
| `RADIANCE_MXFP4_W4A8=0` (aiter W4A4 MXFP4 path, the checkpoint's native scheme) | quality none expected; prefill CLAIMED 1.6–1.9× slower | **PASS, no fault on 5 prompts (n=1), but ~12× slower steady state** (MEASURED #16) |
| Upstream radiance image / older Sly tags / llama.cpp MXFP4 GGUF / no DFlash / other chunk size / int8 KV / other checkpoints / upstream report | see `PLAN.md` Task 3 | Not yet tried |
| `--kv-cache-dtype int8` | — | FROM-CODE: R4D_HYBRID/AITER supports `auto/float16/bfloat16/fp8*` only; int8 variants exist only on TRITON_ATTN. And KV is not involved in the fault |

## 9. Important caveat found late: the vLLM compile cache

vLLM's AOT compile cache is **not keyed on `RADIANCE_*` env vars** (MEASURED via #15: `KeyError 'radiance_wref'`). Any A/B that changed only `RADIANCE_*` env vars may have run on a graph compiled for the previous setting, unless the compile cache was disabled.
- **The A-tiled-off test (#5) is affected in principle.** The A-tiled decision is made per call in eager Python inside the opaque op, and the container log confirmed `a_tiled_min_m=0` and 0 A-tiled calls, so it is INFERRED to be valid.
- **From now on** every test uses `VLLM_DISABLE_COMPILE_CACHE=1` (built into `vllmtest.sh`).

## 10. Side findings from the same session

| Finding | Provenance |
|---|---|
| RAM-tier pinned buffer rounds up to a power of two: 4 GiB → 4.28 pinned, 8 → 8.28, **9 → 16.28** (host dropped to 1.9 GB free). Use 8 if the tier comes back | MEASURED |
| GPU KV pool: 335,974 tok @180k with A-tiled on; 354,661 with it off; 345,297 @150k; 331,188 with W4A8=0 | MEASURED |
| fp8 KV runs with scale 1.0 (checkpoint has no k/v scales); quality at depth never measured | MEASURED (log), quality OPEN |
| vLLM rejects prompt + max_tokens > max-model-len (HTTP 400). Claude Code's `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` breaks requests once the prompt passes ctx − 64000. Recommended 28000; **not applied, awaiting the user's OK** | MEASURED |
| The pasted "FP8 crashes Radiance vLLM, use int8, chunked prefill mandatory" claims: mostly false for this setup (table in the earlier analysis doc) | MEASURED / FROM-CODE |
| llama-swap's `/logs/stream/upstream` buffer (~100 KB) keeps old faults across boots, which caused a watcher false positive. Use `docker logs <container>` of the current container instead | MEASURED |
| Iron-rule slip: one `pkill -f` with a pattern was used during this session (disclosed). Use pidfiles / `serve_vllm.sh stop` / container names only | — |

## 11. State left behind (uncommitted)

- **`~/.config/llama-swap/models.yaml`:** the vLLM row is in a TEST state. Current values: ctx 150000, np 1, fp8, no sharp, no RAM tier. Its generated id is `qwen38-27b-mxfp4-dflash-kvfp8-vllm`.
- **`~/.config/claude/local_muxik/settings.json`:** still points at `qwen38-27b-mxfp4-dflash-kvfp8-vllm-sharp`. That id **no longer exists**; it must be updated once a working config is chosen.
- **New, unused profile:** `bench/engine-bench/vllm/profiles/sly-radiance/qwen38-mxfp4-dflash-noatiled.env`.
- **The earlier analysis doc** lacks everything after 17:20. This file covers it, and `PLAN.md` says to append the final outcome there.
- **Nothing committed.** Pending user decisions:
  - commits,
  - `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 64000 → 28000,
  - an upstream report to SlyBase.
