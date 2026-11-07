# MRCR v2, 8-needle, ~131K context — Qwen3.8-27B Q6_K on a single R9700

**MRCR v2** (multi-round coreference resolution) is Google DeepMind's long-context benchmark: in a
~131K-token User/Assistant transcript the user repeatedly requests a piece of writing matching a
(format, topic, style) triple, and the closing query asks for the *k-th* one — the model must reproduce
the right needle **verbatim** and prefix it with a given hash, so it is retrieval *plus counting*, not
needle-in-a-haystack. This run put a local 27B at **Q6_K** (llama.cpp Vulkan, one 32 GB R9700, no tools)
on the deepest 128K bucket (8-needle, 35 of the 103 rows, stride 3) to see how quantised open weights
hold up at depth against published 128K figures.

**Write-up:** [2026-09-02-1437-mrcr-v2-qwen38-27b-q6k.md](../../../docs/findings/quality/2026-09-02-1437-mrcr-v2-qwen38-27b-q6k.md)

**Layout**
- no `inputs/` and no recipe files in this dir — the benchmark data lives outside the repo (downloaded to `~/mrcr_v2/`)
- `results/` (committed): `results_128k_medium.csv` — per-sample scores + tokens/latency for this run
- `tmp/` (gitignored): `mrcr_128k_run.log` (console log)
- harness (shared, not in this dir): `bench/quality/mrcr/` — `download.sh` (GCS dataset) + `run_local.py` (points at a local OpenAI-compatible endpoint; imports GDM's scorer, does not reimplement it)

**Reproduce**
```bash
bash bench/quality/mrcr/download.sh ~/mrcr_v2 -n 8 -s   # 8-needle, <=128K group
cd ~/.config/llama-swap && python3 generate.py && bash ~/llama_swap_start.sh start   # serving config in the write-up
python3 bench/quality/mrcr/run_local.py \
  --csv ~/mrcr_v2/mrcr_v2/'mrcr_v2p1_8needle_in_(65536,131072)'*.csv \
  --effort medium --stride 3 --time-budget 3300 --out results_128k_medium.csv
```
`--dry-run` projects the cost without touching the GPU; `--limit 3` smoke-tests a bucket. The committed
per-sample output is `results/results_128k_medium.csv`.

Numbers: `MEASURED` (this campaign's `results/`), see the write-up.
