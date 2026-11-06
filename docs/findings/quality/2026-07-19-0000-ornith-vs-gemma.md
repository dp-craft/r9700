<!-- meta
date: 2026-07-19 21:05
slug: ornith-vs-gemma
title: Ornith-1.0-35B vs Qwen3.6-35B-A3B vs Gemma-4-31B at 120k depth (Gemma needs ROCm)
takeaway: Ornith-1.0-35B (qwen35moe hybrid, MTP off, Vulkan) on the hardest-tasks TS-TDD suite at ~120k depth, 3 reps: **62.2% TS** (MEASURED), 1/5 hard-pass, decode 70.9 t/s, fits clean at f16 (25.4 GiB). Vs Qwen3.6-35B-A3B at MATCHED settings (n=3): 35B is **73.3%** (Δ−11.0, paired t=−1.16 → NOT significant), but Ornith is **~half as noisy** (within-task sd 7.4 vs 12.9), wins the two stable tasks (expr-eval/async-memo), and its ~2× speed deficit is **MTP-only** (Ornith has 0 nextn). **Gemma-4-31B: Vulkan/RADV DEVICE-LOSTS at deep prefill and crashes the GUI (~65k @ctx163840 / ~24.5k @140000) — a driver bug, NOT memory — but on `BACKEND=rocm` it runs the full depth suite CLEAN** (q8_0, ctx150000, n=1): **56.6% TS, 0/5 hard-pass, decode 11.6 t/s** (ROCm ~6× slower decode; prefill ~650→200 t/s, so the old ~92× figure is wrong). Gemma hits the lint/types wall harder than Ornith (0.12/0.20) and emits `<think>` (capture.py splits fine). Ornith leads Gemma ~62 vs ~57 but Gemma n=1 (CI [33,80]) is not yet a real comparison.
-->

# Ornith-1.0-35B @ 120k depth (vs Qwen3.6-35B-A3B) — Gemma blocked on Vulkan

- **Date:** 2026-07-19 · **Harness:** TS-TDD hardest-tasks (real `tsc + eslint + vitest`, self-check gated), copied from `campaigns/2026-07-14-hardest-tasks-27b-vs-35b`.
- **Substrate (MEASURED):** llama.cpp Vulkan **b9950**, `-ub 2048 -b 4096 -fa on`, ctx 163840, `--reasoning-budget 4096`, Qwen coding sampler temp 0.6 / top_p 0.95 / top_k 20 / min_p 0. Ornith **KV f16, MTP off** (qwen35moe has 0 nextn tensors → MTP impossible). 3 reps × 5 tasks = 15 replies, 0 capture/grade errors.
- **Comparison cell:** `a3b-d128-f16-rb4096` from the 2026-07-14 campaign — **identical** tasks/depth/sampler/KV/budget; differs only in model and **MTP-on** (35B has a nextn layer). So quality is a clean model comparison; speed carries an MTP asymmetry.

## TL;DR

