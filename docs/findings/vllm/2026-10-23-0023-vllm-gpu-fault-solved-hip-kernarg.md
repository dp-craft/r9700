<!-- meta
date: 2026-10-23 00:23
slug: vllm-gpu-fault-solved-hip-kernarg
title: vLLM (Sly radiance MXFP4 + DFlash) GPU memory fault on R9700 — solved by HIP_FORCE_DEV_KERNARG=0
takeaway: The random HSA_STATUS_ERROR_MEMORY_FAULT (any ROCm kernel, address = a valid pointer with bit 44 cleared) disappears with HIP_FORCE_DEV_KERNARG=0 (kernel args in host memory instead of device memory written over PCIe) — 3/3 boots × 4 Claude turns clean at full speed (decode med 111–150, prefill med 2.4–3.0k tok/s); not the Sly kernels, not the 7.0.0-38 driver. Now the default in every vLLM profile.
-->

# vLLM GPU memory fault on the R9700 — solved by `HIP_FORCE_DEV_KERNARG=0`

- **Date:** 2026-10-22 evening → 2026-10-23 · **Track:** engine-bench (vLLM) · **Supersedes the open root cause in**
  `docs/findings/vllm/2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md`
- **Working notes / raw rows:** `notes/plans/2026-10-22-mxfp4-qwen38-options/FASTPATH.md`, `results.tsv`, `logs/`

## Summary

| | |
|---|---|
| **Issue** | `HSA_STATUS_ERROR_MEMORY_FAULT` ("page not present"), then a 5–16 min hang and a dead engine. Hit Claude Code's first request on most boots of Sly radiance 1.5.1/1.6.0 MXFP4 + DFlash, at any ctx, with or without llama-swap |
| **Root cause (INFERRED, strong)** | A **corrupted kernel-argument pointer**. The fault address is a valid buffer pointer with **bit 44 cleared**. MEASURED once, by pointer logging (ptrlog-4): the down_proj weight `0x7c930da00000…` was read at `0x6c94bc6a2000`. Every fault address seen was `0x6…`, while all buffers live at `0x7…`. By default HIP places kernel arguments in **device memory that the CPU writes over the PCIe BAR**; with them in **host memory** the faults stop |
| **Fix** | `HIP_FORCE_DEV_KERNARG=0` in the container env. Now the default in `stack/serve/vllm/profiles/{sly-radiance,radiance}/_engine.env` |
| **Evidence** | Fix: **3/3 boots × 4 Claude turns, 0 faults** (hostka-1..3, MEASURED). Without it: faults in **~12 of ~21 boots** this session (MEASURED rows below). Chance of 3 clean boots by luck at that rate ≈ 0.43³ ≈ **8 %** (INFERRED) → strong but not final; more runs are in progress |
| **Speed with the fix** | Same as the unstable config: decode median **111–150 tok/s**, prefill median **2.4–3.0k tok/s** (max 5.6k), DFlash acceptance 4.8–6.2 (MEASURED, `speeds.py`, 10 s log windows) — well above the ≥50 / ≥1000 target |
| **Ruled out (MEASURED)** | llama-swap; ctx size (120k–180k); Sly version (1.5.1 faults too); the A-tiled path; an M-tail over-read/over-write (padding A, x_scale and out by 256 rows: still faulted); prefill kernels only (the decode kernel faulted too); the amdgpu driver in kernel 7.0.0-38 (7.0.0-34 faulted too); warm start (a boot that survived a replayed Claude request still faulted) |
| **Consequence** | Every ROCm engine on this box should run with `HIP_FORCE_DEV_KERNARG=0`. The 2026-10-07 llama.cpp ROCm `-fa on` fault (same `0x6…` address shape) is probably the same bug (INFERRED, untested) |

## Working configuration (2026-10-23)

