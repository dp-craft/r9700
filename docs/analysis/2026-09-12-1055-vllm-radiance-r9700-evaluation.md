<!-- meta
date: 2026-09-12 10:55
takeaway: `stilldeadcode/vllm-radiance` (gfx1201-only vLLM 0.27.1 + libr4d kernels) is the undisclosed "tuned" build behind Puget's R9700 numbers, and it runs our single-GPU INT4 checkpoint. **Clean 4-depth curve on ONE fixture family (findings 21-22): llama.cpp + MTP wins decode at every depth by 9-33 %; radiance's only win is prefill/TTFT at 8k.** Radiance decode does NOT decay with depth (exponent +0.070, R2 0.25) - the earlier "degrades with depth" claim was a content artifact and is withdrawn. The ranking is set by WORKLOAD, not depth: radiance leads on generated code, llama.cpp on review prose. A divergent-tail warm test (finding 23) confirms partial cache hits equal full hits, so the earlier identical-prompt warm figures stand.
-->

# vllm-radiance on the R9700 (gfx1201) — what it is, what transfers to a single-GPU INT4 setup

- **Date:** 2026-09-12 10:55 · **Track:** engine-bench (container vs host venv)
- **GPU/Host:** AMD Radeon AI PRO R9700 (gfx1201), 32624 MiB · kernel 7.0.0-31-generic · ROCm 10.0.0 host · HIP 7.15.26333 · Ryzen 5 3600, 31 GB RAM
- **Host venv (reference):** vLLM 0.29.0+rocm723 · torch 2.12.0+git6bbd260 · triton 3.7.1 · transformers 5.17.0 · `HSA_OVERRIDE_GFX_VERSION=12.0.1`
- **Container:** `stilldeadcode/vllm-radiance:0.9.3` (pushed 2026-08-27, 3.96 GB compressed / **13.7 GB on disk**)
- **Model:** `RedHatAI/Qwen3.8-27B-INT4` @ `bf08f3db` (compressed-tensors **W4A16**, group 128) · hybrid 64 layers = 48 Gated-DeltaNet + 16 full attention
- **Data:** `bench/runs/2026-09-11-2047-vllm-qwen38-27b-int4/radiance-*` · `bench/runs/2026-09-12-1330-depth-curve-mtp/` (findings 21–24)
- **Related:** `docs/analysis/2026-09-11-2047-vllm-qwen38-27b-int4.md` (the host-venv vLLM spike this branches from)

## Summary

`vllm-radiance` is the **"vllm-radiance build"** that Puget Systems benchmarked at 32.00 tok/s (vs 15.88 stock)
on 2× R9700 — a label their article never explains. It is a single-architecture vLLM image: everything is
compiled from source for `gfx1201` only, which is why it is 3.96 GB against the official `rocm/vllm` images'
25–27 GB. It carries RDNA4 correctness patches, RDNA4-tuned GEMM/attention/all-reduce paths, a hand-written
HIP kernel library (**libr4d**), and a dynamic MTP draft controller.

**The headline caveat for us:** its author lists "**non-FP8 weights, single GPU**" as *untested*, and that is
exactly our configuration. Its main weight-path speedup (`RADIANCE_PRESHUFFLE`, a preshuffled **FP8 blockscale**
GEMM) is inert on a W4A16 checkpoint, and the TP=2 all-reduce kernels are inert on one card. What does apply is
the R4D/GDN kernel set (**confirmed bound** to our model at runtime) and the MTP drafter stack.

A first container run was **misconfigured** (see finding 5) and produced +22.4 % prefill / −43.5 % decode; it is
retained only as a cautionary row. Configured per the image's own README (finding 3), it delivers
**+22.7 % prefill at decode parity** — 1384.5 vs 1128.3 tok/s prefill, 17.50 vs 17.58 tok/s decode — with the
R4D attention and GDN kernels confirmed bound to our non-FP8 checkpoint. Adding MTP 8 with
`disable_padded_drafter_batch`, `RADIANCE_FAST_DRAFT` and `RADIANCE_SKINNY_GEMM=all` reaches **1308.2 tok/s
prefill / 35.02 tok/s decode**, which beats both our host vLLM 0.29.0 (+16 % / +99 %) and llama.cpp b10909
Vulkan **as measured by `llama-bench`** (+30 % / +17 %). Decode-phase power rises from 133 W to 210 W, showing
the gain is filled idle time, not faster kernels (finding 10).

**That last comparison did not survive a fair test, and the report's conclusion has since reversed twice.**
`llama-bench` cannot use MTP, a server or a prompt cache (finding 19). Against the operator's own MTP-enabled
llama.cpp profile on real corpus fixtures, and now on a clean four-depth curve over a *single* fixture family
(finding 21), **llama.cpp + MTP wins decode at every depth from 8k to 32k by 9–33 %** and wins prefill from 12k
up; radiance's only clean win is prefill/TTFT at 8k (+29 %). Radiance's decode is *flat* in depth
(exponent +0.070, R² 0.25 — no trend), so finding 20's "degrades with depth" claim is **withdrawn** as a content
artifact. What actually decides the ranking is the **workload**: at the same 8k depth radiance wins by 26 % on
generated code and loses by 49 % on review prose (finding 22), because MTP throughput tracks draft acceptance
and acceptance tracks how predictable the *output* is. Finally, a divergent-tail probe (finding 23) shows a
partial cache hit is worth the same as a byte-identical one, so the earlier warm-cache numbers were not
inflated by prompt reuse.

## Legend

