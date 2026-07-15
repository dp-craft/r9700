<!-- meta
date: 2026-07-15 22:00
slug: hardest-tasks-27b-vs-35b
title: Hardest tasks at 128k — 27B quant ladder, reasoning budget, and 35B-A3B sampling (R9700)
takeaway: 14 cells x 5 tasks x 3 reps = 210 replies at ~132.9k tokens. Three axes, one clear answer each. QUANT: bounded null — Q4_K_M 78.3, Q4_K_XL 69.8, Q5_K_M 76.5, Q6_K 80.9 TS%, no paired delta significant, design resolves only >=12 pts; the accidental KV control (Q5_K_M f16 74.3 vs q8_0 76.5) bounds the README's KV confound as negligible. BUDGET: 4096 to 16384 buys +0.3 pts on the 27B (t=0.37, ns) for +60s; above ~4k the budget stops binding — 14 of 15 35B replies are IDENTICAL between 16384 and unlimited, and the one reply unlimited freed ran away to 31,093 think tokens and fell 77 to 45. Refutes our own sourced hypothesis that truncated thinking drives the wall. SAMPLING (35B): temp 0.6 (Qwen's coding recipe) is the best point at 77.5; temp 0.3 is 70.0 (delta -8.3 vs Q4_K_M, t=-4.11, SIGNIFICANT) and no steadier — "low temp = stable" is folklore, refuted. The two presence_penalty>0 vendor presets are the two worst cells (62.1 / 63.0) AND lose ~40% decode (78.1/72.6 vs 115.7-120.2 t/s) — pp appears to break MTP acceptance. STABLE: the wall is cleanliness (lint 0.36, types 0.47) not logic (tests 0.84, reuse 0.99); 35B is ~2.6-3.7x faster to a full answer; reruns pay (delta rerun +4.6..+17.5). GTT spill 1551-2841 MiB in ALL 14 cells. References are NOT depth-matched (~213x shallower) — no bare local-vs-reference delta is a capability gap.
-->

# Benchmark: Hardest tasks at 128k — 27B quant ladder, reasoning budget, and 35B-A3B sampling — R9700 (gfx1201)

- **Date:** 2026-07-15 22:00 · **Track:** campaign (quality capture + deterministic grading + blind judge)
- **GPU/Host:** AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB / 32624 MiB) · Ryzen 5 3600 · 31 GB RAM, no swap · Ubuntu 24.04 · kernel 6.17 · ROCm 7.x · `HSA_OVERRIDE_GFX_VERSION=12.0.1`
- **Runtimes/builds:** llama.cpp **Vulkan b9950** (`961e4b26a`) · `-ub 2048 -b 4096 -fa on` · **MTP on** · ctx **163840** · prefix cache (CLAIMED from `README.md` §2; build MEASURED from `out/props_*.json`)
- **Models:** Qwen3.6-27B-MTP at Q4_K_M / UD-Q4_K_XL / Q5_K_M / Q6_K · Qwen3.6-35B-A3B-UD-Q4_K_M
- **Scale:** **14 cells × 5 tasks × 3 reps = 210 graded replies**, every one at the identical ~132.9k-token prompt
- **Data:** `out/summary.md` (deterministic digest — every number below is read from it) · `calibration-reps.jsonl` (reference ladder, 3 reps) · `charts/`, `charts/detailed/`

---

## Summary — the five things that survived

**Three axes were tested: the 27B quant ladder, the reasoning budget (4096 / 16384 / unlimited), and the 35B-A3B's sampling. Each returned a usable answer, and two of them refute hypotheses this repo previously held on sourced grounds.**

1. **The quant ladder is a bounded null — and the KV confound is now bounded too.** Cell means run **Q4_K_M 78.3 → Q4_K_XL 69.8 → Q5_K_M 76.5 → Q6_K 80.9** TS% (MEASURED). Every 95% CI overlaps; **no paired-by-task Δ vs Q4_K_M is significant** (largest |t| = 1.98 against a 2.776 threshold). The design resolves only **≳12 pts**, so precision is neither proven useful nor useless. The non-monotonic shape — a dip at Q4_K_XL, a rise at Q6_K — is what noise looks like. **New:** the extension accidentally supplied the control `README` §2 asked for. `Q5_K_M` ran at **both** KV types at the same budget: **f16 74.3 vs q8_0 76.5**, CIs [67.9, 80.8] and [71.3, 81.7]. The KV confound the README flagged is smaller than the noise floor and does not rescue the ladder.

2. **The reasoning budget is a no-op above ~4k — and the "truncated thinking" hypothesis is dead.** Our own sourced research (`docs/research/2026-07-15-1000-*`, Finding 3) argued that `--reasoning-budget 4096` truncates thinking ~8× below Qwen's guidance and was "a strong candidate cause of both the lint/types wall and the run-to-run fluctuation". **It is not.** Quadrupling the budget on the 27B moved quality by **+0.3 pts** (paired Δ, t=0.37, ns; per-task −2, +0, +0, +1, +3) and cost **+60 s per reply** (156.9 → 216.7 s). The mechanism is visible in the per-rep tables: at 16384 the models *choose* to think **~3.6k–11.6k** tokens per reply (cell means 5.7k–9.2k) — the cap stops binding, so **14 of the 35B's 15 replies are identical between budget 16384 and unlimited**. The single reply that unlimited actually freed ran to **31,093 think tokens** and collapsed from **77 → 45**.

