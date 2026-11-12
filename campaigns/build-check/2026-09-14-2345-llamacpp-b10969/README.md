# 2026-09-14-2345-llamacpp-b10969

Campaign type `build-check`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): llama.cpp **b10969** build check on `Qwen3.8-27B-UD-Q4_K_XL.gguf` / KV q8_0 — vulkan: **NEUTRAL** vs `b10909-vulkan` (32k-in / 2k-out request -0.1%).

- **Write-up:** [`2026-09-14-2345-llamacpp-b10969-build-check.md`](../../../docs/findings/llamacpp/build-checks/2026-09-14-2345-llamacpp-b10969-build-check.md)
- **Recipe:** no driver kept with the data; the write-up's method section records the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-09-14-2345-buildcmp-b10969/`, `2026-09-14-2345-model-buildcmp-b10909-vulkan/`, `2026-09-14-2350-model-buildcmp-b10969-vulkan-1.4.357.1/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-09-14-2345-buildcmp-b10969/`, `bench/runs/2026-09-14-2345-model-buildcmp-b10909-vulkan/`, `bench/runs/2026-09-14-2350-model-buildcmp-b10969-vulkan-1.4.357.1/`
