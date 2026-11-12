# Sly radiance 1.6.0 · Qwen3.8-27B MXFP4 · fp8 KV · DFlash2 k=7 — 170k window: fill 150k, then think until full (memory over time) (R9700, 2026-10-22)

Scaffolded by `bench/core/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `tmp/done/`, rerun to continue). Fill in the prose below.

## Goal & decisions

- **Question:** does memory stay flat while a 170k window fills to the edge, or does it creep (as
  llama.cpp+MTP does)? → a "safe maximum" setting. User reference: ≤ 30.8 GB total VRAM use is stable.
- **Shape:** turn 0 = 150k tokens of code (cold prefill); every later turn = the hard-thinking task
  only (`--turn-prompt`, `step_tokens 0`), 1024 max tokens, `reasoning_effort: high`, prior turns cached,
  until prompt + 1024 would pass 170000 (~15 turns per rep). 2 reps = 2 fills in one boot, so creep
  across conversations shows too.
- **Memory signals:** VRAM/GTT/power at 1 s for the whole probe (`gpu_samples.csv`) and per-turn
  `kv_usage_peak` (vLLM `kv_cache_usage_perc`, polled during the turn). On vLLM VRAM is reserved at boot
  (util 0.90), so KV-pool occupancy is the number that moves with context.
- **Tool changes for this campaign (approved 2026-10-22):** `capture_engine.py conversation --turn-prompt`
  + `kv_usage_peak`; `run.sh` `TURN_PROMPT`; `gen_campaign.py` probe key `turn_prompt`.
- **Caveats:** the desktop shares the card, so device VRAM includes the GUI; the same task repeats every
  turn (one prompt in `thinking-hard.prompt.txt`).
- **Estimate:** boot ~4–6 min (new MAXLEN may recompile) + per rep ~105 s cold 150k prefill + ~15 × ~15 s
  → ~20 min total.

## Fixed parameters
- Model `amd__Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c` · engine **vLLM (docker)** · profile `sly-radiance/qwen38-mxfp4-dflash` (`stack/serve/vllm/profiles/`) · served as `qwen38-27b-mxfp4-dflash` · server on :8000.

## Fixtures (auto-built)
`run.sh` **auto-builds any missing prompt fixture** into `bench/workloads/tmp/` from its
canonical recipe (`build_prompt.py`) as a pre-flight step, before loading any model — no manual
step. Known patterns: `codereview-<N>.txt`, `thinking-hard.txt`, `agentic-<N>[-v<k>].txt`. An
unrecognized filename fails loudly with a pointer to `bench/workloads/README.md` (add its recipe
to `ensure_fixtures` in `gen_campaign.py` to support a new pattern).

## Run
```bash
bash campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k/run.sh
# resume after interruption: same command (tmp/done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k/run.sh
# tighten the guard:      VRAM_BUDGET_MIB=31000 bash campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each probe's raw dir (`tmp/<stamp>-engine-<probe>/gpu_samples.csv`).

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
| mxfp4-dflash7-fp8kv-ctx170000 | 170000 | 1 | fp8 | 0 | `fill170k` | 1 | codereview-200000.txt |

## Write-up
**Write-up:** [`2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md`](../../../docs/findings/vllm/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md) (its `<!-- meta -->` block names this campaign). `run.sh`'s last step renders
the charts into `results/charts/` + `results/appendix.md` (`bench/core/report.py`).
