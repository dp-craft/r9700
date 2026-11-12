# 2026-09-11-1537-llamacpp-b10909

Campaign type `build-check`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): llama.cpp **b10909** build check on `Qwen3.8-27B-UD-Q4_K_XL.gguf` / KV q8_0 — vulkan: **IMPROVEMENT** vs `b10655-4-g6fdd0ac-vulkan` (est. 30k-in / 4k-out request -2.4%); rocm: **IMPROVEMENT** vs `b10375-rocm` (est. 30k-in / 4k-out request -10.9%).

- **Write-up:** [`2026-09-11-1537-llamacpp-b10909-build-check.md`](../../../docs/findings/llamacpp/build-checks/2026-09-11-1537-llamacpp-b10909-build-check.md)
- **Recipe:** no driver kept with the data; the write-up's method section records the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-09-11-1537-buildcmp-b10909/`, `2026-09-11-1537-model-buildcmp-b10655-4-g6fdd0ac-vulkan/`, `2026-09-11-1540-model-buildcmp-b10909-vulkan/`, `2026-09-11-1544-model-buildcmp-b10375-rocm/`, `2026-09-11-1547-model-buildcmp-b10909-rocm/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-09-11-1537-buildcmp-b10909/`, `bench/runs/2026-09-11-1537-model-buildcmp-b10655-4-g6fdd0ac-vulkan/`, `bench/runs/2026-09-11-1540-model-buildcmp-b10909-vulkan/`, `bench/runs/2026-09-11-1544-model-buildcmp-b10375-rocm/`, `bench/runs/2026-09-11-1547-model-buildcmp-b10909-rocm/`
