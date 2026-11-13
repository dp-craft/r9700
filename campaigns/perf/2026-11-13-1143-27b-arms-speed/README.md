# Qwen3.8-27B arms: speed vs depth, n=2 and a growing conversation (minimal tier) (R9700, 2026-11-13-1143)

Scaffolded by `bench/core/gen_campaign.py` (multi-engine throughput, G1). The executable driver is
**`run.sh`** in this folder: resumable (per-cell markers in `tmp/done/`), one engine at a time, in the
server order below.

## Goal
Which Qwen3.8-27B arm is fastest **where agents actually work** (deep context, two agents per card, a growing
conversation), measured as curves, not single points (rule 16), so speed can be set against each arm's quality.
Every arm is the **same config as its KLD arm** ([`docs/findings/quality/2026-11-09-1825-27b-arms-kld.md`](../../../docs/findings/quality/2026-11-09-1825-27b-arms-kld.md)),
with ctx/np set to production 260000 / 2 (plan D1).

## Decisions (approved plan, private: `notes/plans/2026-11-12-1200-27b-arms-speed-campaign-plan.md`, v2, 2026-11-12; Q1–Q13 as recommended)
- **Minimal tier first** (10 arms, one boot each, pass A). Full tier (dfh, e, q4kxl-f16 sidecar, 7 depths, pass B,
  n=2 at 3 depths, content sidecar) only on a later GO.
- **Cold depth ladder** 8k · 32k · 100k · 200k (q8: 8k · 16k · 32k · 60k), reps 3; spec arms reps 5 at 32k/100k/200k.
  Report: power-law exponent + R² per arm; beyond 200k only INFERRED with the fit range.
- **n=2 at 32k** (every np-2 arm; 100k n=2 moves to the full tier, Q10). **Growing conversation** 10k → ~205k
  (step 20k, prior turns cached, rule 17): per-turn TTFT, new-token prefill, decode; verdict "prefix reuse yes/partial/no".
