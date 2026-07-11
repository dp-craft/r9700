# legacy — frozen, superseded harness

These were the benchmarking scripts up to 2026-07-10. They are **frozen and not maintained**:
the project moved to adopting mature tools (see
`docs/research/2026-07-11-0918-benchmark-harness-build-vs-adopt.md`) and now uses the two tracks in
`bench/model-bench/` and `bench/engine-bench/`.

**Do not run or fix these** — they hardcode the old repo path `/home/dev/work/dippe/amd` in 7 places
(`harness/config.sh`, `harness/probe.py`, `llamacpp_bench.sh`, `llamacpp_single.sh`,
`ollama_bench.sh`, `harness/run_backend.sh`) and will not run in this checkout. Kept only so past
analyses remain reproducible in spirit and their measured JSONL is preserved.

## Contents
- `harness/` — the original framework: `config.sh`, `lib.sh`, `probe.py` (runtime-native timings),
  `run_*.sh` orchestrators, `show.py`, `results_*.jsonl` (the measured data behind the 07-09 / 07-10
  analyses), Modelfiles, logs.
- `llamacpp_bench.sh`, `llamacpp_single.sh`, `ollama_bench.sh` — pre-harness ad-hoc benches.
- `llamacpp_results.jsonl`, `ollama_results.jsonl`, `matrix_results.jsonl` — their outputs.

If you need something here, **copy the idea into the new tracks**, don't revive the scripts.
