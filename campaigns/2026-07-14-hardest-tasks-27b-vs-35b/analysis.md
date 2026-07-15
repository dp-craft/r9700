<!-- meta
date: 2026-07-15 06:37
slug: hardest-tasks-27b-vs-35b
title: Hardest tasks — 27B quant ladder (Q4_K_M→Q6_K) vs 35B-A3B at 128k — R9700
takeaway: On the 4 hardest TS-TDD tasks at 120k depth, the 27B quant ladder spans TS 67–82% (Q6_K best, Q4_K_XL worst) — **non-monotonic and inside the rep-to-rep spread**, so precision does NOT clear the strict lint/types wall (mean lint 0.36 · types 0.45 vs tests 0.90 · edge 0.92 · reuse 1.00): the wall is style/type discipline, not logic, and not a quantization artifact. Capacity doesn't clear it either — 35B-A3B scores 71% (Δ-11 vs best 27B) but is **3.6× faster end-to-end** (59.8s vs 215.1s, 116 vs 31.5 t/s). Against the **re-graded (fractional) reference ladder** the best local cell (82%) now lands **at haiku (83, Δ-1), below sonnet (87, Δ-5) and opus (92, Δ-10)** — on this hardest subset the 27B is a haiku-class coder, not a sonnet-class one. Best value = Q4_K_M (78% @ 152.8s). ⚠ HEALTH: all five cells spilled 1685–2030 MiB into GTT (host RAM) — freeze risk. Grader fix verified: tests/edge now real (0.90/0.92), 0 fails, 0 runaways.
-->

# Benchmark: Hardest tasks — 27B quant ladder vs 35B-A3B at 128k — R9700 (gfx1201)

- **Date:** 2026-07-15 06:37 · **Track:** engine-bench (quality capture + deterministic grader + blind LLM judge; not a tuning sweep)
- **GPU/Host:** AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB / 32624 MiB) · Ryzen 5 3600 · 31 GB RAM, no swap · Ubuntu 24.04 · ROCm 7.x · `HSA_OVERRIDE_GFX_VERSION=12.0.1`
- **Runtimes/builds:** llama.cpp **b9950**, **Vulkan/RADV** backend · `-ub 2048 -b 4096 -fa on` · **MTP-on** · ctx **163840** · prefix cache · sampling temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 · reasoning-budget **4096** (fixed for every cell)
- **Models:** Qwen3.6-27B-MTP @ **Q4_K_M · UD-Q4_K_XL · Q5_K_M · Q6_K** + Qwen3.6-35B-A3B-MTP @ Q4_K_M
- **Data:** `campaigns/2026-07-14-hardest-tasks-27b-vs-35b/out/` (5 cells × 4 tasks × 3 reps = 60 graded replies) · digest `out/summary.md` · charts `charts/appendix.md`

## Summary

