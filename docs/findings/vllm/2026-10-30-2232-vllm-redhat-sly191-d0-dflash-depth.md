<!-- meta
date: 2026-10-30 23:05
slug: vllm-redhat-sly191-d0-dflash-depth
title: RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 at Cactus δ 0 (stock acceptance) - DFlash2 k=7 vs MTP k=4, depth 10k/50k/100k/150k
takeaway: At δ 0 DFlash2 k=7 decodes faster than the model's own MTP head k=4 at 10k/100k/145k (mean of 2 reps 100.2/93.9/80.5 vs 62.8/73.0/68.0 tok/s; every DFlash rep above every MTP rep) and ties at 50k (73.9 vs 73.7), so the W2-08 session S1 uses DFlash2. Decode = verify steps/s x mean accept length; steps/s does not depend on δ (δ 0 vs δ 0.5 within 1-4 %), so δ 0.5 buys only acceptance - +29/+30/-7 % accept length for DFlash2 at 10k/50k/100k, -5..+8 % for MTP.
campaign: campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth
-->

# Benchmark: RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 at Cactus δ 0 - DFlash2 k=7 vs MTP k=4 by depth - R9700 (gfx1201)

- **Date:** 2026-10-30, probes 22:35-22:39 (DFlash2) and 22:50-22:55 (MTP) local · **Track:** engine-bench campaign (`gen_campaign.py` → `run.sh` → `capture_engine.py probe`)
- **GPU/Host:** Radeon AI PRO R9700 (gfx1201, 32624 MiB), kernel 7.0.0-38-generic · power state during these runs: `power1_cap` 210 W (default 300 W), `power_dpm_force_performance_level=manual`, profile `POWER_SAVING`, `OD_VDDGFX_OFFSET` −80 mV, `OD_SCLK_OFFSET` 0 MHz (`campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/tmp/2026-10-30-sly191-d0-power-state.log`, snapshot 22:36; cap + profile also logged before/after each campaign in `campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/tmp/2026-10-30-sly191-d0-depth.log`)
- **Engine:** `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` @ `sha256:9744caf31e9638ec11c01b6bd6e9e61198020a8d7fb80701710caa955cf9abc8` (vLLM 0.32.0), chat template `qwen3.8-froggeric-v22.5-sly2`, `enable_thinking: true`, sampling temperature 1.0 / top_p 0.95 / top_k 20 / min_p 0 / presence_penalty 0 (all from `server-<name>.txt`, the resolved `serve_vllm.sh print`)
- **Model:** `RedHatAI/Qwen3.8-27B-MXFP4` @ `16a86728`; drafter `syvai/Qwen3.8-27B-DFlash2-W4A16` @ `4d30ec73`; MTP = the checkpoint's own head
- **Data:** `bench/runs/2026-10-30-vllm-redhat-sly191-d0-{dflash,mtp}-depth/` (consolidated `results.jsonl` + `server-*.txt` + `meta.txt`), per-probe dirs `bench/runs/2026-10-30-22{35,36,37,50,51,53}-engine-redhat-sly191-d0-*`; δ 0.5 reference `bench/runs/2026-10-30-vllm-redhat-sly191-{dflash,mtp}-depth/`
- **Campaigns:** this dir and `campaigns/perf/2026-10-30-2240-vllm-redhat-sly191-d0-mtp-depth/` (one write-up for both)

## Summary