| Term | What it is | Effect on this box (R9700 / RDNA4, 32 GB) | How it's tested here |
|---|---|---|---|
| `libr4d` | Hand-written HIP kernel library for gfx1201; entry points named for the geometry they compile for (`attn_decode_h256_gqa6_fp8kv`, `gdn_chunk_scan_k128_v128_c64_bf16`) and **refuse a mismatch** | MEASURED: `gdn_chunk_scan` bound to our INT4 model (`head_k 128, head_v 128, chunk 64`) | startup log lists which kernel each part of the model resolved to |
| `--attention-backend R4D` | Purpose-built attention, transposed score matrix `Sᵀ=K·Qᵀ`; needs head_dim 256, paged block 16, **6 q heads per KV head**, bf16/fp8 KV | Our model matches exactly (head_dim 256, 24 q / 4 kv = 6) | arms R3–R6 |
| `RADIANCE_PRESHUFFLE` | Preshuffled AITER **FP8** blockscale GEMM | **Inert on W4A16** — no tuned GEMM exists for our weights | not testable on this checkpoint |
| `RADIANCE_SKINNY_GEMM=all` | Routes small bf16 projections to an R4D split-K kernel; adds GDN `in_proj_ba` (480 KiB, **48×/step**, 28.5 µs → 3.6 µs) | CLAIMED −3.9 % decode step | arms R4–R6 |
| `RADIANCE_FAST_DRAFT` | Draft head to 2 bits with exact rerank | CLAIMED +16.6 % tok/s single-stream; pair with `DRAFT_TAU=0.28` | arms R4–R6 |
| `disable_padded_drafter_batch` | Drops the MTP drafter's batch padding (needs the image's unpad patch) | CLAIMED **~+50 % single-stream** on the 27B hybrids | arms R4–R6 |
| `RADIANCE_DYNAMIC_DRAFT` | Per-request confidence gate varies draft depth; `mtp` only; lossless | `num_speculative_tokens` becomes a **ceiling**, not a fixed cost | on by default |
| `--mamba-cache-mode align` | Snapshots GDN conv+recurrent state at block boundaries so linear-attention layers are prefix-cacheable | CLAIMED ~3.6× TTFT on shared prefixes; raises attention block size to 1664 | arm R6 only |
| MTP | Multi-token prediction; head is **inside** the Qwen3.8 checkpoint, no separate drafter | MEASURED on host venv: 22.68 tok/s vs 17.58 (+29 %) | host arm + R4–R6 |

## Results (MEASURED, pp2048 / tg150, concurrency 1, warmup + 3 runs)

| Config | Engine | Prefill tok/s | Decode tok/s | VRAM@load MiB | Peak VRAM MiB | Peak GTT MiB | Peak W | Status |
|---|---|---|---|---|---|---|---|---|
| TRITON_ATTN, AITER=0 (A2) | host vLLM 0.29.0 | 1123.0 | **17.57** | 27045 | 27228 | 116 | 305 | baseline |
| TRITON_ATTN, AITER=0 (A3) | host vLLM 0.29.0 | 1133.6 | **17.58** | 27045 | 27388 | 132 | 251 | baseline rep |
| TRITON_ATTN, AITER=1 (C1) | host vLLM 0.29.0 | 1138.2 | 17.45 | — | 27625 | 122 | 275 | −1.6 % decode |
| TRITON_ATTN, AITER=1 (C2) | host vLLM 0.29.0 | 1127.5 | 17.14 | — | — | — | — | −1.6 % decode |
| MTP=1, TRITON_ATTN | host vLLM 0.29.0 | 1063.7 | **22.68** | — | — | — | — | best host decode |
| **R1 — default (MISCONFIGURED)** | radiance 0.9.3 | **1381.0** | **9.93** | — | 27313 | 122 | 248 | see §5 — not a valid radiance result |
| R2 — aiter-unified + align | radiance 0.9.3 | — | — | — | — | — | — | QUARANTINED (same misconfig, interrupted) |
| **R3 — R4D, MTP=0** | radiance 0.9.3 | **1384.5** | **17.50** | — | 27695 | 144 | 269 | **+22.7 % prefill, decode parity** |
| **R4 — R4D + MTP8 unpadded + FAST_DRAFT + SKINNY_GEMM=all** | radiance 0.9.3 | **1308.2** | **35.02** | — | 28706 | 136 | 257 | **best measured: +16 % prefill / +99 % decode vs host baseline** |
| R5 — R4 + fp8 KV | radiance 0.9.3 | *pending* | *pending* | | | | | queued |
| R6 — R5 + prefix-cache/align | radiance 0.9.3 | *pending* | *pending* | | | | | queued |
| *(reference)* llama.cpp b10909 Vulkan Q4_K_XL | llama.cpp | 1003.0 | **30.0** | — | 20627 | 298 | — | MEASURED, other report |

Peak GTT stays at the box's idle baseline (~77–132 MiB) in every row — **no host-RAM spill** anywhere.

## What the image actually is

| Component | Version | Note |
|---|---|---|
| vLLM | **0.27.1** | older than our host 0.29.0 — see finding 3 |
| PyTorch / Triton / torchvision | 2.11.0 / 3.6.0 / 0.24.1 | the trio upstream builds vLLM against **on ROCm** |
| AITER | 0.1.17 | built from source **for gfx1201** (upstream gates AITER to MI3xx) |
| transformers | 5.14.1 | pinned; 5.15.0 breaks Gemma-4 `head_dim` |
| ROCm userspace | 7.14 | bundled, pruned to one arch |
| `PYTORCH_ROCM_ARCH` | `gfx1201` | single arch — the reason it is 3.96 GB not 25 GB |

