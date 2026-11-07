# model-bench — tuning microscope (`llama-bench`)

**One engine (llama.cpp), sweep knobs, measure prefill(pp)/decode(tg) tok/s with stddev.**
Two entry points:

| Script | What | When |
|--------|------|------|
| `run.sh` | one llama-bench invocation, fixed/comma-list knobs | quick check, manual grid |
| `sweep.py` | **adaptive optimum search** — expands the grid until the peak is bracketed | "find THE optimum" campaigns |

## sweep.py — adaptive optimum search

```bash
./sweep.py --campaign-dir campaigns/perf/<stamp>-<slug> --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf --slug 35b-rocm
./sweep.py --campaign-dir … --model ... --llama-bench stack/llamacpp/var/builds/latest-vulkan/bin/llama-bench --slug 35b-vulkan
```
`--campaign-dir` (or env `CAMPAIGN_DIR`) is required; without it the script refuses with a usage line.
Coordinate descent `ub → batch → fa`, then a **KV A/B stage** (f16 vs q8_0 at `--kv-depth`,
default 32768). Guarantees:
- a numeric axis keeps **expanding ×2/÷2 while the best value sits on the grid boundary** — the
  shipped optimum always has a measured, slower neighbor on both sides (or a documented hard
  cap / OOM boundary);
- differences within `--noise-pct` (default 3%, our historical run-to-run variance) are flagged
  `plateau_within_noise` instead of being oversold;
- **KV rule**: q8_0 is accepted only if prefill AND decode lose ≤ `--kv-max-loss-pct` (default 5%)
  at the target depth; measured VRAM saving is reported either way. If f16 OOMs at depth where
  q8_0 fits, that's recorded as "q8_0 REQUIRED to fit";
- every invocation's raw JSON + stderr + per-invocation GPU samples land in
  `$CAMPAIGN_DIR/tmp/<stamp>-sweep-<slug>/invocations/` (git-ignored); every point in
  `$CAMPAIGN_DIR/results/<stamp>-sweep-<slug>/sweep-log.jsonl`, decisions in `sweep-summary.json`
  (including a copy-pasteable recommended `llama-server` line) and `meta.txt` next to it.

`--dry-run` prints the planned invocations. `--metric pp|tg` picks the peak-search metric
(default `pp` — `ub`/`b` mostly move prefill; both metrics are always recorded).

## run.sh knobs (env overrides)

| Env | Default | Meaning |
|-----|---------|---------|
| `CAMPAIGN_DIR` | *(required)* | campaign dir `campaigns/<type>/<stamp>-<slug>`; refuses with a usage line when unset |
| `MODEL` | *(required)* | GGUF path |
| `LLAMA_BENCH` | `stack/llamacpp/var/builds/latest-rocm/bin/llama-bench` | Vulkan: `stack/llamacpp/var/builds/latest-vulkan/bin/llama-bench`; NVIDIA: any CUDA build |
| `PP` / `TG` | `512,2048,8192` / `128` | prefill sizes / decode tokens (comma = swept) |
| `DEPTH` | `0` | context depth `-d` — measure pp/tg AT 32768/65536, not just empty |
| `UB` / `BATCH` | `512,1024,2048` / `2048` | micro-batch / logical batch |
| `CTK`/`CTV` | **`f16`** | KV types. f16 is the baseline; q8_0 must pass the sweep's A/B rule |
| `FA` | `on` | flash attention (`on|off|auto`) |
| `REPS` | `3` | repetitions → stddev |
| `PG` | *(empty)* | request shapes `"P,G P,G"` → one `-pg` test each (prompt + generation, timed together) |
| `WARMUP` | `1` | `0` = `--no-warmup` (llama-bench's warmup re-runs every test's prompt in full) |
| `NPL` | *(empty)* | N concurrent sequences → `llama-batched-bench -npl N` from the same `bin/`; single `PP`/`TG`, ctx = N×(PP+TG); `DEPTH`/`REPS`/`PG` unused |
| `VRAM_SAMPLE` | `1` | sample VRAM/power to `gpu_samples.csv` during the run |

Output → results in `$CAMPAIGN_DIR/results/<stamp>-model-<slug>/` (`llama-bench.json` + `meta.txt` incl.
`build_commit`; with `NPL`: `batched-bench.json`, version line in `meta.txt`), raw in
`$CAMPAIGN_DIR/tmp/<stamp>-model-<slug>/` (`llama-bench.err`, `batched-bench.log`, `gpu_samples.csv`).
The last two stdout lines are `→ raw: <dir>` and `→ results: <dir>`. `bench/core/report.py $CAMPAIGN_DIR`
keeps the measured peak VRAM/GTT of every `gpu_samples.csv` in `results/gpu_peaks.json`.
Vendor handling via `stack/gpu/gpu_env.sh` (AMD: HSA override auto; NVIDIA: nvidia-smi meta).

## What this track CAN'T do (use engine-bench instead)
- No **real prompts** (synthetic tokens): no thinking mode, no chat template.
- No **cross-engine**, no **MTP/speculative** (server-only: `--spec-type draft-mtp`), no
  **concurrency** — llama-bench optima must be *validated at the serving operating point* with
  `engine-bench/campaign.sh`.
