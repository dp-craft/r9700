# Sly radiance 1.6.0 · Qwen3.8-27B MXFP4 · fp8 KV · DFlash2 k=7 — depth curve + growing conversation (R9700, 2026-10-22)

Scaffolded by `bench/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `done/`, rerun to continue). Fill in the prose below.

## Fixed parameters
- Model `amd__Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c` · engine **vLLM (docker)** · profile `sly-radiance/qwen38-mxfp4-dflash` (`bench/engine-bench/vllm/profiles/`) · served as `qwen38-27b-mxfp4-dflash` · server on :8000.

## Fixtures (auto-built)
`run.sh` **auto-builds any missing prompt fixture** into `bench/workloads/generated/` from its
canonical recipe (`build_prompt.py`) as a pre-flight step, before loading any model — no manual
step. Known patterns: `codereview-<N>.txt`, `thinking-hard.txt`, `agentic-<N>[-v<k>].txt`. An
unrecognized filename fails loudly with a pointer to `bench/workloads/README.md` (add its recipe
to `ensure_fixtures` in `gen_campaign.py` to support a new pattern).

## Run
```bash
bash campaigns/2026-10-22-vllm-sly-mxfp4-dflash/run.sh
# resume after interruption: same command (done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash campaigns/2026-10-22-vllm-sly-mxfp4-dflash/run.sh
# tighten the guard:      VRAM_BUDGET_MIB=31000 bash campaigns/2026-10-22-vllm-sly-mxfp4-dflash/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each run dir's `gpu_samples.csv`.

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
| mxfp4-dflash7-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `dx-cr8000` | 1 | codereview-8000.txt |
| mxfp4-dflash7-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `dx-cr20000` | 1 | codereview-20000.txt |
| mxfp4-dflash7-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `dx-cr40000` | 1 | codereview-40000.txt |
| mxfp4-dflash7-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `dx-cr140000` | 1 | codereview-140000.txt |
| mxfp4-dflash7-fp8kv-ctx150000 | 150000 | 1 | fp8 | 0 | `dx-conv` | 1 | codereview-150000.txt |

## Write-up
**benchmark-results** skill → co-located `campaigns/2026-10-22-vllm-sly-mxfp4-dflash/analysis.md` (summary + table
first, **memory column mandatory**). `run.sh`'s last step auto-generates theme-aware SVG charts in
`charts/` + an `appendix.md` (`bench/lib/report.py`) — embed the appendix in `analysis.md`. Add a
`<!-- meta -->` block and run `docs/reindex.py`.
