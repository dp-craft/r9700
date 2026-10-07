<!-- meta
date: 2026-09-15 20:33
title: Muse-Glimmer-30B + DFlash drafter — Vulkan vs ROCm depth curve (128k ctx) through llama-swap
takeaway: Muse-Glimmer-30B + DFlash (n_max 15) at ctx 131072: ROCm/stew675 prefill 941→842 tok/s vs Vulkan/b10969 865→740 (gap widens +9%→+14% with depth); decode 27–48 t/s is NOT rankable at reps=2 (inter-rep spread up to +75%); prefill decays shallowly (slope −0.04…−0.06, R² 0.77–0.82) — GQA 32:2 keeps KV at 52 KiB/tok; fits at 27.3 GiB peak VRAM; backend×build still confounded (3 arms = 3 builds), two factorial arms pending.
-->
# Benchmark: Muse-Glimmer-30B + DFlash drafter — Vulkan vs ROCm depth curve — R9700 (gfx1201)

- **Date:** 2026-09-15 20:33–23:12 · **Track:** engine-bench campaign, served through llama-swap :9292 (manual backend starts — hand-written driver exception, iron rule 6; `gen_campaign.py` has no `source: llama-swap` mode yet)
- **GPU/Host:** AMD Radeon AI PRO R9700 (gfx1201), 32624 MiB · kernel 7.0.0-31-generic · ROCm 7.8.0 / Mesa 26.2.2 (kisak PPA) · `HSA_OVERRIDE_GFX_VERSION=12.0.1` (ROCm arms)
- **Runtimes/builds:** llama-server via llama-swap. **Three arms ran three different builds** (see Build attribution): `muse-vulkan` = `b10969-vulkan-system` (391fac1, as-deployed) · `muse-rocm` = `b790cf51aa-stew675-rocm` (fork v16-r4, b862fc3, as-deployed) · `muse-rocm2` = `ROCM-lemonade` (prebuilt lemonade-sdk gfx120X, bundles its own ROCm runtime)
- **Models:** `unsloth/Muse-Glimmer-30B-UD-Q5_K_L.gguf` (18.41 GiB; arch `muse-glimmer`: 52 attn layers, GQA 32 query : 2 KV heads, KV 52 KiB/tok f16 — MEASURED `gguf_kv.py`) + `dflash-kquant.gguf` drafter (1.52 GiB, block-diffusion, block size 16) · ctx 131072 (pinned to trained depth — RoPE cap, not VRAM)
- **Data:** `bench/runs/2026-09-15-muse-glimmer-vulkan-vs-rocm/` (15 per-depth run dirs + parent; `results.jsonl`, `failures.txt`, per-dir `gpu_samples.csv`)

## Summary

ROCm is the faster backend for **prefill** on this model: the as-deployed ROCm/stew675 arm leads at every depth, 941/929/885/842 tok/s at 8k/32k/64k/98k vs Vulkan/b10969's 865/843/789/740 — a gap that **widens from +8.8 % to +13.8 %** with depth (MEASURED). **Decode is not rankable**: with reps=2 the inter-rep spread reaches +75 % (power-clocked regime, peaks 232–246 W), so all three arms' 27–48 t/s figures overlap; the lemonade arm consistently sits lowest (28.8→26.9 t/s). Prefill decay with depth is **shallow** on all arms (log-log slope −0.04…−0.06, R² 0.77–0.82) — an order of magnitude shallower than the 27B's f16-KV curve (−0.294) — consistent with GQA 32:2 keeping the per-token attention cost at 52 KiB/tok (INFERRED, see findings). Everything fits: peak VRAM 26.4–27.4 GiB < 32624 MiB, no host-RAM spill on the ROCm arms (peak GTT 54–177 MiB ≈ idle baseline). **Caveat:** the campaign was designed as a backend×build factorial, but only the three as-deployed/third-party builds were measured — the two remaining arms (`rocm-b10969`, `vulkan-stew675`) are still pending, so no backend claim here is build-free.

## Build attribution (read this before the tables)