| Layer | Value | Provenance |
|---|---|---|
| GPU / host | R9700 gfx1201 32 GB; Ryzen 5 3600 | CLAUDE.md fixpoints |
| Kernel | **7.0.0-34-generic**: all fix runs. Without the fix, -34 and -38 both faulted. The fix is untested on -38 | MEASURED (`uname -r` in `kerneltest.sh`) |
| Host ROCm | 10.1.0 (HIP 7.16, clang 24); the container brings its own user space and shares only the kernel driver | MEASURED |
| Image | `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1`: vLLM 0.31.0, AITER 0.1.23, transformers 5.17.0, torch 2.13.0+rocm10.1.0, triton 3.8.0 | MEASURED (inside the image) |
| Model / drafter | `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` (`--quantization quark`) + DFlash2 drafter `syvai/Qwen3.8-27B-DFlash2-W4A16`, k=7, greedy | profile `sly-radiance/qwen38-mxfp4-dflash` |
| Serving args | `--max-model-len 180000 --max-num-seqs 1 --gpu-memory-utilization 0.90 --kv-cache-dtype fp8 --attention-backend R4D_HYBRID --max-num-batched-tokens 2048 --enable-prefix-caching`, cudagraph FULL_DECODE_ONLY [8], `qwen3_xml` tools, `qwen3` reasoning, `/opt/qwen-fixed.jinja` | `serve_vllm.sh print` |
| Env (fix + Sly) | **`HIP_FORCE_DEV_KERNARG=0`**, `RADIANCE_MXFP4_W4A8=1 W4A8_MIN_M=0 DECODE_MAX_M=128 WIDE_MAX_M=192 A_TILED_MIN_M=513 WPERM=1`, `RADIANCE_RUN_BWTEST=0`, `GPU_MAX_HW_QUEUES=2` | profile |
| Claude Code configs | `~/.config/claude/local_muxik` (llama-swap `:9292`, model `qwen38-27b-mxfp4-dflash-kvfp8-vllm`) and `local_vllm_direct` (`:8000`, `vllm.sh start`). Both: `CLAUDE_CODE_MAX_CONTEXT_TOKENS=180000`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS=33000`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75` | user values |
| llama-swap row | `qwen38-27b-mxfp4-dflash` (ctx 180000, fp8 KV) → id `qwen38-27b-mxfp4-dflash-kvfp8-vllm`; starts `serve_vllm.sh`, so it inherits the env fix without regeneration | models.yaml |

**Known limit (MEASURED k34-1, not a fault):** vLLM rejects prompt + 33,000 > 180,000, i.e. any prompt above 147k.
75 % compaction (~135k) usually fires first, but one turn of large file reads can jump past 147k → HTTP 400 in that turn.
Reduce `CLAUDE_CODE_MAX_OUTPUT_TOKENS` if this shows up in real sessions.

## Logical path (what each step ruled in or out)

| # | Hypothesis | Test (label) | Result | Conclusion |
|---|---|---|---|---|
| 1 | llama-swap / RAM tier / template causes it | direct vLLM + real Claude (claude-direct, claude-baseline-2) | FAULT 2/2 | engine-side |
| 2 | 1.6.0 regression | Sly 1.5.1, same profile (v151, v151-2) | PASS, then FAULT | present in 1.5.1 too. Only `radiance_mxfp4_fp8.so` differs between the images (md5) |
| 3 | depends on ctx / KV pool size | ladder from 120k (lad-120k-r1) | FAULT at the first step | not ctx |
| 4 | 256-row tile over-reads A past M=1760 (grid.y = 7) | overlay pads A + x_scale (pada-1) | FAULT | not A |
| 5 | … over-writes `out` | + out tail (padao-1) | FAULT | not an M-tail at all |
| 6 | which buffer? | inline pointer log (ptrlog-2..4) | PASS, PASS, FAULT | **fault = down_proj W address with bit 44 cleared** |
| 7 | placement is fixed per boot → reject bad boots | `warm_start.sh`: replay a captured Claude request, reboot on fault (warm-1) | warmed boot still FAULT | not per-boot |
| 8 | only the prefill kernels are broken | split prefill into ≤192-row slices on the decode kernel (split-1..3) | PASS, PASS, FAULT **in the decode kernel** | any kernel |
| 9 | amdgpu regression in 7.0.0-38 (the 2026-10-07 llama.cpp fault had the same `0x6…` addresses) | reboot to 7.0.0-34 (k34-1, k34-2) | no fault, then FAULT | not the driver version |
| 10 | pointer corrupted on its way to the GPU: kernargs in device memory written over PCIe | `HIP_FORCE_DEV_KERNARG=0` (hostka-1..3) | **PASS 3/3, 0 faults** | **fix** |

Why step 10 fits (INFERRED): the corruption hit a pointer, not data. It was random per launch, struck different kernels
in both vLLM and llama.cpp **on ROCm only** (never on Vulkan), and kept one bit pattern. A kernel argument written by the
CPU into VRAM through the BAR is the one path all of these share, and moving kernargs to host memory removes it. Which
part of that path flips bit 44 (PCIe link, BAR write-combining, firmware) is not established.

