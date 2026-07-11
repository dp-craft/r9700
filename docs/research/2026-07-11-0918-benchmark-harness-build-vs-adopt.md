# Research: benchmark harness — build our own vs adopt a mature tool

- **Date:** 2026-07-11 09:18   · **Question:** Should this repo keep building a bespoke bash/python harness, or adopt mature tools for (a) cross-engine comparison and (b) single-engine tuning sweeps on the R9700 / RDNA4?
- **Confidence:** high   · **Sources:** 12 (Tier-1: 8, Tier-2: 4)

## Summary
**Adopt, don't build — as a two-tool split.** For single-engine *tuning sweeps*, llama.cpp's own
**`llama-bench`** (already shipped in `bench/llamacpp/`) is the de-facto RDNA4 standard: it sweeps
`-p/-n/-b/-ub/-ngl/-fa/-ctk/-ctv` in one invocation, does repetitions + stddev, and emits
JSON/CSV/SQL/markdown. For *cross-engine comparison* (llama.cpp vs ollama vs vLLM), adopt one
**OpenAI-endpoint HTTP benchmarker** — they are GPU-transparent, so RDNA4 "just works" because the
server handles ROCm/Vulkan. A thin custom wrapper survives only for the two things no mature tool
covers: **MTP/draft-acceptance** and our **unique-prefix long-context** methodology. Avoid MLPerf
(validation-only) and the Phoronix llama.cpp profile (broken/unmaintained).

## Key findings
| # | Finding | Provenance | Source | Confidence |
|---|---------|-----------|--------|-----------|
| 1 | `llama-bench` sweeps `-p/-n/-b/-ub/-ngl/-fa/-ctk/-ctv` (ranges supported), `-r` reps + stddev, out JSON/CSV/JSONL/SQL/md | CLAIMED | llama.cpp tools/llama-bench README | high |
| 2 | `llama-bench` is **library-only** — no server path, **no MTP/speculative**, **single-engine only** | CLAIMED | llama.cpp README; eugr/llama-benchy | high |
| 3 | `llama-bench` is the **de-facto RDNA4 tuning tool**; community workflow = ubatch sweep + bandwidth-util % | CLAIMED | ggml discussion #21043; timmyit.com R9700 writeup | high |
| 4 | Cross-engine needs a separate tool; several engine-agnostic OpenAI-endpoint benchmarkers exist and are **GPU-transparent** (RDNA4 works via the server) | CLAIMED | sglang, vllm, llm-perf, llama-benchy repos | high |
| 5 | `sglang bench_serving`: TTFT/TPOT/ITL + P90/95/99, 13 backends, **explicit ROCm/MI300 support**, actively maintained | CLAIMED | github.com/sgl-project/sglang | high |
| 6 | `vllm bench serve` (replaces deprecated `benchmark_serving.py`, Sep 2025): lighter HTTP load-tester, GPU-transparent | CLAIMED | github.com/vllm-project/vllm | high |
| 7 | `llama-benchy`: purpose-built to compare engines over OpenAI-compatible endpoints (llama.cpp/ollama/etc.) | CLAIMED | github.com/eugr/llama-benchy | medium |
| 8 | MLPerf Inference: edge/consumer category exists but 10+ min/scenario + compliance runs → **validation, not iteration** | CLAIMED | mlcommons.org; inference_policies | high |
| 9 | Phoronix Test Suite llama.cpp profile: **7× variance, broken GPU detection, unmaintained** — do not use | CLAIMED | phoronix-test-suite issue #898 | high |
| 10 | NVIDIA genai-perf/AIPerf: **CUDA-only, no ROCm** | CLAIMED | NVIDIA GenAI-Perf docs | high |
| 11 | No mature tool measures WMMA/kernel efficiency — that needs `rocprof` or engine-internal logs | CLAIMED | (gap noted across sources) | medium |
| 12 | GuideLLM (v0.7.1, active): engine-agnostic but SLO/capacity-planning focus — complements, not replaces, a raw-throughput bench | CLAIMED | github.com/vllm-project/guidellm | medium |

## Detail

**Two roles, two tools (they are not competitors):**
- **Model/tuning-focused, single engine → `llama-bench`.** This is the microscope: hold the engine
  fixed (llama.cpp), sweep one knob, get prefill(pp)/decode(tg) tok/s with variance. It replaces
  our homegrown `run_ub_sweep.sh` / `run_b_sweep.sh` / `probe.py` *for tuning*. Gaps: it can't drive
  the server, can't do MTP, can't touch ollama/vLLM.