- **Chat API, production template, thinking on, explicit identical sampling** (temp 1.0, top_p 0.95, top_k 20,
  min_p 0, presence/frequency 0, repetition 1.0 under each engine's key; user 2026-11-13), 1024 tokens, gate ≥ 900.
- **llama.cpp:** q8_0 KV + `--kv-unified` at 260000/2 (equal window to the fp8 arms), dp-sharp via
  `--jinja --chat-template-file` (Q4: kept only if the smoke shows it renders). **q8** is a reference at
  65536 / q8_0 / 1 (Q3: predicted ≈ 29.1 GiB, INFERRED from the MEASURED KLD boot, f16 @32768 = 29790 MiB at ready).
- **Drift control:** engine families interleaved in the server order; one 32k sentinel per boot (|Δ| > 5 % → `DRIFT`).
- **Pins** (`spec.json`): sha256 of the three GGUFs, the llama-server build and both `.rad` files (hashed 2026-11-13;
  Q8_0 matches the KLD campaign's a680f44a…e348), image digests, single-revision globs; prompt fixtures in
  `inputs/fixtures.sha256`. Preflight refuses on drift.

## Known risks before the run
- **q6k at 260000/2** sat at 31008 MiB at ready with an 833 MiB GTT boot peak in KLD round 3 (MEASURED,
  `campaigns/perf/2026-11-09-1825-27b-arms-kld/results/forced-r3-20261113-090142/boots.jsonl`). Its free-VRAM floor
  (31300 MiB) needs an idle desktop; watch its boot GTT.
- **Radiance has no VRAM watchdog; d's boot peak was ~70 MiB under physical** (MEASURED, KLD run). Run from a plain
  terminal, no local-model session on :8000, desktop idle.
- **Radiance repetition-penalty key is unverified**: no penalty is sent to radiance until the smoke settles it.
- The conversation can take ~4× longer on an engine without prefix reuse (plan §6, INFERRED).

## Runtime (INFERRED, plan §6)
Smoke ≈ 1 h (`ONLY='*-smoke-*'`). Minimal ≈ 7–8 h (one night). Re-collect contingency ≈ 10 %.

## How to run
1. Free the GPU and port 8000 (stop the local vLLM: `~/.config/claude/local_vllm_direct/vllm.sh stop`).
2. **Smoke first** (needs the owner's GO): `ONLY='*-smoke-*' bash run.sh`. It must show: the identity gate,
   `usage.completion_tokens` per engine, the spec counters (vLLM `/metrics`, radiance `/stats`, llama.cpp `draft_n`),
   llama.cpp `/slots` n_ctx with `--kv-unified`, the dp-sharp render on llama.cpp, `cached_tokens` per engine,
   radiance accepting the explicit sampling, and the Memory-Fault watcher + stop/port-free. Fix `spec.json` and
   re-emit; never edit `run.sh`.
3. **Minimal run:** `bash run.sh` (resumable; `ONLY=`, `REPS=`, `RETRY_INCOMPLETE=1 ONLY=<slug>`).
4. Write-up: `/benchmark-results` → `docs/findings/perf/2026-11-13-1143-27b-arms-speed.md`, then `docs/reindex.py`.

## Out of scope
Sly MTP, llama.cpp ROCm, the FP8 KLD reference as a speed arm, Cactus δ 0.5, hipfire, the two-agent interleave
probe (G2g, deferred), and everything in the full tier.

## Servers (run order)
| server | engine | arm | pass | weights · runtime | served | ctx/np/kv | spec | floor/ws MiB | cells |
|---|---|---|---|---|---|---|---|---|---|
| q4kxl | llamacpp | q4kxl | A | `Qwen3.8-27B-UD-Q4_K_XL.gguf` · build `/home/dev/work/dp-craft/amd/stack/llamacpp/var/builds/b11448-vulkan-1.4.363.0/bin/llama-server` | `qwen38-27b-ud-q4kxl` | 260000/2/q8_0 | off | 27300/16745 | 9 |
| b | radiance | b | A | `qwen3.8-27b-mxfp4.rad` · `stilldeadcode/radiance:1.17.0` · k=7 | `qwen38-27b-mxfp4` | 260000/2/fp8 | on | 30000/18479 | 9 |
| d | vllm | d | A | profile `sly-redhat/redhat-mxfp4-dflash` · `ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1` | `qwen38-27b-redhat-mxfp4-dflash` | 260000/2/fp8 | on | 30000/15186 | 9 |
| q6k | llamacpp | q6k | A | `Qwen3.8-27B-UD-Q6_K.gguf` · build `/home/dev/work/dp-craft/amd/stack/llamacpp/var/builds/b11448-vulkan-1.4.363.0/bin/llama-server` | `qwen38-27b-ud-q6k` | 260000/2/q8_0 | off | 31300/20965 | 9 |
| c | radiance | c | A | `qwen3.8-27b-iq4r-l-v4.rad` · `stilldeadcode/radiance:1.17.0` · k=7 | `qwen38-27b-iq4r-l-v4` | 260000/2/fp8 | on | 30000/17834 | 9 |
| d0 | vllm | d0 | A | profile `sly-redhat/redhat-mxfp4` · `ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1` | `qwen38-27b-redhat-mxfp4-sly` | 260000/2/fp8 | off | 30000/13957 | 9 |
| q4mtp | llamacpp | q4mtp | A | `Qwen3.8-27B-UD-Q4_K_XL.gguf` · build `/home/dev/work/dp-craft/amd/stack/llamacpp/var/builds/b11448-vulkan-1.4.363.0/bin/llama-server` | `qwen38-27b-ud-q4kxl-mtp` | 260000/2/q8_0 | on | 27800/16745 | 9 |
| a | radiance | a | A | `qwen3.8-27b-mxfp4.rad` · `stilldeadcode/radiance:1.11.0` · k=7 | `qwen38-27b-mxfp4` | 260000/2/fp8 | on | 30000/18479 | 9 |
| c0 | radiance | c0 | A | `qwen3.8-27b-iq4r-l-v4.rad` · `stilldeadcode/radiance:1.17.0` · k=0 | `qwen38-27b-iq4r-l-v4` | 260000/2/fp8 | off | 30000/17834 | 9 |
| q8 | llamacpp | q8 | A | `Qwen3.8-27B-Q8_0.gguf` · build `/home/dev/work/dp-craft/amd/stack/llamacpp/var/builds/b11448-vulkan-1.4.363.0/bin/llama-server` | `qwen38-27b-q8` | 65536/1/q8_0 | off | 30600/27701 | 8 |

Sampling (every request, explicit): `{"temperature":1.0,"top_p":0.95,"top_k":20,"min_p":0,"presence_penalty":0,"frequency_penalty":0,"seed":1234}` plus
`repetition_penalty 1.0` under each server's own key (llama.cpp `repeat_penalty`,
vLLM `repetition_penalty`, radiance: only if the server sets `rep_penalty_key`). API `chat`,
max_tokens 1024, prefix `unique`, first-probe warm-up 2.
Every row carries `--tag arm,depth,n,tg,workload,pass,tier,cell,rep_key,residency` (conversation rows: no depth).

> ⚠️ **Radiance (b, c, a, c0): penalty UNVERIFIED until the smoke confirms radiance's key: no repetition penalty is sent, so the engine's own default applies.** Its rows carry `rep_key=UNVERIFIED`; do not compare a repetition-sensitive number against the other engines until the smoke settles it.

**Min-gen gate:** a probe cell needs every request to generate >= 900 tokens; conversation turns are not gated (`conversation.min_gen` unset = 0).
A short cell writes no rows and no done marker: run.sh stops it as **INCOMPLETE** with its `n_short` in
`results/failures.txt` and does not retry it (the seeds are deterministic, a rerun repeats the same short replies);
`RETRY_INCOMPLETE=1 ONLY='<slug>'` reruns it deliberately.

## Cells (first server shown; every server gets the same shape, depth/np permitting)
- `q4kxl-smoke-d8000` (smoke, n=1, reps 1, codereview-8000.txt)
- `q4kxl-smoke-conv` (smoke, n=1, reps 1, conversation to 10000)
- `q4kxl-d8000-n1` (ladder, n=1, reps 3, codereview-8000.txt)
- `q4kxl-d32000-n1` (ladder, n=1, reps 3, codereview-32000.txt)
- `q4kxl-d32000-n2` (conc, n=2, reps 3, codereview-32000.txt)
- `q4kxl-d100000-n1` (ladder, n=1, reps 3, codereview-100000.txt)
- `q4kxl-d200000-n1` (ladder, n=1, reps 3, codereview-200000.txt)
- `q4kxl-sentinel-d32000` (sentinel, n=1, reps 1, codereview-32000.txt)
- `q4kxl-conv` (conv, n=1, reps 1, conversation to 205000)

## Run
```bash
bash campaigns/perf/2026-11-13-1143-27b-arms-speed/run.sh                                     # resume: same command
RUN_TAG=smoke-1 ONLY='*-smoke-*' bash campaigns/perf/2026-11-13-1143-27b-arms-speed/run.sh    # smoke (opt-in cells), isolated in tmp/runs/smoke-1/
ONLY='q4kxl-*' REPS=1 bash campaigns/perf/2026-11-13-1143-27b-arms-speed/run.sh               # one server, quick pass
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
**benchmark-results** skill → `docs/findings/<topic>/2026-11-13-1143-27b-arms-speed.md` with `campaign: campaigns/perf/2026-11-13-1143-27b-arms-speed` in its meta block.
