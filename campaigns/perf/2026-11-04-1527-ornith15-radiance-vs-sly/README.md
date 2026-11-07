# 2026-11-04-1527-ornith15-radiance-vs-sly

Campaign type `perf`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): Best 35B on one R9700 at 210 W is Ornith-1.5-35B-A3B w4a8 on native Radiance 1.16.0 with MTP K=3: 220/205/175 t/s decode and 13059/8029/5301 t/s prefill at 10k/50k/100k, 2.1-2.5x Qwen3.8-27B on Sly 1.9.1 (87/96/82 t/s). Ornith on Sly with Radiance's serving values and DFlash K=3 reaches only 95/71/67 t/s, and MTP does not load there on any usable backend. The Qwen3.5-35B slowdown on Sly is the EMULATION MoE backend (16.6 to 110 t/s with triton_unfused). Radiance's default 96 MiB headroom crashed the desktop once, and coding quality is untested.

- **Write-up:** [`2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`](../../../docs/findings/radiance/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md)
- **Recipe (as run):** `scripts/`. The write-up's method section has the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-11-04-1527-35b-kv-fit/`, `2026-11-04-1557-35b-perf-10k-50k-100k/`, `2026-11-04-1730-ornith15-w4a8-radiance/`, `2026-11-04-1740-27b-sly-baseline/`, `2026-11-04-1802-ornith15-sly-dflash/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-11-04-1527-35b-kv-fit/`, `bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k/`, `bench/runs/2026-11-04-1730-ornith15-w4a8-radiance/`, `bench/runs/2026-11-04-1740-27b-sly-baseline/`, `bench/runs/2026-11-04-1802-ornith15-sly-dflash/`
