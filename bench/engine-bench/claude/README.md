# Claude Code on local radiance / vllm-sly-radiance

Five launchers: each frees the GPU, boots ONE server (via `radiance/serve_radiance.sh` or `vllm/serve_vllm.sh`),
waits for `/health`, writes per-run Claude settings, runs `claude`, and stops the server when Claude exits (`KEEP=1` leaves it up).
Extra args go to `claude` (`-c`, `-p "…"`). Verified 2026-10-24: each answered a `claude -p` prompt (log: `bench/.servers/8000.{log,boot}`).

| Script | Engine / image | Model file | Boot | Served name | Notes |
|---|---|---|---|---|---|
| `claude-rad-mxfp4.sh` | native radiance `stilldeadcode/radiance:1.11.0` | `/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-mxfp4@60bd4139/qwen3.8-27b-mxfp4.rad` (18 GiB, incl. vision + DFlash2 drafter) | ~55 s | `qwen35` | tp1, fp8 KV, 8 seqs, ctx 200000 |
| `claude-rad-heretic.sh` | native radiance (same image) | `/mnt/Lin1/work/vllm/sly-radiance/models/swift-heretic-gptq/*.rad` (16.8 GiB, target only, no drafter) | ~55 s | `qwen35` | research-only, safety removed; flags from the file's README |
| `claude-sly-amd.sh` | `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` (vLLM 0.32) | `amd/Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c` (HF checkpoint) | ~3 min (+compile on a new image tag) | `qwen38-27b-mxfp4` | profile `sly-radiance/qwen38-mxfp4`, ctx 150000, drafter off |
| `claude-sly-heretic.sh` | `vllm-sly-radiance:1.6.0` (vLLM) | `slybase/Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ@3bb379dc` (compressed-tensors GPTQ-MXFP4, HF checkpoint, ~20 GB) | ~3 min | `swift-1.5-heretic` | profile `sly-radiance/qwen38-heretic-mxfp4`; research-only, safety removed |
| `claude-sly-redhat.sh` | `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (vLLM 0.32.0; since 2026-10-30, was 1.8.1 — `IMAGE=…:1.8.1-rocm10.1` rolls back) | `RedHatAI/Qwen3.8-27B-MXFP4@16a86728` (compressed-tensors MXFP4, HF checkpoint, 19 GB) + `syvai/Qwen3.8-27B-DFlash2-W4A16@4d30ec73` drafter | ~7 min (400–419 s) | `qwen38-27b-redhat-mxfp4-dflash` | profile `sly-redhat/redhat-mxfp4-dflash` (heretic's sly-official engine layer), DFlash2 k=7, ctx 262000, `WATCHDOG_MIB=32` |

Knobs: `PORT` (8000) `KEEP` `WAIT` `MAXLEN` `IMAGE` `RAD_FILE` `EXTRA_ARGS` `CLAUDE_BASE_SETTINGS`. The Claude env block comes from
`~/.config/claude/local_vllm_direct/settings.json`; the launcher rewrites URL, model names, context window and the autocompact % (so compaction fires before prompt+output > window).

**Heretic on sly vs on radiance:** sly uses the GPTQ checkpoint (the .rad's source); radiance uses the `.rad`.
**Why the `.rad` is on radiance, not sly:** a `.rad` is a native Radiance container (weights+tokenizer+template in one file). vllm-sly-radiance is vLLM and loads HF
checkpoint dirs only; pointing it at the heretic dir (`/mnt/Lin1/work/vllm/sly-radiance/run.sh`, which mounts the .rad dir) makes the `vllm` container crash-loop (15 restarts seen). The heretic file needs radiance >= 1.2.3.

## Directory map

`/mnt/Lin1/work/radiance/` — upstream native engine ([codeberg StillDeadcode/radiance](https://codeberg.org/StillDeadcode/radiance))
- `models/StillDeadcode__qwen3.8-27b-mxfp4@<rev8>/` — HF snapshot: `.rad`, `.recipe` (rad-convert recipe), README (speed table, serve flags), LICENSE
- `dl.log`, `pull.log` — download / `docker pull` logs. No config dir: the engine is configured only by CLI flags (`docker run … stilldeadcode/radiance:<tag> --model … --help` lists all).

`/mnt/Lin1/work/vllm/sly-radiance/` — SlyBase vLLM fork ([github SlyBase/vllm-sly-radiance](https://github.com/SlyBase/vllm-sly-radiance))
- `src/v1.6.0/` — upstream checkout (README = option table + quickstart, CHANGELOG, `sly/` patches, `qwen-fixed-*.jinja`, `docs/`, AGENTS.md). Only v1.6.0 is checked out; images 1.6.0 and 1.8.0 are pulled
- `models/<org>__<repo>@<rev8>/` — pinned HF checkpoints + `SOURCE.txt`: amd Quark MXFP4 (used), Qwen FP8, unsloth NVFP4, syvai DFlash2 W4A16 drafter, `swift-heretic-gptq/` (heretic `.rad`, despite the name — radiance only), `slybase__Swift-1.5-…-heretic-MXFP4-GPTQ@3bb379dc/` (heretic for sly; fetched via `vllm/fetch_model.sh`)
- `cache/<image>@<tag>/{root-cache,triton,aiter}` — compile caches, one set per image tag (new tag = slow first boot)
- `tools/hf-venv` — `hf` CLI (used by `vllm/fetch_model.sh`); `.venv` — scratch; `logs/` — fetch/pull logs
- `run.sh` — hand-written `docker run` for heretic-on-vLLM: **does not work** (see above); `--restart unless-stopped` is why it keeps coming back. The launchers remove such a container automatically

In the repo: `bench/engine-bench/radiance/serve_radiance.sh` (native engine), `bench/engine-bench/vllm/{serve_vllm.sh,profiles/<engine>/*.env}` (sly; `_engine.env` = image + shared flags, `<model>.env` = model flags; see `vllm/README.md`), `monitor.sh` — live view of the booted server (wraps `bench/lib/monitor.py` with `PORT`/paths from `_lib.sh`, records to `$RUNDIR/<port>.session.jsonl`; GPU bars + temps + fan, cache, server uptime, live polls, 5-min avg; see `vllm/README.md` §Monitoring).

## Configs that matter

- Both ROCm containers: `HIP_FORCE_DEV_KERNARG=0` (else random MEMORY_FAULT; set by the launchers). GPU groups are numeric GIDs read from the host. Desktop shares the card, so sly uses `GPU_UTIL=0.90` and a boot VRAM watchdog (`WATCHDOG_MIB`=256).
- radiance: `--reasoning-effort-map high=xhigh` (template rejects OpenAI's `high`); heretic adds `--reasoning-effort medium` (default xhigh adds a system block) and `--max-num-batched-tokens 2048`. KV `fp8`; `fp8_v4`/`k6_v4` exist for more context (see `--help`).
- sly: MXFP4 needs `RADIANCE_MXFP4=1` + the W4A8 set in `qwen38-mxfp4.env`; `--enforce-eager`, Cactus off (`RADIANCE_CACTUS_DELTA=0`), DFlash2 drafter off in the profile (the README quickstart uses it with k=7).

## Upgrading / debugging

- **New radiance image:** `docker pull stilldeadcode/radiance:<tag>`, then `IMAGE=… ./claude-rad-mxfp4.sh`; make it the default in `radiance/serve_radiance.sh` only after a clean run. Re-check `--help` (flags change) and that the `.rad` version requirement is met (model README "Needs radiance >= x").
- **New sly image:** pull, `git -C src fetch` the matching tag into `src/<tag>/` (diff CHANGELOG + the README options table against `_engine.env`/`qwen38-mxfp4.env`), then `IMAGE=… ./claude-sly-amd.sh`. **1.8.0 currently fails the boot watchdog** (free VRAM 90 MiB just after `lm_head quantised to int4`, 2026-10-24) — next step: read the 1.7/1.8 CHANGELOG for load-memory changes, retry with `WATCHDOG_MIB=0` only while watching VRAM (the desktop can die), or lower `GPU_UTIL`.
- **Boot fails:** `bench/.servers/8000.log` (radiance) / `8000.boot` + `8000.log` (sly) / `8000.watchdog` (watchdog trip). Never leave an orphan: `docker rm -f radiance-8000 vllm-8000`, then check `amd-smi metric -g 0 -m` FREE_VRAM (iron rule 14).
- **Heretic dir clean-up (not done):** it holds a 99 KB HTML file named `swift-1.5-heretic-mxfp4-radiance-1.2.3` (a failed HF download saved as the file name) and the real `.rad` has a mangled name (`…-ra~ce-1.2.3.rad`); `rad.sha256`, LICENSE and NOTICE are missing, so the file is unverified beyond its `RAD1` header and README-matching size.
- Not measured here: speed/quality of any of the three (these are launchers, not benchmarks); the speed figures in the model READMEs are `CLAIMED`.
