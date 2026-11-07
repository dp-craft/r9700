# 2026-09-15-1029-stew675-buildcmp

Campaign type `build-check`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): stew675 patch delivers +14-20% prefill on ROCm, flat decode, Vulkan prefill flat/slightly worse

- **Write-up:** [`2026-09-15-1029-stew675-buildcmp.md`](../../../docs/findings/llamacpp/build-checks/2026-09-15-1029-stew675-buildcmp.md)
- **Recipe (as run):** `buildcmp-stew675.sh`, `meta.txt`. The write-up's method section has the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-09-15-1029-buildcmp-stew675/`, `2026-09-15-1035-model-buildcmp-stock-rocm/`, `2026-09-15-1040-model-buildcmp-stew675-vulkan/`, `2026-09-15-1046-model-buildcmp-stew675-rocm/`, `summary.jsonl`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/`, `bench/runs/2026-09-15-1029-buildcmp-stew675/`, `bench/runs/2026-09-15-1035-model-buildcmp-stock-rocm/`, `bench/runs/2026-09-15-1040-model-buildcmp-stew675-vulkan/`, `bench/runs/2026-09-15-1046-model-buildcmp-stew675-rocm/`, `campaigns/2026-09-15-stew675-buildcmp/`
