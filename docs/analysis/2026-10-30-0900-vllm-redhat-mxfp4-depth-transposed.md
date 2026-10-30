<!-- meta
date: 2026-10-30 09:00
slug: vllm-redhat-mxfp4-depth-transposed
title: RedHatAI Qwen3.8-27B-MXFP4 on vLLM (Sly 1.8.1 / Sly 1.9.1 / radiance 0.9.3) - baseline vs MTP vs DFlash2, depth 10k/50k/100k
takeaway: On Sly 1.8.1 (Cactus δ 0.5) the RedHat MXFP4 checkpoint decodes 18 tok/s plain, 73/69/69 with its own MTP head (k=4) and 122/85/87 with the DFlash2 drafter (k=7); the Sly 1.9.1 rerun (δ 0.5 + fade/cap, same probes) gives 19/19/19, 67/70/69 and 123/86/86 - no decode change beyond the n=2 rep noise, prefill 2-6 % faster at 50k/100k; vllm-radiance 0.9.3 decodes only ~4.9 and prefills ~2x slower. Per-depth MEASURED tables, the data check, the run log and the incidents.
-->

# RedHatAI Qwen3.8-27B-MXFP4 - baseline vs MTP vs DFlash2 on Sly 1.8.1 and Sly 1.9.1, and vs radiance 0.9.3 (depth 10k / 50k / 100k)

- **Date:** 2026-10-30 (Sly 1.9.1 rerun added the same evening, 19:32-19:59 local) · **Track:** engine-bench (vLLM) · **Card:** Radeon AI PRO R9700 (gfx1201, 32 GB)
- **Question:** how does `RedHatAI/Qwen3.8-27B-MXFP4` run on Sly radiance 1.8.1 and on upstream vllm-radiance 0.9.3, and can its own MTP head and the DFlash2 drafter be used on Sly 1.8.1? Rerun: does Sly 1.9.1 change any of it?
- **Answer (short):** both speculative methods work on Sly 1.8.1 without any patch. DFlash2 is the faster one at every depth but its acceptance falls with depth. vllm-radiance 0.9.3 loads the checkpoint but is far slower. Sly 1.9.1 (Cactus δ 0.5 + fade + cap, template v22.5-sly2) decodes the same as 1.8.1 within the n = 2 rep noise for all three methods, and prefills 2-6 % faster at 50k/100k; its fade never engages in these 256-token probes, so this rerun says nothing about long-output loops.

## Summary

- **MEASURED** decode (tok/s per stream, p50, 10k/50k/100k): RedHat on Sly 1.8.1, no spec 18.03/18.23/18.87; RedHat on Sly 1.8.1 + its own MTP head k=4 73.07/68.55/68.85; RedHat on Sly 1.8.1 + DFlash2 drafter k=7 122.27/84.76/87.36; RedHat on radiance 0.9.3, no spec 4.93/4.87/4.81.
- **INFERRED** (ratios of the table values, 2 decimals, 10k/50k/100k): RedHat Sly MTP / RedHat Sly no-spec decode = 4.05/3.76/3.65; RedHat Sly DFlash2 / RedHat Sly no-spec decode = 6.78/4.65/4.63; RedHat Sly DFlash2 / RedHat Sly MTP decode = 1.67/1.24/1.27; RedHat Sly no-spec / RedHat radiance no-spec decode = 3.66/3.74/3.92, prefill = 2.25/1.98/1.97.
- Prefill and TTFT are essentially unchanged by either speculative method (the three RedHat · Sly 1.8.1 columns, MTP and DFlash2 vs no spec: prefill within 5.2 %, TTFT p50 within 3.8 % of the no-spec column); peak VRAM stays in 30760-31079 MiB across those three configs (largest spread at one depth: 309 MiB at 100k, 30760 no spec vs 31035 MTP / 31069 DFlash2).
- RedHat · Sly DFlash2 acceptance rate drops from 0.5494 (10k) to 0.3671 / 0.4231 (50k / 100k); RedHat · Sly MTP stays at 0.7332 / 0.6596 / 0.7. This is why the DFlash2 lead shrinks at depth.
- Correction to an earlier chat summary: the RedHat · Sly MTP speed-up over no spec is 3.65-4.05x (not 3.8-4.0x) and the RedHat · Sly DFlash2 speed-up is 4.63-6.78x; the tables above are the authority.
- **MEASURED, Sly 1.9.1 rerun** (RedHat, same probes; image `…:1.9.1-rocm10.1`, Cactus δ 0.5 + fade 4096→16384 output tokens + cap R 0.5, template `v22.5-sly2`), decode tok/s per stream p50, 10k/50k/100k: no spec 18.97/19.43/19.01; MTP k=4 67.25/70.02/69.07; DFlash2 k=7 122.72/86.34/86.24.
- **INFERRED** (1.9.1 / 1.8.1, same method, 10k/50k/100k): decode p50 no spec 1.05/1.07/1.01, MTP 0.92/1.02/1.00, DFlash2 1.00/1.02/0.99. Every difference (-8 % to +7 %) is smaller than the spread between the two reps of a single config (RedHat · Sly 1.8.1 · DFlash2 10k: 142.27 vs 122.27, 14 %; RedHat · Sly 1.9.1 · DFlash2 10k: 139.82 vs 122.72, 12 %), so **1.9.1 does not change decode speed measurably**. The one consistent sign is no spec: higher on 1.9.1 by +3/+3/+1 % (means of the 2 reps), against a rep-to-rep spread of 0.4-7.6 % for no spec. That is too small to call at n = 2. Prefill p50 is 2-6 % higher on 1.9.1 in 8 of 9 cells, including all six at 50k/100k. The exception is no spec at 10k (0.92), where the two 1.9.1 reps are 15 % apart (2967.3 vs 3421.5). On 1.9.1, MTP / no spec decode = 3.55/3.60/3.63, DFlash2 / no spec = 6.47/4.44/4.54, DFlash2 / MTP = 1.82/1.23/1.25 (INFERRED, ratios of the table values).
- Acceptance rate 1.9.1 vs 1.8.1 (MEASURED): MTP 0.6701/0.688/0.6643 vs 0.7332/0.6596/0.7; DFlash2 0.5367/0.3921/0.3844 vs 0.5494/0.3671/0.4231. It is lower in 4 of 6 cells and higher in 2, by at most 0.063. In these probes the 1.9.1 cap is active at every position (code: `h_n = min(h_n, 1 - CAP_R·(1 - q_n))`), and the fade is not (it starts after 4,096 output tokens, the probes generate 256). INFERRED: whatever the cap does to acceptance here is below what 2 reps can resolve.

