# runs — dated campaign outputs

One directory per campaign: `YYYY-MM-DD-HHMM-<track>-<slug>/`, e.g.
`2026-07-11-1545-model-27b-ubsweep/` or `2026-07-11-1600-engine-cr64k/`.

The track scripts (`model-bench/run.sh`, `engine-bench/run.sh`) create these automatically. Each holds:
- `meta.txt` — exact knobs + environment (build/driver/gpu) for reproducibility
- `llama-bench.json` **or** `results.jsonl` — the canonical measured data (tracked)
- `prompt.txt` — the exact workload used (engine-bench)
- `*.err` / logs — gitignored

**The campaign dir name should match its analysis doc** in `docs/analysis/` (same `YYYY-MM-DD-HHMM-slug`),
so raw data and write-up stay linked 1:1. Turn a campaign into a report with the `/benchmark` skill.

`.gitkeep` keeps this dir under version control while it's empty.