- **Cross-engine comparator, multi-engine → an OpenAI-endpoint HTTP bench.** This is the wide shot:
  start each engine's server, point one tool at `/v1/completions`, compare apples-to-apples. Best
  candidates: **`sglang bench_serving`** (richest, explicit ROCm), **`vllm bench serve`** (lightest),
  **`llama-benchy`** (simplest, built exactly for this). All are HTTP clients with no GPU code, so
  RDNA4 support is inherited from the server.

**What stays custom (thin wrapper over `llama-server`):** MTP / draft-acceptance benchmarking
(llama-bench can't; needs server mode) and our unique-prefixed long-context prompt methodology
(defeats prefix cache). This is a small script, not a "harness."

**What to avoid:** MLPerf for day-to-day tuning (too slow), Phoronix TS llama.cpp profile (broken),
genai-perf on AMD (CUDA-only).

## Conflicts & unknowns
- **Cross-engine winner not yet decided:** `llama-benchy` (simple, purpose-built) vs `sglang`
  (richer metrics, explicit ROCm) vs `vllm bench` (lightest). Needs a hands-on starter run on this
  box to pick — see Actionable.
- **RDNA4/gfx1201 is not *explicitly* listed** by the HTTP benchmarkers (they cite MI300); support
  is `INFERRED` from their GPU-transparency, needs a smoke test to confirm end-to-end.
- Kernel-level efficiency (WMMA occupancy) is unmeasured by all of these — would need `rocprof`.

## Actionable for this repo
1. **Adopt the two-tool split.** Model-focused = `llama-bench`; cross-engine = pick one HTTP bench.
2. **Run a starter test for each** on this box (27B/35B) to confirm RDNA4 works end-to-end and to
   choose the cross-engine tool (llama-benchy vs sglang vs vllm-bench).
3. **Shrink the bespoke harness** to the MTP + unique-prefix niche; retire the ub/b sweep scripts in
   favour of `llama-bench`.
4. **Reflect the split in the repo layout** (separate dirs) and in the benchmark skill (route by goal).

## Sources
- llama.cpp `llama-bench` README — github.com/ggml-org/llama.cpp/blob/master/tools/llama-bench/README.md — accessed 2026-07-11 — Tier 1 — sweep flags, output formats, reps
- llama.cpp `batched-bench` README — github.com/ggml-org/llama.cpp/tree/master/tools/batched-bench — accessed 2026-07-11 — Tier 1 — parallel throughput
- ggml discussion #21043 — github.com/ggml-org/llama.cpp/discussions/21043 — accessed 2026-07-11 — Tier 1 — RDNA4 tuning workflow, R9700 peak numbers
- eugr/llama-benchy — github.com/eugr/llama-benchy — accessed 2026-07-11 — Tier 2 — cross-engine OpenAI-endpoint bench
- sgl-project/sglang (`bench_serving`) — github.com/sgl-project/sglang — accessed 2026-07-11 — Tier 1 — metrics, ROCm support, backends
- vllm-project/vllm (`vllm bench serve`) — github.com/vllm-project/vllm — accessed 2026-07-11 — Tier 1 — HTTP load tester, deprecation of benchmark_serving.py
- iopsystems/llm-perf — github.com/iopsystems/llm-perf — accessed 2026-07-11 — Tier 2 — minimal Rust OpenAI bench
- vllm-project/guidellm — github.com/vllm-project/guidellm — accessed 2026-07-11 — Tier 2 — SLO/capacity planning
- MLCommons MLPerf Inference — mlcommons.org/benchmarks/inference-datacenter — accessed 2026-07-11 — Tier 1 — scenarios, overhead
- Phoronix Test Suite issue #898 — github.com/phoronix-test-suite/phoronix-test-suite/issues/898 — accessed 2026-07-11 — Tier 1 — broken llama.cpp profile
- timmyit.com dual-R9700 writeup — accessed 2026-07-11 — Tier 2 — real RDNA4 tuning workflow
- NVIDIA GenAI-Perf docs — accessed 2026-07-11 — Tier 1 — CUDA-only limitation

---
*Note: this doc consolidates seven fragmented auto-generated research files from the same session
into one decision record. Subagents should return digests only; the main agent owns file writes.*