- **DFlash2 k=7 is the δ 0 method for the W2-08 session S1.** MEASURED decode tok/s, mean of 2 reps, 10k/50k/100k/145k: DFlash2 100.2 / 73.9 / 93.9 / 80.5, MTP k=4 62.8 / 73.7 / 73.0 / 68.0. At 10k, 100k and 145k both DFlash2 reps beat both MTP reps. At 50k the reps overlap (DFlash2 69.57-78.31, MTP 66.61-80.69), so that depth is a tie. The agentic sessions sit at 90-180k before auto-compaction; there DFlash2 leads by 18-29 % (INFERRED, ratio of means).
- **Decode = verify steps per second × mean accept length** (INFERRED from MEASURED rates and vLLM counters). Steps/s depend on the method and the depth, not on δ: δ 0 vs δ 0.5 differ by 0.8-1.6 % for DFlash2 and 0.6-4.2 % for MTP. DFlash2 runs 27.2 → 22.5 steps/s from 10k to 145k (36.8 → 44.4 ms/step; log-log exponent −0.068, R² 0.90). MTP is flat at 18.5-19.6 steps/s (51-54 ms/step). MTP accepts more per position but pays more per step.
- **δ 0.5 only buys acceptance.** On these 256-token outputs it raised DFlash2's accept length by +29 % / +30 % at 10k/50k and lowered it by 7 % at 100k. MTP moved −5..+8 %. Decode followed the accept length within 3 % (INFERRED). A lossy δ 0.5 therefore gives MTP essentially no speed. Even MTP at δ 0.5 (69.1-70.6 tok/s) is slower than DFlash2 at δ 0 (73.9-93.9 tok/s at 50k/100k).
- **Prefill** is 2017-3236 tok/s and decays gently (log-log exponent −0.149, R² 0.92 for DFlash2). Spec decoding does not touch it, but the δ 0 runs prefilled 2-11 % below the δ 0.5 runs (means of reps), with 0-6 % lower prefill sclk at the same ~210 W. That cause is not separable here (power state not logged for the δ 0.5 runs; ctx 262000 vs 110000), and it does not affect the decision.
- **Caveat:** n = 2 per cell, and each request generates only 256 tokens of code-review thinking. Acceptance depends on the output, and the rep-to-rep decode spread reaches 21 % (MTP 50k: 66.61 vs 80.69; DFlash2 10k: 91.02 vs 109.32, 20 %). The real agentic output shape (code, tool-call JSON) will come from the S1 session itself (skill rule 17).

**Decode vs depth - δ 0, DFlash2 k=7 vs MTP k=4 (p50 = the slower of 2 reps)**

![Decode vs depth](../../../campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/results/charts/depth_decode.svg)

> Plots the tool's p50, i.e. the slower rep. At 50k the two methods' reps overlap, so that point is a tie, not a ranking. The δ 0.5 runs are not drawn: `report.py` keys series by engine name, and the δ 0 and δ 0.5 runs share one (tool gap, see Methodology). MEASURED.

## Legend - every knob & label used in this run

| Term | What it is | Effect on this box (this run) | How it's tested here |
|------|------------|-------------------------------|----------------------|
| δ (`CACTUS_DELTA` → `RADIANCE_CACTUS_DELTA`) | Sly's Cactus relaxed speculative acceptance: raises each draft position's acceptance probability above the stock value by an amount that grows with δ, then applies the 1.9.x cap and fade | δ 0 = stock rejection sampling (output distribution of the target model); δ 0.5 raised DFlash2's mean accept length +29/+30 % at 10k/50k on this output (−7 % at 100k) and moved MTP's −5..+8 % (MEASURED) | `env {"CACTUS_DELTA": "0"}` in both specs; δ 0.5 = the earlier 1.9.1 runs |
| fade / cap (1.9.x) | δ fades to 0 between 4096 and 16384 output tokens; cap `h ≤ 1 − R·(1 − q)`, R 0.5 (code defaults, `rejection_sampler_utils.py:10-16,775-783` in the 1.9.1 image, code read) | inert at δ 0: δ·fade = 0, and the cap never binds when h = q (INFERRED from the formula); the fade never starts within 256-token probes | not varied; knobs `CACTUS_FADE_*`/`CACTUS_CAP_R` exist since 2026-10-30 (`profiles/sly-official/_engine.env`) |
| DFlash2 k=7 (drafter) | separate `syvai/Qwen3.8-27B-DFlash2-W4A16` block-diffusion drafter, 7 speculative tokens per step | fastest steps (36.8-44.4 ms) but lower acceptance (0.27-0.43 at δ 0) | profile `sly-redhat/redhat-mxfp4-dflash` |
| MTP k=4 (own head) | the checkpoint's built-in MTP head, 4 speculative tokens per step | higher acceptance (0.60-0.71) but slower steps (51-54 ms) | profile `sly-redhat/redhat-mxfp4-mtp` |
| depth / `crN` | code-review prompt padded to N tokens (`codereview-N.txt`; real counts in the tables) | prefill falls 3236 → 2017 tok/s from 10k to 145k; decode follows acceptance, not depth | `prefix_mode=unique`, `api=chat`, 256 generated tokens, 2 reps, 1 warm-up on the 10k shape |
| p50 / p95 | `capture_engine` percentiles over the 2 reps | p50 = the **slower** rep for prefill/decode (the smaller TTFT for TTFT p50) | as computed by the tool |
| mean accept length | accepted tokens per verify step, including the bonus token (vLLM spec counters diffed per probe, warm-up included) | DFlash2 2.87-3.98 of max 8; MTP 3.40-3.84 of max 5 | `spec` rows |
| steps/s, ms/step | INFERRED: mean decode tok/s ÷ mean accept length | the δ-independent cost of one draft + verify cycle | computed in the INFERRED table |
| `WATCHDOG_MIB` | `serve_vllm.sh` boot-time kill switch: docker-kill the container if free VRAM drops below N MiB while booting | the default 256 killed the first MTP boot (free 107 MiB); 32 = the session setting (dp-forge `vllm.sh`, agentic driver) | `env` of the MTP spec after the failure |