Patches it applies to make vLLM work on gfx1201: GPU enumeration (amdsmi init order — otherwise device count
reads 0), AITER enablement for gfx12x, Triton driver activation for the GPU-less inspection subprocess, native
sampler fallback (AITER top-k/top-p doesn't build on RDNA4), **MTP drafter unpadding**, MTP multimodal mask
alignment, tool-parser consistency, `from_json` Jinja filter, `torch.compile` telemetry JSON encoding, and an
**attention LDS fit** that shrinks the staged K/V tile into the R9700's 64 KiB LDS (without it, 2-byte KV at
head 256 aborts at CUDA-graph capture).

## Findings

1. **The "tuned" 2× in the Puget article is a custom build, not configuration.** (VERIFIED — the article
   names only "vllm-radiance build" with no flags, image tag, or link; the image exists on Docker Hub and its
   source on Codeberg.) *Consequence:* no amount of flag-tuning on stock vLLM was ever going to reproduce it,
   which retires several hypotheses from the host-venv spike.

2. **Puget's tuned config is structurally a two-GPU config and cannot be reproduced on one card.**
   (INFERRED from arithmetic + VERIFIED model size.) A 27B at FP8 is ~27 GB of weights; on one 32 GB card that
   leaves no useful KV budget, which is why they ran TP=2 across 64 GB. *Consequence:* for a single R9700, INT4
   is the right quantization and their headline numbers are not a reachable target.

3. **Correctly configured, radiance gives +22.7 % prefill at decode parity on a W4A16 checkpoint.**
   (MEASURED R3: prefill 1384.5 vs host 1128.3; decode 17.50 vs 17.58.) *This supersedes an earlier reading of
   this report.* From the misconfigured R1 row (−43.5 % decode) it was inferred that vLLM 0.27.1, predating
   0.29.0's `RDNAHybridW4A16` kernels, forced our INT4 weights onto a generic dequant path. **R3 disproves that:**
   same 0.27.1, same INT4 weights, decode is identical to our host build. The R1 decode collapse was entirely the
   misconfiguration of finding 5 (vision tower loaded, cold kernel cache, AITER env unset), not the vLLM version.
   *Consequence:* the older vLLM costs us nothing measurable on this model, and the tuned prefill kernels are a
   free +22.7 % — the first unambiguous win in this whole investigation.

4. **There is no tuned GEMM for our model's weights in this image.** (VERIFIED from source README.)
   `RADIANCE_PRESHUFFLE` is FP8-blockscale only; `radiance_w4.py` / `patch_dflash_w4.py` pack a **dflash
   drafter's** projections to int4, not the target model's. *Consequence:* since weight traffic is ~26 of our
   ~59 ms per token, the ceiling on what radiance can do for single-stream INT4 decode is structurally capped.

5. **The first container run was misconfigured, and the README says so explicitly.** (MEASURED error.)
   R1 omitted the runtime env `VLLM_ROCM_USE_AITER=1` / `VLLM_ROCM_USE_AITER_UNIFIED_ATTENTION=1` (the image
   bakes `RADIANCE_*` on, but **not** these), omitted `--language-model-only` on a vision-language checkpoint
   (loading the vision tower), and mounted no persistent Triton/inductor cache — the README warns the first
   start "spends a few extra minutes compiling … it looks idle but it is compiling". *Consequence:* R1's 9.93
   tok/s is not radiance's decode number and must not be quoted as one. Recorded as `radiance-default/CAVEAT.txt`.

6. **The R4D/GDN kernels do bind to a non-FP8 checkpoint.** (MEASURED, startup log:
   `[radiance.gdn] gdn_chunk_scan ENABLED (head_k 128, head_v 128, chunk 64; replaces wy + delta_h + chunk_o)`.)
   Our model matches R4D attention's required geometry exactly — head_dim 256, 6 query heads per KV head.
   *Consequence:* the prefill-side tuning is genuinely available to us despite the untested-combination warning.

7. **R4D attention is a TTFT feature, not a tokens/s feature — by the author's own measurement.** (CLAIMED:
   "+14.6 % prefill throughput at 64K context, +4.1 % at 16K, and decode unchanged within noise — attention is
   only ~7 % of a speculative decode step".) The gain scales with context because attention's share of prefill
   does. *Consequence:* at our 2048-token shape expect ~nothing from R4D; it would matter at 32K.

8. **The image's decode gains come from the MTP drafter stack, not from kernels.** (CLAIMED:
   `disable_padded_drafter_batch` ~+50 % single-stream; `RADIANCE_FAST_DRAFT` +16.6 %; dynamic draft depth.)
   *Consequence — the most actionable item here:* `disable_padded_drafter_batch` is a **stock vLLM speculative-config
   field**, and the image's contribution is the unpad *patch* it relies on. If that patch is upstream in 0.29.0,
   the largest single-stream lever is portable to our host venv with no container and no version downgrade.
   **OPEN** — not yet checked.

9. **`--enable-prefix-caching` is silently off on GDN hybrids.** (CLAIMED, corroborated by our own launcher
   behaviour.) Hybrid models default their prefix-caching support flag off, so vLLM disables it even though the
   engine default looks enabled; `--mamba-cache-mode align` is what makes the linear-attention layers cacheable,
   verified bit-identical to full recompute. *Consequence:* any agentic/RAG deployment with shared system prompts
   is leaving a large TTFT win unclaimed by default. Measured separately in arm R6 — it changes what prefill
   *means*, so it must not be folded into an engine A/B (this repo has measured 2.4× prefill inflation from a
   warm prefix cache).