## Numbers (MEASURED, `campaigns/investigation/2026-10-22-1925-vllm-mxfp4-gpu-fault/results/results.tsv` + `speeds.py`)

| label | config | result | turn times | decode med | prefill med / max | accept |
|---|---|---|---|---|---|---|
| mhist | 1.6.0, 160k, no fix | 3 turns clean (t3 budget 400) | 85/66/75 s | 106 | 2627 / 3257 | 4.48 |
| v151 | 1.5.1, no fix | PASS | 151/90/96/211 s | 59 | 2226 / 3194 | 4.64 |
| ptrlog-4 | 1.6.0 + pointer log | FAULT t0 | — | — | — | — |
| split-2 | prefill on the decode kernel | PASS | 90/65/76/146 s | 107 | 2354 / 3272 | 4.62 |
| split-3 | same | FAULT t3 (decode kernel) | — | — | — | — |
| k34-1 / k34-2 | kernel -34, no fix | no fault (t3 budget 400) / FAULT t0 | 96/65/91 s | 110 | 2323 / 3270 | 4.78 |
| **hostka-1** | **fix**, -34 | **PASS** | 91/65/256/236 s | 150 | 2362 / 3276 | 6.21 |
| **hostka-2** | **fix** | **PASS** | 81/75/70/126 s | 111 | 2958 / 5580 | 4.83 |
| **hostka-3** | **fix** | **PASS** | 70/51/75/151 s | 111 | 2364 / 3250 | 4.90 |
| **swap-ka** | **fix, via llama-swap** (fixtures p0..p4) | **PASS** | p0 181 s incl. boot, p1..p4 7/4/4/5 s | — | — | — |

Speeds are medians over vLLM's 10 s stats windows with `MAXSEQS=1` (decode = windows without prompt tokens; prefill =
windows ≥1000 prompt tok/s, which read low when part-idle). They compare images on one workload; they are not a
`capture_engine.py probe` depth curve (rule 16) — run one before quoting the fixed config in a ranking.

## Consequences and follow-ups

1. **Default everywhere on ROCm:** `HIP_FORCE_DEV_KERNARG=0` is set in both vLLM engine profiles. Proposed next: add it
   to llama.cpp ROCm launches (`serve_llamacpp.sh` / llama-swap ROCm rows), then retest the 2026-10-07 `-fa on` fault.
2. **More confirmation:** 4 clean boots so far (hostka-1..3 + swap-ka through llama-swap) ≈ 0.43⁴ ≈ 3 % luck
   (INFERRED). Still open: a gate run back on kernel 7.0.0-38.
3. **Cost:** host-memory kernargs add PCIe reads per launch. No decode or prefill loss was visible (table above).
4. **No longer needed for this fault:** the `sly-pad-a` overlay (PAD_A / PAD_OUT / SPLIT_M / PTRLOG), `warm_start.sh` and
   the `-pada` / `-split` profiles. They are kept as diagnostics. `PY_OVERLAY` stays as a general `serve_vllm.sh` knob.
5. **Upstream:** this is not a Sly kernel bug, so the Sly issue draft (`ISSUE-SUMMARY.md`) should not be filed as is.
   If anything, report to ROCm/HIP with the bit-44 evidence.

## Tools added this session

| Tool | Purpose |
|---|---|
| `docs/plans/…/claudetest.sh` | the gate: boots a profile, runs 4 real `claude -p` turns, polls for `MEMORY_FAULT`; `AUTOCOMPACT_PCT` (default min(75, safe − 3)), `WARM=1` |
| `…/ladder.sh`, `…/kerneltest.sh`, `…/speeds.py` | ctx ladder; post-reboot gate; prefill/decode/acceptance from the server log |
| `stack/serve/vllm/serve_vllm.sh` `PY_OVERLAY` | mount a dir of Python modules that shadow the image's |
| `stack/serve/vllm/overlays/sly-pad-a/` | diagnostic overlay for `radiance_mxfp4.py` (PAD_A, PAD_OUT_ROWS, SPLIT_M, PTRLOG) |
| `bench/core/capture_proxy.py`, `warm_start.sh`, `warmup/claude-first/` | capture real Claude request bodies; boot + replay + reboot-on-fault |
