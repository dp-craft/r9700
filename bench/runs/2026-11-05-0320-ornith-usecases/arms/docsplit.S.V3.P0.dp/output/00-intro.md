<!-- meta
date: 2026-07-11 22:00
takeaway: Deep-context 35B on Vulkan to 200K tokens (native 262144 cap). f16 KV runs to 200K with no OOM — VRAM is not binding, the RoPE cap is. Prefill decays 3077→1254 tok/s and decode 104→61 (8K→200K). **MTP grows with depth (+14→+35% decode) but is a NET LOSS for deep-prefill/short-decode** (200K: +18s prefill vs +1s decode saved → −17s wall). **q8_0 KV is catastrophic at depth: −40% prefill, −22% decode, TTFT +66%** (penalty scales with ctx) → keep f16 everywhere. Parallel at 32K prompts is prefill-bound: np2→np4 doubles TTFT (24→49s) for ~0 aggregate gain.
-->

# Benchmark: deep-context 35B-A3B to 200K tokens — depth curve · MTP × depth · q8_0 confirm · parallel at the ceiling — R9700 (gfx1201)

- **Date:** 2026-07-11 22:00 · **Track:** engine-bench campaign (`run.sh` per-probe, `serve_llamacpp.sh` Vulkan launcher)
- **GPU/Host:** AMD Radeon AI PRO R9700, 32624 MiB · `HSA_OVERRIDE_GFX_VERSION=12.0.1` · ROCm-SMI 7.8.0 · Ryzen 5 3600, 31 GB RAM
- **Runtimes/builds:** llama.cpp **b9950-961e4b26a** — Vulkan/RADV (`bench/llamacpp-vulkan/`) only · base knobs `-ub 2048 -b 4096 -fa on -ngl 99 -c 262144`
- **Models:** `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (embedded MTP layer) · **Data:** `bench/runs/2026-07-11-2200-deep-context/` (consolidated) + the 11 per-probe `bench/runs/2026-07-11-2{2,3}xx-engine-deep-*/` dirs

