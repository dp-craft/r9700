# Campaign: Ornith-1.0-35B vs Gemma-4-31B-it-qat @ 128k (2026-07-19)

Two new models, one substrate, the **hardest-tasks TS-TDD harness** (copied from
`2026-07-14-hardest-tasks-27b-vs-35b` — same tasks, same real `tsc + eslint + vitest` grader with the
pre-grade self-check). Model facts + provenance:
`docs/research/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md`.

## Cells (`configs.jsonl`)

| label | model | arch | sampler | mtp | kv | ctx | depth | rb |
|---|---|---|---|--:|--|--:|--|--:|
| `ornith-d128-f16-rb4096` | Ornith-1.0-35B-UD-Q4_K_M | qwen35moe hybrid | temp 0.6 / top_p 0.95 / top_k 20 | 0 | f16 | 163840 | ~120k | 4096 |
| `gemma-d128-f16-rb4096` | gemma-4-31B-it-qat-UD-Q4_K_XL | gemma4 dense hybrid | temp 1.0 / top_p 0.95 / top_k 64 | 0 | f16 | 163840 | ~120k | 4096 |

Each model runs at **its own vendor-recommended sampler**, so this is "each model at its recommended
recipe", **not** a controlled sampler test. Substrate (previous, non-doc settings, per request):
Vulkan · f16 · `-ub 2048 -b 4096 -fa on` · ctx 163840 · reasoning-budget 4096.

## Decisions baked in

- **MTP OFF for both.** Ornith has **0 nextn/MTP tensors** (measured) and ships no drafter → MTP impossible.
  Gemma *can* do MTP but only via a separate **280 MB** `mtp-gemma-4-31B-it.gguf` that is **not downloaded**
  ("use the downloaded models"). To add Gemma-MTP later: download the drafter, then add a cell and set
  `EXTRA_ARGS="-md /home/dev/models/gguf/mtp-gemma-4-31B-it.gguf"` with `mtp:1`.
- **Models are symlinked** into `/home/dev/models/gguf/` (the harness `MODELS_DIR`) — they physically live in
  the HF cache; the symlinks just make them visible to the driver.
- **Deterministic by default** (`JUDGE_ENGINE=none SUMMARY=0`): capture → grade → charts → aggregate, no
  tmux/claude. Write `analysis.md` afterward via the **/benchmark-results** skill (or set `SUMMARY=1`).

## Caveats to verify AT RUN TIME

1. **Gemma VRAM is UNGUARDED** — `gguf_kv.py` can't size `gemma4` (per-layer KV-head array). The driver has
   no pre-flight guard anyway; a failure-to-fit is a legitimate result (iron rule 7). Watch `rocm-smi` / the
   `gpu_*.csv` sampler; weights ~16.1 GiB leaves headroom but the global-attention layers grow with ctx.
2. **Gemma think-split** — Gemma emits `<|channel>thought`, not `<think>…</think>`; `capture.py` splits on
   `<think>`, so Gemma's think/answer split + think_tokens may be wrong. Inspect one Gemma reply in
   `out/outputs.jsonl` before trusting those columns (the grader extracts code from the answer, so pass/fail
   may still be fine — but ttfa/think_tokens are suspect).
3. **Grader self-check** — the driver runs `score_typescript.py selftest` (tsc+eslint+vitest on fixtures) and
   ABORTS if vitest can't spawn. Free host memory if it fails.

## Run

```bash
cd /home/dev/work/dp-craft/amd
# deterministic (no claude/tmux): capture -> grade -> charts -> aggregate
bash campaigns/2026-07-19-ornith-vs-gemma/run_capture.sh
# quick single cell / smoke:
ONLY='ornith-*' REPS=1 bash campaigns/2026-07-19-ornith-vs-gemma/run_capture.sh
```

Resumable (row-level in `capture.py` + per-cell markers in `out/done/`). Outputs: `out/outputs.jsonl`,
`out/scores_typescript.jsonl`, `out/summary.md`, `charts/`. Stop a stuck server by pidfile
(`bench/.servers/8081.pid`) and verify VRAM idle before relaunch (iron rule 14).