## Results (one table per depth)

All values **MEASURED**, copied verbatim (no rounding) from `bench/runs/2026-10-30-vllm-<slug>-depth/results.jsonl` (aggregate / gpu / spec rows).
Column names = model · engine · speculative method. **RedHat** = `RedHatAI/Qwen3.8-27B-MXFP4`; **Heretic** = `slybase/Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ` (different weights, reference only); **Sly 1.8.1** = `ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1` (official recipe engine layer; Cactus δ 0.5 with no fade and no cap; chat template `qwen3.8-froggeric-v22.5`, baked into the image); **Sly 1.9.1** = `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` @ `sha256:9744caf31e96…abc8` (vLLM 0.32.0; same engine layer; Cactus δ 0.5 + fade 4096→16384 output tokens + cap R 0.5, the code defaults; chat template `qwen3.8-froggeric-v22.5-sly2`, baked into the image); Cactus only acts on speculative tokens, so it does nothing in the no-spec columns; **radiance 0.9.3** = `stilldeadcode/vllm-radiance:0.9.3` (no Cactus; template, template kwargs and presence penalty differ from the Sly columns, see the config table); **no spec** = no speculative decoding; **MTP k=4 (own head)** = the RedHat checkpoint's built-in MTP head, 4 speculative tokens, no separate drafter; **DFlash2 k=7 (drafter)** = separate `syvai/Qwen3.8-27B-DFlash2-W4A16` drafter, 7 speculative tokens. `n/a` = not applicable.
**How to read "p50" / "p95":** each probe has only 2 reps, and the tool's p50 is the **lower** of the two (p95 the higher) - verified for all 24 probes (15 + the 9 of the Sly 1.9.1 rerun; see Data check). So decode and prefill "p50" are the slower rep, while TTFT p50 is the smaller (faster) TTFT and TTFT p95 the larger.

### 10k depth

| metric | RedHat · Sly 1.8.1 · no spec | RedHat · Sly 1.8.1 · MTP k=4 (own head) | RedHat · Sly 1.8.1 · DFlash2 k=7 (drafter) | Heretic · Sly 1.8.1 · DFlash2 k=7 (drafter) | RedHat · radiance 0.9.3 · no spec |
|---|---:|---:|---:|---:|---:|
| prompt tokens | 10154 | 10157 | 10157 | 10158 | 10159 |
| prefill tok/s (p50) | 3235.7 | 3141.5 | 3234.6 | 3300.1 | 1439.2 |
| decode tok/s per stream (p50) | 18.03 | 73.07 | 122.27 | 92.74 | 4.93 |
| aggregate tok/s | 15.09 | 38.87 | 50.48 | 46.7 | 4.36 |
| TTFT p50 (s) | 3.1002 | 3.2189 | 3.1335 | 3.0642 | 6.8292 |
| TTFT p95 (s) | 3.1391 | 3.2335 | 3.1402 | 3.0781 | 7.0589 |
| peak VRAM (MiB) | 31079 | 31035 | 31069 | 31272 | 29175 |
| peak GTT (MiB) | 73 | 49 | 51 | 58 | 66 |
| spec acceptance rate | n/a | 0.7332 | 0.5494 | 0.3974 | n/a |
| spec mean accept length | n/a | 3.933 | 4.845 | 3.782 | n/a |
| errors (n_err) | 0 | 0 | 0 | 0 | 0 |

### 50k depth

| metric | RedHat · Sly 1.8.1 · no spec | RedHat · Sly 1.8.1 · MTP k=4 (own head) | RedHat · Sly 1.8.1 · DFlash2 k=7 (drafter) | Heretic · Sly 1.8.1 · DFlash2 k=7 (drafter) | RedHat · radiance 0.9.3 · no spec |
|---|---:|---:|---:|---:|---:|
| prompt tokens | 49328 | 49325 | 49327 | 49325 | 49325 |
| prefill tok/s (p50) | 2631.4 | 2662.8 | 2767.0 | 2820.1 | 1330.7 |
| decode tok/s per stream (p50) | 18.23 | 68.55 | 84.76 | 79.01 | 4.87 |
| aggregate tok/s | 8.03 | 11.54 | 12.44 | 12.53 | 2.87 |
| TTFT p50 (s) | 18.025 | 18.4397 | 17.7425 | 17.355 | 36.7724 |
| TTFT p95 (s) | 18.7462 | 18.5237 | 17.8266 | 17.4911 | 37.0661 |
| peak VRAM (MiB) | 31055 | 31035 | 31069 | 31281 | 30743 |
| peak GTT (MiB) | 84 | 51 | 51 | 60 | 70 |
| spec acceptance rate | n/a | 0.6596 | 0.3671 | 0.3172 | n/a |
| spec mean accept length | n/a | 3.638 | 3.569 | 3.22 | n/a |
| errors (n_err) | 0 | 0 | 0 | 0 | 0 |

