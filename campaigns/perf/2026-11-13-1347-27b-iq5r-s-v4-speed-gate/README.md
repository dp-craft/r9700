# Qwen3.8-27B IQ5R-S-V4 on radiance 1.17.0: 100k speed gate, paired to c-100k-tg512-n1 (R9700, 2026-11-13-1347)

Scaffolded by `bench/core/gen_campaign.py` (multi-engine throughput, G1). The executable driver is
**`run.sh`** in this folder: resumable (per-cell markers in `tmp/done/`), one engine at a time, in the
server order below. Fill in the prose (goal, decisions, out of scope).

## Servers (run order)
| server | engine | arm | pass | weights · runtime | served | ctx/np/kv | spec | floor/ws MiB | cells |
|---|---|---|---|---|---|---|---|---|---|
| iq5rs | radiance | iq5rs | A | `qwen3.8-27b-iq5r-s-v4.rad` · `stilldeadcode/radiance:1.17.0` · k=7 | `qwen38-27b-iq5r-s-v4` | 260000/2/fp8 | on | 30000/18728 | 6 |

Sampling (every request, explicit): `{"temperature":0.2}` plus
`repetition_penalty 1.0` under each server's own key (llama.cpp `repeat_penalty`,
vLLM `repetition_penalty`, radiance: only if the server sets `rep_penalty_key`). API `completions`,
max_tokens 512, prefix `unique`, first-probe warm-up 0.
Every row carries `--tag arm,depth,n,tg,workload,pass,tier,cell,rep_key,residency` (conversation rows: no depth).

> ⚠️ **Radiance (iq5rs): penalty UNVERIFIED until the smoke confirms radiance's key: no repetition penalty is sent, so the engine's own default applies.** Its rows carry `rep_key=UNVERIFIED`; do not compare a repetition-sensitive number against the other engines until the smoke settles it.

**Min-gen gate:** a probe cell needs every request to generate >= 0 tokens; there is no conversation cell.
A short cell writes no rows and no done marker: run.sh stops it as **INCOMPLETE** with its `n_short` in
`results/failures.txt` and does not retry it (the seeds are deterministic, a rerun repeats the same short replies);
`RETRY_INCOMPLETE=1 ONLY='<slug>'` reruns it deliberately.

## Cells (first server shown; every server gets the same shape, depth/np permitting)
- `iq5rs-d8000-n1` (ladder, n=1, reps 1, codereview-8000.txt)
- `iq5rs-d32000-n1` (ladder, n=1, reps 1, codereview-32000.txt)
- `iq5rs-d64000-n1` (ladder, n=1, reps 1, codereview-64000.txt)
- `iq5rs-d80000-n1` (ladder, n=1, reps 1, codereview-80000.txt)
- `iq5rs-d100000-n1` (ladder, n=1, reps 1, codereview-100000.txt)
- `iq5rs-d200000-n1` (ladder, n=1, reps 1, codereview-200000.txt)

## Run
```bash
bash campaigns/perf/2026-11-13-1347-27b-iq5r-s-v4-speed-gate/run.sh                                     # resume: same command
RUN_TAG=smoke-1 ONLY='*-smoke-*' bash campaigns/perf/2026-11-13-1347-27b-iq5r-s-v4-speed-gate/run.sh    # smoke (opt-in cells), isolated in tmp/runs/smoke-1/
ONLY='q4kxl-*' REPS=1 bash campaigns/perf/2026-11-13-1347-27b-iq5r-s-v4-speed-gate/run.sh               # one server, quick pass
```
**Requires** `bench/perf/engine-bench/run.sh --capabilities` to list `SAMPLING`, `MIN_GEN`, `TAGS`, `SPEC_ROWS`, `STATUS_OUT` (preflight refuses otherwise).
Fixtures pin (`pins.fixtures_sha256`, optional): `sha256sum` output for bare file names, checked from bench/workloads/tmp/: build it with `(cd bench/workloads/tmp && sha256sum codereview-8000.txt ...) > inputs/fixtures.sha256`.

## Per server, run.sh does
power snapshot → `gpu_exclusive.sh <floor>` → boot gate (port free AND free VRAM ≥ floor) → VRAM sampler
across the boot → `serve_<engine>.sh` print + start → `boot_diag.py record` (`results/boots.jsonl`) →
identity gate (`/v1/models` = served name; state-dir cmdline names the pinned image/build + model) →
residency vs the expected working set (stamped on every row as `residency=ok|low|unknown`) → cells under a
Memory-Fault watcher (a fault aborts the run and moves the cell's rows to `results/quarantine.jsonl`) → stop by
pidfile/container + port-free + VRAM-idle verify → power snapshot; then the drift check (sentinel vs ladder).
Cell order per boot: smoke (opt-in) → ladder ascending (n=N right after its depth) → sentinel → conversation.

## Layout
- `results/` (committed): `results.jsonl`, `boots.jsonl`, `drift.jsonl`, `residency.jsonl`, `quarantine.jsonl`, `meta.txt`, `failures.txt`,
  `server-<slug>.txt`, `models-<slug>.json`, `residency-<slug>.txt`, `power-<slug>.txt`, `charts/`, `appendix.md`.
- `tmp/` (git-ignored raw): `done/` markers, per-probe `<stamp>-engine-<cell>/` dirs, boot logs/CSVs, stop records.

## Write-up
**benchmark-results** skill → `docs/findings/<topic>/2026-11-13-1347-27b-iq5r-s-v4-speed-gate.md` with `campaign: campaigns/perf/2026-11-13-1347-27b-iq5r-s-v4-speed-gate` in its meta block.
