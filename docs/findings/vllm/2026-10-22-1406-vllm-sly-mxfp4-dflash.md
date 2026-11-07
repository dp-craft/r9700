<!-- meta
date: 2026-10-22 14:50
slug: vllm-sly-mxfp4-dflash
title: Sly radiance 1.6.0 (vLLM docker) · Qwen3.8-27B AMD MXFP4 · fp8 KV · DFlash2 k=7 — depth curve + growing conversation
takeaway: Adding the **DFlash2 k=7 drafter** (`syvai/Qwen3.8-27B-DFlash2-W4A16`) to Sly radiance 1.6.0 + AMD MXFP4 + fp8 KV on one R9700 (one variable vs the no-speculation baseline, MEASURED): **cold decode 33.8 → 136.6 tok/s at 8k (4.0×) and 17.9 → 100.5 at 136k (5.6×)**; in the growing 9-turn conversation decode rises to **~145–203 tok/s at 70–131k** (acceptance 66.9 %, τ 5.68 vs 30.6–52.9 %, τ 3.1–4.7 cold); **prefill unchanged** (±3 %); conversation wall to 131k **184.8 → 108.3 s** and is now 86 % prefill. Decode is no longer depth-bound (verify-step rate k −0.06 vs AR −0.23) but acceptance-bound. Cost: KV pool **433,957 → 345,297 tok** (−20 %, still 2.3 × 150k), prefix-cache granularity 64 → 880 tok, VRAM +400 MiB, GTT at baseline. 0 faults in 29 requests (the baseline's faulting 131k turn passed twice). Beats the repo's older llama.cpp+MTP numbers on both prefill and decode (not like-for-like). OPEN: DFlash vs the image's always-on n-gram lookup draft are not separated; reply text not captured, so Sly #164 repetition cannot be ruled out.
campaign: campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash
-->

# Benchmark: Sly radiance vLLM · Qwen3.8-27B MXFP4 · fp8 KV · DFlash2 k=7 — R9700 (gfx1201)

- **Date:** 2026-10-22 14:13–14:26 local (first launch 14:06 aborted by a session teardown, see Methodology) · **Track:** engine-bench campaign (`gen_campaign.py`, `engine: vllm`)
- **GPU/Host:** AMD Radeon AI PRO R9700, 32624 MiB, power cap **210 W** (`POWER_SAVING`, −100 mV, −21 MHz — user tuning, unchanged) · Ryzen 5 3600, 31 GB RAM · kernel 7.0.0-38
- **Runtime:** `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` @ `sha256:bf153fa38868…7506` (reports vLLM 0.31.0) · `stack/serve/vllm/serve_vllm.sh`, profile `sly-radiance/qwen38-mxfp4-dflash`
- **Model:** `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` @ `5233554c` · drafter **`syvai/Qwen3.8-27B-DFlash2-W4A16` @ `4d30ec73`**, `num_speculative_tokens 7`, `draft_sample_method greedy`, drafter attention `TRITON_ATTN`, cudagraph sizes `[8]` · KV **fp8** · ctx **150000** · max-num-seqs 1 · gpu-mem-util 0.90
- **Baseline (the one variable removed):** `campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/` — same image, model, KV, ctx, fixtures, sampler
- **Data:** `campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash/` (consolidated `results.jsonl`, per-probe dirs `bench/runs/2026-10-22-14{17,18,19,22}-engine-dx-*`) · server log of the aborted boot: `aborted-boot-1.server.log`

## Summary

The drafter does what the baseline was missing: **single-stream decode goes from 33.8 to 136.6 tok/s at 8k and from 17.9 to 100.5 tok/s at 136k** (MEASURED, 4.0× and 5.6×). In the growing agentic conversation, decode climbs to 145–203 tok/s on the deep turns because the drafts are accepted more often there (66.9 % vs 31–53 % cold). Prefill is untouched (within ±3 %), so a 9-turn conversation to 131k now takes 108 s instead of 185 s, and **86 % of that is prefill**. Decode no longer decays with depth, but it swings with acceptance (87–137 tok/s cold, 89–203 in the conversation). The price is 20 % of the KV pool (still 2.3 full 150k contexts) and a coarser prefix-cache block. The caveats: this image runs an **n-gram lookup draft alongside DFlash2**, and the counters do not split the two. Reply text was not captured, so repetition (Sly #164) is not ruled out.

## Legend

| Term | What it is | Effect on this box (this run) | How it's tested here |
|------|------------|-------------------------------|----------------------|
| DFlash2 | block-diffusion drafter: a small model proposes 7 tokens per step, conditioned on the target's hidden states; the target verifies all 7 + 1 in one forward | decode 3–6× faster cold, up to ~10× on deep conversation turns (MEASURED) | on (this campaign) vs off (baseline), all else fixed |
| lookup draft | Sly's n-gram matcher: proposes a continuation copied from context > 2048 tokens back (`[radiance] lookup draft: active (enter 8 stay 3 hot 3, sources > 2048 tokens back, greedy draft, steps 7)`, server log) | likely helps copy-heavy replies; **not separable** from DFlash2 in the counters (OPEN) | image default, left on |
| k | `num_speculative_tokens` = drafted tokens per step | 7 in every step (draft tokens = 7 × drafts exactly, MEASURED); the image's `RADIANCE_DYNAMIC_DRAFT` controller is for MTP only | fixed (Sly README recipe) |
| acceptance | accepted ÷ drafted tokens (vLLM spec-decode counters, diffed per probe, warm-ups included) | 30.6–52.9 % cold, 66.9 % conversation (MEASURED) | `stack/gpu/spec_metrics.py` |
| τ (mean accept len) | tokens emitted per verify step = 1 + accepted/drafts | 3.14–4.71 cold, 5.68 conversation (MEASURED) | same |
| verify-step rate | decode tok/s ÷ τ ≈ target forwards per second (INFERRED, approximate: τ is per probe incl. warm-up, decode per request) | 29.0 → 24.3 steps/s from 8k to 136k (k −0.06) vs AR 33.8 → 17.9 (k −0.23) | derived |
| KV `fp8` | 8-bit E4M3 KV cache | pool **345,297 tokens** in 12.5 GiB (2.30 × 150k), vs 433,957 in 13.74 GiB without the drafter | fixed — user decision |
| depth / `crN` | code-review fixture padded to N tokens, unique prefix, chat API, 256-token answer, `reasoning_effort` medium | decode now acceptance-bound, not depth-bound | 4 cold depths × 2 reps, 1 warm-up on 8k/20k/40k |
| conversation | turn 0 = 10k tokens, each turn adds the reply + 15k new tokens, prior turns cached; `reasoning_effort: low` | per-turn cost ≈ prefill of the new tokens; decode is now a small slice of the turn | `capture_engine.py conversation`, 2 reps to ~131k |
| phase power / mclk | GPU power and memory clock over each request's prefill and decode windows | at the 210 W cap; decode mclk 1,258 MHz in 96–100 % of samples (MEASURED) | `phase_power.py` + `gpu_samples.csv` |

## Results — cold depth curve (all MEASURED, per request; 256 generated tokens)

| Config | depth (prompt tok) | rep | TTFT s | Prefill tok/s | Decode tok/s | Baseline decode | Speed-up | think tok | VRAM@load MiB | Peak VRAM MiB | Peak GTT MiB | Prefill W | Decode W |
|--------|-------------------:|----:|-------:|--------------:|-------------:|----------------:|---------:|----------:|--------------:|--------------:|-------------:|----------:|---------:|
| mxfp4 fp8kv ctx150k + DFlash2 k=7 | 8,139 | 0 | 3.25 | 2,502 ◦ | 137.6 | 33.8 | 4.0× | 125 | 29,900 | 30,442 | 89 | 225 | 209 |
| | 8,141 | 1 | 2.92 | 2,788 | 135.7 | 33.8 | | 124 | | | | 206 | 226 |
| | 20,082 | 0 | 7.61 | 2,639 | 88.3 | 31.0 | 2.8× | 134 | 30,442 | 30,442 | 90 | 217 | 204 |
| | 20,081 | 1 | 7.60 | 2,641 | 85.1 | 30.9 | | 141 | | | | 203 | 213 |
| | 39,981 | 0 | 16.96 | 2,357 | 90.1 | 27.5 | 3.7× | 160 | 30,442 | 30,442 | 99 | 224 | 204 |
| | 39,982 | 1 | 16.98 | 2,355 | 113.4 | 27.4 | | 157 | | | | 204 | 201 |
| | 135,691 | 0 | 90.83 | 1,494 | 108.8 | 17.9 | 5.6× | 154 | 30,442 | 30,442 | 98 | 215 | 203 |
| | 135,692 | 1 | 90.20 | 1,504 | 92.2 | 17.9 | | 151 | | | | 218 | 214 |

Speed-up = mean of the two reps ÷ baseline mean. ◦ = first measured request at 8k, −10 % vs rep 1. The warm-up absorbed the only inference-time JIT (`_prepare_dflash_inputs_kernel`, `_triton_w4a16_skinny_fmt_kernel` at 12:18:01 UTC, before rep 0 began at 12:18:04), so the cause is not established. Peak GTT 89–99 MiB = 12–22 MiB above the 77 MiB baseline: **no host-RAM spill**.

**Speculation per probe** (MEASURED, counters include the warm-up request):

| Probe | drafts | drafted | accepted | acceptance | τ | accepted per draft position 1…7 | decode tok/s (mean) | verify steps/s (INFERRED) |
|-------|-------:|--------:|---------:|-----------:|--:|--------------------------------|--------------------:|--------------------------:|
| dx-cr8000 | 112 | 784 | 415 | 52.9 % | 4.71 | 105, 92, 74, 56, 36, 30, 22 | 136.6 | 29.0 |
| dx-cr20000 | 169 | 1,183 | 362 | 30.6 % | 3.14 | 125, 85, 58, 38, 28, 19, 9 | 86.7 | 27.6 |
| dx-cr40000 | 143 | 1,001 | 389 | 38.9 % | 3.72 | 117, 83, 62, 48, 38, 23, 18 | 101.8 | 27.4 |
| dx-cr140000 | 124 | 868 | 390 | 44.9 % | 4.14 | 103, 90, 66, 47, 38, 28, 18 | 100.5 | 24.3 |
| dx-conv | 789 | 5,523 | 3,696 | 66.9 % | 5.68 | 719, 637, 557, 497, 455, 426, 405 | 108–203 | — |

**Depth fits** (log-log `y = a·depth^k`, MEASURED points, valid only inside the fit range; baseline exponents beside them):

| Shape | Metric | k (DFlash) | R² | n | k (baseline) | Fit range |
|-------|--------|-----------:|---:|--:|-------------:|-----------|
| cold | prefill p50 | −0.191 | 0.753 | 4 | −0.206 | 8k–136k |
| cold | decode p50 | −0.115 | **0.408** | 4 | −0.227 | 8k–136k |
| cold | verify-step rate (INFERRED) | −0.062 | 0.930 | 4 | (AR −0.227) | 8k–136k |
| conversation | prefill of new tokens | −0.405 | 0.930 | 18 | −0.360 | 10k–131k |
| conversation | decode | **+0.231** | **0.530** | 18 | −0.229 | 10k–131k |

The decode fits are poor because decode no longer follows depth. It follows acceptance (finding 2). The tool's cold "p50" over 2 reps is the minimum per metric, so read the per-request table.

**Decode vs depth** — ![Decode vs depth](../../../campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash/results/charts/depth_decode.svg)

> DFlash series only (report.py cannot overlay two campaigns yet — see Proposals). The baseline was 33.8 / 31.0 / 27.5 / 17.9 tok/s at the same depths. The curve is not monotone: the 20k fixture accepts worst (30.6 %), and 8k accepts best (52.9 %). MEASURED.

**Prefill vs depth** — ![Prefill vs depth](../../../campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash/results/charts/depth_prefill.svg)

> Within ±3 % of the baseline's clean reps at every depth (2,788 vs 2,870 · 2,641 vs 2,574 · 2,357 vs 2,291 · 1,504 vs 1,504). The drafter does not tax prefill. MEASURED.

## Results — growing conversation (all MEASURED)

| Turn | Context tok | Cached | New | Prefill new tok/s (rep 0 / 1) | Decode tok/s (rep 0 / 1) | Baseline decode (rep 0) | TTFT s (rep 0 / 1) | Baseline TTFT (rep 0) |
|-----:|------------:|-------:|----:|------------------------------:|-------------------------:|------------------------:|-------------------:|----------------------:|
| 0 | 10,408 | 0 | 10,408 | 2,817 / 2,742 | 108.3 / 108.1 | 32.9 | 3.70 / 3.80 | 4.74 |
| 1 | 26,366 | 8,800 | 17,566 | 2,386 / 2,387 | 126.8 / 126.7 | 29.5 | 7.36 / 7.36 | 7.14 |
| 2 | 41,426 | 24,640 | 16,786 | 2,041 / 2,034 | 115.4 / 89.5 | 27.2 | 8.23 / 8.25 | 7.93 |
| 3 | 55,837 | 40,480 | 15,357 | 1,803 / 1,801 | 147.8 / 202.7 | 25.2 | 8.52 / 8.53 | 9.13 |
| 4 | 71,402 | 54,560 | 16,842 | 1,537 / 1,517 | 193.3 / 191.4 | 23.3 | 10.96 / 11.11 | 10.46 |
| 5 | 87,198 | 70,400 | 16,798 | 1,279 / 1,272 | 187.2 / 186.9 | 21.7 | 13.14 / 13.21 | 13.26 |
| 6 | 101,881 | 86,240 | 15,641 | 1,168 / 1,172 | 191.4 / 145.2 | 20.3 | 13.39 / 13.35 | 12.66 |
| 7 | 116,221 | 100,320 | 15,901 | 1,136 / 1,138 | 186.5 / 174.3 | 19.3 | 14.00 / 13.98 | 12.54 |
| 8 | 131,017 | 115,280 | 15,737 | 1,099 / 1,108 | 178.9 / 155.1 | 18.3 | 14.32 / 14.22 | 15.06 |

Both reps completed all 9 turns (the baseline's rep 1 died at turn 8). Each rep's wall time was **108.3 s and 109.5 s, against the baseline's 184.8 s** (rep 0). Of that, TTFT took 93.6 / 93.8 s (baseline 92.9) and decode 14.7 / 15.7 s (baseline 91.9). 5 of 18 replies ended with `stop` inside 256 tokens; the rest hit `length`. VRAM 30,425–30,442 MiB, GTT ≤ 98 MiB.

**Conversation: decode per turn** — ![Conversation decode](../../../campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash/results/charts/conv_decode.svg)

> Decode *rises* with depth here (baseline: falls 32.9 → 18.3). Per-turn acceptance is not recorded, so the per-probe 66.9 % is the only acceptance figure. That this rise is driven by acceptance is INFERRED from finding 2. Rep-to-rep spread on the same turn reaches 45 % (turn 3: 148 vs 203), so single-turn decode figures are noisy. MEASURED.

**Conversation: TTFT per turn** — ![Conversation TTFT](../../../campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash/results/charts/conv_ttft.svg)

> Same as the baseline within ~1 s per turn: prefill now dominates the agent-facing cost. MEASURED.

**Power by phase** — ![Power by phase](../../../campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash/results/charts/power_phase.svg)

> Prefill 205–216 W, decode 203–220 W per probe. Nothing was flagged (threshold 150 W). Decode mclk was 1,258 MHz in 100 % of cold-decode samples and 96 % in the conversation (median 1,258, min 1,124). Prefill mclk median was 456–1,124 MHz at sclk 2.1–2.5 GHz, i.e. power-limited as in the baseline. MEASURED.

## FAILED / interrupted rows

| What | Where | Evidence (MEASURED) | Handling |
|------|-------|---------------------|----------|
| Boot aborted (not an engine failure) | first launch 14:06, during `JIT kernel warmup` | the previous agent session's teardown killed `run.sh`; its EXIT trap ran `serve_vllm.sh stop` at 14:13. Server log has no error, no watchdog file, no `failures.txt` | log kept as `aborted-boot-1.server.log`; relaunched detached (`setsid nohup`), resumed from `done/` markers (none existed, so a clean full run) |

**Faults: 0 `MEMORY_FAULT` in 29 requests** (3 warm-ups + 8 cold + 18 turns) on 1 serving boot. The shape that faulted in the baseline (conversation turn 8, ~15k new tokens on ~115k cached) passed in both reps. Combined MXFP4 tally across both campaigns plus the smoke boot: **1 fault in 57 requests, 1 of 3 serving boots**. The fault remains intermittent and unexplained (OPEN, baseline finding 5).

## What moved the needle (DFlash on vs off)

| Change | Prefill Δ | Decode Δ (cold) | Decode Δ (conversation) | Conversation wall | KV pool | VRAM / GTT |
|--------|----------:|----------------:|------------------------:|------------------:|--------:|-----------:|
| + DFlash2 k=7 (+ lookup draft, image default) | ±3 % (tie) | **+180 % to +460 %** (2.8–5.6×) | +230 % at turn 0 → +880 % at turn 8 | **−41 %** (184.8 → 108.3 s) | **−20 %** (433,957 → 345,297 tok) | +245 MiB at load / +401 MiB peak; GTT +12–22 MiB |

## Consequences & root causes

1. **Decode is no longer this engine's weak side.** 136.6 tok/s at 8k and 100.5 at 136k cold, and 145–203 tok/s on conversation turns past 55k (MEASURED). Against the repo's earlier llama.cpp + MTP (67.4 @ 8k / 35.4 @ 98k; `campaigns/perf/2026-09-12-1844-vllm-window-budgets/results/2026-09-12-1943-vllm-bigwindow-depthcurve`, MEASURED there), that is ~2× at 8k and ~3× at ~100k, *on top of* 3.1× / 2.4× faster prefill. Not like-for-like: older llama.cpp build b10909, a GGUF Q4 quant, an unknown power profile then, so this is a direction, not a ranking.
   **→ On this workload shape (code review with thinking, single stream), vLLM + MXFP4 + DFlash2 is the fastest serving config this repo has measured, in both phases.**

2. **Decode is now acceptance-bound, not depth-bound.** The baseline's AR decode fell with depth at k −0.23. With DFlash, the implied verify-step rate barely moves: 29.0 → 24.3 steps/s from 8k to 136k, k −0.06, R² 0.93 (INFERRED from MEASURED decode ÷ τ). Decode tok/s is therefore set by τ. The 20k fixture accepts worst (τ 3.14 → 86.7 tok/s), and the 8k fixture best among the cold probes (τ 4.71 → 136.6). A notable side result: at 136k, one verify step (8 query tokens + a drafter pass) runs at 24.3/s, while one AR step in the baseline ran at only 17.9/s. INFERRED explanation: the baseline's depth decay was mostly the q_len=1 decode-attention path losing efficiency (baseline finding 2 measured it at ~54 % of the KV-read roofline at 131k). Sly installs a separate verify-batch decode-attention tune (`[radiance] decode attn tune installed (verify-batch config …)`, server log), which that path avoids.
   **→ Quote DFlash decode with τ and the task beside it (skill rule 17). This box's 87–203 tok/s range is set by output predictability, not by context length. The baseline's AR depth decay looks like a kernel issue worth reporting upstream (OPEN).**

3. **Why the conversation accepts better (66.9 % vs 31–53 %) — OPEN, two candidates.** (a) The image's **n-gram lookup draft** is active and copies continuations from context > 2048 tokens back. Code-review replies that quote the code under review, plus a review format that repeats turn after turn in the visible history, are exactly what it matches (INFERRED). (b) `reasoning_effort: low` in the conversation yields fewer and more formulaic thinking tokens (93–155 vs 124–160 cold, MEASURED), and those are easier to draft (INFERRED). The counters cannot tell DFlash2 hits from lookup hits, and acceptance is recorded per probe, not per turn.
   **→ The 145–203 tok/s conversation figures are workload-specific. Don't quote them for prose or fresh code generation. A lookup-off A/B (`RADIANCE_*` lookup knob, to be identified in the source) would attribute the gain.**

4. **Repetition (Sly #164) is not ruled out.** #164 reports Cactus acceptance locking into repetition on long outputs. Here the outputs are 256 tokens, 5 of 18 conversation replies end naturally with `stop`, and the conversation stays coherent enough to keep growing. But `capture_engine` does not persist reply text, so high acceptance from copying cannot be distinguished from high acceptance from looping (OPEN). The 256-token cap also keeps outputs far shorter than the long-output case #164 describes (INFERRED).
   **→ Before using this config for long generations, capture reply text (tool change, proposed) and run a ≥2k-token output probe.**

5. **Prefill is unchanged, so the agent loop is now prefill-bound.** Cold prefill sits within ±3 % at all four depths, and per-turn prefill of new tokens matches the baseline (MEASURED). Conversation wall time fell 41 %, and prefill is now 86 % of it (93.6 of 108.3 s). The conversation prefill exponent steepened slightly (−0.405 vs −0.360), partly because every turn now re-prefills 0.65–1.2k extra tokens from the coarser cache block (finding 6; INFERRED).
   **→ The next speed lever is prefill at depth (power cap, chunk size, attention kernel), not decode.**

6. **The drafter costs 20 % of the KV pool and coarsens the prefix cache.** Model memory 14.89 GiB vs 13.7 GiB (+1.2 GiB ≈ the drafter's 1.2 GB on disk). The KV pool drops to 345,297 tokens in 12.5 GiB, still 2.30 × 150k (MEASURED). The aborted first boot sized it at 327,103 tokens / 11.84 GiB with the same profile. That boot compiled from a cold torch.compile cache (29.9 s compile) and the measured boot loaded from cache (1.1 s), so INFERRED: the profiling peak differs between compile and cache-hit boots. vLLM also warns `no KV cache group could be identified as the draft model's` and `Add 3 padding layers, may waste at most 60.00% KV cache memory`; the drafter works regardless (acceptance above). **Cached prefixes now align to 880 tokens, against 64 in the baseline** (cached = 10 × 880, 28 × 880 … 131 × 880, MEASURED). Each turn therefore re-prefills up to 879 tokens, 0.65–1.2k more new tokens per turn than the baseline (e.g. turn 1: 17,566 vs 16,386). The exact cause is OPEN: likely vLLM's hybrid-model page alignment (GDN state page vs attention block) recomputed with the drafter's layers (INFERRED).
   **→ Fine for one agent at 150k. For parallel agents, budget ~2 full-window sequences, not ~3.**

7. **Memory and power are healthy.** VRAM is flat at 30,442 MiB peak (vLLM reserves 0.90 × VRAM at boot), and GTT peaks 12–22 MiB above the idle baseline, which is noise, not a spill. Power holds at the 210 W cap in both phases, decode mclk is pinned at maximum, and no phase was flagged (MEASURED). So the decode comparison with the baseline (also mclk 1,258 in 100 %) is not confounded by clocks (skill rule 16).

8. **The warm-up fix from the baseline worked.** The baseline's 20k/40k rep 0 lost 13–27 % to inference-time Triton JIT. Here, with one warm-up per shape, reps agree within 0.1 % on prefill at 20k, 40k and 136k (MEASURED). The only logged JIT fired inside the 8k warm-up. The 8k rep 0 prefill dip (−10 %) has no logged cause and is a single sample (OPEN, minor).

## Recommended config

```bash
PROFILE=sly-radiance/qwen38-mxfp4-dflash PORT=8000 stack/serve/vllm/serve_vllm.sh
# = qwen38-mxfp4 (MAXLEN=150000 KV_DTYPE=fp8 MAXSEQS=1 util 0.90) + --speculative-config.method dflash
#   --speculative-config.model /draft (syvai/Qwen3.8-27B-DFlash2-W4A16@4d30ec73) num_speculative_tokens 7
#   draft_sample_method greedy attention_backend TRITON_ATTN, cudagraph sizes [8]
# exact docker argv + image digest + model/drafter revisions: stack/serve/var/servers/8000.cmdline
```
Use it for **single-agent coding/review loops up to 150k** with a client-side timeout. It wins both phases on this box. Hold back for (a) long unattended runs, until the MXFP4 prefill fault is bisected (1 in 57 requests so far); (b) long generations, until #164 is checked with captured reply text; (c) windows > 150k, which were not tested on vLLM. llama.cpp's Q4 GGUF path still covers 262k on Ornith/35B-A3B.

## Methodology & caveats

- One variable vs the baseline: the speculative config (and the cudagraph size list `[8]` that k=7 needs). Fixtures, sampler (temperature 0.2), reasoning effort, max tokens 256, ctx, KV, util and image are identical. vLLM counted 8,139–8,141 / 20,081–20,082 / 39,981–39,982 / 135,691–135,692 prompt tokens.
- 2 reps; 1 warm-up request on 8k/20k/40k (spec `warmup: 1`), none on 136k or the conversation. The spec counters include the warm-ups, so τ is per probe, not per request, and the verify-step rate is approximate (INFERRED).
- Decode tok/s includes the thinking tokens (124–160 cold, 93–155 conversation, of 256). Speculation acceptance on thinking vs answer tokens is not separated.
- First launch (14:06) was killed by an agent-session teardown during engine warm-up. It served no requests, so it is not counted as a faulted boot. The relaunch ran detached. Boot: weights 47.4 s (cold page cache) + drafter 2.9 s, engine init 71 s (compile 1.1 s from the per-tag cache). `triton_bundler` "cubin not found" warnings at boot came from the aborted boot's partly written AOT cache entry, and the kernels were rebuilt (INFERRED from timing; harmless).
- Speculative decoding verifies every drafted token against the target, so output quality should match the baseline's. Quality was **not** measured, and neither were concurrency > 1, a two-conversation interleave (skill rule 18), output lengths > 256, nor a lookup-draft-off arm.
- Charts are DFlash-only (`report.py` processes one campaign per call and shortens both engine names to the same label); baseline numbers are in the tables.

## External comparison (CLAIMED, not measured here)

Sly README (radiance 1.5.1, 300 W, util 0.98, fp8 KV, DFlash2 k=7): **149.6 tok/s single-stream decode**, prefill ~3,024 tok/s @ 1.5k / 2,430 @ 47k, KV pool 439,031 tokens. Ours at 210 W / util 0.90: cold decode 136.6 @ 8k (91 % of the claim) and 86.7–113.4 at 20k–136k; conversation 145–203 on copy-friendly turns. Sly's prompt and output shape are not stated, so per skill rule 17 the gap is not interpretable as an engine difference. Their 439k-token pool is larger than ours with the drafter (345k), as INFERRED from the higher util (0.98 vs 0.90).

## Proposals (not done — awaiting decision)

- `capture_engine`: persist reply text (needed for #164) and record spec counters per turn; fix `_pct` with n=2 (returns the minimum); cut-stream detection in `probe` mode too.
- `report.py`: key series on the full engine/served name so two campaigns overlay in one chart.
- A lookup-draft-off A/B to attribute the conversation speed-up; then the fault bisect from the baseline (`RADIANCE_MXFP4_A_TILED_MIN_M`, repeat deep conversation ×N, 1.5.x image), fault watch in the harness, and an upstream report (outward-facing — ask first).
- A like-for-like llama.cpp + MTP rerun on the current build (b11448) with these fixtures and power profile, to replace the old reference numbers.

Full chart appendix: [`appendix.md`](../../../campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash/results/appendix.md) (adds `memory.svg`, `conv_prefill_new.svg`).
