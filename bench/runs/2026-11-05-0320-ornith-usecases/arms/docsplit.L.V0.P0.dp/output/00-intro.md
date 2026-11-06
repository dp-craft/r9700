<!-- meta
date: 2026-07-15 22:00
slug: hardest-tasks-27b-vs-35b
title: Hardest tasks at 128k — 27B quant ladder, reasoning budget, and 35B-A3B sampling (R9700)
takeaway: 14 cells x 5 tasks x 3 reps = 210 replies at ~132.9k tokens. Three axes, one clear answer each. QUANT: bounded null — Q4_K_M 78.3, Q4_K_XL 69.8, Q5_K_M 76.5, Q6_K 80.9 TS%, no paired delta significant, design resolves only >=12 pts; the accidental KV control (Q5_K_M f16 74.3 vs q8_0 76.5) bounds the README's KV confound as negligible. BUDGET: 4096 to 16384 buys +0.3 pts on the 27B (t=0.37, ns) for +60s; above ~4k the budget stops binding — 14 of 15 35B replies are IDENTICAL between 16384 and unlimited, and the one reply unlimited freed ran away to 31,093 think tokens and fell 77 to 45. Refutes our own sourced hypothesis that truncated thinking drives the wall. The MoE, unlike the dense 27B, DOES benefit from a bigger budget (35B rb4096 vs rb16384 -4.3, t=-5.45, SIGNIFICANT — surfaced by the 2026-07-16 --baseline re-analysis). SAMPLING (35B): temp 0.6 (Qwen's coding recipe) is the best point at 77.5; use the recipe WHOLE. CORRECTED 2026-07-16 (re-baselined within-model): temp 0.3's "significant" deficit was a wrong-baseline artifact and is WITHDRAWN (-7.5, t=-2.60, ns); only the whole general-mode preset survives (-15.4, t=-3.41). The presence_penalty>0 presets lose ~30-40% decode — but the mechanism ("pp breaks MTP acceptance") is REFUTED: it is a fixed ~2 ms/tok host tax on the penalties sampler, no MTP interaction, acceptance untouched (see docs/analysis/2026-07-16-0927-mtp-sampler-tax.md). STABLE: the wall is cleanliness (lint 0.36, types 0.47) not logic (tests 0.84, reuse 0.99); 35B is ~2.6-3.7x faster to a full answer; reruns pay (delta rerun +4.6..+17.5). GTT spill 1551-2841 MiB in ALL 14 cells. References are NOT depth-matched (~213x shallower) — no bare local-vs-reference delta is a capability gap.
-->

# Benchmark: Hardest tasks at 128k — 27B quant ladder, reasoning budget, and 35B-A3B sampling — R9700 (gfx1201)

- **Date:** 2026-07-15 22:00 · **Track:** campaign (quality capture + deterministic grading + blind judge)
- **GPU/Host:** AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB / 32624 MiB) · Ryzen 5 3600 · 31 GB RAM, no swap · Ubuntu 24.04 · kernel 6.17 · ROCm 7.x · `HSA_OVERRIDE_GFX_VERSION=12.0.1`
- **Runtimes/builds:** llama.cpp **Vulkan b9950** (`961e4b26a`) · `-ub 2048 -b 4096 -fa on` · **MTP on** · ctx **163840** · prefix cache (CLAIMED from `README.md` §2; build MEASURED from `out/props_*.json`)
- **Models:** Qwen3.6-27B-MTP at Q4_K_M / UD-Q4_K_XL / Q5_K_M / Q6_K · Qwen3.6-35B-A3B-UD-Q4_K_M
- **Scale:** **14 cells × 5 tasks × 3 reps = 210 graded replies**, every one at the identical ~132.9k-token prompt
- **Data:** `out/summary.md` (deterministic digest — every number below is read from it) · `calibration-reps.jsonl` (reference ladder, 3 reps) · `charts/`, `charts/detailed/`

---

