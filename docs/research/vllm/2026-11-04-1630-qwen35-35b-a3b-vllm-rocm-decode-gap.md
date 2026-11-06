<!-- meta
date: 2026-11-04 16:30
takeaway: The 35B decodes at ~16 t/s on Sly 1.9.1 because its MoE experts run through the vLLM OCP-MX EMULATION backend, which dequantizes ALL 256 experts of every layer to bf16 on every forward pass (~96 GB of memory traffic per decode step, INFERRED, vs ~180 ms/step MEASURED). The step is ~4-5x slower than the 27B's (37-44 ms), and acceptance (2.9 vs 3.7 tokens/step) explains only ~1.3x. No native MXFP4 MoE backend can run on gfx1201 (every one is gated on gfx950/gfx942/gfx1250/CUDA). Sly's own 35B-A3B MoE recipe (MiniCPM-V 4.7, GPTQ W4A16 + a tuned R9700 int4 MoE config) is CLAIMED at 169 t/s decode, so a W4A16 int4 checkpoint is the realistic fast path. FP8 does not fit 32 GB. 200 t/s is not demonstrated for any 35B on this card; ~120-170 t/s is.
-->

# Why Qwen3.5-35B-A3B decodes at ~16 t/s on Sly radiance 1.9.1 / R9700, and what would make it fast

**Date:** 2026-11-04 · **Kind:** deep-dive (code reading of the image + repo data + web) · **Method:** `/research` deep-dive. Image code read with
read-only `docker run --rm --entrypoint bash ...` (no `--device`; sources copied to the session scratchpad). Web sources are Tier-1 where possible
(HF model cards, the SlyBase repo, arXiv). Tags per iron rule 1: `MEASURED` (our files, path/label cited), `CLAIMED` (external, URL),
`INFERRED` (reasoned, stated).

## Summary

| Question | Answer | Confidence |
|---|---|---|
| Is the user's premise right (35B >= 2x the 27B)? | **On llama.cpp yes, on this vLLM checkpoint no.** llama.cpp Vulkan: 35B 115.7-120.2 t/s vs 27B Q4 32.6-46.1 t/s (MEASURED, `campaigns/2026-07-14-hardest-tasks-27b-vs-35b/analysis.md`, row "35B-A3B is far faster"). vLLM 27B: ~100 t/s is the 10k figure; 73.9-93.9 at 50k-145k (MEASURED, `campaigns/2026-10-30-vllm-redhat-sly191-d0-dflash-depth/analysis.md`, DFlash2 k=7, delta 0). Our 35B: 14-17 t/s. | high |
| Root cause of 16 t/s | MoE experts run on the **EMULATION backend**: per forward pass, `dequant_mxfp4` expands `w13` and `w2` of **all 256 experts** to bf16 (`ocp_mx_emulation_moe.py:201-206`), then calls the stock Triton fused-MoE. Step time ~180 ms (INFERRED from MEASURED rate and counters) vs 37-44 ms for the 27B. | high on mechanism, medium on the share of the step (see "falsifiers") |
| Can any non-emulated MXFP4 MoE run on gfx1201? | **No, not in this image.** Each is gated on gfx950 / gfx942 / gfx1250 / CUDA, or rejects SiLU (table below). | high (code read) |
| Faster checkpoint format? | **W4A16 int4 (GPTQ/compressed-tensors, symmetric, no act-order)** via the Triton `int4_w4a16` fused-MoE with Sly's R9700 tuned config. FP8 does not fit 32 GB. | medium (the recipe is CLAIMED for a different 35B-A3B model) |
| Is 200 t/s realistic? | **Not shown anywhere for a 35B on this card.** Best published/measured: 169.4 t/s (Sly MiniCPM-V 4.7 35B-A3B, 210 W, CLAIMED); llama.cpp Vulkan 127-136 t/s without a drafter or with MTP (MEASURED + CLAIMED). 200 needs mean accept length >= ~5 at a ~25 ms step; we get 2.9. Realistic target: **110-170 t/s**. | medium |

## 1. The 27B reference, verified (user said "stable ~100 t/s")