10. **MTP is not bound by the non-speculative decode ceiling, and the power trace proves the mechanism.**
    (MEASURED: R4 decode 35.02 tok/s vs R3's 17.50 on the same image and model; decode-phase board power
    **133 W -> 207–210 W sustained**.) The host-venv spike derived a ~27.7 tok/s kernel-busy ceiling for this
    model at batch 1, and ten config hypotheses moved decode by less than ±2 % because none of them addressed
    the ~23 µs of idle between kernel launches. Speculative decoding verifies several tokens per forward pass,
    so that ceiling **does not apply to it** — the card stops waiting and draws near its full power budget.
    *Consequence:* on RDNA4, single-stream decode for this model class is an occupancy problem, not a bandwidth
    or kernel-efficiency problem, and speculation is the only lever measured to fix it. Any "ceiling" quoted for
    this card must state whether it assumes non-speculative decode.

11. **The drafter stack, not the kernels, is what beats llama.cpp.** (MEASURED: host MTP 22.68 -> radiance MTP
    35.02, +54 %, with R4D attention contributing nothing to decode per finding 7.) The image README attributes
    ~+50 % to `disable_padded_drafter_batch`, +16.6 % to `RADIANCE_FAST_DRAFT` and ~+3.5 % to
    `RADIANCE_SKINNY_GEMM=all`; our host MTP arm had none of the three. Mean acceptance length 2.47–3.74
    (MEASURED, R4 server log). *Consequence:* see finding 8 — if the MTP unpad patch is upstream in 0.29.0, most
    of this is portable to the host venv without the container.

12. **The upstream `disable_padded_drafter_batch` flag helps on the host, but only paired with
    `--no-async-scheduling`, and it closes only a fifth of the gap to radiance.** (MEASURED, 2x2 matrix,
    **n=10 per arm**, pp2048/tg150.) The field exists and is honoured in host vLLM 0.29.0
    (`config/speculative.py:434`, `v1/worker/gpu_model_runner.py:4718`,
    `v1/spec_decode/llm_base_proposer.py:324`), so it is testable without the container.

    | Arm | padded | async sched | decode mean | sd | min–max | acceptance |
    |---|---|---|---|---|---|---|
    | M1 | padded | on | 20.42 | 5.52 | 14.7–34.4 | 3.43 |
    | M2 | padded | off | 19.76 | 3.77 | 13.4–25.5 | 2.84 |
    | **M3** | **unpadded** | **off** | **22.60** | 3.01 | 19.9–29.5 | 2.71 |
    | M4 | unpadded | on | 18.11 | 2.56 | 14.6–23.3 | 2.73 |

    **M3 > M4 by +25 % (t≈3.6) is the firm result:** unpadding the drafter batch *requires* disabling async
    scheduling, and pairing it with async scheduling is worse than not unpadding at all. This is why the image's
    recipe mandates `--no-async-scheduling`. **M3 over padded M1 is +10.7 % but t≈1.1 — not resolvable even at
    n=10**, because MTP acceptance is content-dependent per run (sd 2.6–5.5 across arms). Best host config
    (M3, 22.60) still loses to radiance R4 (35.02) by **−36 %**, a gap that is significant (t≈2.75) despite the
    container arm's n=3. *Consequence:* roughly a fifth of radiance's decode advantage is the upstream flag; the
    rest is its own patch stack (`RADIANCE_FAST_DRAFT` 2-bit draft head, `RADIANCE_SKINNY_GEMM=all`, the dynamic
    draft controller). **The container is the only measured route to 35 tok/s on this box.**

    *This supersedes an earlier provisional reading of this report* which, from an n=3 pair, recorded unpadded
    at 19.3 against padded at 24.81 and concluded the flag was harmful. Both figures were inside the noise, and
    that A/B was additionally confounded (its unpadded arm alone carried `--no-async-scheduling`). The 2x2
    matrix above was run specifically to resolve both defects.

13. **MTP costs ~7 % prefill on the host.** (MEASURED: MTP arms 1012.9–1055.0 tok/s vs 1128.3 without MTP.)
    Not seen on radiance, whose MTP arm still prefills at 1308.2. *Consequence:* on stock vLLM, speculation is a
    decode-for-prefill trade; with radiance's kernels it is not.

14. **Raising `num_speculative_tokens` from 3 to 8 is not a reliable host win.** (MEASURED: 20.42 at 8 padded
    vs 22.68 at 3 measured earlier, both within the MTP noise band.) Radiance's README notes the value is a
    *ceiling, not a fixed cost* under its dynamic draft controller; stock vLLM has no such controller, so on the
    host it is a fixed width and deeper drafting is not free. An earlier provisional note in this report claimed
    8 beat 3 on the host — that rested on a single n=3 arm and does not survive n=10.

