# docs/ index — report register

Every report in `docs/` gets one line here, **newest first**. `analysis/` = our measurements,
`research/` = external synthesis.

**This file is generated** by [`reindex.py`](reindex.py) from each report's `<!-- meta -->`
block (date + one-line takeaway) — don't hand-edit the lists below. After adding or editing a
report, run `docs/reindex.py` (or `docs/reindex.py --check` in CI). Reports without a meta block
make reindex fail on purpose.

Format: `YYYY-MM-DD HH:MM · kind · [file](path) — one-line takeaway`

## Analysis (measured on this box)

<!-- reindex:analysis:start -->
- 2026-07-11 22:00 · analysis · [deep-context-35b](analysis/2026-07-11-2200-deep-context-35b.md) — Deep-context 35B on Vulkan to 200K tokens (native 262144 cap). f16 KV runs to 200K with no OOM — VRAM is not binding, the RoPE cap is. Prefill decays 3077→1254 tok/s and decode 104→61 (8K→200K). **MTP grows with depth (+14→+35% decode) but is a NET LOSS for deep-prefill/short-decode** (200K: +18s prefill vs +1s decode saved → −17s wall). **q8_0 KV is catastrophic at depth: −40% prefill, −22% decode, TTFT +66%** (penalty scales with ctx) → keep f16 everywhere. Parallel at 32K prompts is prefill-bound: np2→np4 doubles TTFT (24→49s) for ~0 aggregate gain.
- 2026-07-11 18:44 · analysis · [campaign-combo35b](analysis/2026-07-11-1844-campaign-combo35b.md) — 35B serving matrix (backend×MTP×KV×depth×conc). **MTP +30–40% decode single-stream but −8…−15% at c4** (off for parallel). Vulkan+MTP+f16 ≈**140 dec**; q8_0 KV = no gain; `cr64000` overflows 65536 ctx; 4 agents fit 32 GB (~48 tok/s/stream, TTFT p95 11 s).
- 2026-07-11 18:33 · analysis · [sweep-35b-rocm-vs-vulkan](analysis/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md) — Adaptive tuning optimum: **ROCm `-ub 4096`, Vulkan `-ub 2048`** (interior peak), `-fa on` +6–9% pf, `-b`=`-ub`. **KV q8_0 REJECTED both** (ROCm −7.5% dec, Vulkan −29.7% pf) → keep f16. Vulkan decode +53%.
- 2026-07-10 18:10 · analysis · [rdna4-r9700-tuning-optimum](analysis/2026-07-10-1810-rdna4-r9700-tuning-optimum.md) — 64K sweep: **llama.cpp Vulkan + MTP wins** (35B 2993 pf / 135.9 dec). ROCm→Vulkan +67%/+46%; MTP +29–132% decode; `-ub 512→2048` +21% prefill; `dpm=high` −15% (use `auto`). vLLM/HF not competitive.
- 2026-07-09 · analysis · [runtime-benchmark-r9700](analysis/2026-07-09-runtime-benchmark-r9700.md) — 100K context, ROCm. Qwen3-Coder-30B-A3B Q4_K_M ~90 tok/s decode; ollama prefill ~2× llama.cpp (rocBLAS vs hipBLASLt); MTP +1.29–1.55× decode.
<!-- reindex:analysis:end -->

## Research (external, sourced)

<!-- reindex:research:start -->
- 2026-07-11 16:30 · research · [vllm-benchmark-serving](research/2026-07-11-1630-vllm-benchmark-serving.md) — vLLM's serving bench is now `vllm bench serve`: engine-agnostic HTTP client (TTFT/TPOT/ITL, percentiles, Poisson rates); heavy install. We use llama-benchy + own probe instead.
- 2026-07-11 09:18 · research · [benchmark-harness-build-vs-adopt](research/2026-07-11-0918-benchmark-harness-build-vs-adopt.md) — **Adopt, two-tool split.** Tuning → `llama-bench` (de-facto RDNA4 standard). Cross-engine → OpenAI-endpoint HTTP bench (llama-benchy/sglang/vllm-bench). Keep thin custom for MTP + unique-prefix long-context. Avoid MLPerf & Phoronix.
- 2026-07-10 · research · [rdna4-llamacpp-ollama-backend-tuning](research/2026-07-10-rdna4-llamacpp-ollama-backend-tuning.md) — Batch/backend tuning: prefill scales with `-ub` up to ~2048 (not 32/64); RADV often beats ROCm on RDNA4; ollama has no ubatch knob (only `num_batch`); rocWMMA FA needs ROCm ≥7.
- 2026-07-09 · research · [rdna4-r9700-llm-optimization](research/2026-07-09-rdna4-r9700-llm-optimization.md) — ROCm works on gfx1201 via ollama `rocm_v7_2`; RDNA4 = FP8 native, no FP4 WMMA; 32 GB memory-bound → Q4_K_M optimal; MTP is llama.cpp-only.
<!-- reindex:research:end -->