### 100k depth

| metric | RedHat · Sly 1.8.1 · no spec | RedHat · Sly 1.8.1 · MTP k=4 (own head) | RedHat · Sly 1.8.1 · DFlash2 k=7 (drafter) | Heretic · Sly 1.8.1 · DFlash2 k=7 (drafter) | RedHat · radiance 0.9.3 · no spec |
|---|---:|---:|---:|---:|---:|
| prompt tokens | 97951 | 97953 | 97953 | 97951 | 97952 |
| prefill tok/s (p50) | 2347.5 | 2283.5 | 2391.7 | 2429.6 | 1189.8 |
| decode tok/s per stream (p50) | 18.87 | 68.85 | 87.36 | 85.35 | 4.81 |
| aggregate tok/s | 4.65 | 5.52 | 5.87 | 5.93 | 1.89 |
| TTFT p50 (s) | 41.3685 | 42.724 | 40.752 | 40.1243 | 82.2765 |
| TTFT p95 (s) | 41.7253 | 42.8962 | 40.9539 | 40.3164 | 82.3271 |
| peak VRAM (MiB) | 30760 | 31035 | 31069 | 31271 | 30743 |
| peak GTT (MiB) | 51 | 51 | 51 | 62 | 66 |
| spec acceptance rate | n/a | 0.7 | 0.4231 | 0.3606 | n/a |
| spec mean accept length | n/a | 3.8 | 3.962 | 3.524 | n/a |
| errors (n_err) | 0 | 0 | 0 | 0 | 0 |

### Sly 1.9.1 rerun - RedHat on Sly 1.8.1 vs Sly 1.9.1, side by side

Same probes, prompts, ctx, KV, reps and engine layer as the tables above; only the image differs (the `sly-redhat` profile moved to Sly 1.9.1 on 2026-10-30). The 1.8.1 columns repeat the values above. The 1.9.1 columns are new: run 2026-10-30 19:32-19:59 local, run dirs `bench/runs/2026-10-30-vllm-redhat-sly191{,-mtp,-dflash}-depth/`, all values **MEASURED** and copied verbatim from their `results.jsonl`. **δ 0.5** = `RADIANCE_CACTUS_DELTA=0.5` with no fade and no cap (1.8.1). **δ 0.5 + fade/cap** = δ 0.5 that falls to 0 between 4,096 and 16,384 output tokens, plus cap R 0.5 (1.9.1 code defaults). With 256 output tokens per probe, the fade never starts, so δ is 0.5 for the whole probe on both images and only the cap differs. The no-spec columns have no Cactus label because Cactus only acts on speculative tokens. Chat template: v22.5 (1.8.1) vs v22.5-sly2 (1.9.1). They differ only in how older assistant turns are rendered, and these single-turn prompts have none; the prompt token counts match within 5.

#### 10k depth (1.8.1 vs 1.9.1)

| metric | RedHat · Sly 1.8.1 · no spec | RedHat · Sly 1.9.1 · no spec | RedHat · Sly 1.8.1 (δ 0.5) · MTP k=4 (own head) | RedHat · Sly 1.9.1 (δ 0.5 + fade/cap) · MTP k=4 (own head) | RedHat · Sly 1.8.1 (δ 0.5) · DFlash2 k=7 (drafter) | RedHat · Sly 1.9.1 (δ 0.5 + fade/cap) · DFlash2 k=7 (drafter) |
|---|---:|---:|---:|---:|---:|---:|
| prompt tokens | 10154 | 10157 | 10157 | 10157 | 10157 | 10157 |
| prefill tok/s (p50) | 3235.7 | 2967.3 | 3141.5 | 3301.2 | 3234.6 | 3404.9 |
| decode tok/s per stream (p50) | 18.03 | 18.97 | 73.07 | 67.25 | 122.27 | 122.72 |
| aggregate tok/s | 15.09 | 15.41 | 38.87 | 38.09 | 50.48 | 52.05 |
| TTFT p50 (s) | 3.1002 | 2.9689 | 3.2189 | 3.0559 | 3.1335 | 2.9566 |
| TTFT p95 (s) | 3.1391 | 3.423 | 3.2335 | 3.0771 | 3.1402 | 2.9831 |
| peak VRAM (MiB) | 31079 | 30991 | 31035 | 30867 | 31069 | 31085 |
| peak GTT (MiB) | 73 | 230 | 49 | 337 | 51 | 337 |
| spec acceptance rate | n/a | n/a | 0.7332 | 0.6701 | 0.5494 | 0.5367 |
| spec mean accept length | n/a | n/a | 3.933 | 3.681 | 4.845 | 4.757 |
| spec drafts / draft tokens / accepted | n/a | n/a | 134 / 536 / 393 | 144 / 576 / 386 | 110 / 770 / 423 | 111 / 777 / 417 |
| errors (n_err) | 0 | 0 | 0 | 0 | 0 | 0 |

#### 50k depth (1.8.1 vs 1.9.1)