15. **On REAL workloads radiance is markedly faster than on synthetic tokens — the headline risk resolved the
    opposite way to the one feared.** (MEASURED, `bench/workloads/generated/` corpus fixtures, chat API.)

    | Workload | prompt tok | decode tok/s | prefill tok/s | TTFT |
    |---|---|---|---|---|
    | synthetic 2048 (arm R4) | 2048 | 35.02 | 1308.2 | 1.57 s |
    | synthetic 2048 + prefix-cache/align | 2048 | 38.68 | 1215.9 | 1.69 s |
    | **real agentic code, 8k** | 8161–8163 | **58.57 / 60.84** | 1173–1213 | 6.73–6.96 s |
    | **real code review, 32k (cold)** | 32294 | **33.03** | 735.1 | 43.93 s |
    | **real code review, 32k (warm)** | 32294 | **34.76** | 12771.4 | **2.53 s** |

    Mean acceptance length rose to 2.79–3.21 on real content (MEASURED, server log) against 2.47–3.74 on
    synthetic. *Consequence:* the caveat this report previously attached to the 35.02 figure is discharged —
    real code accepts **better** than synthetic tokens because it is more predictable. At 8k depth on real
    agentic content this box sustains ~59 tok/s single-stream. **An earlier revision of this report compared
    that against llama.cpp b10909's 30.0 tok/s and claimed "roughly 2x"; that comparison was invalid** — the
    llama.cpp figure came from `llama-bench`, which by construction runs **without MTP**, without a server and
    without a prompt cache, while the vLLM column had MTP on. See finding 19 for the corrected, MTP-on-both-sides
    comparison.

16. **MTP survives 32k depth on radiance, unlike stock vLLM.** (MEASURED: 33.03 tok/s at 32294 tokens.)
    The host-venv spike measured MTP collapsing to ~5 tok/s at 32k, traced to
    `triton_unified_attention.py:1041-1050` disabling the 3D split-KV path whenever `max_seqlen_q > 1` — which
    MTP verify always triggers. R4D attention does not share that pathology — but it does **degrade** with depth
    (58.6 tok/s at 8k -> 33.0 at 32k), which llama.cpp's MTP does not (45.8 -> 50.4). The llama.cpp comparison
    that stood here (vs 28.2 tok/s) was against a non-MTP `llama-bench` run and is superseded by finding 19.
    Per iron rule 16, no single depth licenses an engine recommendation.

17. **Prefix caching is worth 17.4x TTFT on this hardware — far more than the documented ~3.6x.**
    (MEASURED: byte-identical 32294-token prompt, same server, no restart: cold TTFT 43.93 s -> warm 2.53 s;
    effective prefill 735.1 -> 12771.4 tok/s.) Requires **both** `--enable-prefix-caching` and
    `--mamba-cache-mode align` on a GDN hybrid (finding 9). *Consequence:* for agentic or RAG workloads that
    re-send a stable prefix, this single pair of flags outweighs every decode optimisation measured in this
    investigation.

18. **With MTP enabled, concurrency REDUCES total decode throughput — c=1 is the optimum.**
    (MEASURED, real agentic 8k fixtures, unique prefixes, `--max-num-seqs 8`.)

    | c | per-stream decode | ~aggregate decode | prefill | TTFT p50 |
    |---|---|---|---|---|
    | 1 | 58.57 / 60.84 | **~59.7** | 1173–1213 | 6.73 s |
    | 2 | 26.97 / 21.41 / 16.96 / 12.81 | **~39** | 492–592 | 16.44 s |

    Two mechanisms, both MEASURED/CLAIMED respectively: speculation already saturates the GPU at c=1 (210 W
    decode-phase board power vs 137 W without MTP, finding 10), so additional streams only divide it; and
    `RADIANCE_DRAFT_SCHEDULE=1:8,2:7,4:6,8:5,16:4` deliberately shortens draft depth as batch grows.
    *Consequence — this supersedes an earlier conclusion in the companion report*, which found aggregate decode
    peaking at c=2 (28.8 tok/s) and inferred that concurrency was where this card's throughput lay. That held
    for **non-speculative** decode only. With MTP, single-stream at ~59 tok/s beats every concurrent
    configuration measured, and TTFT more than doubles at c=2. Speculation and continuous batching are
    competing ways to fill the same idle gaps, not complementary ones.
    (Aggregate figures are sums of per-request rates and are therefore approximate.)

19. **CORRECTION — with MTP enabled on BOTH engines, llama.cpp wins at 32k and radiance wins at 8k.**
    (MEASURED, identical corpus fixtures, chat API, `capture_engine probe`. llama.cpp = the operator's own
    production llama-swap profile `qwen38-27b-q4kxl-ctx220k-kvq8-mtp-sharp-coding`: Vulkan, `--spec-type
    draft-mtp`, KV q8_0, ctx 220k.)

    | Real-workload metric | llama.cpp + MTP | radiance R4D + MTP8 | winner |
    |---|---|---|---|
    | prefill @8k agentic | 926–930 | 1173–1213 | radiance +27 % |
    | **decode @8k agentic** | 45.8 / 48.3 | **58.6 / 60.8** | radiance **+25 %** |
    | TTFT @8k | 9.38 s | **6.73 s** | radiance |
    | prefill @32k codereview | **842.3** | 735.1 | llama.cpp +15 % |
    | **decode @32k codereview** | **50.4** | 33.0 | **llama.cpp +53 %** |
    | TTFT @32k cold | **39.3 s** | 43.9 s | llama.cpp |
    | **TTFT @32k warm cache** | **0.43 s** | 2.53 s | **llama.cpp 5.9x** |
    | peak VRAM | 29408 MiB | ~28700 MiB | tie |
    | peak GTT | **2179 MiB** (spill) | 136 MiB | radiance |

    **Every llama.cpp figure previously quoted in this report (30.0 / 28.2 tok/s, 20627 MiB) came from
    `llama-bench`, which cannot use MTP, a server, or a prompt cache** — the repo's own build-check report says
    so explicitly, and quoting it beside an MTP-enabled vLLM column understated llama.cpp by 50–80 % on decode.
    The 20627 MiB VRAM figure was likewise a small-context `llama-bench` run; the production profile holds
    **29408 MiB** for a 220k window. *Consequence:* the headline "vLLM beats llama.cpp on this card" holds only
    at ~8k depth. At 32k — the depth that matters for an agentic coding workload — **llama.cpp + MTP is the
    faster engine by a wide margin, on the operator's existing setup, with no third-party container.**

    **SUPERSEDED IN PART by finding 22.** The 32k half stands and is reconfirmed by finding 21. The 8k half
    is fixture-specific: radiance's 8k win holds on `agentic-8000` but reverses on `codereview-8000`, so the
    boundary is the workload, not the depth.

