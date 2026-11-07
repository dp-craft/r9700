# Sly radiance 1.6.0 · Qwen3.8-27B MXFP4 · fp8 KV — depth curve + growing conversation (R9700, 2026-10-22-1324)

Scaffolded by `bench/core/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `tmp/done/`, rerun to continue). Fill in the prose below.

## Fixed parameters
- Model `amd__Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c` · engine **vLLM (docker)** · profile `sly-radiance/qwen38-mxfp4` (`stack/serve/vllm/profiles/`) · served as `qwen38-27b-mxfp4` · server on :8000 · image = the profile's IMAGE (resolved per server in `results/server-<name>.txt`).

## Fixtures (auto-built)
`run.sh` **auto-builds any missing prompt fixture** into `bench/workloads/tmp/` from its
canonical recipe (`build_prompt.py`) as a pre-flight step, before loading any model — no manual
step. Known patterns: `codereview-<N>.txt`, `thinking-hard.txt`, `agentic-<N>[-v<k>].txt`. An
unrecognized filename fails loudly with a pointer to `bench/workloads/README.md` (add its recipe
to `ensure_fixtures` in `gen_campaign.py` to support a new pattern).

## Run
```bash
bash campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/run.sh
# resume after interruption: same command (tmp/done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/run.sh
# tighten the guard:      VRAM_BUDGET_MIB=31000 bash campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each probe's raw dir (`tmp/<stamp>-engine-<probe>/gpu_samples.csv`).

## Layout
- `results/` (committed): `results.jsonl` (every probe's rows, appended once by `engine-bench/run.sh` when the
  probe succeeds), `meta.txt`, `failures.txt`, `skipped.txt`, `server-<name>.txt`,
  `charts/`, `appendix.md`, `gpu_peaks.json`.
- `tmp/` (git-ignored raw): `done/` markers, one `<stamp>-engine-<probe>/` dir per probe (meta, prompt copies,
  `/props`, `gpu_samples.csv`).

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
| mxfp4-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `mx-cr8000` | 1 | codereview-8000.txt |
| mxfp4-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `mx-cr20000` | 1 | codereview-20000.txt |
| mxfp4-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `mx-cr40000` | 1 | codereview-40000.txt |
| mxfp4-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `mx-cr140000` | 1 | codereview-140000.txt |
| mxfp4-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `mx-conv` | 1 | codereview-150000.txt |

## Write-up
**Write-up:** [`2026-10-22-1324-vllm-sly-mxfp4-depth.md`](../../../docs/findings/vllm/2026-10-22-1324-vllm-sly-mxfp4-depth.md) (its `<!-- meta -->` block names this campaign). `run.sh`'s last step renders
the charts into `results/charts/` + `results/appendix.md` (`bench/core/report.py`).