## Results (all MEASURED, verbatim from the consolidated `results.jsonl`; a memory column is included)

Fixed for every row: fp8 KV, `--max-model-len 262000`, `--max-num-seqs 1`, `--gpu-memory-utilization 0.93`, `--max-num-batched-tokens 4096`, prefix caching on (cold prompts via `prefix_mode=unique`), conc 1.

| config | depth (prompt tok) | prefill tok/s p50 | decode tok/s p50 | decode rep 0 / rep 1 | TTFT p50 / p95 s | acc. rate | mean accept len | drafts / drafted / accepted | VRAM@load MiB | peak VRAM MiB | peak GTT MiB | err |
|---|---:|---:|---:|---|---|---:|---:|---|---:|---:|---:|---:|
| δ 0 · DFlash2 k=7 | 10158 | 3220.5 | 91.02 | 91.02 / 109.32 | 3.1237 / 3.1542 | 0.3842 | 3.69 | 145 / 1015 / 390 | 30733 | 31782 | 239 | 0 |
| δ 0 · DFlash2 k=7 | 49327 | 2786.5 | 69.57 | 78.31 / 69.57 | 17.5678 / 17.7013 | 0.2673 | 2.871 | 178 / 1246 / 333 | 31782 | 31782 | 241 | 0 |
| δ 0 · DFlash2 k=7 | 97953 | 2409.7 | 87.3 | 87.3 / 100.47 | 40.4525 / 40.6491 | 0.4253 | 3.977 | 131 / 917 / 390 | 31782 | 31784 | 253 | 0 |
| δ 0 · DFlash2 k=7 | 145120 | 2110.9 | 79.94 | 79.94 / 81.04 | 67.8565 / 68.7495 | 0.3676 | 3.573 | 143 / 1001 / 368 | 31751 | 31797 | 249 | 0 |
| δ 0 · MTP k=4, first boot | - | - | - | - | - | - | - | - | - | - | - | **FAILED** at boot: `WATCHDOG killed vllm-8000: VRAM nearly full during boot (free_mib=107 …, floor 256 MiB)` during weight load / lm_head quantization; desktop held 848 MiB before boot |
| δ 0 · MTP k=4 (retry, `WATCHDOG_MIB=32`) | 10159 | 2783.2 | 60.4 | 60.4 / 65.21 | 3.229 / 3.6501 | 0.601 | 3.404 | 156 / 624 / 375 | 30054 | 30876 | 499 | 0 |
| δ 0 · MTP k=4 | 49325 | 2656.3 | 66.61 | 80.69 / 66.61 | 18.4597 / 18.5689 | 0.6893 | 3.757 | 136 / 544 / 375 | 30876 | 30876 | 499 | 0 |
| δ 0 · MTP k=4 | 97952 | 2253.1 | 71.96 | 71.96 / 73.95 | 42.8293 / 43.4751 | 0.709 | 3.836 | 134 / 536 / 380 | 30876 | 30876 | 499 | 0 |
| δ 0 · MTP k=4 | 145119 | 2016.7 | 63.09 | 72.82 / 63.09 | 71.927 / 71.9588 | 0.6613 | 3.645 | 141 / 564 / 373 | 30876 | 30900 | 499 | 0 |

The δ 0.5 + fade/cap reference rows (same image, ctx 110000, 19:48-19:58 local) are in `docs/findings/radiance/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md` → "Cactus δ 0 rerun", side by side with these, per depth.

