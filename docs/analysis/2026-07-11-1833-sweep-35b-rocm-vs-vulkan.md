# Benchmark: 35B-A3B tuning optimum — ROCm vs Vulkan — R9700 (gfx1201)

- **Date:** 2026-07-11 18:33 · **Track:** model-bench sweep (`sweep.py`, adaptive optimum + KV rule)
- **GPU/Host:** AMD Radeon AI PRO R9700, 32624 MiB · host `bipubi` k6.17 · `HSA_OVERRIDE_GFX_VERSION=12.0.1`
- **Runtimes/builds:** llama.cpp **b9950-961e4b26a** — ROCm/HIP build (`bench/llamacpp/`) and Vulkan/RADV build (`bench/llamacpp-vulkan/`)
- **Models:** `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (MoE ~3B active, embedded MTP layer)
- **Data:** `bench/runs/2026-07-11-1833-sweep-35b-rocm/`, `bench/runs/2026-07-11-1837-sweep-35b-vulkan/` (synthetic llama-bench, pp=8192 / tg=128, reps=3)

## Summary

Adaptive sweeps bracketed the prefill optimum on **both** backends and ran the KV f16-vs-q8_0
acceptance test at depth 32 768. Prefill peaks at **`-ub 4096` on ROCm** and **`-ub 2048` on
Vulkan** (Vulkan drops −19.6 % at 4096 — a clean interior peak; ROCm 2048↔4096 is a
plateau-within-noise), `-b` is flat above `-ub`, and `-fa on` beats `off` on both (+9.1 % ROCm,
+5.6 % Vulkan prefill) with no decode cost. **KV q8_0 is rejected on both backends** — it fails the
≤5 % rule for *different* reasons (ROCm loses **−7.53 % decode**, Vulkan loses **−29.66 % prefill**)
and buys only ~330–374 MiB at 32 K, so **keep f16**. The two backends split by phase: at these
optima ROCm has higher synthetic prefill at depth 0 (+14.8 %) but Vulkan wins decode decisively
(**115 vs 75 tok/s, +53 %**) and overtakes ROCm on prefill once real KV is in play at depth 32 K
(+53 %). Caveat: these are synthetic llama-bench tokens with no MTP/concurrency — validated at the
serving operating point in the companion campaign report.

## Results — prefill sweep (MEASURED, synthetic pp8192, depth 0)

| Backend | Axis | Values → prefill tok/s | Best | Note |
|---------|------|------------------------|-----:|------|
| ROCm | `-ub` | 512:2714 · 1024:3405 · 2048:3844 · **4096:3880** · 8192:3167 | 4096 | 2048↔4096 `plateau_within_noise`; 8192 −18.4 % |
| ROCm | `-b` | 4096:3880 · 8192:3864 | 4096 | flat (≤0.5 %) |
| ROCm | `-fa` | on:3880 · off:3557 | on | **+9.1 %** prefill, decode flat |
| Vulkan | `-ub` | 512:2729 · 1024:3201 · **2048:3372** · 4096:2711 | 2048 | **interior peak** (4096 −19.6 %) |
| Vulkan | `-b` | 2048:3372 · 4096:3381 · 8192:3378 | 4096 | flat (≤0.3 %) |
| Vulkan | `-fa` | on:3381 · off:3202 | on | **+5.6 %** prefill, decode flat |

Decode (tg128) is flat across `-ub`/`-b` on both backends: **ROCm ≈ 75 tok/s**, **Vulkan ≈ 115 tok/s**.

## Cross-backend, each at its own optimum (MEASURED)

| Metric | ROCm (`-ub 4096`) | Vulkan (`-ub 2048`) | Winner |
|--------|------------------:|--------------------:|--------|
| Prefill @ depth 0 (pp8192) | **3880** | 3381 | ROCm +14.8 % |
| Decode (tg128) | 75.2 | **115.0** | **Vulkan +53 %** |
| Prefill @ depth 32768 (KV in play) | 1412 | **2166** | **Vulkan +53 %** |

Phase split: ROCm's prefill edge is real only at depth 0; with a populated KV cache (32 K) Vulkan's
prefill overtakes it, and Vulkan owns decode outright. **Decode is the binding constraint on the
32 GB card at long context → Vulkan is the base backend.**

## KV decision (sweep A/B at depth 32768, ≤5 % rule)

| Backend | f16 pp/tg | q8_0 pp/tg | Δpp % | Δtg % | VRAM peak f16→q8_0 | VRAM saved | Verdict |
|---------|-----------|------------|------:|------:|--------------------|-----------:|---------|
| ROCm | 1412 / 69.7 | 1425 / 64.5 | +0.93 | **−7.53** | 27004 → 26674 MiB | 330 MiB | **KEEP f16** (decode fails) |
| Vulkan | 2166 / 99.5 | 1523 / 101.0 | **−29.66** | +1.46 | 24982 → 24608 MiB | 374 MiB | **KEEP f16** (prefill fails) |

The two failure modes are the finding: **q8_0 KV hurts ROCm's *decode* and Vulkan's *prefill*.**
At 32 K the VRAM saving (~0.35 GiB) is far too small to justify the loss. q8_0 only becomes
interesting near/above 64 K, where f16 KV stops fitting the 65 536 window — see the campaign
report's `cr64000` overflow. Power was 224–235 W with no throttling across the KV runs
(`gpu.csv`, 36–44 samples each).

## What moved the needle (deltas vs each backend's `-ub 512` baseline)

| Change | ROCm prefill Δ | Vulkan prefill Δ | Note |
|--------|---------------:|-----------------:|------|
| `-ub 512 → optimum` | +42.9 % (→4096) | +23.6 % (→2048) | biggest lever; past the peak it reverses |
| `-fa off → on` | +9.1 % | +5.6 % | free (no decode cost) |
| `-b` above `-ub` | ≈0 % | ≈0 % | set `-b = -ub`, don't chase it |
| KV f16 → q8_0 @32K | pp +0.9 % / **tg −7.5 %** | **pp −29.7 %** / tg +1.5 % | rejected both backends |

## Recommended config (from the sweeps)

```
# ROCm (prefill-leaning, depth 0):
llama-server -m Qwen3.6-35B-A3B-UD-Q4_K_M.gguf -ngl 99 -fa on -ub 4096 -b 4096 -ctk f16 -ctv f16 -c <ctx> [--spec-type draft-mtp]

