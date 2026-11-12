# 2026-09-11-2047-vllm-qwen38-27b-int4

Campaign type `perf`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): vLLM 0.29.0 + RedHatAI Qwen3.8-27B-INT4 on the R9700 — the default ROCm attention backend collapses decode at depth (**2.8 tok/s @32k**); `--attention-backend TRITON_ATTN` fixes it (**14.1 tok/s**, +10% at 512 too) but costs 32k prefill (**222 vs ~470 tok/s**). Both lose to llama.cpp b10909 (28.2 tok/s / 872 tok/s). Profiling roots the decode gap in per-kernel dispatch overhead under full CUDA graphs (963 kernels/step, ~19.5 µs floor each, 23 ms idle/step), NOT in the INT4 kernel (~574 GB/s, near bandwidth).

- **Write-up:** [`2026-09-11-2047-vllm-qwen38-27b-int4.md`](../../../docs/findings/vllm/2026-09-11-2047-vllm-qwen38-27b-int4.md) · [`2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md`](../../../docs/findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md)
- **Recipe:** no driver kept with the data; the write-up's method section records the commands.
- **`results/`** — rows, summaries, charts (committed): `aiter-off-1/`, `aiter-off-2/`, `aiter-on-1/`, `aiter-on-2/`, `cwave-vllm-maxseqs16/`, `host-mtp8-padded/`, `host-mtp8-unpadded/`, `llamacpp-mtp-real/`, `meta.txt`, `mtp0/` (+13 more)
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-09-11-2047-vllm-qwen38-27b-int4/`