At matched settings the **35B-A3B scores ~11 pts higher on the mean but the gap is not statistically resolvable** (paired-by-task t=−1.16, n=5). The durable, defensible differences: **Ornith fluctuates about half as much** (within-task sd 7.4 vs 12.9), **wins the two stable-logic tasks outright**, is **lighter on VRAM**, and **thinks less** — but **cannot use MTP** (so it's ~2× slower in wall-clock) and is **weaker on strict typing and edge-cases**. Both models hit the same **lint wall** and both strictly hard-pass **only async-memo**.

## Results — per cell (memory MEASURED via `vram_sampler.py`)

| cell | model | n | TS % | worst·best | hard | within-task sd | think tok | TTFA s | full s | decode t/s | peak VRAM MiB | peak GTT MiB | judge/5 |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| ornith-d128-f16-rb4096 (Vulkan) | Ornith-1.0-35B-UD-Q4_K_M | 15 | **62.2** | 31·97 | 1/5 | **7.4** | 3,543 | 75.3 | 111.5 | 70.9 | **25,400** | 815 | — |
| gemma-d128-q8-rb4096 (**ROCm**) | gemma-4-31B-it-qat-UD-Q4_K_XL | 5 | 56.6 | 23·86 | 0/5 | — (n=1) | 1,357 | 351.6 | 484.7 | **11.6** | 27,097 | **90** | — |
| a3b-d128-f16-rb4096 (Vulkan) | Qwen3.6-35B-A3B-UD-Q4_K_M | 15 | 73.3 | 11·95 | 1/5 | 12.9 | 4,063 | 47.7 | 60.9 | 120.1 *(MTP)* | 27,081 | 1,551 | 3.2 |

Deep-prefill (MEASURED, Ornith): ~1,525–1,886 tok/s on the ~85–133k-token prompts. All 15 replies clean, 0 runaways, 0 grade errors, 0 GTT-spill-induced degradation.

## Per-task (3 reps each — mean · sd · [reps])

| task | tier | Ornith | 35B-A3B | Δ (O−35) |
|---|---|--|--|--:|
| lru-cache | sonnet | 51.6 · 17.1 · [76,40,39] ✗ | 81.8 · 5.1 · [89,77,80] ✗ | −30.2 |
| rate-limiter | sonnet | 39.4 · 6.4 · [31,45,42] ✗ | 70.8 · 16.5 · [87,77,48] ✗ | −31.4 |
| async-memo | (opus lbl) | **92.9 · 4.7 · [97,86,95] ✓** | 86.8 · 11.1 · [95,71,94] ✓ | +6.1 |
| expr-eval | opus/ceiling | **59.5 · 3.1 · [57,64,58]** | 43.8 · 23.6 · [11,64,57] | +15.7 |
| pricing-deferred | (opus lbl) | 67.6 · 5.9 · [71,59,72] | 83.0 · 7.9 · [82,93,74] | −15.4 |
| **mean** | | **62.2** | **73.3** | **−11.0** |

**Fluctuation (the headline):** Ornith within-task sd **7.4** vs 35B **12.9** — Ornith is roughly twice as consistent. The 35B lurches (expr-eval 11→64, rate-limiter 48→87); Ornith's only volatile task is lru-cache (17.1). Note the single-rep pilot read 66.4% for Ornith because rep0's lru-cache landed at 76 (reps 1–2 = 40/39) — reps were necessary. **best-of-3 (rerun value):** Ornith 70.9 (+8.7), 35B 85.5 (+12.3) — the noisier 35B gains more from re-rolls.

**Statistics:** paired-by-task Δ = −11.0, **t = −1.16 → not significant** (n=5 tasks, needs |t|>2.776). INFERRED: underpowered; the mean gap is carried by two tasks and is inside the models' own rep noise. Recommend more tasks (not more reps) to resolve.

## Objective vectors (mean across tasks, 0–1)

| | tests | edge | lint | types | reuse |
|---|--:|--:|--:|--:|--:|
| Ornith | 0.72 | 0.63 | **0.33** | **0.33** | 1.00 |
| 35B-A3B | 0.84 | 0.87 | 0.36 | 0.58 | 1.00 |

Same **lint wall** for both (~0.35). The 35B is genuinely ahead on **types (0.58 vs 0.33)** and **edge (0.87 vs 0.63)**, and a bit on **tests (0.84 vs 0.72)**. Reuse is a tie at ceiling. INFERRED: Ornith's deficit is strict-cleanliness + edge-case coverage, not gross logic (it wins the two stable tasks).

## Speed & memory — read the MTP asymmetry

- The 35B's **120.1 vs 70.9 t/s decode** (and ~2× TTFA/full-reply) is **mostly MTP**: MTP is ~2× decode on this box (prior campaigns), and Ornith **structurally cannot use it** (qwen35moe ships 0 nextn tensors, no drafter). MTP-stripped, the two are ~70 t/s peers.
- **Ornith is the lighter fit:** 25,400 vs 27,081 MiB peak VRAM, roughly half the GTT (815 vs 1,551 MiB), and **thinks less** (3,543 vs 4,063 think tok). Ornith fits f16 native at full 262K; the 35B does too.

## References (NOT depth-matched — indicative only)

haiku 81% · sonnet 91% · opus 94% (one-shot, ~550–620-token prompts). The local cells answer the SAME tasks at ~120–133k tokens (~200× deeper) at n=3 — so a bare local-vs-reference Δ is not a like-for-like capability gap. Ornith (62) and the 35B (73) both sit below the ladder on mean, at vastly greater context.

## Gemma-4-31B-it-qat — Vulkan-blocked, ROCm-viable (MEASURED)

**The driver decides.** On **Vulkan/RADV** (b9950) deep Gemma is non-viable: `llama-server` dies mid-prefill with `decode() failed: vk::Queue::submit: ErrorDeviceLost` → `vk::DeviceLostError`, a GPU device-loss that **crashes the whole Ubuntu desktop** — MEASURED at n_tokens **~65.5k @ctx163840** and **~24.5k @ctx140000** (lowering ctx doesn't help; no `allocation failed` line — a RADV hang, not OOM, though a concurrent 31 GiB stray server turns it into a hard OOM). On **ROCm/HIP** (`bench/llamacpp/llama-server` b1-049326a, `HSA_OVERRIDE_GFX_VERSION=12.0.1`) the **same q8_0/ctx150000 config runs clean end-to-end** — MEASURED: prefilled the full ~140k context and generated all 5 replies, **no device-loss, no GUI crash**, past the exact ~65k point where Vulkan died. So the crash is a **RADV driver bug, not a hardware/memory limit**. The stale repo "ROCm ~92× slower" figure did NOT hold: ROCm prefill was ~650→200 tok/s (decays with depth). The real ROCm cost is **decode: ~11.6 t/s (~6× slower than Vulkan's 70.9)** and long TTFA (351.6s).

**Gemma quality (ROCm, q8_0, ctx150000, n=1, temp 1.0 / top_k 64):** **56.6% TS** (CI [32.9, 80.4]), **0/5 hard-pass**, think 1,357 tok (thinks less than Ornith). Objective: tests 0.60 · edge **0.80** · lint **0.12** · types **0.20** · reuse 1.00 — logic/edge competitive but it hits the **lint/types wall harder than Ornith** (0.12/0.20 vs 0.33/0.33) → no strict clean pass.

**Ornith vs Gemma (⚠ n=3 vs n=1 — indicative only):**

| task | Ornith (n=3) | Gemma (n=1) |
|---|--:|--:|
| lru-cache | 51.6 | **67** |
| rate-limiter | 39.4 | 23 |
| async-memo | 92.9 | 86 |
| expr-eval | 59.5 | 33 |
| pricing-deferred | 67.6 | **74** |
| **mean** | **62.2** | **56.6** |

Ornith leads the mean by ~6 pts and gets the only hard-pass, but **Gemma's single rep at temp 1.0 has a CI of [33, 80] — this is not yet a real comparison.** Gemma wins 2 of 5 tasks. To make it fair, Gemma needs ≥3 reps on ROCm (each ~8 min of decode). Memory is clean on ROCm (GTT only 90 MiB). Full detail: CLAUDE.md "Errors & fixes" + `docs/research/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md`.

## Caveats

- **Underpowered:** 5 tasks, 3 reps. The Ornith–35B mean gap is not significant; do not rank beyond "level within noise, 35B better on types/edge, Ornith more stable."
- **MTP asymmetry** on speed only (35B on, Ornith impossible).
- **No LLM judge** for Ornith (deterministic grades only); the 35B's 3.2/5 is from the prior campaign.
- References are ~200× shallower and n=1.
- Sampler/arch provenance: arch MEASURED (`gguf_kv.py`); sampler recipe CLAIMED (HF card, = Qwen coding recipe).

## Reproduce

`configs.jsonl` (ornith cell) + `bash run_capture.sh` (defaults `JUDGE_ENGINE=none SUMMARY=0`). Model symlinked into `/home/dev/models/gguf/` from the HF cache. Build b9950 Vulkan/HIP, ROCm 7.x, gfx1201 (`HSA_OVERRIDE_GFX_VERSION=12.0.1`). Raw: `out/outputs.jsonl` (15 replies), `out/scores_typescript.jsonl`, `out/summary.md`, `charts/`.