| metric | RedHat · Sly 1.8.1 · no spec | RedHat · Sly 1.9.1 · no spec | RedHat · Sly 1.8.1 (δ 0.5) · MTP k=4 (own head) | RedHat · Sly 1.9.1 (δ 0.5 + fade/cap) · MTP k=4 (own head) | RedHat · Sly 1.8.1 (δ 0.5) · DFlash2 k=7 (drafter) | RedHat · Sly 1.9.1 (δ 0.5 + fade/cap) · DFlash2 k=7 (drafter) |
|---|---:|---:|---:|---:|---:|---:|
| prompt tokens | 49328 | 49323 | 49325 | 49327 | 49327 | 49327 |
| prefill tok/s (p50) | 2631.4 | 2800.9 | 2662.8 | 2745.1 | 2767.0 | 2856.3 |
| decode tok/s per stream (p50) | 18.23 | 19.43 | 68.55 | 70.02 | 84.76 | 86.34 |
| aggregate tok/s | 8.03 | 8.35 | 11.54 | 11.88 | 12.44 | 12.87 |
| TTFT p50 (s) | 18.025 | 17.5746 | 18.4397 | 17.8905 | 17.7425 | 17.2257 |
| TTFT p95 (s) | 18.7462 | 17.6099 | 18.5237 | 17.9681 | 17.8266 | 17.2694 |
| peak VRAM (MiB) | 31055 | 30991 | 31035 | 30867 | 31069 | 31085 |
| peak GTT (MiB) | 84 | 230 | 51 | 337 | 51 | 337 |
| spec acceptance rate | n/a | n/a | 0.6596 | 0.688 | 0.3671 | 0.3921 |
| spec mean accept length | n/a | n/a | 3.638 | 3.752 | 3.569 | 3.745 |
| spec drafts / draft tokens / accepted | n/a | n/a | 141 / 564 / 372 | 137 / 548 / 377 | 144 / 1008 / 370 | 137 / 959 / 376 |
| errors (n_err) | 0 | 0 | 0 | 0 | 0 | 0 |

#### 100k depth (1.8.1 vs 1.9.1)

| metric | RedHat · Sly 1.8.1 · no spec | RedHat · Sly 1.9.1 · no spec | RedHat · Sly 1.8.1 (δ 0.5) · MTP k=4 (own head) | RedHat · Sly 1.9.1 (δ 0.5 + fade/cap) · MTP k=4 (own head) | RedHat · Sly 1.8.1 (δ 0.5) · DFlash2 k=7 (drafter) | RedHat · Sly 1.9.1 (δ 0.5 + fade/cap) · DFlash2 k=7 (drafter) |
|---|---:|---:|---:|---:|---:|---:|
| prompt tokens | 97951 | 97951 | 97953 | 97952 | 97953 | 97952 |
| prefill tok/s (p50) | 2347.5 | 2425.2 | 2283.5 | 2335.9 | 2391.7 | 2461.5 |
| decode tok/s per stream (p50) | 18.87 | 19.01 | 68.85 | 69.07 | 87.36 | 86.24 |
| aggregate tok/s | 4.65 | 4.76 | 5.52 | 5.62 | 5.87 | 6.0 |
| TTFT p50 (s) | 41.3685 | 40.3498 | 42.724 | 41.775 | 40.752 | 39.6936 |
| TTFT p95 (s) | 41.7253 | 40.3884 | 42.8962 | 41.9333 | 40.9539 | 39.7944 |
| peak VRAM (MiB) | 30760 | 30991 | 31035 | 30867 | 31069 | 31085 |
| peak GTT (MiB) | 51 | 230 | 51 | 337 | 51 | 337 |
| spec acceptance rate | n/a | n/a | 0.7 | 0.6643 | 0.4231 | 0.3844 |
| spec mean accept length | n/a | n/a | 3.8 | 3.657 | 3.962 | 3.691 |
| spec drafts / draft tokens / accepted | n/a | n/a | 135 / 540 / 378 | 140 / 560 / 372 | 131 / 917 / 388 | 139 / 973 / 374 |
| errors (n_err) | 0 | 0 | 0 | 0 | 0 | 0 |

#### 1.9.1 / 1.8.1 (INFERRED, computed from the MEASURED cells above and the per-rep rows in the Data check)

| RedHat · method · metric (Sly 1.9.1 δ 0.5 + fade/cap vs Sly 1.8.1 δ 0.5) | 10k | 50k | 100k |
|---|---:|---:|---:|
| no spec · decode p50 (slower rep), ratio | 1.05 | 1.07 | 1.01 |
| no spec · decode mean of 2 reps, ratio | 1.03 | 1.03 | 1.01 |
| no spec · prefill p50 (slower rep), ratio | 0.92 | 1.06 | 1.03 |
| MTP k=4 · decode p50 (slower rep), ratio | 0.92 | 1.02 | 1.00 |
| MTP k=4 · decode mean of 2 reps, ratio | 0.92 | 1.02 | 0.96 |
| MTP k=4 · prefill p50 (slower rep), ratio | 1.05 | 1.03 | 1.02 |
| MTP k=4 · acceptance rate, 1.9.1 minus 1.8.1 | -0.0631 | +0.0284 | -0.0357 |
| DFlash2 k=7 · decode p50 (slower rep), ratio | 1.00 | 1.02 | 0.99 |
| DFlash2 k=7 · decode mean of 2 reps, ratio | 0.99 | 1.06 | 0.94 |
| DFlash2 k=7 · prefill p50 (slower rep), ratio | 1.05 | 1.03 | 1.03 |
| DFlash2 k=7 · acceptance rate, 1.9.1 minus 1.8.1 | -0.0127 | +0.0250 | -0.0387 |