# Vulkan (decode-leaning — the base backend for long-context work):
llama-server -m Qwen3.6-35B-A3B-UD-Q4_K_M.gguf -ngl 99 -fa on -ub 2048 -b 4096 -ctk f16 -ctv f16 -c <ctx> [--spec-type draft-mtp]
```

## Methodology & caveats

- **Synthetic** llama-bench tokens (pp=8192, tg=128), reps=3, ±3 % noise band. **No MTP, no chat
  template, no concurrency, no real prompts** — those live in the campaign track; do not read a
  decode number here as the served rate (MTP adds +30–40 % — see campaign).
- Grid **expanded adaptively**: each axis grew ×2/÷2 until the argmax was interior or hit a cap.
  ROCm `-ub` bracketed 512…8192 (peak 4096, plateau w/ 2048); Vulkan bracketed 512…4096 (clean
  peak 2048). `-b` held at/above `-ub` per llama.cpp's clamp.
- KV A/B at depth 32768; q8_0 accepted only if **both** pp and tg lose ≤5 %. VRAM/power from the
  per-invocation `gpu.csv` sampler.
- Full parameterization in each run's `meta.txt` + `sweep-summary.json`; raw per-invocation JSON in
  `invocations/`.

## External comparison

Legacy harness (2026-07-10, superseded) `CLAIMED` Vulkan+MTP ≈135.9 decode at 64 K
([INDEX](../INDEX.md)). This sweep's synthetic Vulkan decode (115, no MTP, depth 0) is consistent
directionally; the served +MTP rate is in the campaign report.