| Config | Decode t/s | Tag / source |
|---|---:|---|
| 27B RedHat MXFP4, Sly 1.9.1, delta 0, DFlash2 k=7, 10k / 50k / 100k / 145k (mean of 2 reps) | 100.2 / 73.9 / 93.9 / 80.5 | MEASURED, `campaigns/2026-10-30-vllm-redhat-sly191-d0-dflash-depth/analysis.md` |
| same, no speculation (Sly 1.9.1, 10k/50k/100k) | 18.97 / 19.43 / 19.01 | MEASURED, `docs/analysis/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md` |
| 27B DFlash2 step cost | 36.8 ms @10k, 44.4 ms @145k | MEASURED (same campaign, "Step cost by method") |
| 35B-A3B MXFP4 + DFlash k=7, 10k / 50k / 100k, n=3, p50 | 17.07 / 15.51 / 14.22 | MEASURED, `bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k/dflash-k7/results.jsonl`, labels `dflash-k7-10000/-50000/-100000` |

So "~100" is the 10k point; the 27B averages ~87 over the four depths. The ratio the user wants is 2x of that (~175-200).
Probe settings were the same (temperature 1.0, 256 tokens, unique prefix, conc 1), so the comparison is like for like except the model.

## 2. Which code path decides decode speed

**Selection chain (image 1.9.1, vLLM 0.32.0):**
1. `quark_moe.py:1618` calls `select_mxfp4_moe_backend(moe, activation_key=kMxfp4Dynamic)` for scheme `w_mxfp4_a_mxfp4`.
2. `oracle/mxfp4.py:692` -> `_filter_by_activation(_get_priority_backends_for_gpt_oss(), kMxfp4Dynamic)`. `_filter_by_activation` (line 545) returns
   `[backends whose act key == kMxfp4Dynamic, or EMULATION] + [BF16 backends]`. EMULATION therefore sits **before** every BF16-activation backend.
3. Candidates before it are `AITER_MXFP4_MXFP4` and `CUTLASS_MXFP4_MXFP4`; both fail on gfx1201 (below). EMULATION is accepted (`ocp_mx_emulation_moe.py`
   `_supports_quant_scheme` returns True; it only needs the `amd-quark` package, which is installed: amd-quark 0.12.post1, MEASURED by `pip list` in the image).
4. Log confirms (MEASURED, `dflash-k7/server.log`): `Using 'EMULATION' Mxfp4 MoE backend`, `Using OCP_MXQuantizationEmulationTritonExperts MOE backend. This will dequantize weights on the fly`.

**What EMULATION does per step** (`experts/ocp_mx_emulation_moe.py`, `apply()` lines 174-226): `w1_dequant = self._dequantize_weights(w1, ...)` and
`w2_dequant = ...` (lines 201-206) over the **whole** `[E, ...]` uint8 tensors, i.e. all 256 experts, on the GPU (quark `mx.dq_mxfp4`, `mxfp4_utils.py:146-158`),
then `TritonExperts.apply` with bf16 weights plus fake quant-dequant of the activations (`quantization_emulation=True`, `triton_moe.py`). There is no caching
between calls, and it is independent of the number of tokens M and of context depth. It is GPU work, not CPU work.

**Cost model (INFERRED, arithmetic from `config.json`: hidden 2048, moe_intermediate 512, 256 experts, 40 layers):**

| Item | Value |
|---|---:|
| `w13` elements per layer (256 x 1024 x 2048) | 536.9 M |
| `w2` elements per layer (256 x 2048 x 512) | 268.4 M |
| bf16 bytes written by the dequant, per layer / 40 layers | 1.61 GB / 64.4 GB |
| packed 4-bit + scales read by the dequant, 40 layers | ~17.1 GB |
| bf16 expert bytes read by the GEMM when 8 verify rows touch ~57 distinct experts (22%) | ~14.5 GB |
| **Total per forward** | **~96 GB** |
| Time at 640 GB/s (CLAIMED spec, below) | ~150 ms at 100% efficiency |
| Observed step: (1 + 1518/807 = 2.88 tokens/step) / 15.5-16.6 t/s | **174-186 ms** (INFERRED from MEASURED `spec.txt` counters + results.jsonl) |

The prediction matches the observation within ~20%, which is the strength of the explanation, not proof. Corollaries that follow from it and are testable:
- Decode is flat with depth (MEASURED 17.07 / 15.51 / 14.22): the step is dominated by a depth-independent weight-expansion cost.
- Prefill is fast (MEASURED 5.7k t/s @10k): the same 150 ms cost is amortized over thousands of rows per forward.
- **No-speculation decode should be ~6-8 t/s** (M=1: ~82 GB dequant traffic -> ~130 ms/step; INFERRED). The nospec arm in progress is the cleanest test.
- Acceptance matters less than step cost: 35B 2.88 tokens/step vs 27B 100.2/27.2 steps/s = 3.68 tokens/step (INFERRED from MEASURED), a 1.28x factor; step time is 4-5x.

