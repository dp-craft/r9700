# 2026-10-08-1555-llamacpp-b11448

Campaign type `build-check`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): llama.cpp **b11448** build check on `Qwen3.8-27B-UD-Q4_K_XL.gguf` / KV q8_0 — rocm: **REGRESSION** vs `b790cf51aa-stew675-rocm` (pp32768+tg2048 request 312→276 t/s, −11.5%). Do not promote.

- **Write-up:** [`2026-10-08-1555-llamacpp-b11448-build-check.md`](../../../docs/findings/llamacpp/build-checks/2026-10-08-1555-llamacpp-b11448-build-check.md)
- **Recipe:** no driver kept with the data; the write-up's method section records the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-10-08-1555-buildcmp-b11448/`, `2026-10-08-1555-model-buildcmp-b790cf51aa-stew675-rocm/`, `2026-10-08-1559-model-buildcmp-b11448-rocm/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-10-08-1555-buildcmp-b11448/`, `bench/runs/2026-10-08-1555-model-buildcmp-b790cf51aa-stew675-rocm/`, `bench/runs/2026-10-08-1559-model-buildcmp-b11448-rocm/`