3. **Sampling is the one axis with a real, actionable signal — and it says "do what the vendor says".** On the 35B-A3B at budget 16384: **temp 0.6 → 77.5** (Qwen's precise-coding recipe), **temp 0.3 → 70.0**, **temp 1.0 → 68.4**, **Qwen "thinking general" preset (temp 1.0 / pp 1.5) → 62.1**, **Unsloth-only preset (temp 1.0 / top_p 1.0 / top_k 40 / min_p 0.0 / pp 2.0) → 63.0**. Two of these clear the digest's significance bar (see below), and both vendor presets carry a **presence_penalty > 0** — the two worst cells in the campaign. **Temp 0.3 was also no steadier than 0.6** (rep sd 11.2 vs 11.1): the "lower temperature stabilises output" folklore is refuted on its own terms.

4. **presence_penalty costs ~40% of decode throughput, not just quality.** The only two cells with `presence_penalty > 0` are the only two 35B cells below 80 decode tok/s: **78.1** (pp 1.5) and **72.6** (pp 2.0) against **115.7–120.2** for every pp = 0 cell (MEASURED). Perfect separation across seven cells. **INFERRED:** presence_penalty distorts the sampled distribution away from the MTP draft's predictions, so speculative tokens get rejected and the speedup collapses. Untested — and the highest-value cheap experiment left.

5. **The wall is cleanliness, not logic — and it is the same wall at every setting.** Fractional means across cells: **lint 0.36 · types 0.47** against **tests 0.84 · edge 0.87 · reuse 0.99** (MEASURED). No quant, no budget and no sampling point moves it. It binds the references too: **opus's** per-task lint runs **0.40–0.87** and opus hard-passes only **1 of 5** tasks.

⚠ **Two caveats bind everything below.** (1) **GTT spill of 1551–2841 MiB in all 14 cells** — a host-RAM spill on a 31 GB no-swap box, flagged by the digest's Health line as a freeze risk; **OPEN**. (2) The **reference ladder is not depth-matched**: haiku/sonnet/opus answered ~550–620-token one-shot prompts while every local cell answered at **~132.9k tokens (~213× deeper)**. "Best local 80.9 vs haiku 81.0" is **not** a like-for-like capability gap — it names two different questions.

---

## What is stable vs what is not

The single most useful table in this report. "Stable" = survives the digest's own significance/resolution rules, or is far larger than the noise floor.

| Claim | Status | Evidence (MEASURED) |
|---|---|---|
| The wall is cleanliness, not logic | **STABLE** | lint 0.36 · types 0.47 vs tests 0.84 · edge 0.87 · reuse 0.99; holds in all 14 cells and in the references |
| 35B-A3B is far faster | **STABLE** | decode 115.7–120.2 vs 32.6–46.1 t/s; full answer 60.9 s (a3b rb4096) vs 212.6 s (Q6_K) — orders above noise |
| `presence_penalty > 0` costs decode throughput | **STABLE** (mechanism INFERRED) | 78.1 / 72.6 t/s vs 115.7–120.2; perfect separation, 7 cells |
| Budget > 4096 does not pay on the 27B | **STABLE** | paired Δ +0.3, t=0.37, ns, **sd 1.8** — a tight null, not an underpowered one |
| Unlimited budget is harmful | **STABLE** | 14/15 replies identical to rb16384; the one freed reply ran to 31,093 tok and fell 77→45; runaway 7% |
| Reruns pay | **STABLE** | Δ rerun +4.6 … +17.5 pts across all cells; hard@R 20% vs hard@1 7% |
| GTT spill | **STABLE** (MEASURED) | 1551–2841 MiB, all 14 cells |
| Per-rep determinism at a fixed seed | **STABLE** | replies are identical across cells wherever the budget did not bind |
| Q5_K_M at f16 KV / ctx 163840 fits | **STABLE** (MEASURED) | peak VRAM **31918** MiB of 32624; 0 failures |
| Temp 0.6 beats temp 0.3 on the 35B | **SIGNIFICANT vs the Q4_K_M baseline only** | t03 meanΔ −8.3, t=−4.11 vs Q4_K_M; no direct t03-vs-t06 test is printed |
| Qwen "thinking general" preset is worse | **SIGNIFICANT vs the Q4_K_M baseline only** | qwen-gen meanΔ −16.2, t=−3.08 vs Q4_K_M |
| **The quant ladder** | **NOT RESOLVABLE** | all paired Δ ns (\|t\| ≤ 1.98 < 2.776); all CIs overlap; resolution ≳12 pts |
| **27B vs 35B-A3B quality** | **NOT RESOLVABLE** | paired Δ −5.1, t=−1.70, ns |
| **KV f16 vs q8_0** | **NOT RESOLVABLE** (and bounded small) | Q5_K_M 74.3 (f16) vs 76.5 (q8_0); no test printed; CIs overlap |
| Budget 4096→16384 on the **35B** | **NOT RESOLVABLE** | 73.3 → 77.5 raw; no direct test printed |
| More budget steadies the 35B | **NOT RESOLVABLE** | rep sd 15.7 → 11.1 → 12.6; sd from 3 reps is itself noisy; no test |
| The judge separates the cells | **NOT RESOLVABLE** | 2.7–3.6 band on 0–5; no significance test run |
| The Unsloth-only preset is worse | **NOT SIGNIFICANT** | meanΔ −15.3 but t=−2.10 < 2.776 — large and unresolved |

> **Every comparison the digest marks SIGNIFICANT is listed above — there are exactly two, and both are sampling cells measured against the Q4_K_M baseline.** Everything else in this campaign is *not* significant. Where a Δ is large but not significant (Unsloth preset −15.3; Q4_K_XL −8.5) that means **unresolved**, not "no effect".

---

## Legend — every knob and label, defined once

Short definitions, in place. Skip if these are familiar.

| Term | What it is | What it does here |
|------|------------|-------------------|
| **quantisation** (`Q4_K_M`, `Q5_K_M`, `Q6_K`) | storing model weights at reduced bit-depth (~4.8 / ~5.7 / ~6.6 bits per weight) to fit VRAM; higher = more faithful, bigger, slower | the primary axis: 16.1 / 18.5 / 21.3 GiB of weights, 46.1 → 32.6 decode t/s |
| **`UD-Q4_K_XL`** ("UD" = Unsloth **Dynamic**) | a mixed-precision recipe: Unsloth keeps sensitive tensors at higher precision instead of quantising every tensor uniformly | 16.7 GiB — scored *lowest* of the ladder (69.8), but not significantly |
| **MoE vs dense** | the 35B-A3B is a **M**ixture-**o**f-**E**xperts: 35B total parameters but only **~3B active** per token, so it decodes like a small model and stores like a big one | 21.1 GiB of weights, **~120 t/s** vs the dense 27B's ~43–46 |
| **KV cache `f16` vs `q8_0`** | the per-token attention key/value memory, at 16-bit vs 8-bit block-quantised. Halving it buys context; it may cost fidelity | the 27B is hybrid-attention (16 of 65 blocks carry KV): f16 = 64 KiB/tok, q8_0 = 34. **Measured here as a null** |
| **MTP** (multi-token prediction) | speculative decoding using a draft layer embedded in the GGUF: the draft proposes several tokens, the model verifies them in one pass. Accepted tokens are nearly free speed | on in every cell; the 35B's ~120 t/s depends on it — and `presence_penalty` appears to break it |
| **reasoning budget** (`--reasoning-budget N`) | a hard cap on *thinking* tokens before the answer. At the cap, llama.cpp force-closes the thinking block and the model must answer mid-reasoning | axis 2: 4096 / 16384 / −1 (unlimited). A think count of 4093–4095 = forced stop; anything lower = the model stopped on its own |
| **temperature** | flattens (high) or sharpens (low) the sampling distribution. High = more diverse; low = more repetitive/greedy | axis 3: 0.3 / 0.6 / 1.0 on the 35B. Qwen documents **0.6** for precise coding |
| **top_p / top_k / min_p** | truncation filters: keep the smallest set of tokens whose probability sums to `top_p` / the `top_k` most likely / anything above `min_p` of the peak | pinned at Qwen's coding recipe (0.95 / 20 / 0) except in the vendor-preset cells. ⚠ llama.cpp's own default is `min_p=0.05`, so 0 must be sent explicitly |
| **presence_penalty** | subtracts a fixed amount from the logit of any token that already appeared, to break repetition loops | Qwen sets it to **0.0** for coding and 1.5 for general thinking. The two cells with pp > 0 are this campaign's two worst |
| **prefill vs decode** | prefill = ingesting the prompt (parallel, compute-bound); decode = emitting tokens one at a time (serial, memory-bandwidth-bound) | at ~132.9k tokens prefill dominates time-to-first-answer (ttfa 47.7–197.3 s); decode sets the rest |
| **GTT spill** | Graphics Translation Table — GPU-addressable *host* RAM. Traffic here means the working set left VRAM and is crossing PCIe | 1551–2841 MiB in every cell on a 31 GB no-swap host — freeze risk |
| **`TS %`** | the deterministic TypeScript score: a weighted blend of the objectives below, per reply | the headline quality number, averaged over 5 tasks × 3 reps = 15 |
| **`hard_pass`** vs **partial score** | `hard_pass` = *every* gate objective strictly 1.0 (a binary "would you merge it"). Partial score = weighted credit | brutally different questions: one reply scoring **94 hard-passed** while its **95**-scoring sibling did not |
| **`lint` / `types`** (fractional) | `1 − min(1, errors/K)` (K=5 / K=3) — error-count based, not binary. 1 lint error = 0.80 | add-on A of this campaign — it is what makes "the wall" visible |
| **`tests` / `edge` / `reuse`** | vitest pass fraction / edge-case coverage / reuses the provided abstractions | 0.84 / 0.87 / 0.99 — the logic is largely right |
| **`tier`** | **a difficulty class, NOT a score band** — the weakest *reference* tier that produces a strictly-clean hard_pass | 2 of 5 labels confirmed, 2 contradicted, 1 a ceiling. See Tier semantics |
| **rep sd** | mean within-(cell,task) standard deviation — how much the same cell swings on the same prompt | **9.8 pts** overall; per-cell 4.8 → 16.3 |
| **best-of-N / `hard@R`** | take the best of R reps per task. `hard@R` = share of tasks where *any* rep is strictly clean | a real strategy, not an oracle: tsc/eslint/vitest pick the winner without a human |
| **paired t-test** | compares two cells task-by-task, cancelling task difficulty — the right test when tasks differ more than cells do | n=5 tasks → threshold \|t\| > 2.776 |

---

## Results — all 14 cells

All rows MEASURED from `out/summary.md`. n = 15 per cell (5 tasks × 3 reps). **Row order is not a ranking.**

| cell | model | KV | budget | temp/pp | TS % | 95% CI | rep sd | hard % | judge/5 | think tok | full s | decode t/s | peak VRAM | peak GTT |
|---|---|---|---:|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `un-d128-f16-rb4096` | 27B Q4_K_M | f16 | 4096 | 0.6 / 0 | **78.3** | [71.7, 85.0] | 4.9 | 0 | 3.6 | 4095 | 156.9 | 46.1 | 29809 | 1825 |
| `xl-d128-f16-rb4096` | 27B UD-Q4_K_XL | f16 | 4096 | 0.6 / 0 | **69.8** | [60.7, 78.9] | 7.6 | 0 | 3.2 | 3990 | 156.7 | 45.4 | 30536 | 1902 |
| `q5-d128-q8-rb4096` | 27B Q5_K_M | q8_0 | 4096 | 0.6 / 0 | **76.5** | [71.3, 81.7] | 7.6 | 0 | 3.4 | 3492 | 189.3 | 35.4 | 27466 | 1776 |
| `q5-d128-f16-rb4096` | 27B Q5_K_M | **f16** | 4096 | 0.6 / 0 | **74.3** | [67.9, 80.8] | 7.4 | 0 | 3.6 | 3433 | 157.0 | 43.1 | 31415 | 2829 |
| `q6-d128-q8-rb4096` | 27B Q6_K | q8_0 | 4096 | 0.6 / 0 | **80.9** | [74.7, 87.1] | 6.5 | 7 | 3.5 | 3666 | 212.6 | 32.6 | 30214 | 1776 |
| `un-d128-f16-rb16384` | 27B Q4_K_M | f16 | 16384 | 0.6 / 0 | **78.6** | [72.4, 84.8] | 5.2 | 0 | 3.6 | 6834 | 216.7 | 45.7 | 29864 | 1901 |
| `q5-d128-f16-rb16384` | 27B Q5_K_M | f16 | 16384 | 0.6 / 0 | **77.5** | [71.5, 83.5] | 4.8 | 0 | 3.6 | 5691 | 230.8 | 43.1 | **31918** | **2841** |
| `a3b-d128-f16-rb4096` | 35B-A3B | f16 | 4096 | 0.6 / 0 | **73.3** | [62.1, 84.4] | 15.7 | 7 | 3.2 | 4063 | **60.9** | 120.1 | 27081 | 1551 |
| `a3b-d128-f16-rb16384` | 35B-A3B | f16 | 16384 | 0.6 / 0 | **77.5** | [67.7, 87.3] | 11.1 | 7 | 3.3 | 8541 | 96.2 | 120.1 | 27196 | 1629 |
| `a3b-d128-f16-rbmax` | 35B-A3B | f16 | **−1** | 0.6 / 0 | **75.4** | [64.7, 86.0] | 12.6 | 7 | 3.3 | 9522 | 104.4 | 119.3 | 30773 | 1668 |
| `a3b-…-rb16384-t03` | 35B-A3B | f16 | 16384 | **0.3** / 0 | **70.0** | [62.3, 77.7] | 11.2 | 0 | 3.1 | 8121 | 92.6 | 120.2 | 27835 | 1704 |
| `a3b-…-rb16384-t10` | 35B-A3B | f16 | 16384 | **1.0** / 0 | **68.4** | [55.0, 81.8] | 12.1 | 7 | 3.1 | 9120 | 103.7 | 115.7 | 27671 | 1652 |
| `a3b-…-rb16384-qwen-gen` | 35B-A3B | f16 | 16384 | **1.0 / 1.5** | **62.1** | [52.5, 71.8] | 13.5 | 0 | 3.0 | 7974 | 133.8 | **78.1** | 27345 | 1645 |
| `a3b-…-rb16384-unsloth-reason` | 35B-A3B | f16 | 16384 | **1.0 / 2.0** | **63.0** | [53.9, 72.2] | 16.3 | 0 | **2.7** | 9226 | 161.0 | **72.6** | 27344 | 1643 |

**Health (MEASURED, digest Health line):** 0 failures, 0 `grade_error` rows across all 14 cells. Runaway/truncation > 0 in exactly one cell: **`a3b-d128-f16-rbmax`** (the unlimited-budget cell) at 7%. ⚠ **GTT spill > 500 MiB in all 14 cells.**

![Config scorecard](charts/scorecard.svg)

> Bar order is **NOT a ranking** — no pair of cells in the quant ladder is resolvable (all CIs overlap). Read this for the *shape* of the trade: the 35B's time bar and the two presence_penalty cells' collapse are the only differences that clearly beat the noise. MEASURED, all 14 cells.

---

## Uncertainty — the design is underpowered, and that is a headline

Quoted verbatim from the digest, because everything else must be read through it:

- **Rep noise (MEASURED):** mean within-(cell,task) sd = **9.8 pts** → SE of a 3-rep mean ≈ **5.6 pts**. A single-task cell-vs-cell gap must exceed ~**22 pts** to beat rep noise alone.
- **Power (INFERRED):** with **5 tasks** this design resolves only **≳12 pts**. To detect Δ=10 pts needs ~**15 tasks**; Δ=5 pts needs ~**60 tasks** — **reps do not help**, task-to-task variance dominates.

**What this licenses:** quoting cell means with their CIs; quoting the two SIGNIFICANT paired results; quoting differences that are structurally huge (decode throughput, wall time, GTT).

**What this forbids:** calling any quant "best" or "worst"; reading the ladder's order as a trend; treating a 5–10 pt gap as an effect. **A non-monotonic ordering is what noise looks like** — and the ladder is non-monotonic.

---

## Axis 1 — the 27B quant ladder (and the KV confound, finally bounded)

**The finding: a bounded null.** Paired-by-task Δ vs `Q4_K_M` (MEASURED, from the digest):

| cell | Δ per task | meanΔ | sd | t | verdict |
|---|---|--:|--:|--:|---|
| Q4_K_XL (f16) | −22, −3, −4, −15, +1 | **−8.5** | 9.6 | −1.98 | not significant |
| Q5_K_M (q8_0) | −1, −1, −13, +6, +1 | **−1.8** | 7.0 | −0.58 | not significant |
| Q6_K (q8_0) | −1, +12, −2, +5, −2 | **+2.6** | 6.1 | +0.94 | not significant |
| 35B-A3B (f16) | −3, −8, −4, −14, +4 | **−5.1** | 6.7 | −1.70 | not significant |

- **No paired Δ clears \|t\| > 2.776. Every 95% CI overlaps every other.** Q4_K_XL's −8.5 is the largest and still fails; it is **unresolved**, not disproven.
- **The KV confound is now bounded — this is new.** `README` §2 warned that Q5_K_M and Q6_K were forced onto **q8_0** KV to fit ctx 163840, confounding weight precision with KV precision. The budget extension re-ran **Q5_K_M at f16** at the same budget, supplying the missing control: **f16 74.3 [67.9, 80.8] vs q8_0 76.5 [71.3, 81.7]** — a 2.2-pt gap *in favour of the lower-precision KV*, i.e. noise. **INFERRED:** the KV split does not explain the ladder, and the prior campaign's ≤5% f16-vs-q8 rule holds at 128k depth on this workload.
  - **CLAIMED corroboration:** llama.cpp PR [#7412](https://github.com/ggml-org/llama.cpp/pull/7412) (closed/obsolete, CUDA) measured V-cache q8_0 at PPL **6.232771** / KLD **0.000743** against f16's **6.232196** / **0.000189** — a KV-quantisation effect ~3 orders of magnitude below typical weight-quantisation KLD. Different model, different backend; directional support only.
- **Why a null here is plausible rather than suspicious.** External Tier-1 numbers say the Q4→Q6 fidelity gain is *real but small*: on Mistral-7B, median KL-divergence falls **Q4_K_M 0.0075 → Q5_K_M 0.0043 → Q6_K 0.0032** (CLAIMED, [Artefact2 GGUF benchmark gist](https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9), imatrix on wiki.train, KLD on wiki.test). More than halving KLD is meaningful in token-distribution terms — but there is **no Tier-1 table mapping that to coding pass-rates**, and our resolution is ≳12 pts. **INFERRED:** a null at this resolution is exactly what a small-but-real fidelity gain would produce. Do not read it as "precision is free".
- **The cost side is not null.** Q6_K costs **+36% wall time** over Q4_K_M (212.6 s vs 156.9 s) and **−29% decode** (32.6 vs 46.1 t/s) for a Δ of +2.6 pts, ns.

![Quant ladder to quality, per task](charts/detailed/d2_quant_quality.svg)

> Kept inline because it is the direct picture of the null: the per-task lines cross each other. If precision mattered at this resolution the lines would rise together. MEASURED.

**Practical consequence (INFERRED):** on this workload there is no evidence to pay for Q5_K_M or Q6_K, and no evidence they are pointless. If you are choosing today, choose on speed and VRAM headroom — those are measured and large — not on the quality ladder, which is not.

---

## Axis 2 — the reasoning budget: a no-op above ~4k, and a refuted hypothesis

This axis was designed to test a **sourced** hypothesis from our own research doc (`docs/research/2026-07-15-1000-qwen36-sampling-thinking-budget-variance.md`, Finding 3): that running `--reasoning-budget 4096` — roughly **8× below** Qwen's recommended 32,768 output length (CLAIMED, verified on the [Qwen3.6-27B card](https://huggingface.co/Qwen/Qwen3.6-27B)) — was truncating the models mid-reasoning and plausibly causing both the lint/types wall and the run-to-run fluctuation.

**The data refutes it, on all three of its predictions.**

| | 27B Q4_K_M | 35B-A3B |
|---|---|---|
| budget 4096 → TS % | 78.3 | 73.3 |
| budget 16384 → TS % | **78.6** | **77.5** |
| budget −1 (unlimited) → TS % | — | **75.4** |
| paired Δ vs Q4_K_M @4096 | **+0.3**, sd **1.8**, t=0.37, **ns** | rb16384 −0.8 (ns) · rbmax −2.9 (ns) |
| mean think tokens @4096 → @16384 | 4095 → 6834 | 4063 → 8541 (→ 9522 unlimited) |
| full answer time @4096 → @16384 | 156.9 s → **216.7 s** | 60.9 s → 96.2 s |
| rep sd @4096 → @16384 | 4.9 → 5.2 | 15.7 → 11.1 (→ 12.6) |

- **Prediction 1: more budget → better quality. FALSE — and this is a *tight* null, not an underpowered one.** The 27B's paired Δ is **+0.3 pts with sd 1.8** across the five tasks (−2, +0, +0, +1, +3). That sd is five times tighter than any other comparison in the campaign: quadrupling the thinking budget changed essentially *nothing*, per task, consistently. The 35B's raw +4.2 has no direct significance test printed and its CIs overlap heavily.
- **Prediction 2: more budget → less fluctuation. NOT SUPPORTED.** The 27B's rep sd is unchanged (4.9 → 5.2; the digest itself says a Δ sd within ±1 pt is not a change). The 35B's 15.7 → 11.1 is directionally lower but is an sd estimated from 3 reps with no test attached — suggestive at best.
- **Prediction 3: the budget was binding. TRUE at 4096, FALSE at 16384 — and this is the mechanism.** In the per-rep tables a think count of **4093–4095** is a forced stop; anything lower is the model choosing to stop. At rb4096 the 27B Q4_K_M was forced on **every single reply (4095 × 15)**. At rb16384 both models settle at **~3.6k–11.6k** per reply (cell means 5.7k–9.2k) and the cap almost never fires. The proof is reply identity:
  - **`a3b-d128-f16-rb16384` and `a3b-d128-f16-rbmax` are identical on 14 of 15 replies** — same think tokens, same objective vectors, same TS. They differ on exactly **one**: `rate-limiter` rep 1, where 16384 forced a stop at **16383** (TS **77**) and unlimited ran to **31,093** think tokens (TS **45**, judge row absent, and the campaign's only runaway).
  - The same pattern holds on the 27B Q5_K_M f16 pair: `async-memo` is identical across rb4096 and rb16384 (think 1501 / 4073 / 538 — all under the cap), and the cells diverge only where the 4095 cap fired.

**Consequences, in order of importance:**

1. **Budget 4096 is the right default for the 27B on this workload** — +60 s per reply buys +0.3 pts. **Do not** pay for 16384 unless something else changes.
2. **Unlimited budget is a liability, not an upgrade.** It changed exactly one reply out of fifteen, and that reply ran away to 31k tokens and lost 32 points. The campaign's entire runaway rate (7%) lives in this cell.
3. **The models do not want Qwen's 32,768.** Left free, they choose ~3.6k–11.6k per reply on the hardest tasks we have (cell means 6834–9522). **INFERRED:** Qwen's 32,768 is a *headroom* recommendation (do not truncate), not a target — and at 128k depth we cannot test it anyway (per our research doc, 32,768 does not fit a 163840 window behind a ~132.9k prompt).
4. **The lint/types wall is not a truncation artifact.** It is identical at 4096 and 16384. Whatever causes it, more thinking is not the cure.

> **CLAIMED corroboration.** *Increasing the Thinking Budget is Not All You Need* (Iacobacci, Qian, AL-Tam, AL-Qurishi, Souissi — [arXiv:2512.19585](https://arxiv.org/abs/2512.19585)) reports that "simply increasing the thinking budget is not the most effective use of compute" and that "more accurate responses can instead be achieved through alternative configurations, such as self-consistency and self-reflection." That is our result twice over: our budget axis is a null, and our **rerun value** (best-of-3 = self-consistency, adjudicated by the toolchain) is worth **+4.6 to +17.5 pts** — far more than any budget increase bought.

---

## Axis 3 — the 35B-A3B sampling sweep: the vendor was right

Five sampling points on the 35B-A3B, all at budget 16384, all on the identical prompt. Three form a clean single-variable temperature axis (everything else pinned at Qwen's coding recipe); two are vendor presets carried whole (which move temperature **and** presence_penalty together, so they are labelled points, not axis points).

| cell | temp | top_p | top_k | pp | TS % | rep sd | judge/5 | decode t/s | Δ vs Q4_K_M (paired) | source of the recipe |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|---|
| `a3b-…-rb16384` | **0.6** | 0.95 | 20 | 0.0 | **77.5** | 11.1 | 3.3 | 120.1 | −0.8, t=−0.26, ns | **Qwen: "thinking, precise coding"** |
| `a3b-…-t03` | 0.3 | 0.95 | 20 | 0.0 | **70.0** | 11.2 | 3.1 | 120.2 | **−8.3, t=−4.11, SIGNIFICANT** | **nobody** — a folklore probe |
| `a3b-…-t10` | 1.0 | 0.95 | 20 | 0.0 | **68.4** | 12.1 | 3.1 | 115.7 | −9.9, t=−1.41, ns | temp from Qwen "thinking, general" |
| `a3b-…-qwen-gen` | 1.0 | 0.95 | 20 | **1.5** | **62.1** | 13.5 | 3.0 | **78.1** | **−16.2, t=−3.08, SIGNIFICANT** | Qwen: "thinking, general" (whole preset) |
| `a3b-…-unsloth-reason` | 1.0 | **1.0** | **40** | **2.0** | **63.0** | **16.3** | **2.7** | **72.6** | −15.3, t=−2.10, ns | **Unsloth card only** — Qwen does not document it |

**Read carefully: the paired tests printed by the digest are against `Q4_K_M`, a different model.** There is **no printed significance test between the sampling cells themselves** (e.g. t03 vs t06). So the honest statement is: *two sampling cells differ significantly from the 27B Q4_K_M baseline, and the raw sampling ordering is consistent across every metric we have.* Fixing this is the top item on the further-tests list.

**What the sweep shows:**

- **Qwen's documented coding recipe (temp 0.6 / pp 0.0) is the best point on every metric simultaneously** — TS 77.5, judge 3.3, full decode speed. It is not a coincidence that the vendor's number wins; it is the number the model was tuned for. (CLAIMED, verified: the [Qwen3.6-35B-A3B card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) lists `temperature 0.6 / top_p 0.95 / top_k 20 / min_p 0.0 / presence_penalty 0.0` and labels it for **"precise coding tasks"**; [Unsloth's Qwen3.6 docs](https://unsloth.ai/docs/models/qwen3.6) carry the same values in their thinking-mode table, without that coding-specific label. The "precise coding" attribution is Qwen's.)
- **Temperature 0.3 is folklore, and the folklore is wrong twice.** It is documented by **neither** vendor. It scored **70.0** — the only sampling cell whose Δ vs the baseline is significant — **and it was no steadier than 0.6** (rep sd **11.2 vs 11.1**). The intuition "lower temperature = more deterministic = more reliable code" fails on its own terms here: it bought no stability and cost quality. **This kills the cheapest folk remedy for our fluctuation problem.**
- **The two presence_penalty presets are the campaign's floor — on quality, on judge score, on stability, and on speed.** 62.1 / 63.0 TS, judge 3.0 / **2.7** (the worst of 14 cells), rep sd 13.5 / **16.3** (the worst), decode **78.1 / 72.6**. Both are *documented vendor settings* — just not for this job: Qwen's pp 1.5 belongs to **"thinking, general"**, and Qwen explicitly drops pp to **0.0** for precise coding. Unsloth's own docs carry the same caveat — a higher presence_penalty "may result in slight decrease in performance" (CLAIMED, [unsloth.ai/docs/models/qwen3.6](https://unsloth.ai/docs/models/qwen3.6)).
  - **INFERRED, and important:** *applying a vendor preset from the wrong section is worse than any quantisation choice in this campaign.* The pp presets cost ~15 pts; the entire Q4→Q6 ladder spans 11 pts and is not resolvable. **Sampling hygiene dominates quant shopping.**
- **The Unsloth-only preset is the single worst configuration tested** — and it has the weakest provenance. Our research doc verified that Qwen's card lists **three** parameter sets while Unsloth's lists **four**, adding this `top_k 40 / top_p 1.0 / min_p 0.0 / pp 2.0` set while attributing the whole block to the Qwen team. **INFERRED:** treat Unsloth-only recipes as unattributed until Qwen documents them. (Its Δ −15.3 is *not* significant at t=−2.10 — large and unresolved.)

### The presence_penalty × MTP interaction — the sharpest unexplained result

**MEASURED, perfect separation across seven 35B cells:**

| presence_penalty | cells | decode t/s |
|---|---|---|
| **0.0** | rb4096, rb16384, rbmax, t03, t10 | 120.1 · 120.1 · 119.3 · 120.2 · 115.7 |
| **1.5** | qwen-gen | **78.1** |
| **2.0** | unsloth-reason | **72.6** |

- Same model, same weights, same KV, same budget, same backend. The only thing that changed is a sampler penalty — and **~40% of decode throughput disappeared**.
- **INFERRED mechanism:** MTP speculative decoding only wins when the sampled token matches the draft's proposal. `presence_penalty` re-weights logits *after* the draft was produced, so it systematically rejects draft tokens; rejection means the speculation is wasted and decode falls back toward the unaccelerated rate. The size of the drop is consistent with that (the 35B's ~120 t/s is largely an MTP effect).
- **This is untested and it matters beyond this box:** if true, any sampler that perturbs logits (presence/frequency/repetition penalties, aggressive min_p) silently taxes every MTP deployment. **One MTP-on/off × pp-on/off run answers it.** See further-tests #2.

![Fluctuation](charts/fluctuation.svg)

> Kept inline: it visualises the axis-3 result the mean hides — the pp>0 cells are not merely lower, they are the widest-swinging cells in the campaign, and temp 0.3 narrowed nothing. MEASURED, all 14 cells.

---

## Combinations across the three axes — what interacts and what does not

Systematically, from the cells we actually have:

| Combination | Have it? | Result |
|---|---|---|
| **quant × budget** | Yes — Q4_K_M and Q5_K_M f16 each at 4096 and 16384 | **No interaction.** The budget null replicates on both quants (+0.3 and +3.2 raw, both unresolved). The budget conclusion is not a Q4_K_M artifact |
| **quant × KV** | Yes — Q5_K_M at f16 and q8_0, same budget | **No interaction.** 74.3 vs 76.5; the README's flagged confound is bounded below the noise floor |
| **model × budget** | Yes — 27B and 35B each at 4096 and 16384 | **Possibly asymmetric, unresolved.** 27B +0.3 (sd 1.8, a tight null); 35B +4.2 (no test, wide CIs). The 35B thinks more when freed (8541 vs 6834 mean tokens). **Cannot conclude** |
| **budget × fluctuation** | Yes | **27B: no change** (4.9 → 5.2). **35B: 15.7 → 11.1 → 12.6**, directionally lower, untested. The 35B is noisier than the 27B at *every* budget — capacity/MoE, not budget, drives its variance |
| **temperature × budget** | **NO** | ⚠ **A gap.** All five sampling cells run at budget 16384 only. We cannot say whether temp 0.3's deficit would appear at 4096, or whether temp 1.0 needs more budget |
| **sampling × model** | **NO** | ⚠ **A gap, and a confound.** *Every* sampling cell is the 35B-A3B. The temperature and presence_penalty findings are **not established for the dense 27B** — they may be MoE-specific |
| **presence_penalty × MTP** | **NO** | ⚠ **The best hypothesis in the campaign.** Perfectly separated in the data, mechanically plausible, and one cheap run from being settled |
| **quant × sampling** | **NO** | Untested. If sampling hygiene dominates quant choice (as the effect sizes suggest), this is the more valuable of the two axes to extend |

**The connective insight (INFERRED):** the three axes are not equal citizens. **Sampling moved quality by ~15 pts; the entire quant ladder moved it by 11 pts and could not be resolved; the budget moved it by ~0.** Effort spent shopping for quants would have been better spent checking that the sampler matches the vendor's *task-specific* recipe — and that conclusion transfers off this box.

---

## The strict-code wall — cleanliness, not logic

**MEASURED, mean fractional objectives across cells:** `lint` **0.36** · `types` **0.47** · `tests` **0.84** · `edge` **0.87** · `reuse` **0.99**.

- The models get the **logic** substantially right (tests 0.84) and reuse the provided abstractions almost perfectly (0.99). They fail on **strict `eslint`/`tsc` cleanliness**.
- **Nothing in this campaign moves the wall.** Not precision (the ladder is a null), not capacity (35B Δ−5.1, ns), not thinking budget (Δ+0.3), not sampling (the best sampling cell still hard-passes 7%).
- **`hard_pass` and partial credit are different questions, and the per-rep tables prove it.** On `async-memo`, the 35B's rep 0 scored **95 ✗** and its rep 2 scored **94 ✓** — a *lower* score that hard-passes and a *higher* score that does not. A 97%-scoring `rate-limiter` reply with judge 4·4·4 missed hard-pass on **one lint error** (lint 0.80).
- **The wall binds the references too — including opus.** Opus's per-task `lint` runs **0.53 / 0.80 / 0.40 / 0.60 / 0.87** and opus hard-passes **1 of 5** tasks (`pricing-deferred`, 1/3). Sonnet, which scores *lower* on partial credit than opus on 3 of 5 tasks, hard-passes **4 of 5**. **INFERRED and consequential: our `hard_pass` gate is dominated by eslint pedantry that does not track model capability monotonically.** It is a good "would you merge this as-is" proxy and a poor capability ruler. Read `hard_pass` as a workflow statistic, not as a ranking.

![Objective breakdown](charts/objective_breakdown.svg)

> Inline because it is the wall itself: lint/types short, tests/edge/reuse tall, in every cell. MEASURED, all 14 cells.

---

## Capability vs the reference ladder — and what "tier" actually means

**⚠ Read this before quoting any local-vs-reference number.** The references are **one-shot on ~550–620-token prompts**; every local cell answered the same task carrying **~132.9k tokens (~213× deeper)**. Both sides are now n=3 (the ladder was re-collected at 3 reps — `README` §5c) and the ladder is now **complete**: all three tiers cover all five tasks. But **depth is not matched**, so a bare Δ is not a capability gap. It compares *"can you write this cold?"* against *"can you write this after reading 133k tokens of someone else's codebase?"*

**Reference means (MEASURED, `calibration-reps.jsonl` via the digest, 5 tasks × 3 reps):** haiku **81** · sonnet **91** · opus **94**. **Best local cell: 81** (Q6_K, 80.9).

- The best local configuration lands **level with haiku's one-shot mean** while carrying 213× the context, and **~10 pts below sonnet / ~13 below opus** — but those are answers to different questions and must not be subtracted from each other.
- **The 3-rep ladder overturned the n=1 readings — the strongest argument in this campaign for reps.** The previous analysis, built on single reference samples, reported `lru-cache` as a *ceiling* task (nobody hard-passes) and `async-memo` as *opus-confirmed*. With 3 reps:
  - `lru-cache` is **not** a ceiling task: **sonnet hard-passes 1/3** (96%), while **opus hard-passes 0/3** (93%).
  - `async-memo`: **opus 0/3**, **sonnet 1/3** — the label says `opus`, the data says `sonnet`.
  - An n=1 ladder was reading coin flips as tiers.

**Tier semantics — the label vs the measurement (MEASURED, from the digest headers):**

| task | label | measured weakest hard-pass | haiku | sonnet | opus | verdict |
|---|---|---|---|---|---|---|
| `lru-cache` | `sonnet` | **sonnet** | 83% ✗ 0/3 | 96% ✓ **1/3** | 93% ✗ 0/3 | **confirmed** |
| `rate-limiter` | `sonnet` | **sonnet** | 90% ✗ 0/3 | 97% ✓ **1/3** | 97% ✗ 0/3 | **confirmed** |
| `async-memo` | `opus` | **sonnet** | 82% ✗ 0/3 | 93% ✓ **1/3** | 90% ✗ 0/3 | ⚠ **CONTRADICTED** — label too hard |
| `expr-eval` | `opus` | **NONE (ceiling)** | 65% ✗ 0/3 | 81% ✗ 0/3 | 93% ✗ 0/3 | ⚠ **unconfirmed** — no reference hard-passes it; it is *at least* opus-hard |
| `pricing-deferred` | `opus` | **sonnet** | 85% ✗ 0/3 | 86% ✓ **1/3** | 98% ✓ **1/3** | ⚠ **CONTRADICTED** — label too hard |

- **TIER is a difficulty class, not a score band.** A task can be `tier opus` while every model scores 60–90% on partial credit — the tier names the weakest reference tier that produces a **strictly clean** reply, nothing else.
- **2 of 5 labels are confirmed; 2 are contradicted; 1 is a ceiling.** The two contradicted labels should be corrected to `sonnet` in `tasks.jsonl`; `expr-eval`'s should stay `opus` with an explicit "≥" (nobody clears it).
- **Every single reference hard-pass in this campaign is 1/3.** Not one of the 15 (model, task) reference pairs hard-passes 2/3 or 3/3. **INFERRED:** at the strictness of this gate, even frontier models are *sampling* for a clean run rather than reliably producing one — the same "reruns pay" result we measure locally, seen from the top of the ladder.
- **`expr-eval` is the campaign's true ceiling** (opus 93% but 0/3 clean; local cells 29–67). It is the one task that discriminates at the top, and the one where the 35B produced the campaign's worst reply (11%).

![Capability](charts/capability.svg)

> The dashed reference bands are **one-shot at ~550–620 tokens**; the bars are at ~132.9k. Not a like-for-like comparison — read the bands as orientation, not as a target line. MEASURED.

---

## Fluctuation and rerun value — the mean hides both

`rep sd` = how much a cell swings on the *same* prompt. `Δ rerun` = best-of-3 minus mean = what re-rolling buys. `hard@R` = share of tasks where **any** rep is strictly clean — the toolchain (tsc/eslint/vitest) picks the winner, so this is a real strategy, not an oracle.

| cell | mean | worst | best | range | rep sd | best-of-R | **Δ rerun** | hard@1 | **hard@R** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Q4_K_M (f16) | 78.3 | 57 | 96 | 39 | **4.9** | 82.9 | **+4.6** | 0% | 0% |
| Q4_K_XL (f16) | 69.8 | 30 | 92 | 61 | 7.6 | 77.1 | **+7.3** | 0% | 0% |
| Q5_K_M (q8_0) | 76.5 | 59 | 94 | 35 | 7.6 | 84.4 | **+7.9** | 0% | 0% |
| Q6_K (q8_0) | 80.9 | 55 | 100 | 45 | 6.5 | 86.8 | **+5.9** | 7% | **20%** |
| q5-f16-rb4096 | 74.3 | 55 | 94 | 39 | 7.4 | 81.9 | **+7.6** | 0% | 0% |
| q5-f16-rb16384 | 77.5 | 63 | 97 | 34 | **4.8** | 82.4 | **+4.9** | 0% | 0% |
| un-f16-rb16384 | 78.6 | 53 | 91 | 38 | 5.2 | 83.8 | **+5.2** | 0% | 0% |
| 35B-A3B rb4096 | 73.3 | **11** | 95 | **84** | **15.7** | 85.5 | **+12.3** | 7% | **20%** |
| 35B-A3B rb16384 | 77.5 | 19 | 97 | 78 | 11.1 | 85.3 | **+7.8** | 7% | **20%** |
| 35B-A3B rbmax | 75.4 | 19 | 97 | 78 | 12.6 | 85.3 | **+10.0** | 7% | **20%** |
| 35B t03 | 70.0 | 34 | 94 | 61 | 11.2 | 81.2 | **+11.3** | 0% | 0% |
| 35B t10 | 68.4 | 18 | 100 | 82 | 12.1 | 78.7 | **+10.4** | 7% | **20%** |
| 35B qwen-gen | 62.1 | 32 | 84 | 52 | 13.5 | 75.7 | **+13.6** | 0% | 0% |
| 35B unsloth-reason | 63.0 | 36 | 91 | 55 | **16.3** | 80.5 | **+17.5** | 0% | 0% |

- **The dense 27B is markedly steadier than the MoE 35B at every comparable setting** (rep sd 4.8–7.6 vs 11.1–16.3). This is the campaign's most consistent structural difference after speed. **It is not tested for significance** and rep sd from 3 reps is itself noisy — but it is monotone across seven pairings.
  - **CLAIMED / a gap in the literature:** we could find **no Tier-1 source quantifying MoE-vs-dense run-to-run variance**. The known mechanism for inference non-determinism (batch-size-dependent reduction order, floating-point non-associativity) is architecture-agnostic and remains an open engineering problem — see vLLM's [batch-invariance tracking issue #27433](https://github.com/vllm-project/vllm/issues/27433) (**open**; note it does *not* discuss MoE routing). Our own research doc noted the one vendor hint in this direction: Qwen recommends `presence_penalty 1.5` for the **MoE** in general thinking mode but 0.0 for the dense 27B, implying the MoE is more repetition-prone in open-ended use.
  - **Our data rules out engine non-determinism as the cause (MEASURED).** Replies are **identical across cells** wherever the budget did not bind — the engine reproduces exactly at a fixed seed, MTP and all. So the 35B's spread is **sampling variance amplified by the model**, not hardware or batching jitter. That also means llama.cpp issue [#23335](https://github.com/ggml-org/llama.cpp/issues/23335) ("draft-mtp changes deterministic output", **closed**, resolution unverified) is **not** visible in our data as a variance source.
- **Rerunning beats every other lever in this campaign.** Δ rerun is **+4.6 to +17.5 pts** — larger than the whole quant ladder and vastly larger than the budget axis. And the noisiest cells pay the most (+17.5 on the worst cell), which is the correct shape: variance is an asset when a free verifier picks the winner.
- **`hard@R` triples `hard@1`** (7% → 20%) wherever any hard-pass exists at all. The toolchain does the picking; no human, no judge.
- **The floor is the 35B's problem, not its mean.** Worst-of-3: **11** (35B rb4096) vs **57** (Q4_K_M). If a pipeline ships whatever comes out, that floor is the number that matters.

![Rerun value](charts/rerun_value.svg)

> Inline because it is the campaign's most actionable relationship: what re-rolling buys, per cell, against what every other axis bought (≈0). MEASURED, all 14 cells.

---

## Health — GTT spill in all 14 cells, and the Q5 f16 question settled

**MEASURED (`vram_sampler.py` → `out/gpu_*.csv`, peaks reported by the digest):**

- **Peak VRAM: 27081–31918 MiB** of 32624 available. **Peak GTT: 1551–2841 MiB.**
- ⚠ **The digest flags GTT spill (>500 MiB) in all 14 cells** — including the lightest (the 35B-A3B at 27081 MiB VRAM, with 5.4 GiB of headroom, still spilling 1551 MiB). **It is therefore not simply "out of VRAM"**, and it is unexplained. On a 31 GB host with **no swap**, sustained GTT traffic is a freeze risk. **OPEN — this blocks unattended use of every configuration in this report.**
- **`Q5_K_M` at KV f16 and ctx 163840 fits — MEASURED, question settled.** `q5-d128-f16-rb16384` peaked at **31918 MiB** (97.8% of 32624) with **0 failures, 0 runaways, 0 grade errors**, and it is also the campaign's **steadiest cell** (rep sd 4.8). It was run deliberately without a pre-flight guard as a fail-fast probe (`README` §5b) and it did not fail. It confirms `CLAUDE.md` rule 13 with a measurement. It is also the **highest-GTT cell (2841 MiB)** — the fit is real, but it has no margin.
- **Runaway/truncation > 0 in exactly one cell:** `a3b-d128-f16-rbmax`, at 7% — the single 31,093-token reply discussed in Axis 2. Every other cell: 0%.
- **No failures and no `grade_error`/HARNESS rows anywhere.** The grader fix from `README` §3 (vitest single-process, fail-loud, pre-grade self-check) held across all 210 replies, so `tests` 0.84 and `edge` 0.87 are real numbers, not the previous campaign's harness artifact.

![Memory, power and thermal](charts/memory_power.svg)

> All 14 cells. MEASURED. Note the GTT bar is non-zero everywhere.

---

## Recommended config

**For an agentic loop that can retry and let the toolchain judge (the recommended default):**

```bash
# 35B-A3B — quality indistinguishable from the 27B ladder (delta -5.1, t=-1.70, ns),
# 2.6x faster to a full answer (60.9s vs 156.9s for Q4_K_M; 3.5x vs Q6_K's 212.6s),
# so best-of-3 costs less wall time than ONE Q6_K reply.
# Pair it with best-of-N + tsc/eslint/vitest picking the winner (hard@R 20% vs hard@1 7%).
bash bench/engine-bench/serve_llamacpp.sh \
  MODEL=Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \
  BACKEND=vulkan MTP=on KV=f16 \
  EXTRA_ARGS="-c 163840 -ub 2048 -b 4096 -fa on"
# sampling: temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 / presence_penalty 0  <- Qwen's precise-coding recipe
# reasoning budget: 4096   (16384 buys +0.3 pts on the 27B for +60s; unlimited caused the only runaway)
```

**For a one-shot pipeline that ships whatever comes out** (the floor matters more than the mean — the 35B's worst-of-3 is **11**, the 27B Q4_K_M's is **57**):

```bash
bash bench/engine-bench/serve_llamacpp.sh \
  MODEL=Qwen3.6-27B-MTP-Q4_K_M.gguf \
  BACKEND=vulkan MTP=on KV=f16 \
  EXTRA_ARGS="-c 163840 -ub 2048 -b 4096 -fa on"
# same sampling; reasoning budget 4096 (paired delta to 16384 = +0.3 pts, sd 1.8, t=0.37 — a tight null)
```

**Explicitly do not:**

- **Do not set `presence_penalty > 0` for coding.** It is the largest quality loss in this campaign (~15 pts) *and* costs ~40% of decode throughput. Both vendor presets that carry it are documented for **general / non-thinking** use, not coding.
- **Do not lower temperature below 0.6 to "stabilise" output.** Temp 0.3 scored 8.3 pts below the baseline (the only significant sampling result) and was **not** steadier (rep sd 11.2 vs 11.1). It is documented by neither vendor.
- **Do not pay for Q5_K_M or Q6_K on this workload** (INFERRED from the null plus the cost): +36% wall time at Q6_K for Δ+2.6 pts, ns.
- **Do not use `--reasoning-budget -1`** at this depth: it changed 1 reply in 15, and that reply ran away.

⚠ **No recommendation here is safe for unattended use until the GTT spill is characterised.**

---

## Further tests — prioritised

**Tier 1 — these change conclusions.**

1. **Add tasks, not reps.** The single change that would make the quant and model axes conclusive. **~15 hardest tasks resolves Δ=10 pts; ~60 resolves Δ=5** (digest, INFERRED). Reps do not help — task-to-task variance dominates. Every future run of this design should spend its GPU budget on task breadth. *(Cost: linear in tasks; no new infrastructure — `tasks.jsonl` + `eval-design.md` already define the pattern.)*
2. **Settle presence_penalty × MTP — the cheapest high-value run in the queue.** 4 cells: {MTP on, off} × {pp 0.0, 1.5} on the 35B-A3B, 1 task, 3 reps. If pp really breaks speculative acceptance, that finding applies to **every MTP deployment**, not just ours — and it is currently a perfectly-separated pattern with no test behind it. *(Cost: ~1 hour.)*
3. **Give the sampling axis its own baseline.** Every sampling cell is currently tested against `Q4_K_M` — a **different model**. Re-run `aggregate.py` with `a3b-d128-f16-rb16384` as the paired baseline so t03/t10/qwen-gen/unsloth-reason are tested against *the same model at the vendor's temperature*. **This is a re-analysis, not a re-run — no GPU time.** ⚠ Until it is done, "temp 0.3 is significantly worse" is a claim about temp-0.3-35B vs Q4_K_M-27B and must be read that way.
4. **Break the sampling × model confound.** All five sampling points are the MoE. Run temp {0.3, 0.6, 1.0} on the **dense 27B Q4_K_M**. If the temperature effect is MoE-specific, that reframes the whole axis-3 conclusion; if it replicates, we have a transferable rule. *(Cost: 3 cells × 5 tasks × 3 reps.)*

**Tier 2 — these close known gaps.**

5. **Characterise the GTT spill.** Present in all 14 cells *including* the one with 5.4 GiB of VRAM headroom, so it is not a capacity problem. Bisect: MTP on/off, prefix cache on/off, ctx 163840 vs 65536, Vulkan vs ROCm/HIP. **Until it is attributed, nothing here is safe unattended on a no-swap host.**
6. **Correct the tier labels in `tasks.jsonl`.** `async-memo` and `pricing-deferred` measure as `sonnet`, not `opus`; `expr-eval` should read `≥opus` (no reference hard-passes it). The labels disagree with the measurement in 2 of 5 cases and the digest prints a ⚠ for them.
7. **Test the repair arm (add-on B, `run_repair.sh` — already written, never run).** The wall is *one lint error* wide on the best replies (97% + judge 4·4·4, failed on lint 0.80). One `eslint --fix`-style turn feeding `tsc`/`eslint` errors back is the cheapest plausible way through it — and it is the only untested lever that attacks the wall directly rather than hoping a bigger or cleaner model clears it.
8. **Depth-match the reference ladder.** Run haiku/sonnet/opus at ~132.9k tokens, n=3. Only then is *any* local-vs-reference number a capability gap. Currently the ladder answers a different question (one-shot, 213× shallower) and can only orient.

**Tier 3 — worth doing, lower leverage.**

9. **Reconsider the `hard_pass` gate.** It is dominated by eslint pedantry that does not track capability monotonically (sonnet hard-passes 4/5 tasks, opus 1/5, while opus out-scores sonnet on partial credit). Either report it purely as a workflow statistic ("mergeable as-is?") or add a second gate separating *cosmetic* from *semantic* failures — `score_typescript.py` already has the error counts to do it.
10. **Pin and record seeds per rep.** Reply identity across cells shows the engine is deterministic at a fixed seed, so "rep sd" is pure sampling variance — but the seeds are not recorded, so the reps cannot be exactly reproduced or reused as a matched design. Cheap, and it would let future paired tests match on seed as well as task.
11. **Test Qwen's 32,768 output length at a shallower depth.** It does not fit behind a ~132.9k prompt in a 163840 window (research doc, Finding 4). Given that the models freely choose ~3.6k–11.6k per reply here, the expected value is low — but it is the one vendor recommendation we have never been able to honour.
12. **Budget *below* 4096.** The axis only ever went up. At 4096 the 27B is *forced* on every reply and quality is unchanged from 16384 — so the interesting question is now the other direction: is 2048, or 0, also free? That would cut wall time materially. *(Cost: 2 cells.)*

**What is missing from the data — the gaps, stated plainly:**

- **No temperature × budget cell** (all sampling at 16384) and **no sampling on the dense model** (all sampling on the MoE) — items 3 and 4.
- **No MTP-off cell anywhere.** MTP is on in all 14 cells and is entangled with the 35B's entire speed story *and* with the presence_penalty anomaly.
- **No significance test between sampling cells, between budget cells, or on the judge scores.** The digest only prints paired tests vs `Q4_K_M`.
- **No test of rep-sd differences.** "The MoE is noisier" is monotone across seven pairings and formally untested.
- **No coding-specific external quant benchmark exists to anchor our null against.** Tier-1 Q4–Q6 comparisons are perplexity/KLD on wikitext, not pass-rates on code.
- **No external anchor for `UD-Q4_K_XL` at all** — no Unsloth Dynamic accuracy table for Qwen3.6 could be located. Notable, since it is the lowest-scoring cell in the ladder.

---

## Methodology and caveats

**What was measured.** 14 cells × 5 tasks × 3 reps = **210 graded replies** (n=15 per cell). Tasks: `rate-limiter`, `lru-cache`, `async-memo`, `expr-eval`, `pricing-deferred`. Held fixed in every cell: llama.cpp Vulkan **b9950**, `-ub 2048 -b 4096 -fa on`, MTP on, ctx **163840**, prefix cache, the prompt, the grader, the judge, REPS 3. Varied: model/quant (axis 1), reasoning budget (axis 2), sampling (axis 3, 35B only), KV type (forced — see confound 4).

**The depth label is nominal — and it is not a confound.** Cells are labelled `120k`; the real prompt is **~132.9k tokens** (522,260 chars ÷ ~3.93 chars/tok on TypeScript). Two causes, both benign: `build_context.py` uses `CHARS_PER_TOK = 4` as an estimate, and it overshoots its char budget because it breaks *after* appending a file. **Deliberately not fixed** — changing the prompt would invalidate all 210 replies. **Every cell runs the identical prompt**, so all internal comparisons are sound; only the label is approximate. The one place it matters is the reference comparison, where the true ~213× depth ratio is the number to use.

**Known confounds and limitations, worst first.**

1. **Underpowering — the top limitation.** 5 tasks, rep sd 9.8 → resolution **≳12 pts**. Only 2 of 13 printed comparisons are significant. **The fix is more tasks, not more reps.**
2. **The sampling axis is baselined against the wrong cell.** The digest's paired tests run against `Q4_K_M` (27B, dense, temp 0.6); the sampling cells are all 35B-A3B. The two SIGNIFICANT results are therefore *cross-model* comparisons. The sampling *ordering* is consistent across TS %, judge and decode speed, but its significance is not established within-model. **Further-tests #3 fixes this with no GPU time.**
3. **The sampling axis is fully confounded with the model.** All five sampling cells are the MoE. Nothing here establishes temperature behaviour for the dense 27B.
4. **KV is not uniform (by design).** Q5_K_M and Q6_K at rb4096 run **q8_0** KV because f16 caps them below the needed context (`README` §2). **Mitigated and now bounded:** the `q5-d128-f16-rb4096` cell supplies the direct control (74.3 f16 vs 76.5 q8_0) and the effect sits below the noise floor.
5. **The reference ladder is not depth-matched.** 213× shallower, one-shot. Both sides are n=3 and the ladder is now complete across all 5 tasks — but depth is the confound, and more reps cannot fix it.
6. **2 of 5 tier labels are contradicted by measurement**, 1 is a ceiling. See Tier semantics.
7. **The judge was not significance-tested.** Its 2.7–3.6 spread is quoted as printed. The only judge number that clearly stands out is the Unsloth preset's **2.7**, which agrees with its deterministic score and its rep sd.
8. **rep sd is estimated from 3 reps** and is itself noisy. The digest warns that a Δ sd within ±1 pt is not a change; we extend that caution to all rep-sd comparisons, none of which are tested.
9. **Single box, single build.** llama.cpp Vulkan b9950 only. RDNA4 performance swings hard across builds, so every timing number is build-specific.
10. **One reply lost its judge row** (`a3b-d128-f16-rbmax` · `rate-limiter` · rep 1 — the 31,093-token runaway; the judge column shows `—`). Its deterministic score (45) is intact and counted.

**Provenance.** This campaign's `out/` = **MEASURED**. External sources = **CLAIMED**, linked below, each fetched and verified to resolve and to contain the cited claim. Reasoning = **INFERRED**, marked in place. Never blended.

---

## Sources

External claims only. Every URL below was fetched and confirmed to contain the cited claim on 2026-07-15.

**Vendor (Tier-1, primary):**

- Qwen model card — `Qwen/Qwen3.6-27B`: https://huggingface.co/Qwen/Qwen3.6-27B — thinking/coding sampling recipes; the 32,768 output-length recommendation (81,920 for highly complex problems); the presence_penalty note.
- Qwen model card — `Qwen/Qwen3.6-35B-A3B`: https://huggingface.co/Qwen/Qwen3.6-35B-A3B — as above, plus the MoE `presence_penalty=1.5` asymmetry in *general* thinking mode.
- Unsloth model card — `unsloth/Qwen3.6-35B-A3B-GGUF`: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF — the source of the Unsloth-only preset (`temp 1.0 / top_p 1.0 / top_k 40 / min_p 0.0 / pp 2.0`), attributed to the Qwen team but **not present on Qwen's own card**.
- Unsloth docs — Qwen3.6: https://unsloth.ai/docs/models/qwen3.6 — confirms `presence_penalty = 0.0` for "precise coding tasks (e.g. WebDev)"; notes that a higher value "may result in slight decrease in performance".

**Engineering (Tier-1, primary):**

- llama.cpp PR **#7412** "CUDA: quantized KV cache demo" (JohannesGaessler, **closed/obsolete**): https://github.com/ggml-org/llama.cpp/pull/7412 — f16 KV PPL 6.232196 / KLD 0.000189 vs V-cache q8_0 6.232771 / 0.000743; "The K cache seems to be much more sensitive to quantization than the V cache." *(CUDA, different model — directional support only.)*
- llama.cpp issue **#23335** "Eval bug: draft-mtp changes deterministic output on Qwen3.6 MTP model" (**closed**, resolution **UNVERIFIED**): https://github.com/ggml-org/llama.cpp/issues/23335 — cited only to record that it is **not** visible in our data.
- vLLM issue **#27433** "[Feature]: Batch Invariant Feature and Performance Optimization" (**open**): https://github.com/vllm-project/vllm/issues/27433 — batch-invariant / deterministic inference is an open engineering problem. *(It does **not** discuss MoE routing; cited only as evidence that no settled Tier-1 quantification exists.)*

**Benchmarks / literature:**

- Artefact2, GGUF quantisation benchmark gist: https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9 — Mistral-7B, imatrix on wiki.train, KLD on wiki.test: Q4_K_M 4.83 bpw / KLD median 0.0075 / q99 0.0885 · Q5_K_M 5.67 / 0.0043 / 0.0368 · Q6_K 6.57 / 0.0032 / 0.0222. *(Not Qwen3.6, and not a coding benchmark.)*
- Iacobacci, Qian, AL-Tam, AL-Qurishi, Souissi — *Increasing the Thinking Budget is Not All You Need*: https://arxiv.org/abs/2512.19585 — "simply increasing the thinking budget is not the most effective use of compute"; self-consistency and self-reflection outperform budget increases.

**Our own prior work (in this repo):**

- `docs/research/2026-07-15-1000-qwen36-sampling-thinking-budget-variance.md` — the sourced sampling/budget/variance report that axes 2 and 3 were designed to test. Its **Finding 3** (truncated thinking drives the wall and the fluctuation) is **refuted** by axis 2 above; its **Findings 1, 7 and 8** (the vendor sampling recipes; the Unsloth-only preset; the temp/pp coupling confound) are **corroborated**.

**Explicitly not used.** Several candidate sources were rejected during verification: a third-party GGUF perplexity repo (not Tier-1, unverifiable provenance); llama.cpp PR #16016 "deterministic inference" (draft, CUDA-only, unverified, and irrelevant to this Vulkan box); and any Unsloth "Dynamic 2.0" accuracy table for Qwen3.6 — **no such table could be located**, and the figures circulating for it are **Gemma 3** numbers.

**No external number is compared against ours as a benchmark.** The haiku/sonnet/opus figures are **our own** measurements (`calibration-reps.jsonl`), not vendor claims.

---

## Appendix A — every rep of every cell

_Inlined verbatim from `out/summary.md` (the deterministic digest). Nothing averaged away: all 14 cells × 5 tasks × 3 reps, plus the haiku/sonnet/opus reference ladder at 3 reps each._

### Per-rep detail — every rep + haiku/sonnet/opus reference (nothing averaged away)

_Local cells show all REPS individually (full objective vector 0–1) then a **mean** row; references are one-shot. `— (no calib)` = reference point not yet collected (see README add-on D)._

> **TIER is a difficulty class, NOT a score band.** It names the weakest REFERENCE tier that produces a strictly-clean **hard_pass** — so a task can be `tier opus` while every model scores 60–90% on partial credit. Each header below prints the label next to the MEASURED hard-pass evidence; trust the evidence.
> **The references are NOT depth-matched:** they are one-shot on a ~550–620-token prompt, while local cells answer the same task at ~132.9k tokens (**~213× deeper**), and each reference is a single sample (n=1) vs the local n=3. Reference-vs-local Δ are therefore indicative only — do not quote them as a like-for-like capability gap.

#### lru-cache · tier `sonnet` — measured weakest hard-pass: **sonnet** (haiku 83%✗0/3 · sonnet 96%✓1/3 · opus 93%✗0/3)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q4_K_M (f16) | 0 | 70 | ✗ | 0.00 | 0.20 | 1.00 | 1.00 | 1.00 | 0.40 | 1.00 | 4095 | 3.0·3.0·3.0 |
| Q4_K_M (f16) | 1 | 90 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.75 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q4_K_M (f16) | 2 | 96 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.80 | 1.00 | 4095 | 3.0·4.0·3.0 |
| **Q4_K_M (f16) — mean** | – | **85** | 0% | 0.67 | 0.47 | 1.00 | 1.00 | 1.00 | 0.65 | 1.00 | | |
| Q4_K_XL (f16) | 0 | 77 | ✗ | 1.00 | 0.60 | 0.90 | 0.50 | 1.00 | 0.40 | 1.00 | 4094 | 3.0·4.0·3.0 |
| Q4_K_XL (f16) | 1 | 57 | ✗ | 0.00 | 0.00 | 1.00 | 0.50 | 1.00 | 0.50 | 1.00 | 4094 | 3.0·3.0·3.0 |
| Q4_K_XL (f16) | 2 | 56 | ✗ | 0.00 | 0.00 | 0.92 | 0.50 | 1.00 | 0.58 | 1.00 | 4095 | 3.0·4.0·3.0 |
| **Q4_K_XL (f16) — mean** | – | **63** | 0% | 0.33 | 0.20 | 0.94 | 0.50 | 1.00 | 0.49 | 1.00 | | |
| Q5_K_M (q8_0) | 0 | 91 | ✗ | 1.00 | 0.60 | 0.86 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q5_K_M (q8_0) | 1 | 86 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | 1.00 | 0.50 | 1.00 | 4095 | 2.0·3.0·2.0 |
| Q5_K_M (q8_0) | 2 | 74 | ✗ | 0.00 | 0.40 | 0.89 | 1.00 | 1.00 | 0.89 | 1.00 | 4095 | 2.0·3.0·3.0 |
| **Q5_K_M (q8_0) — mean** | – | **84** | 0% | 0.56 | 0.53 | 0.92 | 1.00 | 1.00 | 0.80 | 1.00 | | |
| Q6_K (q8_0) | 0 | 90 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 3.0·4.0·2.0 |
| Q6_K (q8_0) | 1 | 89 | ✗ | 0.67 | 0.80 | 0.83 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 3.0·4.0·3.0 |
| Q6_K (q8_0) | 2 | 74 | ✗ | 0.67 | 0.40 | 0.64 | 1.00 | 1.00 | 0.27 | 1.00 | 4095 | 2.0·3.0·2.0 |
| **Q6_K (q8_0) — mean** | – | **84** | 0% | 0.67 | 0.60 | 0.82 | 1.00 | 1.00 | 0.76 | 1.00 | | |
| 35B-A3B (f16) | 0 | 89 | ✗ | 1.00 | 0.60 | 0.92 | 1.00 | 1.00 | 0.46 | 1.00 | 4095 | 4.0·4.0·4.0 |
| 35B-A3B (f16) | 1 | 77 | ✗ | 1.00 | 0.00 | 0.86 | 1.00 | 1.00 | 0.14 | 1.00 | 4095 | 2.0·1.0·2.0 |
| 35B-A3B (f16) | 2 | 80 | ✗ | 1.00 | 0.00 | 0.90 | 1.00 | 1.00 | 0.50 | 1.00 | 4095 | 3.0·4.0·2.0 |
| **35B-A3B (f16) — mean** | – | **82** | 0% | 1.00 | 0.20 | 0.90 | 1.00 | 1.00 | 0.37 | 1.00 | | |
| q5-d128-f16-rb16384 (f16) | 0 | 67 | ✗ | 0.67 | 0.20 | 0.80 | 0.50 | 1.00 | 0.73 | 1.00 | 335 | 3.0·4.0·2.0 |
| q5-d128-f16-rb16384 (f16) | 1 | 79 | ✗ | 0.00 | 0.80 | 0.92 | 1.00 | 1.00 | 0.67 | 1.00 | 7247 | 3.0·4.0·4.0 |
| q5-d128-f16-rb16384 (f16) | 2 | 91 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 8203 | 4.0·3.0·4.0 |
| **q5-d128-f16-rb16384 (f16) — mean** | – | **79** | 0% | 0.56 | 0.47 | 0.91 | 0.83 | 1.00 | 0.80 | 1.00 | | |
| q5-d128-f16-rb4096 (f16) | 0 | 67 | ✗ | 0.67 | 0.20 | 0.80 | 0.50 | 1.00 | 0.73 | 1.00 | 335 | 3.0·4.0·3.0 |
| q5-d128-f16-rb4096 (f16) | 1 | 94 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.58 | 1.00 | 4095 | 4.0·4.0·4.0 |
| q5-d128-f16-rb4096 (f16) | 2 | 55 | ✗ | 0.33 | 0.00 | 0.88 | 1.00 | 0.00 | 0.38 | 1.00 | 4095 | 3.0·4.0·4.0 |
| **q5-d128-f16-rb4096 (f16) — mean** | – | **72** | 0% | 0.67 | 0.33 | 0.89 | 0.83 | 0.67 | 0.56 | 1.00 | | |
| un-d128-f16-rb16384 (f16) | 0 | 74 | ✗ | 0.00 | 0.60 | 0.70 | 1.00 | 1.00 | 1.00 | 1.00 | 8640 | 3.0·3.0·4.0 |
| un-d128-f16-rb16384 (f16) | 1 | 90 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.75 | 1.00 | 5736 | 4.0·4.0·4.0 |
| un-d128-f16-rb16384 (f16) | 2 | 85 | ✗ | 1.00 | 0.20 | 1.00 | 1.00 | 1.00 | 0.56 | 1.00 | 6426 | 4.0·4.0·3.0 |
| **un-d128-f16-rb16384 (f16) — mean** | – | **83** | 0% | 0.67 | 0.40 | 0.90 | 1.00 | 1.00 | 0.77 | 1.00 | | |
| a3b-d128-f16-rb16384 (f16) | 0 | 86 | ✗ | 1.00 | 0.60 | 0.80 | 1.00 | 1.00 | 0.50 | 1.00 | 6852 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384 (f16) | 1 | 89 | ✗ | 1.00 | 0.60 | 0.90 | 1.00 | 1.00 | 0.50 | 1.00 | 10594 | 2.0·3.0·2.0 |
| a3b-d128-f16-rb16384 (f16) | 2 | 84 | ✗ | 1.00 | 0.00 | 0.90 | 1.00 | 1.00 | 1.00 | 1.00 | 9163 | 3.0·4.0·3.0 |
| **a3b-d128-f16-rb16384 (f16) — mean** | – | **86** | 0% | 1.00 | 0.40 | 0.87 | 1.00 | 1.00 | 0.67 | 1.00 | | |
| a3b-d128-f16-rbmax (f16) | 0 | 86 | ✗ | 1.00 | 0.60 | 0.80 | 1.00 | 1.00 | 0.50 | 1.00 | 6852 | 4.0·4.0·3.0 |
| a3b-d128-f16-rbmax (f16) | 1 | 89 | ✗ | 1.00 | 0.60 | 0.90 | 1.00 | 1.00 | 0.50 | 1.00 | 10594 | 2.0·3.0·2.0 |
| a3b-d128-f16-rbmax (f16) | 2 | 84 | ✗ | 1.00 | 0.00 | 0.90 | 1.00 | 1.00 | 1.00 | 1.00 | 9163 | 4.0·4.0·4.0 |
| **a3b-d128-f16-rbmax (f16) — mean** | – | **86** | 0% | 1.00 | 0.40 | 0.87 | 1.00 | 1.00 | 0.67 | 1.00 | | |
| a3b-d128-f16-rb16384-t03 (f16) | 0 | 80 | ✗ | 0.00 | 0.80 | 0.93 | 1.00 | 1.00 | 0.80 | 1.00 | 8742 | 3.0·4.0·3.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 1 | 80 | ✗ | 0.00 | 0.80 | 0.89 | 1.00 | 1.00 | 1.00 | 1.00 | 8298 | 2.0·3.0·3.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 2 | 64 | ✗ | 0.67 | 0.00 | 0.89 | 0.50 | 1.00 | 0.44 | 1.00 | 6749 | 3.0·4.0·3.0 |
| **a3b-d128-f16-rb16384-t03 (f16) — mean** | – | **75** | 0% | 0.22 | 0.53 | 0.90 | 0.83 | 1.00 | 0.75 | 1.00 | | |
| a3b-d128-f16-rb16384-t10 (f16) | 0 | 82 | ✗ | 1.00 | 0.00 | 0.86 | 1.00 | 1.00 | 0.86 | 1.00 | 6486 | 3.0·3.0·3.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 1 | 77 | ✗ | 1.00 | 0.80 | 0.57 | 0.50 | 1.00 | 1.00 | 1.00 | 10153 | 2.0·3.0·2.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 2 | 87 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.43 | 1.00 | 11906 | 3.0·3.0·3.0 |
| **a3b-d128-f16-rb16384-t10 (f16) — mean** | – | **82** | 0% | 1.00 | 0.40 | 0.81 | 0.83 | 1.00 | 0.76 | 1.00 | | |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 0 | 44 | ✗ | 0.33 | 0.80 | 0.00 | 0.00 | 1.00 | 0.88 | 1.00 | 8672 | 3.0·3.0·3.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 1 | 76 | ✗ | 0.33 | 0.60 | 0.67 | 1.00 | 1.00 | 0.83 | 1.00 | 8612 | 3.0·3.0·2.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 2 | 49 | ✗ | 0.00 | 0.00 | 1.00 | 0.00 | 1.00 | 0.83 | 1.00 | 7939 | 2.0·3.0·2.0 |
| **a3b-d128-f16-rb16384-qwen-gen (f16) — mean** | – | **56** | 0% | 0.22 | 0.47 | 0.56 | 0.33 | 1.00 | 0.85 | 1.00 | | |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 0 | 37 | ✗ | 0.00 | 0.00 | 0.00 | 0.50 | 1.00 | 0.71 | 1.00 | 9136 | 3.0·3.0·3.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 1 | 37 | ✗ | 0.00 | 0.60 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 12017 | 0.0·0.0·0.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 2 | 91 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 0.55 | 1.00 | 10776 | 4.0·4.0·3.0 |
| **a3b-d128-f16-rb16384-unsloth-reason (f16) — mean** | – | **55** | 0% | 0.33 | 0.40 | 0.33 | 0.50 | 1.00 | 0.75 | 1.00 | | |
| _haiku_ ref | 0 | 82 | ✗ | 1.00 | 0.80 | 1.00 | 0.50 | 1.00 | 0.44 | 1.00 | | |
| _haiku_ ref | 1 | 85 | ✗ | 1.00 | 0.80 | 1.00 | 0.50 | 1.00 | 0.78 | 1.00 | | |
| _haiku_ ref | 2 | 81 | ✗ | 1.00 | 0.80 | 1.00 | 0.50 | 1.00 | 0.29 | 1.00 | | |
| _**haiku — mean**_ | – | **83** | 0% | 1.00 | 0.80 | 1.00 | 0.50 | 1.00 | 0.50 | 1.00 | | |
| _sonnet_ ref | 0 | 97 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.57 | 1.00 | | |
| _sonnet_ ref | 1 | 96 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.83 | 1.00 | | |
| _sonnet_ ref | 2 | 96 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.83 | 1.00 | | |
| _**sonnet — mean**_ | – | **96** | 33% | 1.00 | 0.87 | 1.00 | 1.00 | 1.00 | 0.74 | 1.00 | | |
| _opus_ ref | 0 | 94 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 94 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 2 | 91 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.92 | 1.00 | | |
| _**opus — mean**_ | – | **93** | 0% | 1.00 | 0.53 | 1.00 | 1.00 | 1.00 | 0.97 | 1.00 | | |

#### rate-limiter · tier `sonnet` — measured weakest hard-pass: **sonnet** (haiku 90%✗0/3 · sonnet 97%✓1/3 · opus 97%✗0/3)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q4_K_M (f16) | 0 | 88 | ✗ | 1.00 | 0.40 | 0.83 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 3.0·3.0·3.0 |
| Q4_K_M (f16) | 1 | 73 | ✗ | 0.33 | 0.00 | 0.83 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| Q4_K_M (f16) | 2 | 76 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·3.0·3.0 |
| **Q4_K_M (f16) — mean** | – | **79** | 0% | 0.55 | 0.13 | 0.89 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| Q4_K_XL (f16) | 0 | 75 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 0.88 | 1.00 | 4095 | 3.0·4.0·1.0 |
| Q4_K_XL (f16) | 1 | 76 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| Q4_K_XL (f16) | 2 | 76 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| **Q4_K_XL (f16) — mean** | – | **76** | 0% | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 0.96 | 1.00 | | |
| Q5_K_M (q8_0) | 0 | 67 | ✗ | 0.00 | 0.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| Q5_K_M (q8_0) | 1 | 94 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 3.0·3.0·3.0 |
| Q5_K_M (q8_0) | 2 | 71 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·4.0 |
| **Q5_K_M (q8_0) — mean** | – | **78** | 0% | 0.33 | 0.20 | 0.93 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| Q6_K (q8_0) | 0 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q6_K (q8_0) | 1 | 86 | ✗ | 0.67 | 0.60 | 0.86 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 3.0·3.0·3.0 |
| Q6_K (q8_0) | 2 | 90 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| **Q6_K (q8_0) — mean** | – | **91** | 0% | 0.78 | 0.67 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| 35B-A3B (f16) | 0 | 87 | ✗ | 0.67 | 0.60 | 0.88 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| 35B-A3B (f16) | 1 | 77 | ✗ | 0.67 | 0.00 | 1.00 | 1.00 | 1.00 | 0.50 | 1.00 | 4095 | 4.0·4.0·4.0 |
| 35B-A3B (f16) | 2 | 48 | ✗ | 0.67 | 0.20 | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 4095 | 2.0·3.0·1.0 |
| **35B-A3B (f16) — mean** | – | **71** | 0% | 0.67 | 0.27 | 0.74 | 0.67 | 1.00 | 0.83 | 1.00 | | |
| q5-d128-f16-rb16384 (f16) | 0 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 8129 | 4.0·4.0·3.0 |
| q5-d128-f16-rb16384 (f16) | 1 | 91 | ✗ | 1.00 | 0.60 | 0.86 | 1.00 | 1.00 | 1.00 | 1.00 | 6977 | 4.0·3.0·4.0 |
| q5-d128-f16-rb16384 (f16) | 2 | 94 | ✗ | 1.00 | 0.80 | 0.86 | 1.00 | 1.00 | 1.00 | 1.00 | 8723 | 4.0·3.0·3.0 |
| **q5-d128-f16-rb16384 (f16) — mean** | – | **94** | 0% | 1.00 | 0.73 | 0.90 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| q5-d128-f16-rb4096 (f16) | 0 | 94 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.50 | 1.00 | 4095 | 4.0·4.0·3.0 |
| q5-d128-f16-rb4096 (f16) | 1 | 91 | ✗ | 1.00 | 0.60 | 0.86 | 1.00 | 1.00 | 1.00 | 1.00 | 4094 | 4.0·5.0·4.0 |
| q5-d128-f16-rb4096 (f16) | 2 | 84 | ✗ | 0.67 | 0.40 | 0.86 | 1.00 | 1.00 | 1.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| **q5-d128-f16-rb4096 (f16) — mean** | – | **90** | 0% | 0.89 | 0.60 | 0.90 | 1.00 | 1.00 | 0.83 | 1.00 | | |
| un-d128-f16-rb16384 (f16) | 0 | 88 | ✗ | 1.00 | 0.40 | 0.83 | 1.00 | 1.00 | 1.00 | 1.00 | 5158 | 4.0·4.0·3.0 |
| un-d128-f16-rb16384 (f16) | 1 | 73 | ✗ | 0.33 | 0.00 | 0.83 | 1.00 | 1.00 | 1.00 | 1.00 | 5287 | 4.0·4.0·3.0 |
| un-d128-f16-rb16384 (f16) | 2 | 76 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 5343 | 4.0·4.0·3.0 |
| **un-d128-f16-rb16384 (f16) — mean** | – | **79** | 0% | 0.55 | 0.13 | 0.89 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| a3b-d128-f16-rb16384 (f16) | 0 | 79 | ✗ | 0.33 | 0.40 | 0.88 | 1.00 | 1.00 | 1.00 | 1.00 | 4962 | 4.0·4.0·3.0 |
| a3b-d128-f16-rb16384 (f16) | 1 | 77 | ✗ | 0.67 | 0.00 | 1.00 | 1.00 | 1.00 | 0.50 | 1.00 | 16383 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384 (f16) | 2 | 62 | ✗ | 1.00 | 0.60 | 0.50 | 0.00 | 1.00 | 1.00 | 1.00 | 8622 | 2.0·2.0·1.0 |
| **a3b-d128-f16-rb16384 (f16) — mean** | – | **73** | 0% | 0.67 | 0.33 | 0.79 | 0.67 | 1.00 | 0.83 | 1.00 | | |
| a3b-d128-f16-rbmax (f16) | 0 | 79 | ✗ | 0.33 | 0.40 | 0.88 | 1.00 | 1.00 | 1.00 | 1.00 | 4962 | 4.0·4.0·3.0 |
| a3b-d128-f16-rbmax (f16) | 1 | 45 | ✗ | 0.67 | 1.00 | 0.00 | 0.00 | 1.00 | 0.00 | 1.00 | 31093 | — |
| a3b-d128-f16-rbmax (f16) | 2 | 62 | ✗ | 1.00 | 0.60 | 0.50 | 0.00 | 1.00 | 1.00 | 1.00 | 8622 | 2.0·2.0·1.0 |
| **a3b-d128-f16-rbmax (f16) — mean** | – | **62** | 0% | 0.67 | 0.67 | 0.46 | 0.33 | 1.00 | 0.67 | 1.00 | | |
| a3b-d128-f16-rb16384-t03 (f16) | 0 | 94 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 8166 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 1 | 68 | ✗ | 1.00 | 0.80 | 0.62 | 0.00 | 1.00 | 1.00 | 1.00 | 8121 | 2.0·3.0·2.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 2 | 57 | ✗ | 1.00 | 0.80 | 0.12 | 0.00 | 1.00 | 1.00 | 1.00 | 7878 | 2.0·4.0·2.0 |
| **a3b-d128-f16-rb16384-t03 (f16) — mean** | – | **73** | 0% | 1.00 | 0.73 | 0.58 | 0.33 | 1.00 | 1.00 | 1.00 | | |
| a3b-d128-f16-rb16384-t10 (f16) | 0 | 94 | ✗ | 1.00 | 0.80 | 0.86 | 1.00 | 1.00 | 1.00 | 1.00 | 9484 | 4.0·4.0·3.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 1 | 86 | ✗ | 1.00 | 0.60 | 0.75 | 1.00 | 1.00 | 0.62 | 1.00 | 8273 | 3.0·3.0·3.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 2 | 91 | ✗ | 1.00 | 0.80 | 0.88 | 1.00 | 1.00 | 0.50 | 1.00 | 6972 | 3.0·4.0·3.0 |
| **a3b-d128-f16-rb16384-t10 (f16) — mean** | – | **90** | 0% | 1.00 | 0.73 | 0.83 | 1.00 | 1.00 | 0.71 | 1.00 | | |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 0 | 54 | ✗ | 0.00 | 0.20 | 0.83 | 0.67 | 1.00 | 0.58 | 0.00 | 4519 | 3.0·3.0·2.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 1 | 32 | ✗ | 0.33 | 0.00 | 0.00 | 0.00 | 1.00 | 0.88 | 1.00 | 9830 | 2.0·3.0·2.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 2 | 68 | ✗ | 0.00 | 0.00 | 0.86 | 1.00 | 1.00 | 1.00 | 1.00 | 7614 | 4.0·4.0·3.0 |
| **a3b-d128-f16-rb16384-qwen-gen (f16) — mean** | – | **51** | 0% | 0.11 | 0.07 | 0.56 | 0.56 | 1.00 | 0.82 | 0.67 | | |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 0 | 87 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | 1.00 | 0.60 | 1.00 | 7540 | 3.0·2.0·2.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 1 | 36 | ✗ | 0.00 | 0.60 | 0.00 | 0.00 | 1.00 | 0.80 | 1.00 | 8949 | 1.0·1.0·0.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 2 | 55 | ✗ | 0.00 | 0.80 | 0.14 | 0.67 | 1.00 | 0.71 | 1.00 | 11189 | 3.0·3.0·2.0 |
| **a3b-d128-f16-rb16384-unsloth-reason (f16) — mean** | – | **59** | 0% | 0.22 | 0.67 | 0.38 | 0.56 | 1.00 | 0.70 | 1.00 | | |
| _haiku_ ref | 0 | 94 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _haiku_ ref | 1 | 90 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 0.33 | 1.00 | | |
| _haiku_ ref | 2 | 86 | ✗ | 1.00 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _**haiku — mean**_ | – | **90** | 0% | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.78 | 1.00 | | |
| _sonnet_ ref | 0 | 93 | ✗ | 1.00 | 0.80 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _sonnet_ ref | 1 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _sonnet_ ref | 2 | 100 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _**sonnet — mean**_ | – | **97** | 33% | 1.00 | 0.87 | 0.93 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 0 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 2 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _**opus — mean**_ | – | **97** | 0% | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |

#### async-memo · tier `opus` — measured weakest hard-pass: **sonnet** (haiku 82%✗0/3 · sonnet 93%✓1/3 · opus 90%✗0/3)  ⚠ **LABEL CONTRADICTED BY DATA** (label says `opus`, measured weakest hard-pass = `sonnet`)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q4_K_M (f16) | 0 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q4_K_M (f16) | 1 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| Q4_K_M (f16) | 2 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4095 | 4.0·4.0·4.0 |
| **Q4_K_M (f16) — mean** | – | **91** | 0% | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| Q4_K_XL (f16) | 0 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4093 | 4.0·4.0·3.0 |
| Q4_K_XL (f16) | 1 | 80 | ✗ | 0.00 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | 2519 | 4.0·4.0·3.0 |
| Q4_K_XL (f16) | 2 | 92 | ✗ | 1.00 | 1.00 | 0.67 | 1.00 | — | 1.00 | 1.00 | 4095 | 3.0·3.0·2.0 |
| **Q4_K_XL (f16) — mean** | – | **88** | 0% | 0.56 | 0.87 | 0.89 | 1.00 | — | 1.00 | 1.00 | | |
| Q5_K_M (q8_0) | 0 | 71 | ✗ | 0.00 | 0.60 | 1.00 | 1.00 | — | 0.33 | 1.00 | 648 | 4.0·4.0·3.0 |
| Q5_K_M (q8_0) | 1 | 76 | ✗ | 0.33 | 0.20 | 1.00 | 1.00 | — | 1.00 | 1.00 | 3911 | 4.0·3.0·3.0 |
| Q5_K_M (q8_0) | 2 | 88 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | 2132 | 4.0·3.0·3.0 |
| **Q5_K_M (q8_0) — mean** | – | **78** | 0% | 0.33 | 0.47 | 1.00 | 1.00 | — | 0.78 | 1.00 | | |
| Q6_K (q8_0) | 0 | 81 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | — | 1.00 | 1.00 | 3515 | 3.0·4.0·2.0 |
| Q6_K (q8_0) | 1 | 100 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4095 | 5.0·5.0·4.0 |
| Q6_K (q8_0) | 2 | 88 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4095 | 3.0·3.0·3.0 |
| **Q6_K (q8_0) — mean** | – | **90** | 33% | 0.78 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| 35B-A3B (f16) | 0 | 95 | ✗ | 1.00 | 1.00 | 0.80 | 1.00 | — | 1.00 | 1.00 | 4094 | 4.0·4.0·4.0 |
| 35B-A3B (f16) | 1 | 71 | ✗ | 0.00 | 0.60 | 1.00 | 1.00 | — | 0.33 | 1.00 | 4095 | 4.0·4.0·3.0 |
| 35B-A3B (f16) | 2 | 94 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | — | 0.33 | 1.00 | 3621 | 4.0·4.0·3.0 |
| **35B-A3B (f16) — mean** | – | **87** | 33% | 0.67 | 0.87 | 0.93 | 1.00 | — | 0.55 | 1.00 | | |
| q5-d128-f16-rb16384 (f16) | 0 | 65 | ✗ | 0.33 | 0.00 | 0.83 | 1.00 | — | 0.67 | 1.00 | 1501 | 4.0·5.0·4.0 |
| q5-d128-f16-rb16384 (f16) | 1 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4073 | 3.0·4.0·3.0 |
| q5-d128-f16-rb16384 (f16) | 2 | 67 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | — | 0.33 | 1.00 | 538 | 4.0·4.0·4.0 |
| **q5-d128-f16-rb16384 (f16) — mean** | – | **66** | 0% | 0.22 | 0.00 | 0.94 | 1.00 | — | 0.67 | 1.00 | | |
| q5-d128-f16-rb4096 (f16) | 0 | 65 | ✗ | 0.33 | 0.00 | 0.83 | 1.00 | — | 0.67 | 1.00 | 1501 | 4.0·4.0·4.0 |
| q5-d128-f16-rb4096 (f16) | 1 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4073 | 4.0·4.0·3.0 |
| q5-d128-f16-rb4096 (f16) | 2 | 67 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | — | 0.33 | 1.00 | 538 | 4.0·3.0·4.0 |
| **q5-d128-f16-rb4096 (f16) — mean** | – | **66** | 0% | 0.22 | 0.00 | 0.94 | 1.00 | — | 0.67 | 1.00 | | |
| un-d128-f16-rb16384 (f16) | 0 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4589 | 4.0·4.0·4.0 |
| un-d128-f16-rb16384 (f16) | 1 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4700 | 3.0·4.0·3.0 |
| un-d128-f16-rb16384 (f16) | 2 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4345 | 4.0·4.0·4.0 |
| **un-d128-f16-rb16384 (f16) — mean** | – | **91** | 0% | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| a3b-d128-f16-rb16384 (f16) | 0 | 95 | ✗ | 1.00 | 1.00 | 0.80 | 1.00 | — | 1.00 | 1.00 | 6972 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384 (f16) | 1 | 80 | ✗ | 0.33 | 0.80 | 1.00 | 1.00 | — | 0.33 | 1.00 | 5021 | 3.0·4.0·3.0 |
| a3b-d128-f16-rb16384 (f16) | 2 | 94 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | — | 0.33 | 1.00 | 3621 | 4.0·4.0·3.0 |
| **a3b-d128-f16-rb16384 (f16) — mean** | – | **90** | 33% | 0.78 | 0.93 | 0.93 | 1.00 | — | 0.55 | 1.00 | | |
| a3b-d128-f16-rbmax (f16) | 0 | 95 | ✗ | 1.00 | 1.00 | 0.80 | 1.00 | — | 1.00 | 1.00 | 6972 | 4.0·4.0·4.0 |
| a3b-d128-f16-rbmax (f16) | 1 | 80 | ✗ | 0.33 | 0.80 | 1.00 | 1.00 | — | 0.33 | 1.00 | 5021 | 3.0·4.0·3.0 |
| a3b-d128-f16-rbmax (f16) | 2 | 94 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | — | 0.33 | 1.00 | 3621 | 4.0·4.0·3.0 |
| **a3b-d128-f16-rbmax (f16) — mean** | – | **90** | 33% | 0.78 | 0.93 | 0.93 | 1.00 | — | 0.55 | 1.00 | | |
| a3b-d128-f16-rb16384-t03 (f16) | 0 | 75 | ✗ | 0.67 | 0.60 | 0.50 | 1.00 | — | 1.00 | 1.00 | 5769 | 4.0·4.0·3.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 1 | 83 | ✗ | 0.33 | 0.80 | 1.00 | 1.00 | — | 0.67 | 1.00 | 6635 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 2 | 72 | ✗ | 0.33 | 1.00 | 0.67 | 0.67 | — | 1.00 | 1.00 | 5097 | 2.0·3.0·1.0 |
| **a3b-d128-f16-rb16384-t03 (f16) — mean** | – | **77** | 0% | 0.44 | 0.80 | 0.72 | 0.89 | — | 0.89 | 1.00 | | |
| a3b-d128-f16-rb16384-t10 (f16) | 0 | 66 | ✗ | 0.00 | 0.80 | 0.75 | 0.67 | — | 1.00 | 1.00 | 5884 | 2.0·3.0·1.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 1 | 100 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 5593 | 4.0·5.0·4.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 2 | 83 | ✗ | 0.00 | 1.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 6370 | 4.0·5.0·4.0 |
| **a3b-d128-f16-rb16384-t10 (f16) — mean** | – | **83** | 33% | 0.33 | 0.93 | 0.92 | 0.89 | — | 1.00 | 1.00 | | |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 0 | 83 | ✗ | 0.00 | 1.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4869 | 4.0·4.0·3.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 1 | 82 | ✗ | 0.33 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4906 | 4.0·4.0·3.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 2 | 74 | ✗ | 0.00 | 0.60 | 1.00 | 1.00 | — | 0.67 | 1.00 | 5913 | 3.0·3.0·3.0 |
| **a3b-d128-f16-rb16384-qwen-gen (f16) — mean** | – | **80** | 0% | 0.11 | 0.73 | 1.00 | 1.00 | — | 0.89 | 1.00 | | |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 0 | 73 | ✗ | 0.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | 6894 | 4.0·4.0·3.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 1 | 60 | ✗ | 0.00 | 0.00 | 0.83 | 1.00 | — | 0.67 | 1.00 | 8945 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 2 | 50 | ✗ | 0.00 | 0.60 | 0.00 | 1.00 | — | 0.75 | 1.00 | 6260 | 3.0·1.0·1.0 |
| **a3b-d128-f16-rb16384-unsloth-reason (f16) — mean** | – | **61** | 0% | 0.00 | 0.33 | 0.61 | 1.00 | — | 0.81 | 1.00 | | |
| _haiku_ ref | 0 | 88 | ✗ | 1.00 | 0.80 | 0.67 | 1.00 | — | 1.00 | 1.00 | | |
| _haiku_ ref | 1 | 82 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | — | 0.25 | 1.00 | | |
| _haiku_ ref | 2 | 77 | ✗ | 0.67 | 0.60 | 0.67 | 1.00 | — | 0.67 | 1.00 | | |
| _**haiku — mean**_ | – | **82** | 0% | 0.78 | 0.67 | 0.78 | 1.00 | — | 0.64 | 1.00 | | |
| _sonnet_ ref | 0 | 100 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ ref | 1 | 88 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ ref | 2 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _**sonnet — mean**_ | – | **93** | 33% | 0.78 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 0 | 93 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 93 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 2 | 83 | ✗ | 1.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _**opus — mean**_ | – | **90** | 0% | 1.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |

#### expr-eval · tier `opus` — measured weakest hard-pass: **NONE (ceiling)** (haiku 65%✗0/3 · sonnet 81%✗0/3 · opus 93%✗0/3)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q4_K_M (f16) | 0 | 58 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 0.00 | 1.00 | 4095 | 3.0·4.0·3.0 |
| Q4_K_M (f16) | 1 | 57 | ✗ | 0.00 | 0.00 | 0.92 | 1.00 | — | 0.08 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q4_K_M (f16) | 2 | 58 | ✗ | 0.00 | 0.00 | 0.94 | 1.00 | — | 0.12 | 1.00 | 4095 | 3.0·3.0·3.0 |
| **Q4_K_M (f16) — mean** | – | **58** | 0% | 0.00 | 0.00 | 0.95 | 1.00 | — | 0.07 | 1.00 | | |
| Q4_K_XL (f16) | 0 | 40 | ✗ | 0.00 | 0.20 | 0.85 | 0.29 | — | 0.00 | 1.00 | 4095 | 3.0·2.0·4.0 |
| Q4_K_XL (f16) | 1 | 30 | ✗ | 0.00 | 0.00 | 0.12 | 0.43 | — | 1.00 | 1.00 | 4095 | 2.0·3.0·2.0 |
| Q4_K_XL (f16) | 2 | 56 | ✗ | 0.00 | 0.00 | 0.92 | 1.00 | — | 0.00 | 1.00 | 4095 | 3.0·3.0·3.0 |
| **Q4_K_XL (f16) — mean** | – | **42** | 0% | 0.00 | 0.07 | 0.63 | 0.57 | — | 0.33 | 1.00 | | |
| Q5_K_M (q8_0) | 0 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q5_K_M (q8_0) | 1 | 59 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 0.08 | 1.00 | 4095 | 2.0·2.0·3.0 |
| Q5_K_M (q8_0) | 2 | 65 | ✗ | 0.00 | 0.40 | 1.00 | 1.00 | — | 0.00 | 1.00 | 4095 | 4.0·4.0·3.0 |
| **Q5_K_M (q8_0) — mean** | – | **64** | 0% | 0.00 | 0.13 | 1.00 | 1.00 | — | 0.36 | 1.00 | | |
| Q6_K (q8_0) | 0 | 70 | ✗ | 0.00 | 0.20 | 1.00 | 1.00 | — | 1.00 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q6_K (q8_0) | 1 | 64 | ✗ | 0.00 | 0.00 | 0.90 | 1.00 | — | 1.00 | 1.00 | 4095 | 2.0·3.0·2.0 |
| Q6_K (q8_0) | 2 | 55 | ✗ | 0.00 | 0.00 | 0.86 | 1.00 | — | 0.00 | 1.00 | 4095 | 3.0·3.0·4.0 |
| **Q6_K (q8_0) — mean** | – | **63** | 0% | 0.00 | 0.07 | 0.92 | 1.00 | — | 0.67 | 1.00 | | |
| 35B-A3B (f16) | 0 | 11 | ✗ | 0.00 | 0.00 | 0.07 | 0.00 | — | 0.07 | 1.00 | 4095 | 2.0·3.0·2.0 |
| 35B-A3B (f16) | 1 | 64 | ✗ | 0.00 | 0.00 | 0.89 | 1.00 | — | 1.00 | 1.00 | 4095 | 2.0·2.0·2.0 |
| 35B-A3B (f16) | 2 | 57 | ✗ | 0.00 | 0.00 | 0.88 | 1.00 | — | 0.18 | 1.00 | 4095 | 3.0·3.0·3.0 |
| **35B-A3B (f16) — mean** | – | **44** | 0% | 0.00 | 0.00 | 0.61 | 0.67 | — | 0.42 | 1.00 | | |
| q5-d128-f16-rb16384 (f16) | 0 | 63 | ✗ | 0.00 | 0.20 | 1.00 | 1.00 | — | 0.18 | 1.00 | 7172 | 4.0·4.0·4.0 |
| q5-d128-f16-rb16384 (f16) | 1 | 74 | ✗ | 0.33 | 0.60 | 1.00 | 1.00 | — | 0.00 | 1.00 | 5249 | 3.0·3.0·3.0 |
| q5-d128-f16-rb16384 (f16) | 2 | 64 | ✗ | 0.33 | 0.00 | 0.92 | 1.00 | — | 0.33 | 1.00 | 5585 | 4.0·4.0·4.0 |
| **q5-d128-f16-rb16384 (f16) — mean** | – | **67** | 0% | 0.22 | 0.27 | 0.97 | 1.00 | — | 0.17 | 1.00 | | |
| q5-d128-f16-rb4096 (f16) | 0 | 62 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 0.38 | 1.00 | 4095 | 4.0·3.0·4.0 |
| q5-d128-f16-rb4096 (f16) | 1 | 74 | ✗ | 0.33 | 0.60 | 1.00 | 1.00 | — | 0.00 | 1.00 | 4095 | 3.0·4.0·3.0 |
| q5-d128-f16-rb4096 (f16) | 2 | 59 | ✗ | 0.00 | 0.00 | 0.92 | 1.00 | — | 0.33 | 1.00 | 4095 | 2.0·3.0·3.0 |
| **q5-d128-f16-rb4096 (f16) — mean** | – | **65** | 0% | 0.11 | 0.20 | 0.97 | 1.00 | — | 0.24 | 1.00 | | |
| un-d128-f16-rb16384 (f16) | 0 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 10486 | 3.0·3.0·3.0 |
| un-d128-f16-rb16384 (f16) | 1 | 57 | ✗ | 0.00 | 0.00 | 0.92 | 1.00 | — | 0.08 | 1.00 | 6967 | 4.0·4.0·4.0 |
| un-d128-f16-rb16384 (f16) | 2 | 53 | ✗ | 0.00 | 0.40 | 0.89 | 0.29 | — | 1.00 | 1.00 | 11081 | 3.0·3.0·3.0 |
| **un-d128-f16-rb16384 (f16) — mean** | – | **59** | 0% | 0.00 | 0.13 | 0.94 | 0.76 | — | 0.69 | 1.00 | | |
| a3b-d128-f16-rb16384 (f16) | 0 | 19 | ✗ | 0.00 | 0.00 | 0.10 | 0.00 | — | 1.00 | 1.00 | 8651 | 3.0·3.0·3.0 |
| a3b-d128-f16-rb16384 (f16) | 1 | 64 | ✗ | 0.00 | 0.00 | 0.93 | 1.00 | — | 0.93 | 1.00 | 11647 | 2.0·3.0·3.0 |
| a3b-d128-f16-rb16384 (f16) | 2 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 8613 | 3.0·3.0·4.0 |
| **a3b-d128-f16-rb16384 (f16) — mean** | – | **50** | 0% | 0.00 | 0.00 | 0.68 | 0.67 | — | 0.98 | 1.00 | | |
| a3b-d128-f16-rbmax (f16) | 0 | 19 | ✗ | 0.00 | 0.00 | 0.10 | 0.00 | — | 1.00 | 1.00 | 8651 | 2.0·3.0·2.0 |
| a3b-d128-f16-rbmax (f16) | 1 | 64 | ✗ | 0.00 | 0.00 | 0.93 | 1.00 | — | 0.93 | 1.00 | 11647 | 2.0·3.0·2.0 |
| a3b-d128-f16-rbmax (f16) | 2 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 8613 | 3.0·4.0·3.0 |
| **a3b-d128-f16-rbmax (f16) — mean** | – | **50** | 0% | 0.00 | 0.00 | 0.68 | 0.67 | — | 0.98 | 1.00 | | |
| a3b-d128-f16-rb16384-t03 (f16) | 0 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 9361 | 4.0·4.0·3.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 1 | 47 | ✗ | 0.00 | 0.00 | 0.20 | 1.00 | — | 1.00 | 1.00 | 8883 | 2.0·3.0·2.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 2 | 34 | ✗ | 0.00 | 0.00 | 0.25 | 0.43 | — | 1.00 | 1.00 | 8868 | 2.0·2.0·1.0 |
| **a3b-d128-f16-rb16384-t03 (f16) — mean** | – | **49** | 0% | 0.00 | 0.00 | 0.48 | 0.81 | — | 1.00 | 1.00 | | |
| a3b-d128-f16-rb16384-t10 (f16) | 0 | 31 | ✗ | 0.00 | 0.00 | 0.30 | 0.29 | — | 1.00 | 1.00 | 10683 | 2.0·2.0·2.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 1 | 36 | ✗ | 0.00 | 0.20 | 0.38 | 0.29 | — | 0.92 | 1.00 | 11224 | 3.0·3.0·3.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 2 | 18 | ✗ | 0.00 | 0.00 | 0.07 | 0.00 | — | 1.00 | 1.00 | 10060 | 3.0·3.0·3.0 |
| **a3b-d128-f16-rb16384-t10 (f16) — mean** | – | **29** | 0% | 0.00 | 0.07 | 0.25 | 0.19 | — | 0.97 | 1.00 | | |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 0 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | 11157 | 3.0·2.0·3.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 1 | 32 | ✗ | 0.33 | 0.60 | 0.00 | 0.00 | — | 1.00 | 1.00 | 10874 | 1.0·1.0·1.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 2 | 37 | ✗ | 0.00 | 0.00 | 0.38 | 0.43 | — | 1.00 | 1.00 | 8477 | 2.0·3.0·3.0 |
| **a3b-d128-f16-rb16384-qwen-gen (f16) — mean** | – | **45** | 0% | 0.11 | 0.20 | 0.46 | 0.48 | — | 1.00 | 1.00 | | |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 0 | 60 | ✗ | 0.00 | 0.00 | 0.86 | 0.86 | — | 1.00 | 1.00 | 9570 | 4.0·3.0·2.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 1 | 66 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 0.88 | 1.00 | 7232 | 3.0·4.0·4.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 2 | 64 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 0.64 | 1.00 | 10912 | 3.0·1.0·2.0 |
| **a3b-d128-f16-rb16384-unsloth-reason (f16) — mean** | – | **63** | 0% | 0.00 | 0.00 | 0.95 | 0.95 | — | 0.84 | 1.00 | | |
| _haiku_ ref | 0 | 66 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 0.87 | 1.00 | | |
| _haiku_ ref | 1 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _haiku_ ref | 2 | 62 | ✗ | 0.00 | 0.20 | 1.00 | 1.00 | — | 0.00 | 1.00 | | |
| _**haiku — mean**_ | – | **65** | 0% | 0.00 | 0.07 | 1.00 | 1.00 | — | 0.62 | 1.00 | | |
| _sonnet_ ref | 0 | 73 | ✗ | 0.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ ref | 1 | 90 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ ref | 2 | 78 | ✗ | 0.00 | 0.80 | 1.00 | 1.00 | — | 0.82 | 1.00 | | |
| _**sonnet — mean**_ | – | **81** | 0% | 0.33 | 0.53 | 1.00 | 1.00 | — | 0.94 | 1.00 | | |
| _opus_ ref | 0 | 90 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 93 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 2 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _**opus — mean**_ | – | **93** | 0% | 1.00 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |

#### pricing-deferred · tier `opus` — measured weakest hard-pass: **sonnet** (haiku 85%✗0/3 · sonnet 86%✓1/3 · opus 98%✓1/3)  ⚠ **LABEL CONTRADICTED BY DATA** (label says `opus`, measured weakest hard-pass = `sonnet`)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q4_K_M (f16) | 0 | 79 | ✗ | 0.67 | 0.00 | 0.92 | 1.00 | 1.00 | 0.92 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q4_K_M (f16) | 1 | 81 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | 1.00 | 0.64 | 1.00 | 4095 | 3.0·4.0·3.0 |
| Q4_K_M (f16) | 2 | 76 | ✗ | 0.67 | 0.00 | 0.92 | 1.00 | 1.00 | 0.58 | 1.00 | 4095 | 4.0·4.0·4.0 |
| **Q4_K_M (f16) — mean** | – | **79** | 0% | 0.67 | 0.07 | 0.94 | 1.00 | 1.00 | 0.71 | 1.00 | | |
| Q4_K_XL (f16) | 0 | 83 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | 1.00 | 0.82 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q4_K_XL (f16) | 1 | 73 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 0.54 | 1.00 | 4095 | 4.0·4.0·4.0 |
| Q4_K_XL (f16) | 2 | 84 | ✗ | 0.67 | 0.40 | 1.00 | 1.00 | 1.00 | 0.64 | 1.00 | 4095 | 2.0·2.0·2.0 |
| **Q4_K_XL (f16) — mean** | – | **80** | 0% | 0.56 | 0.20 | 1.00 | 1.00 | 1.00 | 0.67 | 1.00 | | |
| Q5_K_M (q8_0) | 0 | 82 | ✗ | 1.00 | 0.40 | 0.83 | 0.83 | 1.00 | 0.67 | 1.00 | 650 | 3.0·4.0·1.0 |
| Q5_K_M (q8_0) | 1 | 78 | ✗ | 0.67 | 0.00 | 1.00 | 1.00 | 1.00 | 0.58 | 1.00 | 4095 | 4.0·3.0·4.0 |
| Q5_K_M (q8_0) | 2 | 79 | ✗ | 0.67 | 0.00 | 1.00 | 1.00 | 1.00 | 0.67 | 1.00 | 4095 | 4.0·4.0·4.0 |
| **Q5_K_M (q8_0) — mean** | – | **80** | 0% | 0.78 | 0.13 | 0.94 | 0.94 | 1.00 | 0.64 | 1.00 | | |
| Q6_K (q8_0) | 0 | 77 | ✗ | 0.67 | 0.00 | 1.00 | 1.00 | 1.00 | 0.50 | 1.00 | 1142 | 4.0·4.0·4.0 |
| Q6_K (q8_0) | 1 | 77 | ✗ | 0.67 | 0.00 | 0.92 | 1.00 | 1.00 | 0.62 | 1.00 | 1526 | 5.0·4.0·4.0 |
| Q6_K (q8_0) | 2 | 76 | ✗ | 0.67 | 0.00 | 0.94 | 1.00 | 1.00 | 0.50 | 1.00 | 3756 | 4.0·4.0·5.0 |
| **Q6_K (q8_0) — mean** | – | **77** | 0% | 0.67 | 0.00 | 0.95 | 1.00 | 1.00 | 0.54 | 1.00 | | |
| 35B-A3B (f16) | 0 | 82 | ✗ | 0.33 | 0.60 | 1.00 | 1.00 | 1.00 | 0.62 | 1.00 | 4095 | 4.0·4.0·4.0 |
| 35B-A3B (f16) | 1 | 93 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.43 | 1.00 | 4095 | 4.0·4.0·4.0 |
| 35B-A3B (f16) | 2 | 74 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 0.69 | 1.00 | 4095 | 3.0·4.0·4.0 |
| **35B-A3B (f16) — mean** | – | **83** | 0% | 0.55 | 0.47 | 1.00 | 1.00 | 1.00 | 0.58 | 1.00 | | |
| q5-d128-f16-rb16384 (f16) | 0 | 83 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | 1.00 | 0.91 | 1.00 | 4503 | 4.0·4.0·4.0 |
| q5-d128-f16-rb16384 (f16) | 1 | 79 | ✗ | 0.33 | 0.40 | 1.00 | 1.00 | 1.00 | 0.58 | 1.00 | 8512 | 4.0·4.0·3.0 |
| q5-d128-f16-rb16384 (f16) | 2 | 81 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | 1.00 | 0.58 | 1.00 | 8615 | 3.0·3.0·4.0 |
| **q5-d128-f16-rb16384 (f16) — mean** | – | **81** | 0% | 0.56 | 0.27 | 1.00 | 1.00 | 1.00 | 0.69 | 1.00 | | |
| q5-d128-f16-rb4096 (f16) | 0 | 81 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | 1.00 | 0.64 | 1.00 | 4095 | 4.0·4.0·4.0 |
| q5-d128-f16-rb4096 (f16) | 1 | 76 | ✗ | 0.33 | 0.20 | 1.00 | 1.00 | 1.00 | 0.58 | 1.00 | 4095 | 3.0·3.0·3.0 |
| q5-d128-f16-rb4096 (f16) | 2 | 81 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | 1.00 | 0.58 | 1.00 | 4095 | 4.0·3.0·4.0 |
| **q5-d128-f16-rb4096 (f16) — mean** | – | **79** | 0% | 0.56 | 0.20 | 1.00 | 1.00 | 1.00 | 0.60 | 1.00 | | |
| un-d128-f16-rb16384 (f16) | 0 | 79 | ✗ | 0.67 | 0.00 | 0.92 | 1.00 | 1.00 | 0.92 | 1.00 | 7529 | 4.0·4.0·4.0 |
| un-d128-f16-rb16384 (f16) | 1 | 81 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | 1.00 | 0.64 | 1.00 | 7726 | 4.0·4.0·4.0 |
| un-d128-f16-rb16384 (f16) | 2 | 84 | ✗ | 1.00 | 0.20 | 0.92 | 1.00 | 1.00 | 0.58 | 1.00 | 8490 | 3.0·3.0·4.0 |
| **un-d128-f16-rb16384 (f16) — mean** | – | **81** | 0% | 0.78 | 0.13 | 0.94 | 1.00 | 1.00 | 0.71 | 1.00 | | |
| a3b-d128-f16-rb16384 (f16) | 0 | 88 | ✗ | 0.33 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 8621 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384 (f16) | 1 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 9418 | 3.0·3.0·3.0 |
| a3b-d128-f16-rb16384 (f16) | 2 | 81 | ✗ | 0.67 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 8974 | 3.0·4.0·4.0 |
| **a3b-d128-f16-rb16384 (f16) — mean** | – | **89** | 0% | 0.67 | 0.53 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| a3b-d128-f16-rbmax (f16) | 0 | 88 | ✗ | 0.33 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 8621 | 4.0·4.0·4.0 |
| a3b-d128-f16-rbmax (f16) | 1 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 9418 | 3.0·3.0·4.0 |
| a3b-d128-f16-rbmax (f16) | 2 | 81 | ✗ | 0.67 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 8974 | 4.0·4.0·4.0 |
| **a3b-d128-f16-rbmax (f16) — mean** | – | **89** | 0% | 0.67 | 0.53 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| a3b-d128-f16-rb16384-t03 (f16) | 0 | 76 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 11299 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 1 | 71 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.93 | 1.00 | 8923 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384-t03 (f16) | 2 | 82 | ✗ | 0.33 | 0.40 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 9026 | 4.0·3.0·3.0 |
| **a3b-d128-f16-rb16384-t03 (f16) — mean** | – | **76** | 0% | 0.22 | 0.13 | 1.00 | 1.00 | 1.00 | 0.98 | 1.00 | | |
| a3b-d128-f16-rb16384-t10 (f16) | 0 | 68 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.50 | 1.00 | 13964 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 1 | 30 | ✗ | 0.33 | 0.00 | 0.00 | 0.00 | 1.00 | 0.50 | 1.00 | 10856 | 2.0·3.0·2.0 |
| a3b-d128-f16-rb16384-t10 (f16) | 2 | 76 | ✗ | 1.00 | 0.00 | 0.92 | 0.83 | 1.00 | 0.38 | 1.00 | 8885 | 3.0·4.0·2.0 |
| **a3b-d128-f16-rb16384-t10 (f16) — mean** | – | **58** | 0% | 0.44 | 0.00 | 0.64 | 0.61 | 1.00 | 0.46 | 1.00 | | |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 0 | 81 | ✗ | 0.67 | 0.20 | 0.92 | 1.00 | 1.00 | 0.77 | 1.00 | 11141 | 4.0·3.0·4.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 1 | 84 | ✗ | 0.67 | 0.20 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 7417 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384-qwen-gen (f16) | 2 | 69 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.62 | 1.00 | 7669 | 4.0·4.0·3.0 |
| **a3b-d128-f16-rb16384-qwen-gen (f16) — mean** | – | **78** | 0% | 0.45 | 0.13 | 0.97 | 1.00 | 1.00 | 0.80 | 1.00 | | |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 0 | 86 | ✗ | 0.67 | 0.40 | 1.00 | 1.00 | 1.00 | 0.86 | 1.00 | 11870 | 4.0·4.0·4.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 1 | 66 | ✗ | 0.00 | 0.00 | 0.92 | 1.00 | 1.00 | 0.54 | 1.00 | 9818 | 3.0·3.0·3.0 |
| a3b-d128-f16-rb16384-unsloth-reason (f16) | 2 | 78 | ✗ | 0.67 | 0.00 | 0.94 | 1.00 | 1.00 | 0.78 | 1.00 | 7287 | 3.0·2.0·3.0 |
| **a3b-d128-f16-rb16384-unsloth-reason (f16) — mean** | – | **77** | 0% | 0.45 | 0.13 | 0.96 | 1.00 | 1.00 | 0.73 | 1.00 | | |
| _haiku_ ref | 0 | 82 | ✗ | 1.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.54 | 1.00 | | |
| _haiku_ ref | 1 | 83 | ✗ | 1.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.67 | 1.00 | | |
| _haiku_ ref | 2 | 89 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.62 | 1.00 | | |
| _**haiku — mean**_ | – | **85** | 0% | 1.00 | 0.13 | 1.00 | 1.00 | 1.00 | 0.61 | 1.00 | | |
| _sonnet_ ref | 0 | 99 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.83 | 1.00 | | |
| _sonnet_ ref | 1 | 64 | ✗ | 0.67 | 0.40 | 0.00 | 1.00 | 1.00 | 0.85 | 1.00 | | |
| _sonnet_ ref | 2 | 96 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.87 | 1.00 | | |
| _**sonnet — mean**_ | – | **86** | 33% | 0.89 | 0.73 | 0.67 | 1.00 | 1.00 | 0.85 | 1.00 | | |
| _opus_ ref | 0 | 100 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.95 | 1.00 | | |
| _opus_ ref | 2 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _**opus — mean**_ | – | **98** | 33% | 1.00 | 0.87 | 1.00 | 1.00 | 1.00 | 0.98 | 1.00 | | |


---

## Appendix B — all generated charts

Every chart is generated over **all 14 cells** by `make_charts.py` / `make_charts_detailed.py`. Charts embedded in the body above are not repeated here.

**Cell-level** (`charts/`):

| Chart | What it shows |
|---|---|
| [`quality_deterministic.svg`](charts/quality_deterministic.svg) | deterministic objective accuracy per cell |
| [`quality_judge.svg`](charts/quality_judge.svg) | blind-judge score per cell — a 2.7-3.6 band, not resolvable |
| [`hard_pass.svg`](charts/hard_pass.svg) | hard-pass rate per cell (0-7%) |
| [`quality_vs_cost.svg`](charts/quality_vs_cost.svg) | quality against token cost |
| [`quality_vs_time.svg`](charts/quality_vs_time.svg) | quality against full-answer time — the 35B's trade, at a glance |
| [`throughput.svg`](charts/throughput.svg) | prefill / decode throughput per cell |
| [`latency.svg`](charts/latency.svg) | ttft to ttfa per cell |
| [`token_economy.svg`](charts/token_economy.svg) | thinking tokens vs answer tokens — the budget axis, visually |
| [`task_heatmap.svg`](charts/task_heatmap.svg) | cell x task score matrix |

**Per-task** (`charts/detailed/`):

| Chart | What it shows |
|---|---|
| [`d1_capability_by_task.svg`](charts/detailed/d1_capability_by_task.svg) | local cells vs the reference ladder, per task |
| [`d3_quant_cost.svg`](charts/detailed/d3_quant_cost.svg) | quant ladder against cost |
| [`d4_efficiency_by_task.svg`](charts/detailed/d4_efficiency_by_task.svg) | efficiency per task |
| [`d5_hardpass_by_task.svg`](charts/detailed/d5_hardpass_by_task.svg) | hard-pass by task |
| [`d6_model_by_task.svg`](charts/detailed/d6_model_by_task.svg) | 27B vs 35B per task |
| [`d7_judge_axes_by_task.svg`](charts/detailed/d7_judge_axes_by_task.svg) | design / clarity / robustness per task — robustness is the low axis nearly everywhere |
| [`d8_objective_by_task.svg`](charts/detailed/d8_objective_by_task.svg) | objective breakdown per task |

**Full verdict tables.** The complete blind-judge table — one row per candidate (config x task x rep) with TS %, hard-pass, the three judge axes, the judge's one-line note and the deterministic `fails:` list — is in [`charts/appendix.md`](charts/appendix.md), together with the cell-level data table. Per-task equivalents: [`charts/detailed/appendix.md`](charts/detailed/appendix.md).
