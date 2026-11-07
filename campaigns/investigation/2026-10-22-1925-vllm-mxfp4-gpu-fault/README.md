# 2026-10-22-1925-vllm-mxfp4-gpu-fault

Campaign type `investigation`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): SOLVED 2026-10-23 (see 2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg) — the GPU memory fault in Sly's MXFP4 GEMMs was a corrupted kernel-argument pointer (bit 44), fixed by HIP_FORCE_DEV_KERNARG=0; this report keeps the llama-swap serving, RAM-tier and fp8-KV findings

- **Write-up:** [`2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md`](../../../docs/findings/vllm/2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md) · [`2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md`](../../../docs/findings/vllm/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md)
- **Recipe (as run):** `claudetest.sh`, `kerneltest.sh`, `ladder.sh`, `speeds.py`, `swaptest.sh`, `vllmtest.sh`. The write-up's method section has the commands.
- **`inputs/`** — fixtures (committed): `p0.json`, `p1.json`, `p2.json`, `p3.json`, `p4.json`
- **`results/`** — rows, summaries, charts (committed): `results.tsv`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `docs/plans/2026-10-22-mxfp4-qwen38-options/`
