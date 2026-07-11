# docs/ index — report register

Every report in `docs/` gets one line here, **newest first**. `analysis/` = our measurements,
`research/` = external synthesis. Add your entry when you write a new report (the skills do this).

Format: `YYYY-MM-DD HH:MM · kind · [file](path) — one-line takeaway`

## Analysis (measured on this box)

- 2026-07-11 18:44 · analysis · [campaign-combo35b](analysis/2026-07-11-1844-campaign-combo35b.md)
  — 35B serving matrix (backend×MTP×KV×depth×conc). **MTP +30–40% decode single-stream but −8…−15% at
  c4** (turn off for parallel). Vulkan+MTP+f16 ≈**140 dec**; q8_0 KV = no gain; `cr64000` overflows 65536 ctx;
  4 agents fit 32 GB (~48 tok/s/stream, TTFT p95 11 s).
- 2026-07-11 18:33 · analysis · [sweep-35b-rocm-vs-vulkan](analysis/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md)
  — Adaptive tuning optimum: **ROCm `-ub 4096`, Vulkan `-ub 2048`** (interior peak), `-fa on` +6–9% pf,
  `-b`=`-ub`. **KV q8_0 REJECTED both** (ROCm −7.5% dec, Vulkan −29.7% pf) → keep f16. Vulkan decode +53%.
- 2026-07-10 18:10 · analysis · [rdna4-r9700-tuning-optimum](analysis/2026-07-10-1810-rdna4-r9700-tuning-optimum.md)
  — 64K sweep: **llama.cpp Vulkan + MTP wins** (35B 2993 pf / 135.9 dec). ROCm→Vulkan +67%/+46%;
  MTP +29–132% decode; `-ub 512→2048` +21% prefill; `dpm=high` is −15% (use `auto`). vLLM/HF not competitive.
- 2026-07-09 · analysis · [runtime-benchmark-r9700](analysis/2026-07-09-runtime-benchmark-r9700.md)
  — 100K context, ROCm. Qwen3-Coder-30B-A3B Q4_K_M ~90 tok/s decode; ollama prefill ~2× llama.cpp
  (rocBLAS vs hipBLASLt); MTP +1.29–1.55× decode.

## Research (external, sourced)

- 2026-07-11 16:30 · research · [vllm-benchmark-serving](research/2026-07-11-1630-vllm-benchmark-serving.md)
  — vLLM's serving bench is now `vllm bench serve`: engine-agnostic HTTP client (TTFT/TPOT/ITL,
  percentiles, Poisson rates); heavy install (full vLLM). We use llama-benchy + own probe instead.
- 2026-07-11 09:18 · research · [benchmark-harness-build-vs-adopt](research/2026-07-11-0918-benchmark-harness-build-vs-adopt.md)
  — **Adopt, two-tool split.** Tuning (single engine) → `llama-bench` (de-facto RDNA4 standard, already
  in repo). Cross-engine → an OpenAI-endpoint HTTP bench (llama-benchy / sglang / vllm-bench, GPU-transparent).
  Keep thin custom only for MTP + unique-prefix long-context. Avoid MLPerf (validation-only) & Phoronix (broken).
- 2026-07-10 · research · [rdna4-llamacpp-ollama-backend-tuning](research/2026-07-10-rdna4-llamacpp-ollama-backend-tuning.md)
  — Batch/backend tuning: prefill scales with `-ub` up to ~2048 (not 32/64); RADV often beats ROCm on
  RDNA4; ollama has no ubatch knob (only `num_batch`); rocWMMA FA needs ROCm ≥7.
- 2026-07-09 · research · [rdna4-r9700-llm-optimization](research/2026-07-09-rdna4-r9700-llm-optimization.md)
  — ROCm works on gfx1201 via ollama `rocm_v7_2`; RDNA4 = FP8 native, no FP4 WMMA; 32 GB is
  memory-bound → Q4_K_M optimal; MTP is llama.cpp-only (not ollama).
