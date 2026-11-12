<!-- meta
date: 2026-07-11 16:30
takeaway: vLLM's serving bench is now `vllm bench serve`: engine-agnostic HTTP client (TTFT/TPOT/ITL, percentiles, Poisson rates); heavy install. We use llama-benchy + own probe instead.
-->

# Research: vLLM benchmark_serving.py Tool

- **Date:** 2026-07-11 16:30   · **Question:** What is vLLM's benchmark_serving.py, what does it measure, is it engine-agnostic, what's the AMD/ROCm status, and what are its limitations?
- **Confidence:** high   · **Sources:** 3 (Tier-1: 3)

## Summary

vLLM's `benchmark_serving.py` is **deprecated** as of 2025-09-09 and has been moved to the vLLM CLI as `vllm bench serve`. The tool measures **online serving throughput** via HTTP requests to OpenAI-compatible endpoints. It is **engine-agnostic** — it works with any backend (vLLM, OpenAI, Ollama, Infinity) that speaks the OpenAI completions API. AMD/ROCm support is transparent: the benchmark is a pure HTTP client and doesn't inspect or constrain GPU hardware. Use case is single-box tuning and distributed load testing. Key metrics: request throughput (req/s), token throughput (tok/s), TTFT/TPOT latencies with percentiles, and per-request latency.

## Key findings

| # | Finding | Provenance | Source | Confidence |
|---|---------|-----------|--------|-----------|
| 1 | benchmark_serving.py is fully deprecated; functionality moved to `vllm bench serve` CLI | CLAIMED | [vLLM #24411](https://github.com/vllm-project/vllm/commit/6fb27881634d89c2e70e9e5fbad1b918c0d916cf) | high |
| 2 | Measures: TTFT, TPOT, ITL, request/token throughput, goodput, latency percentiles | CLAIMED | [serve.py BenchmarkMetrics](https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/serve.py#L1-L50) | high |
| 3 | Engine-agnostic; supports vllm, openai, openai-chat, infinity-embeddings, vllm-rerank, etc. | CLAIMED | [endpoint_request_func.py ASYNC_REQUEST_FUNCS](https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/lib/endpoint_request_func.py#L880-L895) | high |
| 4 | Client-side HTTP tool (no GPU awareness); AMD ROCm supported at vLLM engine level | CLAIMED | [vLLM README](https://raw.githubusercontent.com/vllm-project/vllm/main/README.md) | high |
| 5 | Last commit (deprecation): 6fb27881 on 2025-09-09 | MEASURED-BY-US | GitHub API | high |
| 6 | Limitation: TODO on RPS calculation for embeddings; limited multi-modal benchmarking | CLAIMED | [serve.py L915](https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/serve.py) | high |

## Detail

**Deprecation & Migration:**
The original `benchmarks/benchmark_serving.py` was fully deprecated in commit **6fb27881** on **2025-09-09** ([PR #24411](https://github.com/vllm-project/vllm/commit/6fb27881634d89c2e70e9e5fbad1b918c0d916cf)) by Ye Charlotte Qi. The tool now lives as a CLI subcommand: `vllm bench serve`. Current vLLM version: **v0.24.0** (released 2026-06-29); latest commit **bec0a4ed** on 2026-07-11.

**Metrics & Output:**
The tool measures a comprehensive BenchmarkMetrics dataclass:
- **Throughput**: request throughput (req/s), output throughput (tok/s), total token throughput (tok/s), request goodput
- **Latency — TTFT (Time to First Token)**: mean, median, std, 25th/50th/75th/90th/99th percentiles (ms)
- **Latency — TPOT (Time Per Output Token)**: mean, median, std, percentiles (ms)
- **Per-request**: inter-token latency (ITL) mean/median/std, end-to-end latency
- **Request counts**: completed, failed, total input tokens, total output tokens

Output format: JSON results file named with pattern `{label}-{qps}-{model}-{timestamp}.json` (stored in `--result-dir`).

**Engine-Agnostic Design:**
The benchmark is **purely HTTP-based**, not coupled to vLLM internals. Supported backends via `--backend` flag:
- **vllm** → async_request_openai_completions
- **openai** → async_request_openai_completions (default)
- **openai-chat** → async_request_openai_chat_completions
- **openai-audio** → async_request_openai_audio
- **openai-embeddings** → async_request_openai_embeddings
- **infinity-embeddings** → Infinity embedding server (https://github.com/michaelfeil/infinity)
- **vllm-rerank** → vLLM reranker endpoint
- (and more)

Any OpenAI-compatible endpoint works. GPU device choice is irrelevant — the benchmark is a client-side load driver.

**AMD/ROCm Support:**
No GPU-specific logic in `benchmark_serving.py` / `vllm bench serve`. AMD/ROCm GPU support exists at the **vLLM engine level** (mentioned in vLLM README: "Support for NVIDIA GPUs, AMD GPUs, and x86/ARM/PowerPC CPUs"). The benchmark endpoint can be backed by any GPU, and the tool will transparently benchmark it. No AMD-specific configuration required; benchmarking works identically on ROCm and CUDA backends.

**Use Cases:**
- **Single-box tuning**: Run server on one machine, benchmark client on another, vary `--num-prompts`, `--request-rate`, `--input-len`, `--output-len`.
- **Distributed load testing**: Multiple benchmark clients hitting a single server endpoint, controlled concurrency via `--max-concurrency`.
- **Comparative benchmarks**: Same `--dataset-name` (e.g., 'random', 'sharegpt') across different backends or quantizations.

**Limitations & TODOs:**
- One documented TODO ([serve.py L915](https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/serve.py#L915)): "there is no notion of RPS here, may be we can calculate" — RPS (requests per second goodput) may not be accurately tracked for embeddings workloads.
- No built-in multi-modal (vision) benchmarking; limited to text completions and embeddings.
- Tokenizer mismatch detection/realignment exists but is a post-hoc workaround, not a primary feature.
- Requires server to be running before benchmark starts.

## Conflicts & unknowns
- No known conflicts with sources.
- Specific ROCm driver version recommendations for benchmark_serving.py are not documented; inherit vLLM's ROCm prerequisites.

## Actionable for this repo
- If running on RDNA4 (R9700), deploy vLLM server with `--device rocm` (or default auto-detect), then benchmark with `vllm bench serve --backend openai --api-url http://localhost:8000/v1 --input-len <> --output-len <> --request-rate <rps>`.
- Use `--dataset-name sharegpt` for realistic prompt distributions.
- Extract JSON output to `results_*.jsonl` for integration with your benchmarking harness.

## Sources
- **vLLM GitHub (primary)** — github.com/vllm-project/vllm — accessed 2026-07-11 — Tier 1
  - Commit 6fb27881 (deprecation notice)
  - File: vllm/benchmarks/serve.py (2284 lines, current implementation)
  - File: vllm/benchmarks/lib/endpoint_request_func.py (905 lines, backend handlers)
  - README.md (GPU support statement)
- **vLLM Releases** — GitHub API — accessed 2026-07-11 — Tier 1
  - v0.24.0 published 2026-06-29; main branch latest commit 2026-07-11