Reading (INFERRED): the decode ratios scatter around 1.00 in both directions and stay inside the rep-to-rep spread (Data check), so the image change shows no decode effect at this n. Prefill is consistently a little faster on 1.9.1 at 50k/100k (all 6 cells, +2 to +6 %), which is larger than the rep spread of prefill at those depths (the two reps differ by ≤ 1.0 % in 11 of the 12 pairs at 50k/100k; the exception is RedHat · Sly 1.8.1 · no spec 50k, 4.0 %). The one slower cell, RedHat · Sly 1.9.1 · no spec 10k (0.92), is a rep outlier: its two reps are 2967.3 and 3421.5 tok/s (15 % apart; the other is faster than both 1.8.1 reps). Peak GTT is higher on 1.9.1 (230-337 MiB vs 49-84 MiB, MEASURED); it is still small and its cause was not investigated.

Common setup: single stream (conc 1), cold prefill (`prefix_mode=unique`), `api=chat`, `max_tokens=256`, 2 reps, fp8 KV, ctx 110000 (`--max-model-len`), `max-num-seqs 1`. Peak VRAM / GTT = `vram_sampler` peak over each probe (iron rule 7: sampled, not calculated). Prompts = `codereview-{10000,50000,100000}.txt` (actual token counts in the first row; 1 warm-up on the 10k shape of each campaign).

| config | profile | image | Cactus (acts on speculative tokens only) | chat template · template kwargs · presence_penalty | run dir (time, local) |
|---|---|---|---|---|---|
| RedHat · Sly 1.8.1 · no spec | `sly-redhat/redhat-mxfp4` | `ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1` @ `sha256:9b918ac0…` | n/a (no spec; `RADIANCE_CACTUS_DELTA=0.5` set) | image `/opt/qwen-fixed.jinja` = `qwen3.8-froggeric-v22.5` · `enable_thinking: true` · 0.0 | `bench/runs/2026-10-30-vllm-redhat-sly-depth/` (probes 08:14-08:16) |
| RedHat · Sly 1.8.1 · MTP k=4 (own head) | `sly-redhat/redhat-mxfp4-mtp` | same 1.8.1 | δ 0.5, no fade, no cap | same as above | `bench/runs/2026-10-30-vllm-redhat-sly-mtp-depth/` (08:37-08:38) |
| RedHat · Sly 1.8.1 · DFlash2 k=7 (drafter) | `sly-redhat/redhat-mxfp4-dflash` | same 1.8.1 | δ 0.5, no fade, no cap | same as above | `bench/runs/2026-10-30-vllm-redhat-sly-dflash-depth/` (08:44-08:45) |
| Heretic · Sly 1.8.1 · DFlash2 k=7 (drafter) | `sly-official/heretic-mxfp4` (existing) | same 1.8.1 | δ 0.5, no fade, no cap | same as above | `bench/runs/2026-10-30-vllm-heretic-sly-depth/` (08:06-08:07) |
| RedHat · Sly 1.9.1 · no spec | `sly-redhat/redhat-mxfp4` | `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` @ `sha256:9744caf31e96…abc8` (vLLM 0.32.0) | n/a (no spec; `RADIANCE_CACTUS_DELTA=0.5` set) | image `/opt/qwen-fixed.jinja` = `qwen3.8-froggeric-v22.5-sly2` · `enable_thinking: true` · 0.0 | `bench/runs/2026-10-30-vllm-redhat-sly191-depth/` (probes 19:38-19:40) |
| RedHat · Sly 1.9.1 · MTP k=4 (own head) | `sly-redhat/redhat-mxfp4-mtp` | same 1.9.1 | δ 0.5 + fade 4096→16384 output tokens + cap R 0.5 (code defaults; fade inactive within 256 tokens) | same as above (1.9.1) | `bench/runs/2026-10-30-vllm-redhat-sly191-mtp-depth/` (19:48-19:49) |
| RedHat · Sly 1.9.1 · DFlash2 k=7 (drafter) | `sly-redhat/redhat-mxfp4-dflash` | same 1.9.1 | δ 0.5 + fade 4096→16384 output tokens + cap R 0.5 (code defaults; fade inactive within 256 tokens) | same as above (1.9.1) | `bench/runs/2026-10-30-vllm-redhat-sly191-dflash-depth/` (19:57-19:58) |
| RedHat · radiance 0.9.3 · no spec | `radiance/redhat-mxfp4` | `stilldeadcode/vllm-radiance:0.9.3` | n/a (no spec, no Cactus) | mounted `bench/engine-bench/vllm/templates/qwen-fixed-sly-1.6.0.jinja` · `reasoning_effort: medium` · 0.1 | `bench/runs/2026-10-30-vllm-redhat-radiance-depth/` (07:50-07:55) |

Template, kwargs and presence_penalty come from the profiles: the Sly rows from the `sly-official/_engine.env` engine layer, confirmed by the 1.9.1 DFlash2 server's logged args (`bench/.servers/8000.log`, overwritten by later boots), and the radiance row from `radiance/_engine.env`, unchanged since 2026-10-23. The radiance row therefore differs from the Sly rows in template, thinking control and presence penalty, not only in engine. The earlier "same sampling/template/parsers" in the investigation section below was wrong and is corrected there. For the 1.9.1 rows, `gen_campaign.py` had no image field when they ran (added afterwards: optional spec `"image"`, and run.sh now saves each server's resolved config to `server-<name>.txt`), so the image is the `sly-redhat` profile default; it is logged on each server's start line in `bench/runs/2026-10-30-sly191-depth-reruns.log` (`up after 337 / 388 / 368 s`, vLLM 0.32.0).