| Arm label | Build that actually ran | How known |
|-----------|-------------------------|-----------|
| `muse-vulkan` | `b10969-vulkan-system` (upstream 391fac1) | **Documented, not harness-verified** — the first-pass driver wrote the meta `server_binary` line before the `/running`-lookup fix (it recorded a `latest-rocm` path for *both* first-pass arms); attribution rests on the operator's README/spec, the llama-swap config's `${vulkan}` macro + Vulkan-only env, and the `latest-vulkan` symlink state of 2026-09-15 |
| `muse-rocm` | `b790cf51aa-stew675-rocm` (fork b862fc3) | as-deployed via `${rocm}` macro → `latest-rocm` (operator docs) |
| `muse-rocm2` | `ROCM-lemonade` (prebuilt lemonade-sdk) | **harness-verified** — later driver version resolved the symlink and recorded `resolved=.../llamacpp/builds/ROCM-lemonade/bin/llama-server` per pass |

The factorial's remaining two arms (`rocm-b10969`, `vulkan-stew675`) exist precisely to de-confound this — until they land, "vulkan vs rocm" rows below really read "b10969-vulkan vs stew675-rocm vs lemonade-rocm" (iron rule 2).

## Legend — every knob & label used in this run

| Term | What it is | Effect on this box (R9700 / RDNA4, 32 GB) | How it's tested here |
|------|------------|-------------------------------------------|----------------------|
| `-ub 2048 -b 4096` | micro-batch / logical batch | carried over from the prior 27B sweep optima; held fixed — not a variable here | llama-swap config `${common}` macro |
| `-fa on` | flash attention | required for quantized KV; on for all arms | fixed |
| KV `f16` | 16-bit KV entries | 52 KiB/tok on this GQA-2 model → full 131072 ctx costs ~6.6 GiB; fits with 18.4+1.5 GiB weights (MEASURED peak 27.3 GiB) | fixed (q8_0 not A/B-ed this run — the RoPE cap means quantising KV buys nothing here, see findings) |
| `--kv-unified -np 1` | one shared KV pool | single 131072 pool; two concurrent deep chats can contend | fixed |
| DFlash spec decoding | `--spec-type draft-dflash -md dflash-kquant.gguf --spec-draft-n-max 15 --spec-draft-p-min 0.4` — block-diffusion drafter, 16-token blocks | decode 27–48 t/s with the drafter (MEASURED); **no non-drafter baseline on this box** → the drafter's contribution is not separable (see External comparison) | identical on all arms; `n_max 15` is a LOCAL choice (vendor example uses 4) — un-A/B-ed |
| depth `dN` | cold code-review prompt padded to N tokens (`codereview-{8192,32768,65536,98304}.txt`, real token counts 7850/30510/59312/89179) | prefill decays shallowly (slope −0.04…−0.06) — see findings | 4 depths ≥ iron rule 16 minimum, log-log fit per arm |
| `prefix_mode=unique` | uuid-prefixed prompt defeats the prefix cache | honest cold prefill per rep | fixed |
| reps=2, warmup=1 | timed reps after one untimed pass | Vulkan compiles shaders on first prefill; **n=2 makes "p50" the slower rep and kills rankability** (inter-rep spread up to +75 %) | per probe |
| think tokens | reasoning tokens before the answer (template split) | 231–320 of the 512 generated tokens are thinking (MEASURED); `ttfa_s` null for this model — decode rates include thinking tokens | per request row |
| `ROCM-lemonade` | prebuilt lemonade-sdk llama.cpp for gfx120X, bundles its own ROCm runtime | slowest prefill of the three arms (+3.9…+6.3 % behind Vulkan); one mid-pass server crash (unproven root cause) | third ROCm data point |

## Results (table first — MEASURED, from `report.py` aggregates; memory column mandatory)

Canonical per-cell value = **slower of the 2 reps** (n=2 makes p50 the lower rep). `agg tok/s` = 512 gen tokens / total request time (includes prefill). All cells: conc 1, ctx 131072, f16 KV, DFlash n_max 15, `max_tokens 512`.

