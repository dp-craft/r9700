# 2026-09-11-1950-benchy-ideas-27b

Campaign type `perf`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): Forum tuning ideas on Qwen3.8-27B Q4_K_XL / Vulkan b10909 (llama-benchy, prose output): **none beats the served MTP config** — `--spec-draft-n-max 5` −11/−20% decode, MTP+ngram-mod −11%, adaptive MTP (PR #27210) −15/−5%, `rm_kq=1` +0.4% (tie); q8_0 KV ties f16 up to 18k tokens and saves 4.8 GB.

- **Write-up:** [`2026-09-11-1950-benchy-ideas-27b.md`](../../../docs/findings/llamacpp/2026-09-11-1950-benchy-ideas-27b.md)
- **Recipe (as run):** `scripts/`. The write-up's method section has the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-09-11-1950-benchy-ideas-27b/`, `2026-09-11-1951-engine-benchy-base-mtp3/`, `2026-09-11-1956-engine-benchy-mtp-nmax5/`, `2026-09-11-1959-engine-benchy-mtp-ngram/`, `2026-09-11-2003-engine-benchy-kvq8-mtp3/`, `2026-09-11-2006-engine-benchy-pr-mtp3/`, `2026-09-11-2010-engine-benchy-pr-adaptive12/`, `2026-09-11-2013-engine-benchy-base-mtp3-repeat/`, `2026-09-11-2016-model-rmkq1-b10909-vulkan/`, `2026-09-11-2017-model-rmkq2-b10909-rmkq1-vulkan/` (+2 more)
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-09-11-1950-benchy-ideas-27b/`, `bench/runs/2026-09-11-1951-engine-benchy-base-mtp3/`, `bench/runs/2026-09-11-1956-engine-benchy-mtp-nmax5/`, `bench/runs/2026-09-11-1959-engine-benchy-mtp-ngram/`, `bench/runs/2026-09-11-2003-engine-benchy-kvq8-mtp3/`, `bench/runs/2026-09-11-2006-engine-benchy-pr-mtp3/`, `bench/runs/2026-09-11-2010-engine-benchy-pr-adaptive12/`, `bench/runs/2026-09-11-2013-engine-benchy-base-mtp3-repeat/`, `bench/runs/2026-09-11-2016-model-rmkq1-b10909-vulkan/`, `bench/runs/2026-09-11-2017-model-rmkq2-b10909-rmkq1-vulkan/`, `bench/runs/2026-09-11-2017-model-rmkq3-b10909-vulkan/`, `bench/runs/2026-09-11-2018-model-rmkq4-b10909-rmkq1-vulkan/`