20. **Radiance's MTP degrades with depth; llama.cpp's does not.** (MEASURED: radiance 58.6 @8k -> 33.0 @32k,
    −44 %; llama.cpp 45.8 @8k -> 50.4 @32k, +10 %.) *Consequence:* radiance's advantage is confined to shallow
    requests, and an engine choice taken at 8k inverts by 32k — a textbook instance of iron rule 16.
    **Confound to close:** the 8k and 32k fixtures are different content (agentic vs codereview), so the
    depth trend carries a content component. The engine-vs-engine comparison at each depth is sound (identical
    fixture both sides); the depth *slope* is not yet clean and needs the same fixture at >=4 depths with a
    log-log fit before the exponent is quotable.

    **WITHDRAWN — see finding 21.** The confound this note flagged was measured and it was the whole effect:
    on one fixture family radiance's decode is flat in depth (exponent +0.070, R² 0.25). Do not cite this
    finding.

21. **CORRECTION — the depth confound is now closed, and it WITHDRAWS finding 20.** (MEASURED, run
    `bench/runs/2026-09-12-1330-depth-curve-mtp/`, `t3.log` + `t3-armA.log`.) Same fixture family
    (`codereview-N`) at four depths, MTP on both engines, `--prefix-mode unique`, `--api chat`,
    `max_tokens 256`, n=3/point, temperature 0.2, one boot per engine. llama.cpp = the operator's
    current profile `qwen38-27b-q4kxl-q8-mtp-ctx200000-kvq8-mtp-sharp-coding` (the `ctx220k` id used in
    findings 19–20 no longer exists — `config.yaml` was regenerated 2026-09-12 12:48).

    | depth (prompt tok, lcpp/rad) | llama.cpp prefill | radiance prefill | Δ | llama.cpp decode | radiance decode | Δ |
    |---|---|---|---|---|---|---|
    | 8 295 / 8 183 | 905.6 | **1168.6** | +29.0 % | **56.47** | 37.81 | −33.0 % |
    | 12 211 / 12 096 | **889.3** | 813.7 | −8.5 % | **54.58** | 40.32 | −26.1 % |
    | 20 235 / 20 122 | **864.2** | 812.0 | −6.0 % | **49.16** | 36.11 | −26.5 % |
    | 32 428 / 32 317 | **819.4** | 736.8 | −10.1 % | **48.29** | 43.79 | −9.3 % |

    | depth | llama.cpp TTFT p50 | radiance TTFT p50 | llama.cpp peak VRAM / GTT | radiance peak VRAM / GTT |
    |---|---|---|---|---|
    | 8 000 | 9.57 s | **7.00 s** | 27 280 / **1 879** | 26 362 / 60 |
    | 12 000 | **14.30 s** | 14.87 s | 27 295 / **1 886** | 28 008 / 60 |
    | 20 000 | **24.28 s** | 24.78 s | 27 327 / **1 902** | 28 994 / 62 |
    | 32 000 | **41.00 s** | 43.86 s | 27 374 / **1 926** | 28 994 / 62 |

    Log-log fits (iron rule 16), fit range 8 183–32 428 tokens:

    | Engine | prefill exponent | R² | decode exponent | R² |
    |---|---|---|---|---|
    | llama.cpp Vulkan + MTP | −0.072 | 0.96 | −0.125 | 0.94 |
    | vllm-radiance R4D + MTP8 | −0.290 | 0.73 | **+0.070** | **0.25** |

    **Radiance decode does not decay with depth at all.** The exponent is positive and R² 0.25 means
    there is no trend to fit — 37.8 / 40.3 / 36.1 / 43.8 is scatter, not a curve. Finding 20's claim
    that "radiance's MTP degrades with depth while llama.cpp's does not" is **WITHDRAWN**: it compared
    an `agentic-8000` fixture against a `codereview-32000` one, so it measured content, not depth.
    Radiance's prefill exponent is also not quotable (R² 0.73; the 12k/20k pair 813.7 / 812.0 is flat).
    Only llama.cpp fits a power law cleanly here, and it is a *shallow* one — prefill −0.072 means
    llama.cpp's prompt processing is nearly depth-independent over this range.
    *Consequence:* on the codereview family llama.cpp + MTP wins decode at **every** depth by 9–33 %
    and wins prefill from 12k up; radiance's only clean win is prefill/TTFT at 8k. Note llama.cpp
    achieves this while spilling ~1.9 GB into GTT at every depth (its 200k window), which radiance
    never does — so llama.cpp wins from a structurally worse memory position.