R9700 memory bandwidth: 640 GB/s, 256-bit GDDR6 at 20 Gbps (CLAIMED; several vendor listings, some quote 644.6 GB/s: https://www.tomshardware.com/pc-components/gpus/amd-launches-radeon-ai-pro-r9700-to-challenge-nvidias-ai-market-dominance , https://hothardware.com/news/radeon-ai-pro-r9700-arrives-32gb-vram-machine-learning ; I did not retrieve AMD's own page, it timed out).

The Sly README itself says "stock vLLM emulates MXFP4 in bf16 on RDNA4" and ships kernels only for the dense linears (CLAIMED, https://github.com/SlyBase/vllm-sly-radiance). The image's `[radiance.mxfp4] W4A8 fp8-WMMA GEMM` log line is the dense-linear kernel; this checkpoint
**excludes** attention, linear-attention, shared-expert and router from quantization (AMD card, CLAIMED: https://huggingface.co/amd/Qwen3.5-35B-A3B-MXFP4; our `config.json` exclude list agrees, MEASURED), so those layers run in bf16 and the Sly W4A8 kernel does not see them either (INFERRED; the log shows `gate_up+silu fused 0, GDN qkvz+ba merged 0`).

## 3. Every MoE backend on gfx1201 and what blocks it

`--moe-backend` literals in this image: auto, triton, batched_triton, deep_gemm, deep_gemm_mega_moe, cutlass, flashinfer_*, b12x, marlin, humming, triton_unfused,
aiter, aiter_mega_moe, aiter_triton_mxfp4_bf16, flydsl, hpc, emulation, rdna3 (`vllm/config/kernel.py:122-146`, MEASURED by reading the image).
For MXFP4 only the keys in `map_mxfp4_backend` (`oracle/mxfp4.py` ~line 360-390) are accepted; `flydsl`, `rdna3`, `hpc`, `cutlass` raise "not supported for MXFP4 MoE".

| Backend | Blocker (file:line, image 1.9.1) | Status on gfx1201 |
|---|---|---|
| `aiter` / AITER_MXFP4_MXFP4, AITER_MXFP4_BF16 (CK) | `rocm_aiter_moe.py:504` `if not on_gfx950() or on_gfx1250(): return False` for `kMxfp4Static` weights | blocked, gfx950 only |
| `aiter_triton_mxfp4_bf16` | `aiter_mxfp4_w4a16_moe.py:311` `on_gfx942() or on_gfx950() or on_gfx1250()` | blocked |
| AITER_MXFP4_FP8 (W4A8) | `aiter_mxfp4_w4a8_moe.py:222` `on_gfx950() or on_gfx1250()` | blocked |
| `triton` (OAI triton_kernels) | device gate passes on gfx1x (`gpt_oss_triton_kernels_moe.py:41-58`), but both classes accept **only SWIGLUOAI** (lines 1083, 1526) | blocked, matches our MEASURED refusal "does not support MoEActivation.SILU" |
| **`triton_unfused`** | `UnfusedOAITritonExperts` (line 1162) **does** accept SILU (line 1172); device gate passes on gfx1x; weights `(kMxfp4Static, None)` accepted (line 1018); `vllm.third_party.triton_kernels` exists in the image | **not tried, untested on gfx1201** (see experiment 1). Priority list comment: "TRITON_UNFUSED has bug with MTP support". |
| `marlin`, `humming`, `cutlass`, `flashinfer_*`, `b12x`, `deep_gemm` | `p.is_cuda()` / SM-gated (e.g. `marlin_moe.py:589`, `cutlass_moe.py:716`) | blocked, CUDA only |
| `rdna3` | WNA16 (int4) only, and `on_gfx1100()` (`rdna3_moe.py:49`) | blocked (gfx1100, not gfx1201), irrelevant to MXFP4 |
| `flydsl` | not a literal in `map_mxfp4_backend`; `fused_flydsl_moe.py` is an int4/aiter path (INFERRED from file contents, not exercised) | not selectable for MXFP4 |
| `emulation` | works anywhere with amd-quark | **the one in use** |

Open item: I cannot say whether `triton_unfused` will compile or run correct MXFP4 on gfx1201 (upstream triton_kernels MXFP4 on AMD is aimed at gfx950); the `on_gfx1x()` gate suggests vLLM authors intend RDNA to work, which is an inference.

## 4. Would a different checkpoint format be faster?

**FP8 parent does not fit.** `Qwen/Qwen3.5-35B-A3B-FP8` lists 36B parameters, tensor types BF16/F8_E4M3/F32, fine-grained FP8 block 128 (CLAIMED, https://huggingface.co/Qwen/Qwen3.5-35B-A3B-FP8; file size not stated on the page).
At ~1 byte/param that is ~36 GB, over the card's ~31.86 GiB (INFERRED; planning bound only, iron rule 7). The local 27B FP8 is 23 GB on disk (MEASURED `du`), the local 35B MXFP4 is 23 GB on disk with 21B params (MEASURED `du`; HF metadata CLAIMED). So FP8 35B cannot load on one R9700 regardless of context. The banner's "tuned fused-MoE configs ... E=256,N=256" is a different shape: our log says `E=256,N=512`, and the image ships `E=256,N=256,...R9700,dtype=fp8_w8a8,block_shape=[128,128].json` (MEASURED, `ls configs/`), so even a fitting FP8 would not use it at TP1 (INFERRED).

**W4A16 int4 is the format Sly tuned for exactly this expert shape.** The image ships `E=256,N=512,device_name=AMD_Radeon_R9700,dtype=int4_w4a16.json` (MEASURED, `ls fused_moe/configs`), and our log's missing file is `E=256,N=512,device_name=AMD_Radeon_R9700.json` (no dtype suffix, bf16 path used by emulation).
Sly's own documentation for a 35B-A3B MoE on this card (MiniCPM-V 4.7 35B-A3B, GPTQ W4A16 compressed-tensors, experts use that int4 json) reports (CLAIMED, https://github.com/SlyBase/vllm-sly-radiance/blob/main/docs/MINICPM-V47.md, 210 W cap, 64k ctx, K=8 DSpark drafter, BetterBench):

| Step | Decode t/s | Step gap |
|---|---:|---:|
| GPTQ, graphs, tuned MoE | 112.5 | 38.0 ms |
| + bf16 linears -> MXFP4 at load (`RADIANCE_NVFP4_BF16_LAYERS`) | 140.9 | 34.2 ms |
| + drafter linears -> MXFP4 | 146.8 | 32.8 ms |
| + `--attention-backend ROCM_AITER_UNIFIED_ATTN` | **169.4** | 26.2 ms |

The page says the MoE config alone gave 1.2-1.7x per MoE call (+8% end to end). Caveats: it is a different model (MiniCPM-V 4.7, same E=256/N=512 expert shape), the drafter is DSpark not DFlash, and the comparison there was 132.4 t/s for the 27B in the same window, so this is a **1.28x**, not 2x, advantage over the 27B (CLAIMED).
Same page's headline for the 27B at 300 W: 154.4 t/s weighted (CLAIMED, README). Our 27B 100 t/s (cold code review, 256 tokens) is a harder workload than BetterBench's mix (code 186, reasoning 107, prose 90; CLAIMED).

**Constraints for a W4A16 checkpoint on gfx1201** (image `oracle/int_wna16.py`, MEASURED by reading): priority is RDNA3 (gfx1100 only) -> Marlin (CUDA) -> **TRITON** -> EMULATION. TRITON rejects AutoAWQ layouts and GPTQ with `desc_act` (lines ~190-200). So the checkpoint must be compressed-tensors or GPTQ **without** act-order; otherwise it silently falls to the int4 EMULATION backend, which has the same dequant-everything problem.
The only GPTQ Qwen3.5-35B-A3B I found is a community upload, `RESMP-DEV/Qwen3.5-35B-A3B-GPTQ-Hybrid`, with `desc_act true` and asymmetric (CLAIMED, https://huggingface.co/RESMP-DEV/Qwen3.5-35B-A3B-GPTQ-Hybrid, search snippet; page not opened): that would be **rejected by the Triton backend**. I found no confirmed RedHatAI / official W4A16 for Qwen3.5-35B-A3B. A local requantization (llm-compressor GPTQ/AWQ->compressed-tensors, symmetric, group 128, no actorder) is the likely route, which is real work and out of scope here.
Memory: the int4 weights should be ~18-20 GB (INFERRED), leaving room for ctx 262000 as the MXFP4 profile does; not measured.

## 5. Published and repo decode numbers for 35B-A3B

| Setup | Decode t/s | Tag / source |
|---|---:|---|
| llama.cpp Vulkan b9950, Qwen3.6-35B-A3B Q4_K_M, depth 8K / 128K / 200K, MTP off | 104 / 71 / 61 | MEASURED `docs/analysis/2026-07-11-2200-deep-context-35b.md` |
| llama.cpp Vulkan, 64K, MTP off / on | 114.3 / 135.9 | MEASURED `docs/analysis/2026-07-10-1810-rdna4-r9700-tuning-optimum.md` (35B table) |
| same file, 27B Vulkan no MTP / MTP | 31.7 / 73.5 | MEASURED (27B table) |
| same file, vLLM 0.19.1 AWQ 35B | 19.7 | MEASURED (old stack, same finding class: vLLM was not competitive) |
| 35B Vulkan, MTP on, ctx 4096 | 161.1 | MEASURED `docs/analysis/2026-07-16-0927-mtp-sampler-tax.md` (`presence_penalty 0.0` repA) |
| 35B vs 27B hardest-tasks decode (llama.cpp, long ctx) | 115.7-120.2 vs 32.6-46.1 | MEASURED `campaigns/2026-07-14-hardest-tasks-27b-vs-35b/analysis.md` |
| R9700 Vulkan (Windows), Qwen3.5-35B-A3B UD-Q4_K_XL, llama-bench TG average | 127.4 | CLAIMED, https://github.com/ggml-org/llama.cpp/discussions/19890 (commit 244641955) |
| Sly MiniCPM-V 4.7 35B-A3B, GPTQ + DSpark K=8, 210 W | 169.4 | CLAIMED (section 4) |
| Our vLLM Qwen3.5-35B-A3B MXFP4 + DFlash k=7 | 14.2-17.1 | MEASURED (section 1) |

I found no published stock-vLLM decode figure for Qwen3.5-35B-A3B on an R9700 (one search; absence is not evidence).
Note on `CLAUDE.md`: its line that the 35B's speed edge is "MTP-only" is about **Ornith vs Qwen3.6-35B-A3B** (Ornith has no nextn); against the dense 27B the 35B-A3B leads by ~2.5x on llama.cpp without MTP (rows above). Not a contradiction, but the two statements are easy to conflate.

## 6. Is the active-parameter advantage real at batch 1?

Bandwidth floor, INFERRED from `config.json` dimensions and 640 GB/s:
- Plain decode (M=1): 8 experts/layer x 3 x 2048 x 512 x ~0.53 B = ~0.5 GB for all 40 layers, plus bf16 dense parts (GDN/attention/shared-expert/router, ~2.8 GB at 2 B/param since the checkpoint keeps them bf16) -> ~3.3 GB -> ~5 ms -> a few hundred t/s upper bound. The 27B reads ~19 GB/token (disk size 19 GB, MEASURED) -> ~30 ms floor; measured 53 ms (18.97 t/s). So **the advantage is real on paper (~6x fewer bytes)** and llama.cpp realizes ~2.6x (115-120 vs 32-46).
- Verify step with K=7 (M=8 rows): the union of routed experts grows to ~57 of 256 per layer (22%, INFERRED from 256 x (1 - (1 - 8/256)^8) assuming independent routing, which real routers violate in the favorable direction). Expert bytes rise ~7x to ~3.9 GB, still below the 27B's 19 GB; floor ~7 ms + dense 4.4 ms.
- So the active-parameter comparison is **not misleading for a native kernel**, and **badly wrong for the emulated path**, whose cost scales with *total* parameters (all 256 experts, 21B-equivalent bf16 expansion = 64 GB/step), which is more than 3x the 27B's 19 GB.
- Literature caveat on MoE + speculation (CLAIMED, abstracts only; I did not read full texts): verifying several draft tokens activates more experts, adds memory traffic and can cancel the speedup (Cascade, https://arxiv.org/abs/2506.20675v1: Mixtral K=3 +39% on code, -54% on math); MoE-Spec calls this the "union-of-experts" problem and proposes a per-layer expert budget (https://arxiv.org/abs/2602.16052); EcoSpec (https://www.alphaxiv.org/abs/2607.12696.md) reports up to 1.62x. For 256-expert top-8 the union growth at K=7 is large (22% of experts), so K should be tuned, not copied from the 27B.

## 7. Drafting on this MoE: method, K, and why acceptance fell 51% -> 27%

MEASURED facts (`dflash-k7/server.log`, `spec.txt`): 807 drafts, 5649 drafted, 1518 accepted (26.9%). Mean acceptance length per 10 s window 2.08-4.45, typically 2.4-3.3; per-position acceptance ~0.6-0.8 at position 1 decaying to 0.0-0.3 by position 7. Draft sampling `probabilistic`, request temperature 1.0 (`perf2.sh`).

- **The fall is not 35B-specific.** The 27B with DFlash2 also drops from 0.549 (10k) to 0.367 / 0.423 (50k / 100k) (MEASURED, `docs/analysis/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md`, "acceptance rate drops"). The 51% was a 400-token smoke with a short prompt and first-request JIT, one request; 27% is a mix over 9 requests at 10k-100k with code-review thinking. Different output type and n=1 vs n=9; I do not treat 51 -> 27 as one effect.
- Candidate causes (all INFERRED, not isolated): (a) drafter z-lab/Qwen3.5-35B-A3B-DFlash is trained against the BF16/FP8 parent while the target here is W4A4-quantized (the 27B drafter has the same mismatch, but also a different training base); (b) temperature 1.0 sampling lowers draft/target agreement versus greedy; (c) long-context drift of the drafter (window 4096, `radiance.dflash_skip` log); (d) thinking text is higher-entropy than the short smoke.
- **Method/K:** because step cost under emulation is independent of M, K=7 is nearly free there, so K cannot be tuned from the current data. Once on a native int4 path, step cost grows with distinct experts (section 6) and the best K is probably lower than 7 (INFERRED; Cascade-style adaptivity). Sly's MoE recipe used K=8 with its own drafter (CLAIMED), so K=7-8 is not obviously wrong either. MTP k=4 on this model uses `TRITON_ATTN` because R4D refuses gqa=8 (MEASURED, profile header); the arm is still running.
- Worst case for MoE verification: a draft block whose rows route to disjoint experts maximizes the union (up to 56 of 256 experts per layer at K=7 with 8 rows) and its cost, while acceptance is low; with the emulated path this is moot, with a native path it costs up to ~7x expert bytes per step (INFERRED).

## 8. Ranked next experiments (all effects INFERRED)

| # | Experiment | Expected effect | Falsified if |
|---|---|---|---|
| 1 | Boot the same profile with `--moe-backend triton_unfused` (no code change; one flag, one boot; may need `VLLM_..` none). Watch for `Using 'TRITON_UNFUSED' Mxfp4 MoE backend` | step time falls from ~180 ms toward 40-60 ms; decode 40-80 t/s at accept 2.9 | boot error / wrong output on gfx1201, or decode unchanged (then dequant is not the cost) |
| 2 | Read the nospec arm now being produced | ~6-8 t/s if the dequant explanation holds | nospec >= 12 t/s (then the 180 ms is not a fixed per-forward cost) |
| 3 | `torch.profiler` or `rocprof` on one decode step (short boot, 3 requests) | `dq_mxfp4` + Triton MoE kernels = most of ~180 ms | they are < 50% of step time |
| 4 | W4A16 int4 checkpoint (symmetric GPTQ/compressed-tensors, group 128, **no act-order**) on the sly-amd engine layer; confirm log shows `Using 'triton' WNA16 MoE backend` and that the `E=256,N=512,...int4_w4a16.json` loads | 100-170 t/s decode with DFlash/MTP (Sly's CLAIMED 112 -> 169 for MiniCPM) | log shows `EMULATION`, or decode < 60 t/s |
| 5 | Add `RADIANCE_NVFP4_BF16_LAYERS` (regex over GDN/attn/shared-expert) on the MXFP4 checkpoint | +10-25% on top of whichever MoE path (Sly: 112.5 -> 140.9) | no log marker `linear layers: N/N`, or no gain |
| 6 | After 1 or 4, A/B DFlash vs MTP and K = 3, 5, 7 at 10k with greedy and temp 1.0 | locate the optimum K for the native step cost | step cost still flat in K |
| 7 | Try the Qwen3.6-35B-A3B DFlash drafter (profile header already names it) | accept length +0.2-0.5 | no change |

## 9. Is 200 t/s realistic?

Probably not as a cold-prompt, temperature-1.0 number on this card. Arithmetic (INFERRED): decode = steps/s x tokens/step. At Sly's best 35B-A3B step (26.2 ms) you need 5.2 tokens/step for 200 t/s; our measured 35B DFlash gives 2.9, the 27B gets 3.7. Sly's 169.4 t/s (CLAIMED) already needs ~4.4 tokens/step.
Code-heavy, low-entropy outputs do reach 186-211 t/s on the 27B under BetterBench (CLAIMED), so 200 is plausible in bursts of JSON/code, not as a stable mean for reasoning text. The 27B stays ahead of "2x" only because it is already ~100: a 35B at a realistic 110-170 t/s would be 1.1-1.7x, not 2x.

## 10. Not verified

- Late partial read of the MTP arm (MEASURED, `bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k/mtp-k4/results.jsonl`, aggregates `mtp-k4-10000` / `mtp-k4-50000`, p50): decode 17.07 / 14.72 t/s, prefill 5230 / 3331 t/s. A different drafter (own MTP head, k=4) gives the same decode rate as DFlash k=7 (17.07 / 15.51), consistent with a step cost that is independent of drafter and K (INFERRED; supports section 2, does not prove it). The 100k point and the nospec arm were not finished when this was written.
- Share of the ~180 ms step spent in dequant vs Triton GEMM vs drafter vs GDN is INFERRED from bandwidth arithmetic, not profiled. The drafter's own cost is unmeasured.
- Whether `triton_unfused` runs MXFP4 correctly on gfx1201; whether Sly's int4 config applies to Qwen3.5 (shape matches; model not tested by anyone I could find).
- The AMD product page timed out; 640 GB/s rests on retailer/press listings.
- The Sly repo `moe-configs/`, `PERFORMANCE.md` and `MXFP4-NOTES.md` contents were only seen through page summaries; no Sly doc mentions Qwen3.5/3.6-35B-A3B (fetch returned none). Local `/mnt/Lin1/work/vllm/sly-radiance/src/` only holds `v1.6.0`, which predates this model.
- No W4A16 Qwen3.5-35B-A3B checkpoint meeting the backend constraints was confirmed to exist.
- The banner's "~-12% TTFT prefill" tuned-config claim concerns FP8 N=256; not relevant to our decode problem.

## Sources

- Image code, `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (vLLM 0.32.0): `vllm/model_executor/layers/fused_moe/oracle/mxfp4.py`, `oracle/int_wna16.py`, `experts/{ocp_mx_emulation_moe,rocm_aiter_moe,aiter_mxfp4_w4a8_moe,aiter_mxfp4_w4a16_moe,gpt_oss_triton_kernels_moe,rdna3_moe,marlin_moe,cutlass_moe}.py`, `quantization/quark/quark_moe.py`, `config/kernel.py` (read 2026-11-04)
- https://huggingface.co/amd/Qwen3.5-35B-A3B-MXFP4 (fetched 2026-11-04; listed hardware MI300/MI350/MI355, no perf numbers)
- https://huggingface.co/Qwen/Qwen3.5-35B-A3B-FP8 (36B params, no file size)
- https://github.com/SlyBase/vllm-sly-radiance and `docs/MINICPM-V47.md`, `MXFP4-NOTES.md` (fetched via summarizer 2026-11-04)
- https://github.com/ggml-org/llama.cpp/discussions/19890
- https://arxiv.org/abs/2506.20675v1 , https://arxiv.org/abs/2602.16052 , https://www.alphaxiv.org/abs/2607.12696.md (abstracts/summaries only)
- https://www.tomshardware.com/pc-components/gpus/amd-launches-radeon-ai-pro-r9700-to-challenge-nvidias-ai-market-dominance , https://hothardware.com/news/radeon-ai-pro-r9700-arrives-32gb-vram-machine-learning
- https://huggingface.co/RESMP-DEV/Qwen3.5-35B-A3B-GPTQ-Hybrid (search snippet only)
- Repo: `bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k/`, `campaigns/2026-10-30-vllm-redhat-sly191-d0-dflash-depth/analysis.md`, `docs/analysis/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md`, `docs/analysis/2026-07-10-1810-rdna4-r9700-tuning-optimum.md`, `docs/analysis/2026-07-11-2200-deep-context-35b.md`, `docs/analysis/2026-07-16-0927-mtp-sampler-tax.md`, `campaigns/2026-07-14-hardest-tasks-27b-vs-35b/analysis.md`