| Arm (build) | depth | prompt tok | Prefill tok/s | Decode t/s | Agg tok/s | TTFT p50 s | TTFT p95 s | Peak VRAM MiB | Peak GTT MiB |
|-------------|------:|-----------:|--------------:|-----------:|----------:|-----------:|-----------:|--------------:|-------------:|
| muse-vulkan (b10969-vulkan-system) | 8192 | 7850 | 865 | 37.6 | 23.5 | 9.43 | 9.44 | 27337 | 1550 |
| | 32768 | 30509 | 843 | 32.1 | 10.1 | 36.83 | 36.83 | 27322 | 1570 |
| | 65536 | 59312 | 789 | 46.9† | 5.9 | 76.17 | 76.23 | 27311 | 1570 |
| | 98304 | 89179 | 740 | 36.4 | 3.8 | 121.92 | 122.12 | 27311 | 1581 |
| muse-rocm (stew675-rocm) | 8192 | 7851 | **941** | 33.3 | 21.8 | **8.64** | 8.64 | 26626 | 76 |
| | 32768 | 30510 | **929** | **32.6** | **10.5** | **33.37** | 33.39 | 26644 | 76 |
| | 65536 | 59311 | **885** | 30.0 | 6.2 | **67.81** | 67.84 | 26379 | 59 |
| | 98304 | 89179 | **842** | 31.1 | 4.1 | **107.30** | 107.67 | 26379 | 54 |
| muse-rocm2 (ROCM-lemonade) | 8192 | 7850 | 899 | 28.8 | 23.0 | 9.01 | 9.04 | 27282 | 99 |
| | 32768 | 30509 | 884 | 31.4 | 10.0 | 35.05 | 35.05 | 27354 | 102 |
| | 65536 | 59313 | 839 | 29.4 | 5.8 | 71.22 | 71.54 | 27254 | 116 |
| | 98304 | 89182 | 786 | 26.9 | 3.9 | 113.65 | 114.67 | 27354 | 177 |
| **FAILED** muse-rocm2-d32768 (22:03 pass) | 32768 | 30510 | — | — | — | — | — | — | — |
| **QUARANTINE** muse-rocm2-d65536 / d98304 (22:05 pass) | 65536 / 98304 | — | — | 24.1 / 24.2 (degenerate) | — | 0.002 (degenerate) | — | 27254 / 27354 | 116 / 177 |

† The Vulkan d65536 decode pass ran high (both reps 46.9/50.1 t/s — a fast pass, not a single fast rep) vs its neighbours (32.1/36.4). Unexplained — **OPEN**.

GTT note: the Vulkan arm's 1550–1581 MiB peak GTT is **depth-invariant** (MEASURED: flat across 8k→98k) while VRAM stays at 27.3 GiB with headroom — a driver-aperture reservation under RADV (INFERRED), not a model/KV spill. ROCm arms sit at the idle baseline (~77 MiB; 54–177 here, the 177 at d98304 being +100 MiB over baseline — borderline, watch).

**Prefill vs depth** — the ROCm/stew675 arm leads at every depth and the gap widens (Vulkan behind at all four points; lemonade in between):

![Prefill vs depth](charts/depth_prefill.svg)

> MEASURED, 4 depths × 3 arms, cold prefix, slower-rep convention. The diverging curves are why a single-depth comparison understates the ROCm prefill advantage here. It does NOT license a backend verdict — the arms run different builds (Build attribution).

**Decode vs depth** — within the noise band; Vulkan's d65536 point is the † outlier pass:

![Decode vs depth](charts/depth_decode.svg)

> MEASURED, same convention. Reps=2 + power-clocked regime → inter-rep spread up to +75 % (Methodology); **bar/line order here is not a ranking**.

**Memory & power** — all arms fit; Vulkan's GTT bar is the driver-aperture offset, not spill:

![Memory & power](charts/memory.svg)

> MEASURED (peak per arm across depths; avg power per run dir). No arm approaches the 32624 MiB physical VRAM; no host-RAM spill on ROCm.

## Depth decay — power-law fit (INFERRED from MEASURED points, iron rule 16)

Log-log fit of the canonical per-depth values, 7850→89179 prompt tokens (4 pts, fit range stated — no extrapolation beyond it):

