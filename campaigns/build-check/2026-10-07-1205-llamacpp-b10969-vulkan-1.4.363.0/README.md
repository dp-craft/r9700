# 2026-10-07-1205-llamacpp-b10969-vulkan-1.4.363.0

Campaign type `build-check`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): llama.cpp **b10969-vulkan-1.4.363.0** build check on `Qwen3.8-27B-UD-Q4_K_XL.gguf` / KV q8_0 — vulkan: **NEUTRAL** vs `b10969-vulkan-1.4.357.1` (2k-in / 512-out request +0.2%).

- **Write-up:** [`2026-10-07-1205-llamacpp-b10969-vulkan-1.4.363.0-build-check.md`](../../../docs/findings/llamacpp/build-checks/2026-10-07-1205-llamacpp-b10969-vulkan-1.4.363.0-build-check.md)
- **Recipe:** no driver kept with the data; the write-up's method section records the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-10-07-1205-buildcmp-b10969-vulkan-1.4.363.0/`, `2026-10-07-1206-model-warmup-b10969-vulkan-1.4.357.1/`, `2026-10-07-1207-model-buildcmp-b10969-vulkan-1.4.357.1/`, `2026-10-07-1208-model-warmup-b10969-vulkan-1.4.363.0/`, `2026-10-07-1209-model-buildcmp-b10969-vulkan-1.4.363.0/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-10-07-1205-buildcmp-b10969-vulkan-1.4.363.0/`, `bench/runs/2026-10-07-1206-model-warmup-b10969-vulkan-1.4.357.1/`, `bench/runs/2026-10-07-1207-model-buildcmp-b10969-vulkan-1.4.357.1/`, `bench/runs/2026-10-07-1208-model-warmup-b10969-vulkan-1.4.363.0/`, `bench/runs/2026-10-07-1209-model-buildcmp-b10969-vulkan-1.4.363.0/`