The three RedHat-on-Sly profiles were moved from `sly-official/` to `sly-redhat/` after these runs (2026-10-30; same files, `sly-redhat/_engine.env` sources `sly-official/_engine.env`, `serve_vllm.sh print` output identical). The run dirs' `meta.txt` still record the old `sly-official/redhat-mxfp4*` path.

Model: `RedHatAI/Qwen3.8-27B-MXFP4` @ `16a86728c6e2a5023e7dd5e68100ceff24abe5d7` (compressed-tensors `mxfp4-pack-quantized`, 19 GB). Drafter: `syvai/Qwen3.8-27B-DFlash2-W4A16` @ `4d30ec73`. Heretic: `slybase/Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ` @ `3bb379dc`.
Campaigns are in `campaigns/2026-10-30-vllm-{redhat-sly,redhat-radiance,heretic-sly,redhat-sly-mtp,redhat-sly-dflash}-depth/` and, for the Sly 1.9.1 rerun, `campaigns/2026-10-30-vllm-{redhat-sly191,redhat-sly191-mtp,redhat-sly191-dflash}-depth/`. Both sets go spec.json -> `gen_campaign.py emit` -> `run.sh`. The 1.9.1 specs are the 1.8.1 specs with new slugs and titles plus a note; probes, ctx, reps and warm-ups are identical (diffed).

## How MTP and DFlash2 were enabled (investigation)

Sources: the checkpoint's own files in `/mnt/Lin1/work/vllm/sly-radiance/models/RedHatAI__Qwen3.8-27B-MXFP4@16a86728/` and the existing repo profiles; **no web research was done** for this step.

- **Checkpoint format (MEASURED from `config.json`):** `quant_method: compressed-tensors`, `format: mxfp4-pack-quantized`, `Qwen3_5ForConditionalGeneration`. Same loader family as the heretic GPTQ-MXFP4 checkpoint, which the Sly profiles load with no `--quantization` flag; the new profiles do the same.
- **MTP head present (MEASURED):** `mtp_num_hidden_layers = 1`; 15 `mtp.*` tensors, all indexed to `model_mtp.safetensors` in `model.safetensors.index.json`; the head is BF16. Its quantization `ignore` list holds the regex `re:^mtp.*`.
- **Why no config overlay was needed (INFERRED):** the AMD Quark checkpoint needed `overlays/qwen38-mxfp4-mtp-config` because its exclude list had `mtp.*.weight` entries that vLLM's layer-name matching misses (load-time shape assert, 2026-10-23). This checkpoint excludes the head by regex on the layer name instead; the MTP server loaded and generated correctly (acceptance table above), which is consistent with that reading.
- **MTP spec config:** copied from `sly-radiance/qwen38-mxfp4-mtp.env` (Sly `serve.sh` SPEC_METHOD=mtp, "measured default 4"): `{"method":"mtp","num_speculative_tokens":4,"attention_backend":"R4D","disable_padded_drafter_batch":true}` as JSON (a dotted `...=true` reaches vLLM as a string). The sly-official engine layer already sets `--no-async-scheduling`.
- **DFlash2 spec config:** copied verbatim from `heretic-mxfp4.env`: `--speculative-config.method dflash`, drafter mounted at `/draft`, `num_speculative_tokens 7`, `draft_sample_method probabilistic`, `attention_backend TRITON_ATTN`. The drafter targets the Qwen3.8-27B base; this checkpoint is the same base re-quantized, and it worked without changes (acceptance rates above).
- **Kept identical to the heretic run so the comparison is fair:** engine layer `sly-official/_engine.env` (also used by `sly-redhat/`; Cactus delta 0.5, util 0.93, `FULL_DECODE_ONLY` graphs `[8,16,...,64]`, `R4D_HYBRID`, `--max-num-batched-tokens 4096`), `WATCHDOG_MIB=32`.
- **vllm-radiance 0.9.3 profile:** engine layer `radiance/_engine.env` (R4D, eager, `--max-num-batched-tokens 16384`), same parsers but **not** the same template/sampling (corrected 2026-10-30 evening: mounted `qwen-fixed-sly-1.6.0.jinja`, `reasoning_effort: medium` instead of `enable_thinking: true`, presence_penalty 0.1 instead of 0.0 - see the config table), no speculation, **no** `RADIANCE_MXFP4_*` kernel env (those are Sly-patch switches; whether upstream radiance has equivalents is unverified).

## Experience log (what happened, in order)