**Health - memory & power per probe**

![Memory & power](../../../campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/results/charts/memory.svg)

> Peak VRAM is the whole card: vLLM's reservation plus the desktop. GTT never grew during a probe: MTP sat at 499 MiB in every sample, and DFlash2 fluctuated between 161 and 253 MiB, falling during the 145k probe. So nothing spilled during a measurement (MEASURED from `gpu_samples.csv`). The absolute GTT level follows the desktop (OPEN, see finding 5).

## What moved the needle

INFERRED - computed from the MEASURED rows above and the δ 0.5 rows of the transposed doc. Means are of the 2 reps.

| quantity | 10k | 50k | 100k | 145k |
|---|---:|---:|---:|---:|
| δ 0: DFlash2 / MTP decode, mean of reps | 1.59 | 1.00 | 1.29 | 1.18 |
| δ 0: DFlash2 / MTP decode, p50 (slower rep) | 1.51 | 1.04 | 1.21 | 1.27 |
| DFlash2 steps/s (ms/step), δ 0 | 27.15 (36.8) | 25.75 (38.8) | 23.61 (42.4) | 22.53 (44.4) |
| DFlash2 steps/s (ms/step), δ 0.5 | 27.60 (36.2) | 25.97 (38.5) | 23.88 (41.9) | not measured |
| MTP steps/s (ms/step), δ 0 | 18.45 (54.2) | 19.60 (51.0) | 19.02 (52.6) | 18.64 (53.6) |
| MTP steps/s (ms/step), δ 0.5 | 18.96 (52.7) | 18.81 (53.2) | 18.90 (52.9) | not measured |
| steps/s δ 0 ÷ δ 0.5, DFlash2 / MTP | 0.984 / 0.973 | 0.992 / 1.042 | 0.989 / 1.006 | - |
| mean accept length δ 0.5 ÷ δ 0, DFlash2 / MTP | 1.289 / 1.081 | 1.304 / 0.999 | 0.928 / 0.953 | - |
| decode (mean) δ 0.5 ÷ δ 0, DFlash2 / MTP | 1.310 / 1.111 | 1.316 / 0.958 | 0.939 / 0.947 | - |
| prefill (mean) δ 0 ÷ δ 0.5, DFlash2 / MTP | 0.946 / 0.895 | 0.978 / 0.968 | 0.980 / 0.970 | - |

Depth fits (log-log, y = a·depth^k, fit range 10k-145k):

