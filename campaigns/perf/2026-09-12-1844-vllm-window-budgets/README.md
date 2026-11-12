# 2026-09-12-1844-vllm-window-budgets

Campaign type `perf`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): The vLLM row's 36864 window could not serve the dp-forge spec-pipeline (dies at the first LLM stage); the row is now ctx 114688 / MTP-3 and MEASURED to boot (138k-token pool). fp8 KV measured as an exact null on this hybrid; MTP is the only window lever. At ~98k prompts vLLM decodes 25% faster than the llama.cpp 200k row (flat vs decaying decode), though llama.cpp leads decode by 60% at 8k.

- **Write-up:** [`2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md`](../../../docs/findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md)
- **Recipe (as run):** `scripts/`. The write-up's method section has the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-09-12-1844-vllm-window-bootmatrix/`, `2026-09-12-1943-vllm-bigwindow-depthcurve/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-09-12-1844-vllm-window-bootmatrix/`, `bench/runs/2026-09-12-1943-vllm-bigwindow-depthcurve/`
