# vLLM docker track — Sly radiance first, any vLLM image later

Goal: a reproducible, docker-only vLLM setup for **Qwen3.8-27B on one R9700**, using RDNA4's fp8
WMMA through 4-bit **W4A8** checkpoints (4-bit weights, fp8 activations). Switching versions or
forks = a new image tag or a new `profiles/<engine>/` folder; nothing compiles on the host.

## Layout

| Where | What |
|---|---|
| `bench/engine-bench/vllm/` (repo) | `serve_vllm.sh` launcher, `fetch_model.sh`, `profiles/<engine>/{_engine,<model>}.env` |
| `/mnt/Lin1/work/vllm/sly-radiance/models/<org>__<repo>@<rev8>/` | pinned HF snapshots + `SOURCE.txt`, mounted read-only at `/model` |
| `/mnt/Lin1/work/vllm/sly-radiance/cache/<image>@<tag>/` | vllm/inductor/triton/aiter compile caches, **one set per image tag** |
| `/mnt/Lin1/work/vllm/sly-radiance/src/<tag>/` | upstream source checkout (templates, docs, reference scripts) |
| `/mnt/Lin1/work/vllm/sly-radiance/tools/hf-venv/` | `hf` CLI used by `fetch_model.sh` |
| `/mnt/Lin1/work/hf/` | shared `HF_HOME` (hub cache, xet chunks): `fetch_model.sh` on the host + mounted at `/hf` (`HF_HOME=/hf`) in every container. Default ACL `u:dev:rwX`, so root-written files stay dev-writable. **Not** set globally: `~/.cache/huggingface` keeps the GGUFs CLAUDE.md/llama-swap reference by path |
| `/mnt/Lin1/work/docker/` | docker data-root (**pending, needs root** — see below) |

## Models (pinned)

| Id | Repo @ revision | Format | FP8 hardware path | Profile |
|---|---|---|---|---|
| A | `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` @ `5233554c` | Quark MXFP4 | W4A8 fp8-WMMA (all linears) | `sly-radiance/qwen38-mxfp4` |
| A2 | `unsloth/Qwen3.8-27B-NVFP4` @ `f0b7c9e7` | NVFP4 → MXFP4 at load | same as A | `sly-radiance/qwen38-nvfp4` |

## Usage

```bash
./fetch_model.sh <org/repo> <40-hex-rev>                       # pinned, resumable download
PROFILE=sly-radiance/qwen38-mxfp4 ./serve_vllm.sh print        # show the docker argv (no GPU)
PROFILE=sly-radiance/qwen38-mxfp4 PORT=8000 ./serve_vllm.sh    # boot: gpu_exclusive.sh floor first
PORT=8000 ./serve_vllm.sh stop|status|logs
IMAGE=ghcr.io/slybase/vllm-sly-radiance:<new-tag> PROFILE=... ./serve_vllm.sh   # try a new image
```
Every boot writes `bench/.servers/<port>.cmdline`: argv, image digest, model repo+revision, vLLM version.
While booting, a **VRAM watchdog** polls sysfs every 0.2 s and `docker kill`s the container if free
VRAM drops below `WATCHDOG_MIB` (default 256; the desktop shares the card — see step 4, A2).

## Monitoring

A live server exposes three data sources (no extra setup): vLLM `/metrics` (Prometheus), `amd-smi`,
and the log (`bench/.servers/<port>.log`).

**Quick check (one-liner):**
```bash
watch -n 2 'curl -s http://127.0.0.1:8000/metrics \
  | grep -E "prefix_cache_(hits|queries)_total|kv_cache_usage_perc|num_requests_running|spec_decode_num_(accepted|drafted)_tokens" \
  | grep -v "^#"'
```
Prefix-cache hit rate = `hits / queries` — watch it go >0 after a prefix-caching boot.

**Live view (`bench/lib/monitor.py`):** zero-install (Python + rocm-smi). Polls `/metrics` + rocm-smi
every 2s and shows a live table — **per-call** input/output tokens, prefill TPS, decode TPS, TTFT
(diffed from the per-request histograms), a **min over the last 60 s**, KV usage %, prefix-cache hit
rate, spec acceptance, VRAM/power/temp, plus a log tail. `--out` records the session to JSONL for a
chart (`bench/lib/report.py`). It is the "observe" half of the bench 3-task model (probe / monitor / report).
```bash
python3 bench/lib/monitor.py --port 8000 --out session.jsonl   # live, records the session
python3 bench/lib/monitor.py --port 8000 --once               # single snapshot
```

**Log:** `tail -f bench/.servers/8000.log` (like llama-swap `status`).

## Plan

0. ✅ **Root, one-time:** fresh docker data-root at `/mnt/Lin1/work/docker` (old images not
   kept — the llama-swap vllm rows get re-pointed at the new image in step 6), and make docker wait
   for the mount (`RequiresMountsFor=/mnt/Lin1` — the fstab entry is `nofail`).
1. ✅ Layout, `hf` venv, pinned downloads A / A2, Sly source `v1.6.0` (`ead28fe6`).
2. ✅ Launcher + profiles; stress-tested in `print` and guard modes (no GPU).
3. ✅ `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` pulled to the Lin1 store — digest
   `sha256:bf153fa38868…7506`, 9.96 GB; inside: vLLM **0.31.0**, `RADIANCE_VERSION=1.6.0`, gfx1201,
   `/opt/qwen-fixed.jinja` present, runs as root. (Step 0 also needed containerd's `root` moved and
   two stale `TMPDIR` docker drop-ins removed.)