| series | k | R² | n | source |
|---|---:|---:|---:|---|
| δ 0 DFlash2 prefill p50 | −0.149 | 0.919 | 4 | `results/appendix.md` (report.py) |
| δ 0 MTP prefill p50 | −0.113 | 0.791 | 4 | report.py; pulled by the slow 10k rep 0 (2783.2 vs 3145.6 tok/s, that request's prefill 136 W avg) |
| δ 0 DFlash2 decode p50 | −0.036 | 0.126 | 4 | report.py: no depth trend, decode follows acceptance |
| δ 0 MTP decode p50 | +0.037 | 0.330 | 4 | report.py: no depth trend |
| δ 0 DFlash2 steps/s | −0.068 | 0.895 | 4 | INFERRED, means of reps / accept length |
| δ 0 MTP steps/s | +0.007 | 0.085 | 4 | INFERRED: flat |

**Prefill vs depth**

![Prefill vs depth](../../../campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/results/charts/depth_prefill.svg)

> Both methods prefill in the same band, so the spec method does not change prefill. MTP's 10k point is one slow rep (2783.2 tok/s, at 136 W average versus ~207 W elsewhere), not a method effect. MEASURED.

## Consequences & root causes

1. **S1 runs DFlash2 k=7 at δ 0.**
   - DFlash2 wins at 3 of 4 depths with non-overlapping reps and ties at 50k (MEASURED).
   - Expected decode at the session depths, on this output shape: ~80-94 tok/s (MEASURED at 100k/145k).
   - `~/.config/claude/local_vllm_direct/settings-redhat.json` already names the DFlash2 served model (`qwen38-27b-redhat-mxfp4-dflash`), so S1 needs no settings change.
   - Projection to the 262k window (INFERRED): the steps/s fits give DFlash2 22.1 steps/s × mean accept length 3.53 ≈ 78 tok/s, against MTP 19.1 × 3.66 ≈ 70 tok/s. That is 1.8× past the deepest measured point and assumes acceptance stays flat with depth (it does here, within noise). A crossover would need ~1.1 M tokens, far outside the window.
2. **The user's question "could MTP beat DFlash?" - not on this stack.**
   - At δ 0 the two methods sample the target model's own distribution. Quality cannot differ, only speed (INFERRED, stock rejection sampling), and DFlash2 is faster.
   - At δ 0.5, MTP's accept length moves by −5..+8 % (MEASURED). The lossy relaxation therefore buys MTP almost nothing, and even MTP at δ 0.5 (69.1-70.6 tok/s) is slower than DFlash2 at δ 0 at 50k/100k.
   - An "MTP at δ 0.5 loops less" session would test a config that is both lossy and slower than the lossless DFlash2 one. **Recommendation: no MTP session** (INFERRED).
3. **Why the two methods trade the way they do** (INFERRED, mechanism not instrumented):
   - DFlash2 drafts all 7 tokens in one pass of a small W4A16 drafter.
   - MTP drafts its 4 tokens sequentially, each through the MTP layer and the 248,320-row LM head.
   - Verify is one target forward over 8 vs 5 tokens in both cases.
   - So MTP pays ~10-15 ms more per step, and its higher per-position acceptance (pos-1 0.83-0.89 vs DFlash2 0.75-0.86, from `accepted_per_pos` ÷ drafts) does not make that up.
   - Checked and ruled out: the boot line `Falling back to the Triton GDN spec decode path: torch.ops._C.fused_gdn_decode_post_conv_mtp is not built` appears in the DFlash2 1.9.1 server log too (`campaigns/agentic/2026-10-30-0947-dpf-brief-ab/tmp/sly191-w208/server-container.log`). It is not an MTP-only handicap (MEASURED: present in both logs).
   - **OPEN:** why DFlash2's step time grows with depth (+7.6 ms from 10k to 145k) while MTP's does not, although both verify against the same KV. One hypothesis: the DFlash2 drafter attends over the target's context features (not verified).
4. **δ 0.5's speed is acceptance, and acceptance depends on the output.**
   - On these probes DFlash2's decode gain from δ 0.5 was +31 % / +32 % / −6 % at 10k/50k/100k (mean of reps).
   - In the W2-08 sessions the non-loop decode was 102.0 tok/s at δ 0.5 (1.9.1) vs 74.5 at δ 0 (1.8.1), i.e. +37 % (MEASURED, `docs/findings/agentic/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md`). That is consistent with a larger acceptance gain on real agentic output, but the comparison crosses images and power states (INFERRED).
   - S2 (δ 0.5) vs S1 (δ 0), same image, power state and RUNBOOK, is the measurement that settles the price of δ 0.
5. **Memory:**
   - vLLM's own footprint does not depend on `--max-model-len`. Peak VRAM minus the pre-boot desktop usage (`gpu_exclusive.sh` line) is the same at ctx 262000 and 110000 (MEASURED): DFlash2 30603 vs 30609 MiB, MTP 30315 vs 30283 MiB.
   - The card total is that plus the desktop. With the desktop at 1179 MiB, DFlash2 peaked at 31797 MiB (97.5 % of physical, 827 MiB free).
   - The MTP boot transient comes within ~100 MiB of full: the first boot was killed at 107 MiB free with 848 MiB of desktop. Throughput specs on this card should pass `WATCHDOG_MIB=32` (the session value) via `env`, or the desktop should be kept light during boots.
   - GTT stayed flat within probes. **OPEN:** whether the 499 MiB level of the MTP run includes a boot-time allocation, because there is no pre-boot GTT sample (only `gpu_exclusive.sh`'s VRAM line).
6. **Power state:**
   - Decode was not memory-clock-throttled. The decode-window mclk p50 was 1258 MHz (the observed maximum) in all 14 probes of both δ sets, p10 1124 MHz only in the two δ 0 10k probes (MEASURED, 3-8 decode samples per probe at ~1 s).
   - Average power was 191-226 W in decode and 207-214 W in prefill (MTP 10k 163 W), with the same averages in the δ 0.5 runs.
   - Single samples exceed the 210 W cap (up to 316 W in prefill, 254 W in decode), because the cap is an average.
   - So the δ 0 vs δ 0.5 decode comparison is not confounded by clocks.
   - Correction of a claim made in chat before this analysis: "the δ 0.5 runs ran at a higher power cap" is not supported. Their power averages are the same, and the high samples occur at 210 W too.
   - The prefill difference (2-11 % on means of reps, with 0-6 % lower prefill sclk) stays unattributed (power state of the δ 0.5 runs not logged; ctx also differs).

## Recommended config (S1 server)

```bash
PROFILE=sly-redhat/redhat-mxfp4-dflash CACTUS_DELTA=0 SERVED_NAME=qwen38-27b-redhat-mxfp4-dflash \
  MAXLEN=262000 MAXSEQS=1 KV_DTYPE=fp8 GPU_UTIL=0.93 WATCHDOG_MIB=32 PORT=8000 \
  stack/serve/vllm/serve_vllm.sh start      # image = sly-redhat default 1.9.1-rocm10.1 (@sha256:9744caf3…abc8)
```
In the agentic campaign this is one arm: `{"profile": "sly-redhat/redhat-mxfp4-dflash", "env": {"CACTUS_DELTA": "0"}}` (server defaults already MAXSEQS 1 / fp8 / 0.93 / watchdog 32).

## Methodology & caveats

- **Fixtures:** `codereview-{10000,50000,100000,150000}.txt`. Real prompt tokens are 10158-10159 / 49325-49327 / 97952-97953 / 145119-145120. Settings: `api=chat`, `prefix_mode=unique`, `max_tokens` 256 (think tokens 136-158 of them), 2 reps per depth, 1 untimed warm-up on 10k. Spec counters include the warm-up, while the decode means exclude it, so the steps/s figures at 10k carry that small mismatch.
- **Noise:** n = 2. Decode reps differ by up to 21 % (max ÷ min: MTP 50k 21 %, DFlash2 10k 20 %); prefill reps by ≤ 1.5 % except MTP 10k (13 %). Ties are called where the reps overlap. No significance claims.
- **ctx 262000** (= `CLAUDE_CODE_MAX_CONTEXT_TOKENS` in `settings-redhat.json` and the W2-08 1.9.1 server's `--max-model-len`), versus 110000 in the δ 0.5 reference. Finding 5 shows the memory footprint is unchanged. A decode effect is not separable from δ, but steps/s agree within 0.8-4.2 %, so any ctx effect on decode is at most that size (INFERRED).
- **Failure:** the first MTP boot is a FAILED row above. The retry used the same spec plus `WATCHDOG_MIB=32` (22:43:53 local).
  - The MTP `meta.txt` still shows the first attempt's env line, because `run.sh` writes `meta.txt` only once. The retry's config is in `server-redhat-sly191-d0-mtp-fp8kv-ctx262000.txt` (`printed_utc=2026-10-30T21:43:53Z`).
  - `serve_vllm.sh print` does not echo `WATCHDOG_MIB`. The value 32 is recorded in the spec, the regenerated `run.sh` and the depth log.
- **Charts:** `bench/core/report.py` charts one run dir per call; with `--charts`, the last dir overwrites the others. They were therefore generated from a merged input dir: `campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/results/2026-10-30-vllm-redhat-sly191-d0-dflash-vs-mtp-merged/` (`cat` of both `results.jsonl` + the MTP `failures.txt`; see its `README.txt`). Regenerate with `python3 bench/core/report.py campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/results/2026-10-30-vllm-redhat-sly191-d0-dflash-vs-mtp-merged --charts campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/results/charts --appendix campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/results/appendix.md`. Also embedded: `charts/power_phase.svg` in the appendix only (`results/appendix.md`).
- **Tool gaps found** (recommendations, not done):
  - `report.py`: merge several run dirs into one chart set, and accept a per-dir series label, so that δ 0 and δ 0.5 runs of the same profile can share a chart.
  - Throughput `run.sh`: record each attempt's env, rather than writing `meta.txt` only once.
  - `serve_vllm.sh print`: echo `WATCHDOG_MIB`.
  - A pre-boot GTT baseline sample.
- **Reproduce:** `bash campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/run.sh` and `bash campaigns/perf/2026-10-30-2240-vllm-redhat-sly191-d0-mtp-depth/run.sh`. Both are resumable, so remove `done/` under the run dir to re-measure. The power state above should be the same before comparing numbers.
