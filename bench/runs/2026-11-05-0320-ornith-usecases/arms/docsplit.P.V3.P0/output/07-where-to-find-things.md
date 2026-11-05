## Where to find things (quick answers)

- *"What's the fastest config?"* → `docs/INDEX.md` top entry → its report's top table (a report is
  either `docs/analysis/*.md` or a co-located `campaigns/*/analysis.md`). (Currently: llama.cpp
  Vulkan + MTP, `-ub 2048 -b 8192 -fa on`.)
- *"How do I run a benchmark?"* → `docs/GUIDE.md` (step-by-step, offline). Tracks: `bench/model-bench/`
  (llama-bench tuning) and `bench/engine-bench/` (cross-engine on real workloads).
- *"Build vs adopt a harness?"* → decided: adopt. `docs/research/2026-07-11-0918-benchmark-harness-build-vs-adopt.md`.
- *"What did we already research?"* → `docs/INDEX.md`.
- *"What are the raw numbers?"* → `bench/runs/<stamp>-*/` (new) or `bench/legacy/harness/results_*.jsonl` (legacy).