22. **The engine ranking is workload-dependent, and that dominates the depth effect.** (MEASURED
    both rows; mechanism INFERRED.) At the *same* ~8k depth the two fixture families disagree:

    | Fixture @8k | llama.cpp + MTP decode | radiance R4D+MTP8 decode | winner |
    |---|---|---|---|
    | `agentic-8000` (finding 15/19, earlier run) | 45.77 / 48.33 | **58.57 / 60.84** | radiance +26 % |
    | `codereview-8000` (finding 21, this run) | **56.47** | 37.81 | llama.cpp +49 % |

    MTP throughput is set by draft acceptance, and acceptance is a property of the *output* text.
    `agentic-implement` produces generated code (predictable — boilerplate, repeated identifiers);
    `codereview-large` produces review prose (far less predictable). Radiance's 2-bit
    `RADIANCE_FAST_DRAFT` head at `RADIANCE_DRAFT_TAU=0.28` evidently drafts code well and prose badly;
    llama.cpp's MTP head is steadier across both. This is the trap the benchmark-results skill already
    records (its rule 17): hipfire's DFlash showed τ 13 synthetic vs τ 1.7–2.2 on real prose.
    **Caveat:** the two rows come from different runs with different probe settings, so only the
    `codereview` row is internally controlled; the cross-family comparison is suggestive, not decisive.
    **OPEN:** one run measuring both families back to back on a single boot, reporting draft acceptance
    per row, would settle it — that test should precede any engine decision.
    *Consequence:* do not pick an engine from one workload. Code *generation* favours radiance, code
    *review/analysis* favours llama.cpp, and a real agent does both.