4. ✅/❌ Smoke boots 2026-10-22 (`bench/runs/2026-10-22-1252-vllm-sly-1.6.0-smoke/`, MEASURED):
   - **A MXFP4 ✅** cold boot 435 s (load 48.8 s / 13.7 GiB, compile 47 s, init 237 s); KV pool
     **438,806 tok** (13.7 GiB, 1.67× of 262,144) at util 0.90 + fp8 KV; peak VRAM **29,873 MiB**,
     GTT 98 MiB; chat OK (reasoning split + correct code, 172 tok).
   - **A2 NVFP4 ❌ (host-side)** the load-time NVFP4→MXFP4 requant + fp8→bf16 lm_head transient
     filled the card: peak **32,600 / 32,624 MiB + 2,956 MiB GTT** at 11:03:01Z, HIP allocator OOM
     retries; the engine survived (load 13.79 GiB) but the **desktop session exited 22 s later**
     (INFERRED from timing; GUI shares the card). `--gpu-memory-utilization` does not bound the load
     phase. Parked — see Later.
   Original step: smoke-boot A, A2; record boot result + KV pool + VRAM (MEASURED).
5. ✅ Baseline campaign `campaigns/2026-10-22-vllm-sly-mxfp4-depth/` (A, fp8 KV only, ctx 150k, no
   speculation; 4 cold depths + growing conversation) — see its `analysis.md`. Prefill 2,845 → 1,500
   tok/s, decode 33.8 → 17.9 tok/s, power at the 210 W cap; **1 GPU memory fault** in
   `radiance_mxfp4_fp8_gemm_atiled` (OPEN).
5b. ✅ DFlash2 k=7 campaign `campaigns/2026-10-22-vllm-sly-mxfp4-dflash/` (profile
   `sly-radiance/qwen38-mxfp4-dflash`, drafter `syvai/Qwen3.8-27B-DFlash2-W4A16` @ `4d30ec73`) — see its
   `analysis.md`. Decode 33.8 → 136.6 tok/s @ 8k, 17.9 → 100.5 @ 136k cold, 145–203 on deep conversation
   turns (acceptance 31–67 %, τ 3.1–5.7); prefill unchanged; KV pool −20 % (345,297 tok); 0 faults in 29
   requests. OPEN: lookup-draft vs DFlash2 attribution, #164 (no reply text captured).
6. ⏸ llama-swap rows: `generate.py` vllm rows hard-code the 0.9.3 image, which is NOT migrated to the
   new data-root → those rows break until re-pointed (per-row `image` key; edit to an existing
   tool — ask first).
7. ⏸ Unsloth Studio: check for a custom OpenAI-compatible endpoint → point at `127.0.0.1:8000/v1`.
8. Later: a `/vllm-image` skill (pull tag → smoke → bench vs previous → promote), like `/llamacpp-build`.

**Later (agreed, not now):**
- **A2 NVFP4 retry** only with the card free of the desktop (TTY/SSH, GUI stopped) or after a
  load-peak fix (try `RADIANCE_NVFP4_LMHEAD=fp8`: keeps the 0.6 GiB lm_head out of bf16). Same
  kernels as A (CLAIMED 133.4 vs A's ~150 tok/s with drafter), so it is a second-source check only.
- **B — `Qwen/Qwen3.8-27B-FP8` @ `017b9c7a`** (quality reference; ~25 GiB weights on 1 card, may
  not boot): download PARTIAL (21/31 GB, no `SOURCE.txt` = incomplete) — re-run `fetch_model.sh`
  to resume. Profile `sly-radiance/qwen38-fp8` is ready.
- **C — `RedHatAI/Qwen3.8-27B-INT4`** (W4A16, already at `/home/dev/models/vllm/Qwen3.8-27B-INT4`):
  no-fp8 control and old-image (0.9.3) comparison; Sly serves it with `--quantization compressed-tensors`.
- **ParoQuant `z-lab/Qwen3.8-27B-PARO`** (W4A8): kernel not in the image → a derived image
  (`FROM ghcr.io/slybase/vllm-sly-radiance:<tag>` + `setup-paroquant.sh`), still docker-only.

## Deviations from the Sly README quickstart (and why)

- `--gpu-memory-utilization 0.90` (README 0.98): the desktop GUI shares the card.
- Speculative decoding off (drafter arms are separate profiles). `--enforce-eager` (2026-10-23 user decision)
  replaces the README quickstart's `FULL_DECODE_ONLY` + capture sizes `[1,2,4,8]` (README's `[8..64]` assume
  k=7 × 8 seqs); verified in the image source that eager cleanly overrides the compilation flags. Restoring
  graphs = re-add `--compilation-config.cudagraph_mode FULL_DECODE_ONLY` + `CUDAGRAPH_SIZES` to `_engine.env`.
- `--shm-size 16g` instead of `--ipc=host`; port bound to `127.0.0.1`; `no-new-privileges`;
  numeric render/video GIDs read from the host (here 992/44, README assumes 109/44).
- Containers run as root (image default): cache files under `cache/` are root-owned.