| Arm | Prefill slope | Prefill R² | Decode slope | Decode R² |
|-----|--------------:|-----------:|-------------:|----------:|
| muse-vulkan (b10969) | −0.060 | 0.819 | +0.032 | 0.047 |
| muse-rocm (stew675) | **−0.042** | 0.775 | −0.037 | 0.687 |
| muse-rocm2 (lemonade) | −0.050 | 0.766 | −0.019 | 0.096 |

Over 11.4× depth growth, prefill drops only 10.5–14.5 % (vs the 27B f16-KV −0.294 slope, measured 2026-09-10, which costs ~40 % over a similar span). Decode slopes are not significantly different from zero — the curve is flat within noise.

## What moved the needle (deltas vs `muse-vulkan` baseline, per depth)

| Arm | Prefill Δ 8k | Prefill Δ 32k | Prefill Δ 64k | Prefill Δ 98k | Decode Δ 8k | Decode Δ 98k |
|-----|-------------:|--------------:|--------------:|--------------:|------------:|-------------:|
| muse-rocm (stew675) | +8.8 % | +10.2 % | +12.2 % | **+13.8 %** | −11.4 % (overlap) | −14.6 % (overlap) |
| muse-rocm2 (lemonade) | +3.9 % | +4.9 % | +6.3 % | +6.2 % | −23.4 % (overlap) | −26.1 % (overlap) |

Decode deltas are **within the inter-rep noise band everywhere** (up to +75 % spread, Methodology) — reported for completeness, not as findings.

## Consequences & root causes

1. **ROCm prefill advantage widens with depth (MEASURED: +8.8 % → +13.8 %).** Vulkan's prefill decay is steeper (−0.060 vs −0.042). *Consequence:* for long-context cold prefills on this model, ROCm is the better backend — with the build caveat. INFERRED mechanism (not proven from our data): the Vulkan attention path pays more per-token as the KV cache grows; the ROCm path's decay is closer to pure GEMM scaling. The pending `vulkan-stew675` arm is the test: if stew675-Vulkan matches stew675-ROCm's −0.042 slope, the effect is the backend, not the build.
2. **Shallow prefill decay is an architecture property, not a driver property (INFERRED).** All three arms cluster at −0.04…−0.06 despite two backends and three builds. *Explanation:* GQA 32:2 → KV is only 52 KiB/tok (MEASURED `gguf_kv.py`), so the attention term stays a small fraction of prefill FLOPs even at 89k; the curve is GEMM-dominated. *Consequence:* depth-scaling fears calibrated on the 27B (−0.294) do not transfer to this model; 128k ctx is a prefill-time, not prefill-rate, cost (TTFT 8.6 → 107 s).
3. **KV quantisation buys nothing at this model's RoPE cap (INFERRED).** f16 KV at 131072 costs ~6.6 GiB and fits with 5.3 GiB headroom (MEASURED peak 27.3 GiB); `gguf_kv.py` shows q8_0 would also be RoPE-capped at 131072. *Conserve the ≤5 % rule for models where the cap is VRAM, not training.*
4. **Decode ranking is not achievable at reps=2 on this card (MEASURED: +2…+75 % inter-rep spread; peaks 232–246 W, means 125–182 W — power-limited at depth).** *Consequence:* any decode comparison on the R9700 needs ≥3 reps *and* the power/clock trace as a companion column (skill rule 16); this campaign's decode rows are directional only.
5. **Vulkan did NOT device-lost on this model at depth (MEASURED: 0 errors across 4 depths incl. 98k prefill)** — the Gemma RADV device-loss (CLAUDE.md) did not reproduce on Muse-Glimmer. *Consequence:* Vulkan remains viable for deep prefill on this architecture; the crash risk model is per-architecture, not per-backend.
6. **One lemonade-ROCm server crash mid-pass, root cause unproven (MEASURED: 22:05 rows degenerate — ttft 0.002 s, GPU idle 14 W/829 MiB during sampling; llama-swap auto-restart failed; crash text rotated out, dmesg unreadable).** Quarantined per iron rule 18; the affected cells were re-collected clean (23:01/23:05). **OPEN** — if it recurs, capture the llama-swap log stream *before* restart.
7. **Build confound is the campaign's main debt (iron rule 2).** Three arms, three builds; the meta `server_binary` line for the first two passes predates the driver's `/running`-lookup fix and is unreliable. *Consequence:* run the pending `rocm-b10969` and `vulkan-stew675` arms (README runbook) before quoting any "backend" number from this report downstream.