23. **A divergent tail costs essentially nothing versus a byte-identical prompt — the warm-cache
    measurement was not distorted.** (MEASURED, `t1.log`.) One shared ~32k `codereview` body, four
    *different* trailing questions (~25 tokens each), `--prefix-mode tail`, 8 sequential requests so
    the tails cycle: #1 cold, #2–4 partial hits (new tail), #5–8 byte-identical repeats of #1–4.

    | # | regime | llama.cpp TTFT | radiance TTFT | llama.cpp decode | radiance decode |
    |---|---|---|---|---|---|
    | 1 | COLD | 38.167 | 44.312 | 48.96 | 47.78 |
    | 2 | partial | 3.335 | 2.760 | 46.55 | 44.32 |
    | 3 | partial | 3.364 | 2.406 | 51.19 | 33.20 |
    | 4 | partial | 3.323 | 2.413 | 55.07 | 35.16 |
    | 5 | full-hit | 3.369 | 2.414 | 48.90 | 48.26 |
    | 6 | full-hit | 3.334 | 2.426 | 46.33 | 36.85 |
    | 7 | full-hit | 3.376 | 2.434 | 52.82 | 42.30 |
    | 8 | full-hit | 3.348 | 2.437 | 57.24 | 34.52 |

    **Partial ≈ full on both engines** (llama.cpp 3.341 vs 3.357 s mean; radiance 2.526 vs 2.428 s, and
    radiance's partial mean is lifted only by request #2, the first after the cold one). Changing the
    final ~25 tokens does not measurably reduce the payoff, because the divergence falls inside the last
    cache block and everything before it still hits. The a-priori concern that a 100 %-identical prompt
    inflates the warm figure is reasonable but **does not hold here** — the honest "only similar"
    workload lands on the same number, so finding 17 stands.
    Cold→warm TTFT: **llama.cpp 11.4×** (38.167 → 3.341), **radiance 18.4×** (44.312 → 2.410).
    Radiance owns the warm case (2.41 vs 3.34 s, −28 %); llama.cpp owns the cold case (38.2 vs 44.3 s, −14 %).
    Memory: llama.cpp peak 27 373 MiB VRAM / **1 925 MiB GTT**; radiance **30 148 MiB** VRAM / 60 MiB GTT.
    Radiance's peak is 1 154 MiB above its finding-21 peak — that is the prefix-cache block pool, and at
    30 148 of 32 624 MiB it is the tightest measurement in this document.
    *Consequence:* warm-up for a cache benchmark only needs the model loaded and lightly exercised; the
    measured prompts must never appear in warm-up, but they do not need to be made artificially unique.

24. **The two engines' reported prefill rate is NOT comparable on a cache hit — compare TTFT.**
    (MEASURED, finding 23.) Radiance reports 13 258–13 429 tok/s on warm requests, llama.cpp 618–627.
    Neither is a kernel throughput. vLLM divides the **full** prompt length by the prefill window, so
    cached tokens count as processed — an *effective* rate. llama.cpp counts only tokens it actually
    re-processed; 625 tok/s over 3.34 s is ≈2 090 tokens, consistent with re-processing the final
    `-ub 2048` chunk rather than the whole prompt. *Consequence:* on any run with prefix caching live,
    compare **TTFT**, never `prefill_tok_s`; the prefill column is comparable only cold. Finding 17's
    17.4× was a TTFT ratio and is therefore unaffected.

25. **Tool change (iron rule 6): `capture_engine.py` gained a `tail` prefix mode.** The finding-23 probe
    could not be expressed by the existing tool — `--prefix-mode unique` prepends its marker at the
    **front**, moving token 0 and defeating prefix caching entirely, while `shared` resends the prompt
    byte-for-byte. Neither models an agent that re-reads one repo and asks a new question. Rather than
    hand-roll a script, `bench/lib/capture_engine.py` gained `--prefix-mode tail` plus a repeatable
    `--tail` (a literal `{}` is replaced by a random hex id); it always builds on `prompts[0]` so every
    request shares one prefix. +22 lines, purely additive — the `none`/`unique`/`shared` paths are
    untouched.

### Caveat on the R4 decode figure

Per-run decode was **43.8 / 31.9 / 29.4** tok/s (n=3) — MTP acceptance is content-dependent, so the spread is
expected and the mean should not be quoted to four significant figures. **The real-workload confirmation this
caveat originally demanded has now been run: see finding 15.** It resolved favourably (real code decodes at
33–59 tok/s depending on depth), so 35.02 is a conservative synthetic-token figure rather than an optimistic
one. Decode figures under MTP still require n>=10 and a reported sd to be comparable (finding 12).

## Recommended config (single R9700, INT4, from the image README adapted to one GPU)

```bash
docker run -d --name radiance --rm \
  --device /dev/kfd --device /dev/dri \
  --group-add "$(getent group render | cut -d: -f3)" \
  --group-add "$(getent group video  | cut -d: -f3)" \
  --shm-size 4g --cap-add SYS_PTRACE --security-opt seccomp=unconfined \
  -p 127.0.0.1:8000:8000 \
  -v /home/dev/models/vllm/Qwen3.8-27B-INT4:/model:ro \
  -v /home/dev/work/dp-craft/amd/bench/dl/radiance-cache:/cache \
  -e VLLM_ROCM_USE_AITER=1 -e VLLM_ROCM_USE_AITER_UNIFIED_ATTENTION=1 \
  -e VLLM_ROCM_USE_AITER_MHA=0 -e VLLM_ROCM_USE_AITER_MLA=0 -e VLLM_ROCM_USE_AITER_MOE=0 \
  -e VLLM_ROCM_USE_AITER_LINEAR=0 -e VLLM_ROCM_USE_AITER_FP8BMM=0 \
  -e VLLM_ROCM_USE_AITER_FP4BMM=0 -e VLLM_ROCM_USE_AITER_RMSNORM=0 \
  -e VLLM_CACHE_ROOT=/cache/vllm -e TORCHINDUCTOR_CACHE_DIR=/cache/inductor \
  -e TRITON_CACHE_DIR=/cache/triton -e AITER_ROOT_DIR=/cache/aiter \
  -e TRITON_CACHE_AUTOTUNING=1 \
  -e RADIANCE_FAST_DRAFT=1 -e RADIANCE_DRAFT_TAU=0.28 -e RADIANCE_SKINNY_GEMM=all \
  stilldeadcode/vllm-radiance:0.9.3 \
    /model --served-model-name qwen38-27b-int4 --host 0.0.0.0 --port 8000 \
    --language-model-only --max-model-len 36864 --max-num-batched-tokens 16384 \
    --max-num-seqs 4 --gpu-memory-utilization 0.90 \
    --attention-backend R4D --kv-cache-dtype fp8 \
    --enable-prefix-caching --mamba-cache-mode align \
    --speculative-config '{"method":"mtp","num_speculative_tokens":8,"attention_backend":"R4D","disable_padded_drafter_batch":true}' \
    --no-async-scheduling
```

Single-GPU deltas from the published recipe: drop `--tensor-parallel-size 2` and `HIP_VISIBLE_DEVICES=0,1`
(`RADIANCE_USE_R4D_AR` / `_AR_QUANT` then become inert), drop `--quantization fp8` (auto-detected
compressed-tensors W4A16), and omit `--numa-bind` (single-node host).

## Methodology & caveats

- Shape `pp2048 / tg150`, llama-benchy 0.4.0, `--exact-tg --no-cache`, warmup + 3 runs; plus one 100 ms-sampled
  power trace of a single request. Identical shape and fixture on host and container, so the columns compare.
- `--no-enable-prefix-caching` is held on R3–R5 to keep prefill comparable to the host baseline; R6 is the only
  arm with caching on and is reported separately (skill rule 2).
- Container runs deliberately omit `HSA_OVERRIDE_GFX_VERSION` — the image is compiled natively for gfx1201 and
  does not need the override our host torch requires.
- Run non-privileged: device nodes + numeric GIDs only, read-only model mount. (`--group-add render` **fails**
  inside this image — no `render` entry in its `/etc/group`; pass the host's numeric GID.)
- Host-side reproducibility across boots is ±0.1 % (A2 17.57 / A3 17.58), so deltas above ~1 % are real. An
  earlier suspicion of ROCm#6347 bimodality on this stack is **not** supported by these repeats.
- Disk: the image is 13.7 GB extracted and took the host from 31 GB to 18 GB free (95 % used). Prune after use.
- Any comparison against the Puget rows below mixes a **2-GPU FP8** system with our **1-GPU INT4** one, and
  their throughput figures are aggregate across streams. They are not row-comparable to ours.

## External comparison (CLAIMED — Puget Systems, 2× R9700, Qwen3.6-27B-FP8, TP=2, 500 in / 200 out)

| Config | c=1 | c=4 | c=8 |
|---|---|---|---|
| Stock vLLM FP8 | 15.88 | 69.34 | 156.21 |
| **Tuned (vllm-radiance)** | **32.00** | 110.56 | 198.78 |
| Tuned + MTP | 62.75 | 186.29 | 320.23 |
| llama.cpp Q4_K_M | 23.40 | 55.70 | 56.00 |

Source: <https://www.pugetsystems.com/labs/articles/amd-radeon-ai-pro-r9700-dual-gpu-ai-inference-performance/>.
Note their **stock** vLLM at 15.88 tok/s on *two* cards against our 17.58 on *one* — our host baseline is not
misconfigured, it is simply what stock vLLM does on this architecture.

## Sources

- Image: <https://hub.docker.com/r/stilldeadcode/vllm-radiance> (README read verbatim via the Hub API)
- Source: <https://codeberg.org/StillDeadcode/vllm-radiance> · kernels: <https://codeberg.org/StillDeadcode/libr4d>
- Puget Systems article (above)
