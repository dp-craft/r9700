# 2026-09-12-1330-depth-curve-mtp

Campaign type `perf`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): `stilldeadcode/vllm-radiance` (gfx1201-only vLLM 0.27.1 + libr4d kernels) is the undisclosed "tuned" build behind Puget's R9700 numbers, and it runs our single-GPU INT4 checkpoint. **Clean 4-depth curve on ONE fixture family (findings 21-22): llama.cpp + MTP wins decode at every depth by 9-33 %; radiance's only win is prefill/TTFT at 8k.** Radiance decode does NOT decay with depth (exponent +0.070, R2 0.25) - the earlier "degrades with depth" claim was a content artifact and is withdrawn. The ranking is set by WORKLOAD, not depth: radiance leads on generated code, llama.cpp on review prose. A divergent-tail warm test (finding 23) confirms partial cache hits equal full hits, so the earlier identical-prompt warm figures stand.

- **Write-up:** [`2026-09-12-1055-vllm-radiance-r9700-evaluation.md`](../../../docs/findings/radiance/2026-09-12-1055-vllm-radiance-r9700-evaluation.md) · [`2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md`](../../../docs/findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md)
- **Recipe:** no driver kept with the data; the write-up's method section records the commands.
- **`results/`** — rows, summaries, charts (committed): `llamacpp-mtp/`, `radiance-r4d-mtp8/`, `t1-llamacpp-mtp/`, `t1-radiance-r4d-mtp8/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-09-12-1330-depth-curve-mtp/`
