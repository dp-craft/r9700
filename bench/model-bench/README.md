# model-bench — tuning microscope (`llama-bench`)

**One engine (llama.cpp), sweep knobs, measure prefill(pp)/decode(tg) tok/s with stddev.**
Two entry points:

| Script | What | When |
|--------|------|------|
| `run.sh` | one llama-bench invocation, fixed/comma-list knobs | quick check, manual grid |
| `sweep.py` | **adaptive optimum search** — expands the grid until the peak is bracketed | "find THE optimum" campaigns |

## sweep.py — adaptive optimum search

```bash
./sweep.py --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf --slug 35b-rocm
./sweep.py --model ... --llama-bench ../llamacpp-vulkan/llama-bench --slug 35b-vulkan
```
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
- every invocation's raw JSON + per-invocation GPU samples land in
  `bench/runs/<stamp>-sweep-<slug>/invocations/`, every point in `sweep-log.jsonl`, decisions in
  `sweep-summary.json` (including a copy-pasteable recommended `llama-server` line).

`--dry-run` prints the planned invocations. `--metric pp|tg` picks the peak-search metric
(default `pp` — `ub`/`b` mostly move prefill; both metrics are always recorded).

## run.sh knobs (env overrides)

| Env | Default | Meaning |
|-----|---------|---------|
| `MODEL` | *(required)* | GGUF path |
| `LLAMA_BENCH` | `bench/llamacpp/llama-bench` | Vulkan: `bench/llamacpp-vulkan/llama-bench`; NVIDIA: any CUDA build |
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

Output → `bench/runs/<stamp>-model-<slug>/` (`llama-bench.json` + `meta.txt` incl. `build_commit`;
with `NPL`: `batched-bench.json` + `batched-bench.log`, version line in `meta.txt`).
Vendor handling via `bench/lib/gpu_env.sh` (AMD: HSA override auto; NVIDIA: nvidia-smi meta).

## What this track CAN'T do (use engine-bench instead)
- No **real prompts** (synthetic tokens): no thinking mode, no chat template.
- No **cross-engine**, no **MTP/speculative** (server-only: `--spec-type draft-mtp`), no
  **concurrency** — llama-bench optima must be *validated at the serving operating point* with
  `engine-bench/campaign.sh`.
