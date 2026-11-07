# Sly 1.9.1 · RedHatAI Qwen3.8-27B-MXFP4 · MTP k=4 · CACTUS_DELTA=0 (stock sampling) · fp8 KV · ctx 262000 · depth 10k/50k/100k/150k (R9700, 2026-10-30)

Scaffolded by `bench/core/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `tmp/done/`, rerun to continue). Fill in the prose below.

## Fixed parameters
- Model `RedHatAI__Qwen3.8-27B-MXFP4@16a86728` · engine **vLLM (docker)** · profile `sly-redhat/redhat-mxfp4-mtp` (`stack/serve/vllm/profiles/`) · served as `qwen38-27b-redhat-mxfp4-mtp` · server on :8000 · image `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (resolved per server in `results/server-<name>.txt`).
- Env (all servers, passed to `serve_vllm.sh`): `CACTUS_DELTA=0 WATCHDOG_MIB=32`.

## Fixtures (auto-built)
`run.sh` **auto-builds any missing prompt fixture** into `bench/workloads/tmp/` from its
canonical recipe (`build_prompt.py`) as a pre-flight step, before loading any model — no manual
step. Known patterns: `codereview-<N>.txt`, `thinking-hard.txt`, `agentic-<N>[-v<k>].txt`. An
unrecognized filename fails loudly with a pointer to `bench/workloads/README.md` (add its recipe
to `ensure_fixtures` in `gen_campaign.py` to support a new pattern).

## Run
```bash
bash campaigns/perf/2026-10-30-2240-vllm-redhat-sly191-d0-mtp-depth/run.sh
# resume after interruption: same command (tmp/done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash campaigns/perf/2026-10-30-2240-vllm-redhat-sly191-d0-mtp-depth/run.sh
# tighten the guard:      VRAM_BUDGET_MIB=31000 bash campaigns/perf/2026-10-30-2240-vllm-redhat-sly191-d0-mtp-depth/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each probe's raw dir (`tmp/<stamp>-engine-<probe>/gpu_samples.csv`).

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
| redhat-sly191-d0-mtp-fp8kv-ctx262000 | 262000 | 1 | fp8 | 0 | `redhat-sly191-d0-mtp-cr10000` | 1 | codereview-10000.txt |
| redhat-sly191-d0-mtp-fp8kv-ctx262000 | 262000 | 1 | fp8 | 0 | `redhat-sly191-d0-mtp-cr50000` | 1 | codereview-50000.txt |
| redhat-sly191-d0-mtp-fp8kv-ctx262000 | 262000 | 1 | fp8 | 0 | `redhat-sly191-d0-mtp-cr100000` | 1 | codereview-100000.txt |
| redhat-sly191-d0-mtp-fp8kv-ctx262000 | 262000 | 1 | fp8 | 0 | `redhat-sly191-d0-mtp-cr150000` | 1 | codereview-150000.txt |

## Write-up
`run.sh`'s last step renders the charts into `results/charts/` + `results/appendix.md`
(`bench/core/report.py`).

**Written up together with the DFlash2 campaign:** `docs/findings/vllm/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth.md` (one analysis for both δ 0 campaigns).