## Recommended config

As measured (ROCm arm — fastest prefill; DFlash drafter loaded clean on this build):

```bash
llama-server \
  --model /home/dev/models/gguf/unsloth/Muse-Glimmer-30B-UD-Q5_K_L.gguf \
  -a muse-glimmer -c 131072 -ctk f16 -ctv f16 -np 1 --kv-unified \
  -ngl 99 -ub 2048 -b 4096 -fa on \
  --temp 1.0 --top-p 0.95 --top-k 64 --min-p 0 \
  --spec-type draft-dflash \
  -md /home/dev/models/gguf/unsloth/dflash-kquant.gguf \
  --spec-draft-n-max 15 --spec-draft-ngl all --spec-draft-p-min 0.4
# ROCm: HSA_OVERRIDE_GFX_VERSION=12.0.1 (and use a lemonade-style build with a bundled
# ROCm runtime, or a locally-built ROCm arm — the ggml-org ROCm release runs on CPU here)
# Vulkan arm: GGML_VK_ALLOW_GRAPHICS_QUEUE=1
```

Served through llama-swap as `muse-glimmer-30b-q5kl-f16-ctx128k-dflash[-rocm]` (config.yaml).

## Methodology & caveats

- **Fixtures:** `bench/workloads/generated/codereview-{8192,32768,65536,98304}.txt` (tracked TS+Python corpus via `build_prompt.py`); real prompt token counts 7850/30510/59312/89179 (MEASURED from `usage`).
- **Probe:** chat API, `max_tokens 512`, reps 2 + untimed warmup 1 (Vulkan shader compilation), `prefix_mode=unique`, conc 1. Token counts from `usage` (not SSE chunks) in all clean cells.
- **Noise band:** ±3 % plateau rule (skill rule 4) vs **MEASURED inter-rep decode spread +2…+75 %** — the spread dominates; all decode comparisons in this report are declared non-rankable. Peak power 232–246 W (vulkan) / 218–226 W (rocm) / 198–233 W (rocm2), means 125–182 W at depth — the card is power-limited in the deep-prefill regime (note: the measured 246 W peak exceeds the 210 W cap figure cited in CLAUDE.md — firmware PPT vs the cited value is OPEN).
- **VRAM guard:** pre-flight floor 4096 MiB free (run.sh) + predicted 29064 MiB (weights 19.93 GiB incl. drafter + 131072 × 52 KiB/tok f16 + 2000 MiB overhead) vs MEASURED peak 26.4–27.4 GiB — everything fit, nothing SKIPPED.
- **Quarantine (iron rule 18):** 22:05 `rocm2` d65536/d98304 rows (degenerate, server crash) and the 22:03 d32768 error rep are excluded; affected cells re-collected clean at 23:01/23:05/22:08. See `failures.txt`.
- **Not measured here:** the incremental agentic cache-reuse pattern (rule 17 — cold one-shot prefills only, by design); `n_max 15 vs 4` (both arms identical; open question in models.yaml); any non-drafter decode baseline; concurrency >1.
- **Charts:** generated by `bench/lib/report.py <parent run dir>` (byte-identical on regeneration, verified 2026-09-16).

## External comparison (CLAIMED — separate from MEASURED)

| Source | Claim | Note |
|--------|-------|------|
| Muse-Glimmer model card / dev.meta.ai docs (via models.yaml, 2026-08-27) | 74.9 → 233.4 tok/s (3.1×) with the DFlash drafter on an **RTX 5090**; vendor's only example uses `--spec-draft-n-max 4` | different GPU, quant, and n_max (ours is the local 15) — not comparable beyond "drafter gives a large decode boost". We have no non-drafter arm on this box, so the boost's size here is unseparable (**gap** — a drafter-off re-run would close it) |