Five model cells were run on the **4 hardest TypeScript-TDD tasks** (`rate-limiter`, `lru-cache`, `async-memo`, `expr-eval`) inside **120k tokens of real TypeScript context** (~132.7k real tokens), 3 reps each, with everything except the model/quant held fixed. **Precision does not clear the strict-code wall.** The 27B quant ladder runs **Q4_K_M 78% → Q4_K_XL 67% → Q5_K_M 76% → Q6_K 82%** (MEASURED) — non-monotonic, and the whole 15-point span is smaller than the rep-to-rep spread *inside* single cells (Q4_K_XL on `expr-eval`: 40/30/56; 35B-A3B on `expr-eval`: 11/64/57), so no quant ordering is established here. **Capacity does not clear it either:** the 35B-A3B MoE scores **71%**, Δ**-11** below the best 27B. What the fractional grader shows instead is where every cell dies: **lint 0.36 · types 0.45** against **tests 0.90 · edge 0.92 · reuse 1.00** (mean across cells, MEASURED) — the models write logic that works and retrieve the planted util perfectly, then fail `eslint --strict`/`tsc`. The blind judge agrees, scoring design/clarity ≈3.1–3.5/5 while praising the same replies the grader fails. Against the reference ladder — **now re-graded on the same fractional scale** (`out/regrade_refs.log`, add-on A) — the best local cell (82%) lands **level with haiku (83, Δ−1), below sonnet (87, Δ−5) and opus (92, Δ−10)**: on the *hardest* subset the 27B is a **haiku-class** coder, not the sonnet-class one the binary-graded ladder suggested. One caveat survives (§(c)): opus's 92 covers only 2 of the 4 tasks. **Speed is where the MoE wins decisively:** 35B-A3B finishes in **59.8s** at **116.1 t/s** decode vs Q6_K's **215.1s** at **31.5 t/s** — 3.6× faster for 11 TS points. ⚠ **HEALTH: all five cells spilled 1685–2030 MiB into GTT** (host RAM) against a ~77 MiB idle baseline — freeze risk, flagged in §HEALTH. The **grader fix worked**: tests/edge are now real numbers (0.90/0.92, not the previous run's harness-bug zeros), with **0 fails, 0 runaways, 0 truncations**.

## Legend — every knob & label used in this run

| Term | What it is | Effect on this box (R9700 / RDNA4, 32 GB) | How it's tested here |
|------|------------|-------------------------------------------|----------------------|
| `Q4_K_M` / `UD-Q4_K_XL` / `Q5_K_M` / `Q6_K` | GGUF weight quantization of the 27B (16.1 / 16.7 / 18.5 / 21.3 GiB weights) | MEASURED: TS 78 / 67 / 76 / 82% — **non-monotonic**, span < intra-cell rep spread → no ordering established | the primary axis; one cell each, all else fixed |
| `35B-A3B` | Qwen3.6-35B MoE, ~3B active params, Q4_K_M (21.1 GiB) | MEASURED: TS 71% (−11 vs best 27B) but **116.1 t/s decode** vs 31.5–44.3 for the dense 27B | one cell, same tasks/reps/budget |
| KV `f16` | 16-bit KV-cache entries — the baseline | 27B is hybrid-attention (16 of 65 blocks carry KV) → **64 KiB/tok**; caps ctx ~189k (Q4_K_M) / ~179k (XL); 35B-A3B is KV-light at 20 KiB/tok | Q4_K_M, Q4_K_XL, 35B-A3B cells |
| KV `q8_0` | 8-bit block-quantized KV cache | **34 KiB/tok** → caps ~195–260k ctx. **Forced** on Q5_K_M+Q6_K: their weights make f16 cap ~150k / ~104k, below the ~145k the prompt+gen needs. A **confound** — see §KV confound | Q5_K_M, Q6_K cells |
| MTP | multi-token prediction speculative decoding (`--spec-type draft-mtp`, draft layer in the GGUF) | on for every cell (held fixed); overhead ≈3.5 GiB incl. the draft batch (MEASURED at the Q6_K load) | not varied here |
| depth `d128` | code-review prompt padded to ~120k tokens (≈132.7k real tok) from the tracked corpus | forces ctx 163840; prefill dominates ttfa (47–178s) | fixed for every cell |
| reasoning-budget `rb4096` | thinking-token budget before the answer | MEASURED: cells spend **3629–4095** of 4096 — the model spends nearly its whole budget. **The budget sweep is a separate follow-up campaign; not analyzed here** | fixed at 4096 for every cell |
| `TS %` | weighted deterministic score over the objective vector (0–1 each) | the headline capability number; MEASURED per rep, means in the tables | `score_typescript.py` (tsc + eslint + vitest) |
| `hard` / hard-pass | **every** gate objective at 1.0 simultaneously | MEASURED: only **2 of 60** replies (Q6_K async-memo rep1; 35B-A3B async-memo rep2) | binary per reply |
| `types` / `lint` | **fractional** since add-on A: `1 − min(1, errors/K)` (K=3 / K=5) | MEASURED means **0.45 / 0.36** — the wall. 1 error = 0.8, not 0, so cleanliness now has resolution | `tsc --strict`, `eslint` error counts |
| `tests` / `edge` | visible test suite / hidden edge-case suite pass fraction | MEASURED means **0.90 / 0.92** — logic is largely fine. **These are trustworthy this run** (see §Grader fix) | single-process vitest (`--no-file-parallelism`), fail-loud |
| `reuse` | did the reply use the planted util from deep context | MEASURED **1.00** everywhere it applies → **no lost-in-the-middle** at 120k | graded on `lru-cache`/`rate-limiter`; `—` on the other two |
| `bdd` | test-style/behaviour-description quality fraction | MEASURED: the most volatile objective (0.00–1.00 within one cell) | grader heuristic |
| `novj` | no-vitest-jest-mixing / harness hygiene | MEASURED **1.00** everywhere — never a limiter | grader check |
| `judge d·c·r` | blind judge (opus) design · clarity · robustness, 0–5 | MEASURED 3.1–3.5/5 overall; **robustness is consistently the lowest of the three** in every cell | blind review of each reply, `judge_scores.jsonl` |
| `ttfa` / `full s` | time to first **answer** token (after thinking) / time to last token | MEASURED: ttfa 47.1–178.2s, full 59.8–215.1s — prefill at 120k + a ~4k thinking budget dominate | per-request timing in `capture.py` |
| **peak VRAM / peak GTT** | device VRAM high-water · GPU-accessible host-RAM (GTT) high-water | GTT should sit near its **~77 MiB idle baseline**; MEASURED **1685–2030 MiB in all five cells** = **host-RAM spill, freeze risk** | `vram_sampler.py` → `gpu_*.csv` |
| `runaway %` / `fails` / `trunc %` | reply never terminated / cell errored / thinking hit the budget cap | MEASURED **0 / 0 / 0** across all five cells — a clean run | capture + grader bookkeeping |

## Results (table first — all MEASURED, from `out/summary.md`)

| cell | model | quant | depth | KV | budget | n | **TS %** | hard % | judge/5 | judge d·c·r | think tok | ans tok | ttfa s | full s | decode t/s | **peak VRAM MiB** | **peak GTT MiB** | runaway % | fails |
|------|-------|-------|-------|----|-------:|--:|---------:|-------:|--------:|:-----------:|----------:|--------:|-------:|-------:|-----------:|------------------:|-----------------:|----------:|------:|
| `q6-d128-q8-rb4096` | Qwen3.6-27B | **Q6_K** | 120k | **q8_0** | 4096 | 12 | **82** | 8 | 3.3 | 3.2·3.7·3.0 | 4047 | 1279 | 178.2 | 215.1 | 31.5 | 30888 | 1957 ⚠ | 0 | 0 |
| `un-d128-f16-rb4096` | Qwen3.6-27B-MTP | Q4_K_M | 120k | f16 | 4096 | 12 | **78** | 0 | **3.5** | 3.6·3.7·3.3 | 4095 | 1286 | 126.6 | 152.8 | 44.3 | 30322 | **2030** ⚠ | 0 | 0 |
| `q5-d128-q8-rb4096` | Qwen3.6-27B | Q5_K_M | 120k | **q8_0** | 4096 | 12 | 76 | 0 | 3.3 | 3.4·3.4·3.2 | 3629 | 1181 | 155.9 | 187.2 | 33.6 | **28139** | 1957 ⚠ | 0 | 0 |
| `a3b-d128-f16-rb4096` | Qwen3.6-**35B-A3B** | UD-Q4_K_M | 120k | f16 | 4096 | 12 | 71 | 8 | 3.1 | 3.2·3.3·2.8 | 4055 | 1606 | **47.1** | **59.8** | **116.1** | 27764 | **1685** ⚠ | 0 | 0 |
| `xl-d128-f16-rb4096` | Qwen3.6-27B | UD-Q4_K_XL | 120k | f16 | 4096 | 12 | 67 | 0 | 3.2 | 3.2·3.5·2.8 | 3963 | 1315 | 124.6 | 151.7 | 43.9 | **31224** | 1957 ⚠ | 0 | 0 |

*(Rows sorted by TS %; n = 12 = 4 tasks × 3 reps. **KV is NOT uniform** — Q5_K_M and Q6_K run q8_0 because their weights cannot fit f16 KV at ctx 163840; see §KV confound. **⚠ = GTT peak ~22–26× the ~77 MiB idle baseline = host-RAM spill, freeze risk** — see §HEALTH. Bold marks the best/worst value in a column. No cell OOM'd, failed, ran away, or truncated its thinking; peak VRAM ≤ 31224 < 32624 physical. `trunc % = 0` for all five cells (`charts/appendix.md` data table).)*

## HEALTH — GTT host-RAM spill in **all five cells** (flagged loudly)

`summary.md`'s Health line reports **GTT spill (>500 MiB) in every cell**: `un-d128-f16-rb4096`, `xl-d128-f16-rb4096`, `q5-d128-q8-rb4096`, `q6-d128-q8-rb4096`, `a3b-d128-f16-rb4096`. Peak GTT ran **1685–2030 MiB** (MEASURED) against a **~77 MiB idle baseline** on this box — i.e. 1.6–2.0 GiB of the working set living in GPU-accessible **host RAM**, which is the freeze-risk signal on this hardware.

- **Nothing failed because of it** (MEASURED): fails 0, runaway 0%, peak VRAM 27764–31224 MiB all under the 32624 MiB physical ceiling, every cell generated fine.
- **It is not driven by the VRAM headroom** (MEASURED): the *lowest*-VRAM cell (35B-A3B, 27764 MiB) still spilled 1685 MiB, and the *highest* (Q4_K_XL, 31224 MiB) spilled 1957 MiB — the same as the mid-pack Q5/Q6 cells. The spread across cells is only 345 MiB while peak VRAM spans 3460 MiB.
- **INFERRED:** the spill therefore tracks the **allocator/serving substrate at ctx 163840 + MTP**, not per-model pressure — consistent with the prior campaign (`2026-07-13-27b-quality-at-depth`), which measured the same universal spill at 785–2049 MiB across ten cells with different KV settings. **OPEN:** the root cause is not established from our data; it survives as an open item across two campaigns.
- **Consequence for practice:** monitor GTT in production at 128k, keep peak VRAM off the ceiling, and treat `xl` (31224 MiB, 1.4 GiB from physical) as the least comfortable cell to deploy.

## Grader fix — tests/edge are trustworthy this run

The previous campaign's headline was voided by a harness bug (a `vitest` worker-pool failure silently zeroed `tests`+`edge` on all 120 replies). This run used **single-process vitest** (`--no-file-parallelism`), a **fail-loud grader** (retry once, then record a `grade_error` `HARNESS:` row — never a silent `tests=0`), and a **pre-grade self-check** that aborts if vitest isn't working.

**Verdict: the fix holds (MEASURED).** `summary.md`'s Health line reports **no `grade_error`/HARNESS rows, no runaways, and `fails 0` in every cell**; `tests` and `edge` now land at **0.90 / 0.92** mean, with per-rep values spread across the full 0.00–1.00 range (e.g. `expr-eval` XL rep1 tests 0.12; 35B-A3B `expr-eval` rep0 tests 0.07, edge 0.00) rather than collapsed to zero. The only Health item to surface is the **GTT spill** above.

## (a) The 27B quant ladder — does precision clear the wall?

**No.** The ladder (TS %, MEASURED, `summary.md` finding (a)):

| quant | weights | KV | TS % | Δ vs Q4_K_M | hard % | judge/5 | full s |
|-------|--------:|----|-----:|------------:|-------:|--------:|-------:|
| Q4_K_M | 16.1 GiB | f16 | **78** | — | 0 | 3.5 | 152.8 |
| UD-Q4_K_XL | 16.7 GiB | f16 | **67** | **−11** | 0 | 3.2 | 151.7 |
| Q5_K_M | 18.5 GiB | q8_0 ⚠ | **76** | −2 | 0 | 3.3 | 187.2 |
| Q6_K | 21.3 GiB | q8_0 ⚠ | **82** | **+4** | 8 | 3.3 | 215.1 |

Three things kill the "precision buys quality" reading:

1. **It is not monotonic (MEASURED).** Precision rises left to right, quality does not: Q4_K_XL — *more* bits than Q4_K_M — is the **worst cell in the campaign at 67%**, 11 points below the cheapest quant. A monotonic precision effect cannot produce that shape.
2. **The span is smaller than the noise (INFERRED, from the per-rep tables).** The whole ladder spans 15 points (67→82). Inside single cells, three reps of the *same* config on the *same* task span more than that: Q4_K_XL on `expr-eval` scores **40 / 30 / 56** (26-point spread); Q5_K_M on `rate-limiter` scores **67 / 94 / 71** (27 points); Q6_K on `lru-cache` scores **90 / 89 / 74**. With n=12 per cell and rep spreads of 25+ points, a 4-point Q6_K-over-Q4_K_M lead is not a result — it is a coin flip. Per the repo's plateau rule, these cells are a **tie**.
3. **Precision does not touch the failing objectives (MEASURED).** Q6_K, the heaviest quant, still scores **types 0.00 on every one of its three `expr-eval` reps** and lint 0.20/0.00/0.00 there — identical to Q4_K_M's 0.00/0.00. Extra bits bought nothing on exactly the axis that defines the wall.

**Therefore (INFERRED): the strict lint/types wall is not a quantization artifact.** The fractional grader (add-on A) is what makes this legible: because `lint`/`types` now resolve error *counts* rather than pass/fail, we can see the cells sitting at **lint 0.36 / types 0.45** — that is, roughly 3 eslint errors and ~1.6 tsc errors per reply on average, everywhere on the ladder — while `tests` 0.90, `edge` 0.92 and `reuse` 1.00 say the logic is right and the deep-context retrieval is perfect. The models understand the problem and fail the toolchain. Adding bits does not teach style discipline.

### KV confound (must be read with the ladder)

**Q5_K_M and Q6_K run `q8_0` KV; Q4_K_M, Q4_K_XL and 35B-A3B run `f16`** — forced, not chosen: the 27B is hybrid-attention (16 of 65 blocks carry KV → f16 = 64 KiB/tok, q8_0 = 34), so at ctx 163840 f16 caps out at **~150k for Q5_K_M** and **~104k for Q6_K**, both under the ~145k the 132.7k prompt + generation needs. Any Q5/Q6 ladder delta is therefore **weight-quant *plus* a KV effect**, not weight-quant alone. **Mitigation (CLAIMED, from the prior campaign):** f16-vs-q8_0 at 128k measured **−2.3% TS**, inside the repo's **≤5% rule**, so the KV component is small relative to the ±25-point rep spread we actually see. **INFERRED:** the confound is real but second-order here — it cannot rescue a monotonic reading of a ladder whose noise is 10× the KV effect.

## (b) 27B (best quant) vs 35B-A3B — does capacity clear the wall?

**No. Capacity fails where precision failed** (MEASURED, `summary.md` finding (b)): best 27B (Q6_K) **82%** vs 35B-A3B **71%** — **Δ−11 for the bigger MoE**. It also loses to the *cheapest* 27B quant (Q4_K_M 78%, Δ−7) and to Q5_K_M (76%).

| | best 27B (Q6_K) | 35B-A3B | Δ |
|---|---:|---:|---:|
| TS % | 82 | 71 | **−11** |
| hard % | 8 | 8 | 0 |
| judge/5 | 3.3 | **3.1** | −0.2 |
| judge d·c·r | 3.2·3.7·3.0 | 3.2·3.3·2.8 | −0.4 clarity, −0.2 robust |
| full s | 215.1 | **59.8** | **−155.3 (3.6× faster)** |

The MoE's problem is **variance, not ceiling** (INFERRED from the per-rep tables). Its best reps are genuinely competitive — `async-memo` 95/94 (one hard-pass), `lru-cache` 89, `rate-limiter` 87 — but it produces the two worst replies in the entire campaign: **`expr-eval` rep0 at 11%** (tests 0.07, edge 0.00) and **`rate-limiter` rep2 at 48%** (tests 0.33, edge 0.00). Both are single-reply collapses that drag a 12-reply cell mean down ~5 points on their own. Its objective profile confirms the wall is untouched: on `lru-cache` the MoE posts **types 1.00 on all three reps** — the best types score of any cell on that task — and still lands at 82% mean because **lint collapses to 0.20** (reps: 0.60/0.00/0.00). More capacity bought type-correctness on one task and immediately gave it back on lint.

**Consequence for practice (INFERRED):** neither axis available to us — **precision** (Q4_K_M→Q6_K, +5.2 GiB weights) nor **capacity** (27B→35B-A3B MoE) — moves the strict-code wall. The wall is a *behaviour* (style/type discipline under strict tooling), and the lever for it is not the model: it is a **repair loop** (add-on B: feed the exact `tsc`/`eslint` errors back for one fix turn) or **lower-temperature sampling** (add-on C). Both are already scaffolded and unrun — they are the campaign's real follow-ups, alongside the deferred reasoning-budget sweep.

## (c) Capability per task vs the haiku/sonnet/opus ladder

Per-task means (MEASURED, computed from the per-rep tables; references are one-shot):

| task | tier | Q4_K_M | Q4_K_XL | Q5_K_M | **Q6_K** | 35B-A3B | _haiku_ | _sonnet_ | _opus_ |
|------|------|-------:|--------:|-------:|---------:|--------:|--------:|---------:|-------:|
| `lru-cache` | sonnet | **85** | 63 | 84 | 84 | 82 | 79 | **95** | — (no calib) |
| `rate-limiter` | sonnet | 79 | 76 | 78 | **91** | 71 | 95 | **98** | — (no calib) |
| `async-memo` | opus | **91** | 88 | 78 | 90 | 87 | 91 | 87 | **100** |
| `expr-eval` | opus | 58 | 42 | **64** | 63 | 44 | 67 | 67 | **83** |
| **cell mean** | | 78 | 67 | 76 | **82** | 71 | **83** | **87** | **92** |

Headline (MEASURED, `summary.md` finding (d)): best local cell **82%** vs **haiku 83% (Δ−1) · sonnet 87% (Δ−5) · opus 92% (Δ−10)**.

**This is a correction to the previous campaign's reading, and it is the most important number in this report.** The prior campaign concluded the 27B "sits in the haiku→sonnet band"; on the *hardest* subset, with the grader bug fixed **and the references re-graded on the same fractional scale**, the honest verdict is narrower: **the best local cell is level with haiku (Δ−1, a tie by any reading of the rep spread) and clearly below sonnet (Δ−5)**. The 27B is a **haiku-class coder on hard strict-TypeScript work**, not a sonnet-class one.

**Why this moved (MEASURED — the reference re-grade):** the references were originally graded on the **binary** lint/types scale, which zeroed them for a single eslint error. `out/regrade_refs.log` shows the fractional re-grade (add-on A, `grader: fractional-2026-07-15`) applied to the same reference answers: **haiku `async-memo` 0.667→0.912**, **sonnet `async-memo` 0.625→0.870**, **haiku `lru-cache` 0.679→0.793**, **haiku `rate-limiter` 0.834→0.948**, **sonnet `lru-cache` 0.831→0.946**; `expr-eval` was unchanged (0.667/0.667/0.833 — those genuinely have 5+ lint errors). **INFERRED:** the binary scale was understating the references by 8–25 points each, exactly as the README's add-on-A caveat predicted — and the "best local beats sonnet by 4" claim it produced was an artifact of comparing a fractional local score against a binary reference score. **Both sides are now on the fractional scale; the ladder above is like-for-like.** The one caveat that survives:

**Opus's 92% is a 2-task mean, not a 4-task mean (INFERRED).** Opus has no calibration point on `lru-cache` or `rate-limiter` (README **add-on D** — known and unclosed), so 92 = mean(async-memo 100, expr-eval 83), i.e. **only the two opus-tier tasks**. Like-for-like on those same two tasks: best-local Q6_K **(90+63)/2 ≈ 76.5** vs opus **92** — a **~15-point gap, not 10**. On that same 2-task subset haiku scores **79** and sonnet **77**, so the local cell is still haiku-class there. The Δ−10 flatters the local models by averaging in two sonnet-tier tasks opus never ran. **OPEN until add-on D is run.**

**The wall is quantitative, and it is where the ladder gap lives (MEASURED).** Mean `lint` across the four tasks: **local cells 0.36** vs **haiku 0.60 · sonnet 0.65**; mean `types`: **local 0.45** vs **haiku 0.67 · sonnet 0.67**. **INFERRED:** the references are not clean either — sonnet loses points to the same linter on 3 of 4 tasks — but the local models emit roughly **twice as many `eslint`/`tsc` errors per reply** on the same prompts and the same grader. That gap, not logic (`tests` 0.90 · `edge` 0.92 · `reuse` 1.00), is the entire Δ−5 to sonnet.

**Per-task structure (the more useful reading):**

- **`expr-eval` is where everyone dies, and the failure is shared with the frontier (MEASURED).** Every local cell is at **types 0.00 on all 15 reps** (5 cells × 3) — no exceptions. But so are **haiku (types 0.00) and sonnet (types 0.00)**; only **opus** clears it (types 1.00) — and opus *still* fails lint 0.00. **INFERRED root cause, from the judge's own notes:** the task's spec declares a **non-generic `Result` type**, and reply after reply reaches for a generic one — Q4_K_XL rep1: *"the code uses `Result<T>` generically when the declared type is not generic"*; 35B-A3B rep2: *"it leans on a generic `Result<T>` that the spec's non-generic type never provides"*. That is a **task-design trap that catches everything below opus**, not a local-model deficiency — and it drags the local means down by ~15–20 points each. The judge independently ranks it weakest: **`expr-eval` 3.0/5**, the lowest of the four.
- **`async-memo` is the one task where the local models are frontier-competitive (MEASURED):** Q4_K_M **91** ties **haiku 91** and edges **sonnet 87**, with Q6_K at 90 and opus at 100. Both references lose the same points the local cells do — sonnet: types 0.67, lint 0.80, bdd 0.50 — i.e. **the wall hits the references too, just less hard**. **INFERRED:** on a task whose *logic* is a single well-known fix (evict the cached promise on rejection), the local 27B is genuinely haiku/sonnet-class; note the tier label ("opus-only") was assigned under the *binary* grader, where haiku/sonnet scored 0.667/0.625 — under fractional grading the task no longer looks opus-only, and **its tier should be re-labelled** (it separates by *degree* of lint-cleanliness, not by pass/fail).
- **`rate-limiter` is where the local models lose to the whole ladder (MEASURED):** sonnet **98** (types 1.00, lint 1.00 — the only perfect lint on the board) and **haiku 95** vs best local Q6_K **91** and Q4_K_M 79. This is the wall in its purest form: the local reps score tests 0.83–1.00 and edge 1.00 (logic fine) and lose on `types` 0.33–0.78 / `lint` 0.00–0.67, while haiku gets there with a single lint error (0.80). **This task, not `expr-eval`, is what drags the local cells below haiku overall.**
- **`reuse` = 1.00 on every rep where it applies (MEASURED)** — `lru-cache` and `rate-limiter`, all five cells, all reps. **INFERRED: no lost-in-the-middle degradation at 120k depth** — the planted util is retrieved from deep context 100% of the time, by every quant and by the MoE. Depth is not the limiter here; this replicates the prior campaign's 64k→128k reuse 1.00→1.00 finding on a harder task set.

## (d) Speed vs quality

MEASURED, one reasoning budget (4096) for every cell, so this is a clean model-only comparison:

| cell | TS % | think tok | ans tok | ttfa s | **full s** | decode t/s | TS points per 100s |
|------|-----:|----------:|--------:|-------:|-----------:|-----------:|-------------------:|
| `a3b` (35B-A3B, f16) | 71 | 4055 | **1606** | **47.1** | **59.8** | **116.1** | **119** |
| `xl` (Q4_K_XL, f16) | 67 | 3963 | 1315 | 124.6 | 151.7 | 43.9 | 44 |
| `un` (Q4_K_M, f16) | 78 | 4095 | 1286 | 126.6 | 152.8 | 44.3 | 51 |
| `q5` (Q5_K_M, q8_0) | 76 | 3629 | 1181 | 155.9 | 187.2 | 33.6 | 41 |
| `q6` (Q6_K, q8_0) | **82** | 4047 | 1279 | 178.2 | 215.1 | 31.5 | 38 |

- **The MoE's speed is a different regime, not an increment (MEASURED).** 35B-A3B decodes at **116.1 t/s** — **2.6× the fastest dense 27B (44.3)** and **3.7× Q6_K (31.5)** — and reaches the first answer token in **47.1s vs 126.6–178.2s**. End-to-end it finishes in **59.8s vs 152.8–215.1s**. **INFERRED:** this is the ~3B-active-parameter MoE dividend, amplified at 120k depth where prefill dominates ttfa; it costs 11 TS points against the best 27B and 7 against the cheapest.
- **Precision buys time, not quality (MEASURED).** Going Q4_K_M → Q6_K costs **+62.3s (+41%) full time** and **−12.8 t/s (−29%) decode** to move TS by **+4 points that sit inside the rep spread**. Q5_K_M is strictly dominated: slower than Q4_K_M (187.2s vs 152.8s) *and* lower (76 vs 78).
- **The thinking budget dominates the answer, and nothing truncates (MEASURED).** Every cell spends **3629–4095 of its 4096-token budget** and emits only **1181–1606 answer tokens** — i.e. **~2.6–3.4× more thinking than answer**, with **trunc 0%** everywhere. The model reliably spends nearly its whole budget, replicating the prior campaign's observation. *(Whether 4096 is the right budget is explicitly out of scope — the sweep is a separate follow-up campaign.)*
- **Q4_K_XL is dominated on both axes (MEASURED):** same speed as Q4_K_M (151.7s vs 152.8s, 43.9 vs 44.3 t/s) at **11 points lower quality**. There is no operating point where it wins.

**Therefore (INFERRED) — pick by latency budget, not by quality:** the quality axis is a **tie across the ladder** (67–82 inside a ±25-point rep spread), so the honest tiebreak is speed and stability. **Q4_K_M** is the default: top-2 quality (78%), best judge score (3.5), 152.8s, and the least VRAM pressure of the dense f16 cells that scored well. **35B-A3B** is the choice whenever latency matters (3.6× faster, and it holds 71% with a hard-pass) — accept its higher reply-to-reply variance. **Q6_K** buys nothing but 62 extra seconds.

## Judge verdicts (blind, opus)

**(1) Per-cell judge means (MEASURED, `summary.md`):**

| cell | judge/5 | design | clarity | robustness |
|------|--------:|-------:|--------:|-----------:|
| `un-d128-f16-rb4096` (Q4_K_M) | **3.5** | **3.6** | **3.7** | **3.3** |
| `q5-d128-q8-rb4096` (Q5_K_M) | 3.3 | 3.4 | 3.4 | 3.2 |
| `q6-d128-q8-rb4096` (Q6_K) | 3.3 | 3.2 | **3.7** | 3.0 |
| `xl-d128-f16-rb4096` (Q4_K_XL) | 3.2 | 3.2 | 3.5 | 2.8 |
| `a3b-d128-f16-rb4096` (35B-A3B) | **3.1** | 3.2 | 3.3 | **2.8** |

Two observations (MEASURED): **the judge ordering does not follow the quant ladder either** — Q4_K_M, the cheapest quant, wins the judge outright (3.5) while Q6_K, the TS winner, ties for third (3.3); and **robustness is the lowest of the three sub-scores in every single cell** (3.3 down to 2.8), which is the judge's independent version of the same story the grader tells — the code reads fine and doesn't defend itself. **INFERRED:** the judge and the deterministic grader disagree about *which cell is best* while agreeing about *what is wrong*, which is what you expect when the between-cell differences are noise and the within-reply weaknesses are systematic.

**(2) Most informative verdicts, quoted verbatim (`charts/appendix.md`):**

- **The best reply in the campaign** — `q6-d128-q8-rb4096` · `async-memo` · rep 1 · **TS 100, hard ✓**, judge **5.0·5.0·4.0**:
  > *"Minimal idiomatic fix — one promise map plus a detached catch that evicts on rejection — with tight deterministic tests; only a narrow microtask window between rejection and eviction goes unhandled."*
  *(the only reply in 60 with zero deterministic fails)*
- **The worst reply in the campaign** — `a3b-d128-f16-rb4096` · `expr-eval` · rep 0 · **TS 11**, judge 2.0·3.0·2.0:
  > *"Readable recursive-descent skeleton undermined by an unsound `Result | readonly Token[]` union discriminated with `typeof === 'object'` (arrays are objects, so the success path is indistinguishable from an error), plus whitespace handling limited to literal spaces."* — **fails:** types 0.00, lint 0.00, tests 0.07, bdd 0.07, edge 0.00
- **The MoE's other collapse** — `a3b-d128-f16-rb4096` · `rate-limiter` · rep 2 · **TS 48**, judge 2.0·3.0·**1.0**:
  > *"The first call for a key returns true on a short-circuit path that creates a full bucket without deducting the requested tokens or honoring capacity, and refill multiplies raw milliseconds by refillPerSec with no conversion to seconds."*
  *(a units bug and a capacity bypass — genuine logic failure, not a style miss; this is the reply that costs the MoE cell ~4 points of mean)*
- **Lowest robustness on the board** — `xl-d128-f16-rb4096` · `rate-limiter` · rep 0 · TS 75, judge 3.0·4.0·**1.0**:
  > *"Readable structure, but the `if (added > 0)` guard leaves lastRefillAt stale whenever the bucket is full, so a bucket idle for 10s then drained refills to capacity on the very next call, and non-positive/NaN token requests are unvalidated."*
  *(a reply that passes tests 1.00 and edge 1.00 and is still wrong — the hidden-suite blind spot)*
- **Capacity spent on the wrong thing** — `a3b-d128-f16-rb4096` · `lru-cache` · rep 1 · TS 77, judge 2.0·**1.0**·2.0 (the lowest clarity in the campaign):
  > *"Coerces the generic key via `String(key)`, silently collapsing distinct object/number keys and defeating the K type parameter, and the test file repeats its entire suite verbatim twice."*
- **The wall, stated by the judge on a high-scoring reply** — `un-d128-f16-rb4096` · `lru-cache` · rep 2 · **TS 96**, judge 3.0·4.0·3.0:
  > *"Pruning up front makes has/size pleasingly trivial, but it repeats the same prune call in all four methods, mutates state from the size getter, and pays an O(n) sweep on every get."* — **fails:** lint 0.80, bdd 0.80
  *(96% and the judge still finds three real design faults — the deterministic score is generous where the judge is not)*

**(3) Judge mean by task (MEASURED, weakest first):** `expr-eval` **3.0** · `lru-cache` **3.1** · `rate-limiter` **3.4** · `async-memo` **3.6**.

**INFERRED:** the judge's task ordering **matches the deterministic ordering almost exactly** — `expr-eval` is worst on both (judge 3.0; local means 42–64%), `async-memo` is best on both (judge 3.6; local means 78–91%). Two independent graders, one blind LLM and one toolchain, agree on task difficulty while disagreeing on cell ranking. **That is the campaign in one line: the task-to-task signal is real; the model-to-model signal is not.**

**(4) Full detail:** the complete blind-judge verdict table — one row per candidate (60 rows: config × task × rep, with TS %, hard-pass, design/clarity/robustness, the judge's one-line note, and the deterministic `fails:` list) — is in **[`charts/appendix.md`](charts/appendix.md)**, together with all 13 cell-level charts (scorecard, quality-vs-time, capability-vs-ladder, hard-pass, objective breakdown, quality-vs-cost, token economy, throughput, latency, memory/power, per-task heatmap). *(No `charts/detailed/` per-task appendix was generated for this run.)*

## Per-rep results (all 3 reps + reference ladder)

*Verbatim from `out/summary.md` — every local rep with its full objective vector (0–1), a mean row, and the haiku/sonnet/opus one-shot references in the same columns. Nothing averaged away. `— (no calib)` = reference point not yet collected (README **add-on D**).*

### lru-cache · tier sonnet

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
| _haiku_ 1-shot | – | 79 | | 1.00 | 0.80 | 0.82 | 0.50 | 1.00 | 0.55 | 1.00 | | |
| _sonnet_ 1-shot | – | 95 | | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.64 | 1.00 | | |
| _opus_ | – | — (no calib) | | — | — | — | — | — | — | — | | |

**Rep-to-rep spread (MEASURED):** Q4_K_M swings **70→96** (26 points) on identical inputs — rep0 fails types 0.00 while reps 1–2 score 1.00. Q4_K_XL swings **77→56** and is the only cell to fail `edge` here (0.50 on all three reps). The **35B-A3B is the only cell with types 1.00 on all three reps** — and still lands at 82% because lint collapses (0.60/0.00/0.00) and bdd is the worst on the board (0.37 mean). **Reference gap: no opus calibration point on this task** (add-on D). Against the re-graded references, Q4_K_M's 85 beats **haiku 79** but sits 10 points under **sonnet 95** — and note haiku is the only row here that fails `edge` (0.50), the same objective Q4_K_XL fails.

### rate-limiter · tier sonnet

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
| _haiku_ 1-shot | – | 95 | | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.67 | 1.00 | | |
| _sonnet_ 1-shot | – | 98 | | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.75 | 1.00 | | |
| _opus_ | – | — (no calib) | | — | — | — | — | — | — | — | | |

**Rep-to-rep spread (MEASURED):** the **most stable task for the 27B** — Q4_K_XL scores 75/76/76 and Q6_K 97/86/90, with `tests`, `edge`, `reuse` and `bdd` at 1.00 almost throughout. All the movement is in `types`/`lint`: Q4_K_M rep0 (types 1.00, lint 0.40, TS 88) vs reps 1–2 (types 0.33, lint 0.00, TS 73/76) — **a 15-point swing driven purely by error counts on identical logic.** The **35B-A3B is the exception: rep2 collapses to 48** (tests 0.33, edge 0.00 — the units bug the judge describes), a 39-point drop from its own rep0. **Reference gap: no opus calibration point on this task** (add-on D). Sonnet's 98 (lint 1.00) is the campaign's cleanest reference reply — and **every local cell loses to both references here** (best local Q6_K 91 vs haiku 95 / sonnet 98), purely on `types`/`lint`.

### async-memo · tier opus

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
| _haiku_ 1-shot | – | 91 | | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ 1-shot | – | 87 | | 0.67 | 0.80 | 1.00 | 1.00 | — | 0.50 | 1.00 | | |
| _opus_ 1-shot | – | 100 | | 1.00 | 1.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |

**Rep-to-rep spread (MEASURED):** **the only task where a cell is perfectly reproducible** — Q4_K_M scores **91/91/91 with an identical objective vector** on all three reps (types 0.67, lint 0.80, tests 1.00, edge 1.00, bdd 1.00, think 4095). **INFERRED:** at temp 0.6 the model converges on one canonical solution here (the judge's notes for those three reps describe the same delete-on-reject fix), which is what a well-understood single-fix task looks like. **Both hard-passes in the campaign live on this task:** Q6_K rep1 (TS 100, judge 5.0·5.0·4.0) and 35B-A3B rep2 (TS 94) — 2 of 60 replies overall, both cells at 33% hard-pass here. Note the **think-token variance**: Q5_K_M rep0 stopped thinking at **648 tokens** (vs 3911/2132) and Q4_K_XL rep1 at **2519** — the only cells that ended their reasoning well short of the 4096 budget anywhere in the campaign; Q5_K_M rep0 is also its worst rep (71). `reuse` is `—` (not graded on this task). On the re-graded ladder both references land at **haiku 91 / sonnet 87** with the *same* objective shape as the local cells (types 0.67, lint 0.80) — so Q4_K_M's 91 **ties haiku and edges sonnet**, rather than beating them outright as the binary-graded ladder claimed. Only **opus 100** is clean. This is the campaign's single strongest local result.

### expr-eval · tier opus

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
| _haiku_ 1-shot | – | 67 | | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ 1-shot | – | 67 | | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ 1-shot | – | 83 | | 1.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |

**Rep-to-rep spread (MEASURED):** the hardest task and the widest disagreement. **`types` = 0.00 on all 15 local reps and on both haiku and sonnet — only opus clears it (1.00), and opus still fails lint 0.00.** The extremes: **35B-A3B 11 → 64** (53-point swing on identical inputs; rep0 is the campaign's worst reply, tests 0.07 / edge 0.00) and **Q4_K_XL 30 → 56** (tests 0.12 / edge 0.43 on rep1). By contrast **Q4_K_M is boringly consistent at 58/57/58** — the cheapest quant is the *steadiest* here, while the two heaviest and the MoE are the volatile ones. `bdd` is near-random across every cell (0.00–1.00 within the same config). **INFERRED:** with `tests` at 0.86–1.00 for most reps but `types`/`lint` pinned at 0.00, the local failure here is not comprehension — it is the spec's non-generic `Result` type (see §(c)); the reps that additionally collapse `tests`/`edge` (XL rep1, A3B rep0) are separate one-off logic breakdowns, not a systematic pattern.

## Consequences & root causes (ultrathink)

1. **The strict-code wall is real capability, not precision or capacity — and it is a *style* wall, not a logic wall.** *Observation (MEASURED):* mean objectives across all cells: **lint 0.36 · types 0.45** vs **tests 0.90 · edge 0.92 · reuse 1.00**; the ladder spans 67–82% non-monotonically and the 35B-A3B lands at 71%, below three of four 27B quants. *Explanation (INFERRED):* the fractional grader (add-on A) resolves this for the first time — the models are not failing to solve the problems (tests/edge ~0.9, reuse perfect); they are emitting **a handful of `eslint`/`tsc --strict` errors per reply**, and neither 5.2 GiB of extra weights nor a 35B MoE reduces that count. Weight precision improves *what the model knows*; the wall is about *what it consistently does* under a strict linter. *Consequence:* **stop buying the wall with model size.** The levers are the unrun add-ons — **B (one-turn repair loop:** feed the exact `tsc`+`eslint` errors back for one fix turn — an `eslint --fix`-shaped intervention aimed directly at the failing objective) and **C (sampling sweep:** temp {0.3, 0.6, 0.9}, hypothesis: lower temp → cleaner lint/types). Run B first: it targets the measured deficit head-on and is one turn of compute.
2. **The model axis is inside the noise; the task axis is not.** *Observation (MEASURED):* between-cell span 67–82 (15 points), while within-cell rep spreads reach 26 (Q4_K_XL lru-cache), 27 (Q5_K_M rate-limiter), 39 (35B-A3B rate-limiter) and 53 (35B-A3B expr-eval) points on identical inputs. Meanwhile the per-task means are strongly separated (async-memo 78–91 vs expr-eval 42–64) and **two independent graders agree on that ordering** — the blind judge's mean-by-task (expr-eval 3.0 · lru-cache 3.1 · rate-limiter 3.4 · async-memo 3.6) matches the deterministic ranking. *Explanation (INFERRED):* n=12 per cell (4 tasks × 3 reps) against ±25-point per-reply variance cannot resolve a 4-point difference; per the repo's own plateau rule these cells are **a tie**. *Consequence:* **do not report a quant winner from this campaign.** If a future run must separate quants, it needs either many more reps or a lower-variance decision (temp 0.3, add-on C) — and it should stop reporting cell means without a spread column.
3. **`expr-eval` is measuring the task's trap, not the model.** *Observation (MEASURED):* `types` = 0.00 on **all 15 local reps AND on haiku AND on sonnet**; only opus scores 1.00, and even opus fails lint 0.00. *Explanation (INFERRED, corroborated by two independent judge notes):* the spec declares a **non-generic `Result` type** and nearly every reply reaches for a generic one — Q4_K_XL rep1: *"uses `Result<T>` generically when the declared type is not generic"*; 35B-A3B rep2: *"leans on a generic `Result<T>` that the spec's non-generic type never provides"*. This is a spec-comprehension trap that catches everything below the frontier. *Consequence:* `expr-eval` costs every local cell ~15–20 points of mean and **compresses the model signal** — it is a great difficulty probe and a poor discriminator. Either fix the spec's ergonomics or report campaign means with and without it.
4. **The MoE's deficit is variance, not ceiling — and it is the latency winner by a wide margin.** *Observation (MEASURED):* 35B-A3B best reps (async-memo 95/94 with a hard-pass, lru-cache 89, rate-limiter 87) are competitive with any 27B cell, but it owns the two worst replies in 60 (expr-eval 11%, rate-limiter 48%); meanwhile it decodes at **116.1 t/s** (2.6× the best dense 27B) with **ttfa 47.1s** and **full 59.8s** (3.6× faster than Q6_K). *Explanation (INFERRED):* ~3B active parameters give the speed; the routing appears to make occasional catastrophic-quality draws that a dense model of the same footprint does not (both collapses show tests ≤0.33 **and** edge 0.00 — whole-solution failures, not degradations). *Consequence:* **the MoE is the right choice for interactive/agentic loops** where a 60s turn vs a 215s turn changes the workflow — provided the loop can tolerate or retry a bad draw. For unattended single-shot generation, the dense 27B is steadier.
5. **No lost-in-the-middle at 120k — depth is not the limiter.** *Observation (MEASURED):* `reuse` = **1.00 on every rep of every cell** where it applies (lru-cache, rate-limiter — 30 replies). *Explanation (INFERRED):* the planted util is retrieved from ~132.7k tokens of real context 100% of the time, by every quant and by the MoE; this replicates the prior campaign's 64k→128k reuse 1.00→1.00 result on a harder task set. *Consequence:* **stop treating 128k depth as a quality risk on this box** — the deep-context retrieval is solid; budget the engineering at the lint/types wall instead.
6. **GTT spill is universal, model-independent, and still unexplained — OPEN.** *Observation (MEASURED):* all five cells spilled **1685–2030 MiB** into host RAM vs a ~77 MiB idle baseline, with only a 345 MiB spread across cells whose peak VRAM spans 3460 MiB (27764–31224). *Explanation (INFERRED):* the near-constant spill across very different memory footprints points at the **serving substrate at ctx 163840 + MTP** rather than per-model pressure; the prior campaign measured the same universal spill (785–2049 MiB) across ten cells with different KV settings, so it survives two campaigns and both KV types. **The root cause is not established from our data — OPEN.** *Consequence:* monitor GTT in production at 128k; nothing OOM'd or froze here (fails 0, runaway 0%, peak VRAM ≤ 31224 < 32624), but `xl` at 31224 MiB sits 1.4 GiB from the physical ceiling and is the least comfortable cell to deploy. **A research-skill pass on llama.cpp/Vulkan/RADV allocation at long ctx + MTP is the right next step**, per the skill's rule that unexplained anomalies get investigated, not papered over.
7. **The reference re-grade reversed the campaign's headline — the 27B is haiku-class here, not sonnet-class.** *Observation (MEASURED):* the references were re-graded with the fractional grader (`out/regrade_refs.log`, `grader: fractional-2026-07-15`) and moved sharply: haiku `async-memo` **0.667→0.912**, sonnet `async-memo` **0.625→0.870**, sonnet `lru-cache` **0.831→0.946**, haiku `rate-limiter` **0.834→0.948**, haiku `lru-cache` **0.679→0.793**; `expr-eval` did not move (0.667/0.667/0.833). The ladder is therefore **haiku 83 · sonnet 87 · opus 92** against best-local **82** — Δ−1 / Δ−5 / Δ−10, where the binary-graded ladder had said Δ+11 / Δ+4 / Δ−10. *Explanation (INFERRED):* under binary grading a **single** eslint error scored the reference 0.00 on that objective; the local cells were already being graded fractionally (add-on A), so the two sides were on different scales and every "local beats reference" claim was an artifact of that mismatch. The references are frontier models that write *nearly* clean code — exactly the case binary grading punishes hardest. *Consequence:* **the "27B beats sonnet" reading is dead; do not cite it.** The defensible statement is: on the 4 hardest tasks at 120k, the best 27B cell is **tied with haiku and ~5 points below sonnet**, and the deficit is entirely `lint`/`types` (local 0.36/0.45 vs haiku 0.60/0.67, sonnet 0.65/0.67). **This is also a process lesson: never compare across grader versions** — when a grader changes, re-grade *both* sides before reading a ladder. One gap remains open: **add-on D** (opus has no `lru-cache`/`rate-limiter` point, so its 92 is a 2-task mean; like-for-like on those two tasks the gap is ~15 points).

## Recommended config

**Default (best quality-per-second, steadiest):** Qwen3.6-27B **Q4_K_M** — TS 78% (statistically tied with Q6_K's 82), best judge score (3.5/5), 152.8s end-to-end, f16 KV.

```bash
BACKEND=vulkan MODEL=/path/to/Qwen3.6-27B-MTP-Q4_K_M.gguf \
KV=f16 MTP=1 NP=1 \
bash bench/engine-bench/serve_llamacpp.sh \
  --ctx 163840 -ub 2048 -b 4096 -fa on \
  --spec-type draft-mtp \
  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0
# reasoning budget 4096 (client-side); llama.cpp b9950, Vulkan/RADV
```

**When latency matters (agentic loops):** Qwen3.6-**35B-A3B** Q4_K_M — same flags, `KV=f16`. 71% TS at **59.8s** and **116.1 t/s** (3.6× faster); accept the higher variance and retry bad draws.

**Do not deploy:** **Q4_K_XL** (dominated — 67% at the same speed as Q4_K_M, and the highest VRAM at 31224 MiB) and **Q5_K_M** (dominated — 76% and *slower* than Q4_K_M at 187.2s). **Q6_K** only if a +4-point (noise-band) TS lead is worth **+62s per turn** and q8_0 KV.

## Methodology & caveats

- **Matrix:** 5 cells × 4 hardest tasks (`rate-limiter`, `lru-cache`, `async-memo`, `expr-eval`) × **3 reps** = **60 graded replies**. Only the **model/quant** varies; the two easier tasks (`deep-equal`, `store-remove`, avg 84–89% last run) are excluded from the matrix by design.
- **Held fixed:** llama.cpp b9950 Vulkan/RADV · `-ub 2048 -b 4096 -fa on` · MTP-on · ctx **163840** · prompt depth 120k (**~132.7k real tokens**; code ≈3.93 chars/tok) · prefix cache · temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 · **reasoning-budget 4096 for every cell**.
- **Why ctx 163840:** the server needs `ctx > prompt + generation`; a 131072 window fails because the prompt alone exceeds it. 163840 leaves ~19k headroom for think+answer (the prior campaign's proven window).
- **⚠ KV is NOT uniform (the campaign's known confound):** Q5_K_M and Q6_K run **q8_0**; Q4_K_M, Q4_K_XL and 35B-A3B run **f16**. Forced by geometry, not chosen (27B hybrid attention: 16 of 65 blocks carry KV → f16 64 KiB/tok, q8_0 34; f16 caps ~150k for Q5_K_M and ~104k for Q6_K, both below the ~145k needed). Any Q5/Q6 delta = **weight-quant + a small KV effect**; the f16-vs-q8_0 gap measured **−2.3% TS** in the prior campaign (**≤5% rule**, CLAIMED), an order of magnitude below the observed rep spread.
- **Grader (fixed this run):** single-process vitest (`--no-file-parallelism`), fail-loud (retry once → `grade_error` `HARNESS:` row, never a silent `tests=0`), plus a pre-grade `selftest` that aborts the run if vitest is broken. **Verified clean: no grade_error/HARNESS rows, fails 0, runaway 0%, trunc 0%.** The previous campaign's `tests`/`edge` = 0 was that harness bug; **these numbers are trustworthy.**
- **Fractional lint/types (add-on A):** `1 − min(1, errors/K)`, K=5 (lint) / K=3 (types). `hard_pass` still requires a perfect 1.0 on every gate objective. **The reference calibration has been re-graded on this same fractional scale** (`out/regrade_refs.log`; `calibration*.jsonl` now carry `grader: fractional-2026-07-15`, with the pre-re-grade files preserved as `calibration*.binary.jsonl`), so local cells and references are **like-for-like** — see finding 7 for what that changed.
- **Reference gaps:** **no opus calibration on `lru-cache` or `rate-limiter`** (README add-on D) → opus's 92% is a 2-task mean (async-memo 100, expr-eval 83); on that 2-task subset the honest comparison is best-local ~76.5 vs opus 92, haiku 79, sonnet 77. References are **one-shot, no thinking**, and not run at 120k depth — they are a capability ladder, not a like-for-like serving comparison (the local cells get ~4k thinking tokens and 120k of context the references never saw).
- **Noise:** REPS 3 per cell/task; observed per-reply spreads of 26–53 points on identical inputs. Per the repo's ±3% plateau rule and the spread above, **all five cells are a tie on TS %**. No spread/CI column is computed by `aggregate.py` — cell means should not be read as rankings.
- **Out of scope (deliberately):** the **reasoning-budget sweep** {0, 2048, 8192} is a separate follow-up campaign — budget is pinned at a saturated 4096 here and no budget conclusion is drawn. Add-on **B** (repair arm), **C** (sampling sweep) and **D** (opus ladder) are scaffolded but **unrun**.
- **Failures/runaways:** none (fails 0, runaway 0%, trunc 0%, no cell OOM'd or was guard-skipped). **GTT spill in all five cells — see §HEALTH.**
- **Provenance:** this campaign's `out/` = **MEASURED** (cited by cell/task/rep); the prior campaign's KV rule and the harness lineage = **CLAIMED**; all reasoning marked **INFERRED**. Never blended.

## External comparison

None pulled for this campaign. The only non-local numbers here are the **haiku/sonnet/opus one-shot references** in `calibration.jsonl` / `calibration-hard.jsonl` — these are **our own MEASURED gradings** of frontier-model answers on the same tasks and the same (now fractional) grader, not external claims. They carry one open caveat (finding 7): **opus is missing 2 of the 4 tasks** (add-on D).
