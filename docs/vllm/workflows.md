# vLLM track — workflows (procedures)

Task-based procedures. The "add a model to llama-swap" and "run Claude via llama-swap" procedures are
**Plan B** (`docs/plans/2026-10-25-vllm-llama-swap-path.md`) — not this track.

## Boot a server

```bash
./fetch_model.sh <org/repo> <40-hex-rev>                       # pinned, resumable download
PROFILE=<engine>/<model> PORT=8000 bench/engine-bench/vllm/serve_vllm.sh   # boot (gpu_exclusive.sh floor first)
PROFILE=<engine>/<model> ./serve_vllm.sh print                # show the full resolved config (no GPU)
IMAGE=ghcr.io/slybase/vllm-sly-radiance:<new-tag> PROFILE=... ./serve_vllm.sh   # try a new image
PORT=8000 ./serve_vllm.sh stop|status|logs
```

- Every boot writes `bench/.servers/<port>.cmdline`: argv, image digest, model repo+revision, vLLM version.
- While booting, a **VRAM watchdog** polls sysfs every 0.2 s and `docker kill`s the container if free
  VRAM drops below `WATCHDOG_MIB` (default 256; the desktop shares the card).
- `print` is the read-only preview: it shows the same resolved config `start` records (env + docker
  argv + image digest + model repo@rev + drafter + config override) with no GPU.

Native Radiance has its own launcher, because `serve_vllm.sh` builds vLLM arguments:

```bash
bench/engine-bench/vllm/fetch_model.sh keptn/ornith-1.5-35b-a3b-w4a8 cfed0f8f07d0ef8d0c7dcf4d29a07eeb6a402472
./ornith_rad_mtp.sh start    # port 8000
./ornith_rad_mtp.sh stop|status|logs
```

It runs the `gpu_exclusive.sh` floor first but has no VRAM watchdog and writes no `.cmdline`. It leaves about 232 MiB free,
which crashed the desktop once, so close Chrome if VRAM gets tight. `EXTRA_ARGS="--gpu-headroom-mib 2048"` is recommended
only, and unmeasured (see `known-issues.md`).

35B starters on port 8000, one at a time. `ornith_rad_mtp.sh` is the fastest. Its Claude config, and `ornith_sly_dflash.sh`'s, is
`claude --settings ~/.config/claude/local_vllm_direct/settings-redhat.json`; both serve under that file's model name.
`qwen35_sly_dflash.sh` uses `settings-35b.json`.

```bash
./ornith_sly_dflash.sh start|stop|status|logs   # Ornith 1.5 MXFP4 + DFlash K=3 on Sly
./qwen35_sly_dflash.sh start|stop|status|logs   # Qwen3.5-35B MXFP4 + DFlash K=7, triton_unfused, on Sly
```

## Observe a running server (no GPU, read-only)

```bash
python3 bench/lib/monitor.py --port 8000                 # live view (zero-install: Python + rocm-smi)
python3 bench/lib/monitor.py --port 8000 --out session.jsonl   # live, records the session
python3 bench/lib/monitor.py --port 8000 --once         # single snapshot
python3 bench/lib/monitor.py --port 8000 --history 50   # show 50 history rows
./bench/engine-bench/claude/monitor.sh --once           # thin wrapper, records to bench/.servers/<port>.session.jsonl
```

- `monitor.py` polls `/metrics` + rocm-smi + the log every 2 s; blocks = polls (requests) / avg (last
  5 min) / session (cumulative) / cache/queue/spec / GPU (VRAM/GTT/power/temp/clocks/busy) / log.
  Anomalies are highlighted red (KV > 90 %, power > 200 W). It is the "observe" half of the bench
  3-task model (probe / monitor / report).
- **Quick one-liner** (prefix-cache hit rate + KV + spec acceptance):
  ```bash
  watch -n 2 'curl -s http://127.0.0.1:8000/metrics \
    | grep -E "prefix_cache_(hits|queries)_total|kv_cache_usage_perc|num_requests_running|spec_decode_num_(accepted|draft)_tokens" \
    | grep -v "^#"'
  ```