1. **Downloads.** `fetch_model.sh RedHatAI/Qwen3.8-27B-MXFP4 <rev>` (pinned, 19 GB) and `docker pull stilldeadcode/vllm-radiance:0.9.3` (13.7 GB; the image was not present locally, only `stilldeadcode/radiance`, which is the native `.rad` runtime and not the vLLM fork). Docker data-root is `/mnt/Lin1/work/docker`.
2. **Three campaigns in one chain** (RedHat/Sly, RedHat/radiance, heretic/Sly), launched with the default boot watchdog.
3. **Incident 1 - boot watchdog kill (RedHat/Sly, first attempt).** The container was killed during boot with `WATCHDOG killed vllm-8000: VRAM nearly full during boot (free_mib=71 utc=06:45:37.444, floor 256 MiB)`, right after the log line `lm_head quantised to int4`. This is the known Sly 1.8.1 transient dip (`docs/vllm/known-issues.md`); the stable launcher `claude-sly-heretic.sh` already runs `WATCHDOG_MIB=32`. Rerun with `WATCHDOG_MIB=32` passed. The heretic boot in the same chain passed at the default 256, so the dip is not deterministic across checkpoints (cause not investigated). The first-attempt line `SERVER-FAILED ... redhat-sly-fp8kv-ctx110000` is still in `bench/runs/2026-10-30-vllm-redhat-sly-depth/failures.txt`; ignore it, all three probes of that run have rows.
4. **Result of the baselines.** Heretic · Sly · DFlash2 and RedHat · Sly · no spec ran clean; radiance 0.9.3 booted and served but at ~4.9 tok/s decode (see table). Why it is slow was **not** investigated (INFERRED: Sly's MXFP4 kernel switches are not present upstream so the checkpoint runs a generic path).
5. **Incident 2 - served-name 404 (MTP and DFlash, first attempt).** Every probe returned `HTTP Error 404`. The server log said ``The model `qwen38-27b-redhat-mxfp4-mtp` does not exist. Valid aliases: qwen38-27b-redhat-mxfp4-sly``. Cause: my new profiles `source` the base profile first, and the base file sets `SERVED_NAME=${SERVED_NAME:-...}`, so the first definition wins (the same trap the heretic profile avoids by setting it before `source`). Fix: set `SERVED_NAME` before `source` in both profiles (checked with `serve_vllm.sh print`). The failed runs were moved to quarantine, not graded or deleted (iron rule 18); the MTP head had loaded fine in that attempt.
6. **Incident 3 - self-kill.** Stopping the DFlash chain with `pkill -f "campaigns/...run.sh"` matched my own shell's command line and terminated it (exit 144) - the exact trap iron rule 14 describes (stop by pidfile/container, never a `pgrep -f` pattern). No data was affected: the chain and container were already gone. Lesson: stop with `serve_vllm.sh stop` / the `bench/.servers/<port>.pid`.
7. **Reruns.** Both speculative campaigns reran clean with `WATCHDOG_MIB=32`; boot to "Application startup complete" took ~5 min the first time (container log 07:26:39 -> 07:31:48 for the first MTP boot, mostly kernel compile; caches are per image tag).
8. **Verification.** The tables were checked cell by cell against the raw `results.jsonl` and against the earlier per-config and merged versions of this document; the RedHat · Sly · no spec and RedHat · Sly · MTP columns were additionally checked at the request level (see Data check).
9. **Sly 1.9.1 rerun (2026-10-30, 19:32-19:59 local).** The `sly-redhat` profile was moved to Sly 1.9.1 the same day (`profiles/sly-redhat/_engine.env`; the 1.8.1 rollback line is kept there), so the three RedHat-on-Sly campaigns were re-emitted with `sly191` slugs. They ran in one sequential chain with `WATCHDOG_MIB=32`; the log is `bench/runs/2026-10-30-sly191-depth-reruns.log`. All three servers came up on the first attempt (337 / 388 / 368 s). There were no `SERVER-FAILED` lines, no `failures.txt` entries and no request errors. After the chain, port 8000 was free and VRAM was back to 483 MiB used (the desktop). The 1.9.1 Cactus constants (`RADIANCE_CACTUS_FADE_START` 4096, `FADE_END` 16384, `CAP_R` 0.5) and the cap formula were read from the running container's `vllm/v1/worker/gpu/spec_decode/rejection_sampler_utils.py`, which is the only file in the image that references Cactus; the container env had only `RADIANCE_CACTUS_DELTA=0.5`.

## Data check - are the RedHat · Sly no-spec and MTP numbers really measured?

Checked 2026-10-30 against the request-level rows of `results.jsonl` (not just the aggregates):

- **RedHat · Sly 1.8.1 · no spec** (`redhat-sly`): 6 request rows, all `error: None`, each generated 256 tokens, prompts 10154-10157 / 49324-49328 / 97951 tokens; **no `spec` rows** (no speculative decoding, as intended).
- **RedHat · Sly 1.8.1 · MTP k=4 (own head)** (`redhat-sly-mtp`): 6 request rows, all `error: None`, 256 tokens each, plus 3 `spec` rows from the server's own counters, which show MTP was active: e.g. 10k = 134 drafts, 536 draft tokens (134 x 4), 393 accepted (rate 0.7332; mean accept length 1 + 393/134 = 3.933); 50k = 141 drafts, 564, 372; 100k = 135 drafts, 540, 378.
- The MTP rows come from the **rerun** (run dirs `2026-10-30-0837/0838-engine-redhat-sly-mtp-*`, after the served-name fix), not from the quarantined failed attempt. The no-spec run's `meta.txt` date (07:42) is the start of the first, watchdog-killed attempt; its probe dirs are `0814-0816`.
- **Sly 1.9.1 rerun** (`redhat-sly191`, `-sly191-mtp`, `-sly191-dflash`; run dirs `2026-10-30-1938…1958-engine-redhat-sly191*`): 6 request rows per config, all `error: None`, 256 tokens each. The no-spec config has **no `spec` rows**. The two speculative configs have 3 `spec` rows each, and their draft-token counts are exact multiples of k: MTP 10k = 144 drafts, 576 draft tokens (144 x 4), 386 accepted; DFlash2 10k = 111 drafts, 777 (111 x 7), 417 accepted.
- **p50 of 2 reps = the lower rep** (decode and prefill, and TTFT p50 = smaller TTFT; TTFT p95 = larger), true for all 24 probes (15 + 9 of the 1.9.1 rerun, checked by script against the request rows). Per-rep decode tok/s (MEASURED, request rows); the table values above are the lower of each pair:

| config | 10k rep 0 | 10k rep 1 | 50k rep 0 | 50k rep 1 | 100k rep 0 | 100k rep 1 |
|---|---:|---:|---:|---:|---:|---:|
| RedHat · Sly 1.8.1 · no spec | 18.03 | 18.81 | 19.61 | 18.23 | 19.02 | 18.87 |
| RedHat · Sly 1.8.1 (δ 0.5) · MTP k=4 (own head) | 78.84 | 73.07 | 68.55 | 69.46 | 68.85 | 75.44 |
| RedHat · Sly 1.8.1 (δ 0.5) · DFlash2 k=7 (drafter) | 142.27 | 122.27 | 98.22 | 84.76 | 87.36 | 100.28 |
| Heretic · Sly 1.8.1 (δ 0.5) · DFlash2 k=7 (drafter) | 92.74 | 120.84 | 90.9 | 79.01 | 85.35 | 86.49 |
| RedHat · Sly 1.9.1 · no spec | 18.97 | 19.04 | 19.62 | 19.43 | 19.12 | 19.01 |
| RedHat · Sly 1.9.1 (δ 0.5 + fade/cap) · MTP k=4 (own head) | 72.36 | 67.25 | 71.11 | 70.02 | 69.07 | 69.17 |
| RedHat · Sly 1.9.1 (δ 0.5 + fade/cap) · DFlash2 k=7 (drafter) | 122.72 | 139.82 | 108.2 | 86.34 | 86.24 | 90.04 |
| RedHat · radiance 0.9.3 · no spec | 4.93 | 4.93 | 4.87 | 4.87 | 4.81 | 4.81 |

- Consequence (INFERRED): the decode numbers in the tables are conservative; the speculative configs vary a lot between the two reps (RedHat · Sly · DFlash2 10k: 142.27 vs 122.27; Heretic · Sly · DFlash2 10k: 92.74 vs 120.84), so n = 2 cannot resolve differences of that size. Ratios computed from the means of the reps would be larger for DFlash (e.g. RedHat · Sly · DFlash2 10k mean 132.27 vs RedHat · Sly · MTP 75.95) but the ordering no spec < MTP < DFlash2 (all RedHat · Sly 1.8.1) at every depth holds with either statistic (checked on the per-rep values above).
- The same limit applies to the 1.9.1 vs 1.8.1 comparison (INFERRED): the 1.9.1 DFlash2 reps are 122.72 vs 139.82 at 10k and 108.2 vs 86.34 at 50k, wider apart than any 1.8.1 → 1.9.1 difference in the p50 cells. The ordering no spec < MTP < DFlash2 also holds on 1.9.1 at every depth, with either statistic.

## Limits

- n = 2 reps per depth, single stream, `max_tokens` 256: a short perf probe, not a full campaign (no concurrency, no depth exponent fit - 3 depths is below the 4-point minimum of iron rule 16, so no decay exponent is quoted).
- **Quality was not measured.** Sly runs with Cactus delta 0.5 (lossy acceptance, `known-issues`: Sly issue #164 reports repetition locks on long outputs); speculative speed-ups here say nothing about output quality.
- Decode in the probe includes the model's thinking tokens (`api=chat`, reasoning on); acceptance of speculative tokens may differ for other workloads.
- Heretic is a different set of weights (and its numbers are a reference, not a controlled comparison with RedHat).
- Radiance results are for one image tag (0.9.3) with eager mode; the slowness cause is open. The radiance profile also uses a different template (`qwen-fixed-sly-1.6.0.jinja`), `reasoning_effort: medium` and presence_penalty 0.1 (config table), so it is not a pure engine comparison.
- **Sly 1.9.1 rerun:** the probes generate 256 tokens, so the 1.9.1 fade never starts (it begins at 4,096 output tokens). The sly2 template has nothing to drop in a single-turn prompt. Inside these probes, then, 1.9.1 differs from 1.8.1 only in the engine build (vLLM 0.32.0) and the Cactus cap. The rerun measures neither the fade nor long-output loops nor multi-turn token use; for those on a real Claude Code session, see `docs/analysis/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md`. Heretic was not rerun on 1.9.1 (`sly-official` stays on 1.8.1).

## Reproduce

```bash
bench/engine-bench/vllm/fetch_model.sh RedHatAI/Qwen3.8-27B-MXFP4 16a86728c6e2a5023e7dd5e68100ceff24abe5d7
docker pull stilldeadcode/vllm-radiance:0.9.3
docker pull ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1
# Sly 1.8.1 RedHat columns: the sly-redhat profile now defaults to 1.9.1, so pin the image (env IMAGE beats the profile)
IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 WATCHDOG_MIB=32 bash campaigns/2026-10-30-vllm-redhat-sly-mtp-depth/run.sh   # likewise -sly-dflash-, redhat-sly-
WATCHDOG_MIB=32 bash campaigns/2026-10-30-vllm-heretic-sly-depth/run.sh       # sly-official profile, still 1.8.1
# Sly 1.9.1 RedHat columns (profile default image)
WATCHDOG_MIB=32 bash campaigns/2026-10-30-vllm-redhat-sly191-depth/run.sh     # likewise -sly191-mtp-, -sly191-dflash-
bash campaigns/2026-10-30-vllm-redhat-radiance-depth/run.sh
# run.sh is resumable (done/ markers): remove a campaign's done/ to re-measure it
```
