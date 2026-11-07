# 2026-10-08-1316-llamacpp-b11448-rocm

Campaign type `build-check`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): llama.cpp **b11448-rocm** build check on `Qwen3.8-27B-UD-Q4_K_XL.gguf` / KV q8_0 — rocm: **REGRESSION** vs `b790cf51aa-stew675-10.1-rocm` (32k-in / 2k-out request +14.6%).

- **Write-up:** [`2026-10-08-1316-llamacpp-b11448-rocm-build-check.md`](../../../docs/findings/llamacpp/build-checks/2026-10-08-1316-llamacpp-b11448-rocm-build-check.md)
- **Recipe:** no driver kept with the data; the write-up's method section records the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-10-08-1316-buildcmp-b11448-rocm/`, `2026-10-08-1316-model-buildcmp-b790cf51aa-stew675-10.1-rocm/`, `2026-10-08-1320-model-buildcmp-b11448-rocm/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-10-08-1316-buildcmp-b11448-rocm/`, `bench/runs/2026-10-08-1316-model-buildcmp-b790cf51aa-stew675-10.1-rocm/`, `bench/runs/2026-10-08-1320-model-buildcmp-b11448-rocm/`