- **Log:** `tail -f bench/.servers/8000.log` (like llama-swap `status`).

## Run a campaign

```bash
PROFILE=<engine>/<model> PORT=8000 bench/engine-bench/vllm/serve_vllm.sh   # boot
python3 bench/lib/capture_engine.py probe ...        # throughput/concurrency + ttft
python3 bench/lib/capture_engine.py tasks ...        # quality capture
python3 bench/lib/report.py <run_dir> --charts ... --appendix ...          # charts + appendix.md
```

- Fixtures: `bench/workloads/build_prompt.py` (or the `codereview-*.txt` fixtures).
- Resumable via `done/` markers (row-level in `capture.py`).
- The exact argv + digest + revision for every boot is in `bench/.servers/<port>.cmdline` (attributable).

## Debug a fault

- **Check the fault:** `grep -n MEMORY_FAULT bench/.servers/8000.log` (saved on stop) or `docker logs vllm-8000`.
- **Check residency** (iron rule 15): `amd-smi process -g 0` — a daemon holding far less than its known
  working set is a contention signal (the on-demand-paging engine degrades silently, no OOM, no log line).
- **After a fix**, check the upstream log does **not** contain `[radiance.mxfp4] A-tiled GEMM path`
  (when the A-tiled path is the suspect).
- **Orphan check** (iron rule 14): `PORT=8000 bench/engine-bench/vllm/serve_vllm.sh stop`, verify
  `amd-smi metric -g 0 -m` FREE_VRAM ≈ 32 GB, then rerun.
- **Process matching:** use `pgrep -af` with a **split pattern** — `pkill -f` / `pgrep -f` can match
  their own command line.
- **Diagnostics** (settings.md): `RADIANCE_MXFP4_PTRLOG=1`, `RADIANCE_MXFP4_PAD_A`,
  `RADIANCE_MXFP4_SPLIT_M=192`, `RADIANCE_MXFP4_PAD_OUT_ROWS`; `overlays/sly-pad-a` (zeroed 256-row
  tail on A + x_scale before every W4A8 prefill GEMM).
- **Fault history:** `known-issues.md` (the GEMM fault, NVFP4 load-peak); `historical.md` (the kernarg fix).

## Plan B (not this track)

- **Add a model to llama-swap** → `docs/plans/2026-10-25-vllm-llama-swap-path.md` (the `generate.py`
  vllm rows + the add-model skill; needs GPU testing, riskier).
- **Run Claude via llama-swap** → `docs/plans/2026-10-25-vllm-llama-swap-path.md` (the
  `claude-llama-swap.sh` launcher).

## Roadmap (migrated from the tool README "Plan" — agreed, not now)

- **A2 NVFP4 retry** only with the card free of the desktop (TTY/SSH, GUI stopped) or after a
  load-peak fix (`RADIANCE_NVFP4_LMHEAD=fp8`). Same kernels as A (CLAIMED 133.4 vs A's ~150 tok/s
  with drafter), so a second-source check only.
- **B — `Qwen/Qwen3.8-27B-FP8@017b9c7a`** (quality reference; ~25 GiB weights on 1 card, may not boot).
  Profile `sly-radiance/qwen38-fp8` is ready.
- **C — `RedHatAI/Qwen3.8-27B-INT4`** (W4A16, already at `/home/dev/models/vllm/Qwen3.8-27B-INT4`):
  no-fp8 control and old-image (0.9.3) comparison; Sly serves it with `--quantization compressed-tensors`.
- **ParoQuant `z-lab/Qwen3.8-27B-PARO`** (W4A8): kernel not in the image → a derived image
  (`FROM ghcr.io/slybase/vllm-sly-radiance:<tag>` + `setup-paroquant.sh`), still docker-only.
- **`/vllm-image` skill** (pull tag → smoke → bench vs previous → promote), like `/llamacpp-build`.
- **Unsloth Studio** (standing goal): get at least one working vLLM solution running in Unsloth Studio —
  check for a custom OpenAI-compatible endpoint → point it at `127.0.0.1:8000/v1`.
