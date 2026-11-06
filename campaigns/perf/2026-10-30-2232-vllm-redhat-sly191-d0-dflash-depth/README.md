# Sly 1.9.1 · RedHatAI Qwen3.8-27B-MXFP4 · DFlash2 k=7 · CACTUS_DELTA=0 (stock sampling) · fp8 KV · ctx 262000 · depth 10k/50k/100k/150k (R9700, 2026-10-30)

Scaffolded by `bench/core/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `done/`, rerun to continue). Fill in the prose below.

## Fixed parameters
- Model `RedHatAI__Qwen3.8-27B-MXFP4@16a86728` · engine **vLLM (docker)** · profile `sly-redhat/redhat-mxfp4-dflash` (`stack/serve/vllm/profiles/`) · served as `qwen38-27b-redhat-mxfp4-dflash` · server on :8000 · image `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (resolved per server in `server-<name>.txt` of the run dir).
- Env (all servers, passed to `serve_vllm.sh`): `CACTUS_DELTA=0`.

## Fixtures (auto-built)
`run.sh` **auto-builds any missing prompt fixture** into `bench/workloads/tmp/` from its
canonical recipe (`build_prompt.py`) as a pre-flight step, before loading any model — no manual
step. Known patterns: `codereview-<N>.txt`, `thinking-hard.txt`, `agentic-<N>[-v<k>].txt`. An
unrecognized filename fails loudly with a pointer to `bench/workloads/README.md` (add its recipe
to `ensure_fixtures` in `gen_campaign.py` to support a new pattern).

## Run
```bash
bash campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/run.sh
# resume after interruption: same command (done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/run.sh
# tighten the guard:      VRAM_BUDGET_MIB=31000 bash campaigns/perf/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each run dir's `gpu_samples.csv`.

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
| redhat-sly191-d0-dflash-fp8kv-ctx262000 | 262000 | 1 | fp8 | 0 | `redhat-sly191-d0-dflash-cr10000` | 1 | codereview-10000.txt |
| redhat-sly191-d0-dflash-fp8kv-ctx262000 | 262000 | 1 | fp8 | 0 | `redhat-sly191-d0-dflash-cr50000` | 1 | codereview-50000.txt |
| redhat-sly191-d0-dflash-fp8kv-ctx262000 | 262000 | 1 | fp8 | 0 | `redhat-sly191-d0-dflash-cr100000` | 1 | codereview-100000.txt |
| redhat-sly191-d0-dflash-fp8kv-ctx262000 | 262000 | 1 | fp8 | 0 | `redhat-sly191-d0-dflash-cr150000` | 1 | codereview-150000.txt |

## Write-up
**benchmark-results** skill → co-located `docs/findings/vllm/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth.md` (summary + table
first, **memory column mandatory**). `run.sh`'s last step auto-generates theme-aware SVG charts in
`charts/` + an `appendix.md` (`bench/core/report.py`) — embed the appendix in `analysis.md`. Add a
`<!-- meta -->` block and run `docs/reindex.py`.
