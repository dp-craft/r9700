# Claude Code on local radiance / vllm-sly-radiance

Eight launchers (the table lists five; the three `claude-rad-iq4rlv4*.sh` serve the IQR-V4 .rad on radiance 1.17.0, see
their headers): each frees the GPU, boots ONE server (via `radiance/serve_radiance.sh` or `vllm/serve_vllm.sh`),
waits for `/health`, writes per-run Claude settings, runs `claude`, and stops the server when Claude exits (`KEEP=1` leaves it up).
Extra args go to `claude` (`-c`, `-p "…"`). Smoke-tested 2026-10-24 (each answered a `claude -p` prompt; log: `stack/serve/var/servers/8000.{log,boot}`), before the
2026-10-25 27B context decision (262000 ctx, 2 seqs; 260000 since the 2026-11-09 re-tune) and the later image changes; not re-run since.

| Script | Engine / image | Model file | Boot | Served name | Notes |
|---|---|---|---|---|---|
| `claude-rad-mxfp4.sh` | native radiance `stilldeadcode/radiance:1.11.0` | `/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-mxfp4@60bd4139/qwen3.8-27b-mxfp4.rad` (18 GiB, incl. vision + DFlash2 drafter) | ~55 s | `qwen35` | tp1, fp8 KV, 2 seqs, ctx 260000 |
| `claude-rad-heretic.sh` | native radiance (same image) | `/mnt/Lin1/work/vllm/sly-radiance/models/swift-heretic-gptq/*.rad` (16.8 GiB, target only, no drafter) | ~55 s | `qwen35` | research-only, safety removed; flags from the file's README |
| `claude-sly-amd.sh` | `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` (vLLM 0.32) | `amd/Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c` (HF checkpoint) | ~3 min (+compile on a new image tag) | `qwen38-27b-mxfp4` | profile `sly-radiance/qwen38-mxfp4`, ctx 150000, drafter off |
| `claude-sly-heretic.sh` | `ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1` (vLLM) | `slybase/Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ@3bb379dc` (compressed-tensors GPTQ-MXFP4, HF checkpoint, ~20 GB) + `syvai/Qwen3.8-27B-DFlash2-W4A16@4d30ec73` drafter | ~3 min (~10 min first boot on a new image tag) | `swift-1.5` | profile `sly-official/heretic-mxfp4`; research-only, safety removed |
| `claude-sly-redhat.sh` | `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (vLLM 0.32.0; since 2026-10-30, was 1.8.1 — `IMAGE=…:1.8.1-rocm10.1` rolls back) | `RedHatAI/Qwen3.8-27B-MXFP4@16a86728` (compressed-tensors MXFP4, HF checkpoint, 19 GB) + `syvai/Qwen3.8-27B-DFlash2-W4A16@4d30ec73` drafter | ~7 min (400–419 s) | `qwen38-27b-redhat-mxfp4-dflash` | profile `sly-redhat/redhat-mxfp4-dflash` (heretic's sly-official engine layer), DFlash2 k=7, ctx 260000, `WATCHDOG_MIB=32` |

Knobs: `PORT` (8000) `KEEP` `WAIT` `MAXLEN` `IMAGE` `AUTO_PULL` (sly: 0 = refuse a missing image) `RAD_FILE` `EXTRA_ARGS` `CLAUDE_BASE_SETTINGS`. The Claude env block comes from
`~/.config/claude/local_vllm_direct/settings.json`; the launcher rewrites URL, model names, context window and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` = window minus max output, dropping any `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (so compaction fires before prompt+output > window).

**Heretic on sly vs on radiance:** sly uses the GPTQ checkpoint (the .rad's source); radiance uses the `.rad`.
**Why the `.rad` is on radiance, not sly:** a `.rad` is a native Radiance container (weights+tokenizer+template in one file). vllm-sly-radiance is vLLM and loads HF
checkpoint dirs only; pointing it at the heretic dir (`/mnt/Lin1/work/vllm/sly-radiance/run.sh`, which mounts the .rad dir) makes the `vllm` container crash-loop (15 restarts seen). The heretic file needs radiance >= 1.2.3.

## Directory map

`/mnt/Lin1/work/radiance/` — upstream native engine ([codeberg StillDeadcode/radiance](https://codeberg.org/StillDeadcode/radiance))
- `models/StillDeadcode__qwen3.8-27b-mxfp4@<rev8>/` — HF snapshot: `.rad`, `.recipe` (rad-convert recipe), README (speed table, serve flags), LICENSE
- `dl.log`, `pull.log` — download / `docker pull` logs. No config dir: the engine is configured only by CLI flags (`docker run … stilldeadcode/radiance:<tag> --model … --help` lists all).

`/mnt/Lin1/work/vllm/sly-radiance/` — SlyBase vLLM fork ([github SlyBase/vllm-sly-radiance](https://github.com/SlyBase/vllm-sly-radiance))
- `src/v1.6.0/` — upstream checkout (README = option table + quickstart, CHANGELOG, `sly/` patches, `qwen-fixed-*.jinja`, `docs/`, AGENTS.md). Checked out: `v1.6.0` and `1.10.0`; the launchers use images 1.6.0 (amd), 1.8.1 (heretic) and 1.9.1 (redhat)
- `models/<org>__<repo>@<rev8>/` — pinned HF checkpoints + `SOURCE.txt`: amd Quark MXFP4 (used), Qwen FP8, unsloth NVFP4, syvai DFlash2 W4A16 drafter, `swift-heretic-gptq/` (heretic `.rad`, despite the name — radiance only), `slybase__Swift-1.5-…-heretic-MXFP4-GPTQ@3bb379dc/` (heretic for sly; fetched via `vllm/fetch_model.sh`)
- `cache/<image>@<tag>/{root-cache,triton,aiter}` — compile caches, one set per image tag (new tag = slow first boot)
- `tools/hf-venv` — `hf` CLI (used by `vllm/fetch_model.sh`); `.venv` — scratch; `logs/` — fetch/pull logs
- `run.sh` — hand-written `docker run` for heretic-on-vLLM: **does not work** (see above); `--restart unless-stopped` is why it keeps coming back. The launchers remove such a container automatically

In the repo: `stack/serve/radiance/serve_radiance.sh` (native engine), `stack/serve/vllm/{serve_vllm.sh,profiles/<engine>/*.env}` (sly; `_engine.env` = image + shared flags, `<model>.env` = model flags; see `vllm/README.md`), `monitor.sh` — live view of the booted server (`stack/gpu/monitor.sh` in the repo: wraps `stack/gpu/monitor.py`, `PORT` from the env, records to `$RUNDIR/<port>.session.jsonl`; GPU bars + temps + fan, cache, server uptime, live polls, 5-min avg; see `vllm/README.md` §Monitoring).

## Configs that matter

- Both ROCm containers: `HIP_FORCE_DEV_KERNARG=0` (else random MEMORY_FAULT) is set by `serve_radiance.sh` and the sly-radiance (amd) engine layer; the sly-official layer (heretic, redhat) deliberately leaves it unset. GPU groups are numeric GIDs read from the host. Desktop shares the card, so sly uses a reduced `GPU_UTIL` (amd 0.90, redhat and heretic 0.93) and a boot VRAM watchdog (`WATCHDOG_MIB`: amd 256, redhat and heretic 32).
- radiance: `--reasoning-effort-map high=xhigh` (template rejects OpenAI's `high`); heretic adds `--reasoning-effort medium` (default xhigh adds a system block) and `--max-num-batched-tokens 2048`. KV `fp8`; `fp8_v4`/`k6_v4` exist for more context (see `--help`).
- sly amd (`sly-radiance/qwen38-mxfp4`): MXFP4 needs `RADIANCE_MXFP4=1` + the W4A8 set in `qwen38-mxfp4.env`; `--enforce-eager`, Cactus off (`RADIANCE_CACTUS_DELTA=0`), DFlash2 drafter off in the profile (the README quickstart uses it with k=7). Heretic and redhat use the sly-official layer instead: DFlash2 k=7, cudagraphs (not eager); Cactus 0.5 for heretic, delta 0 for redhat (0.5 loops on agentic work, `docs/findings/agentic/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md`).

## Upgrading / debugging

- **New radiance image:** `docker pull stilldeadcode/radiance:<tag>`, then `IMAGE=… ./claude-rad-mxfp4.sh`; make it the default in `radiance/serve_radiance.sh` only after a clean run, and move the `IMAGE` pin in `claude-rad-mxfp4.sh` and `claude-rad-heretic.sh` with it. Re-check `--help` (flags change) and that the `.rad` version requirement is met (model README "Needs radiance >= x").
- **New sly image:** pull, `git -C src fetch` the matching tag into `src/<tag>/` (diff CHANGELOG + the README options table against `_engine.env`/`qwen38-mxfp4.env`), then `IMAGE=… ./claude-sly-amd.sh`. **1.8.0 failed the boot watchdog with the amd profile** (free VRAM 90 MiB just after `lm_head quantised to int4`, 2026-10-24, at the 256 MiB floor; heretic and redhat run `WATCHDOG_MIB=32` for their own dips: heretic 1.8.1 ~250 MiB on 2026-10-24, RedHat 1.8.1 71 MiB on 2026-10-30) — next step: read the 1.7/1.8 CHANGELOG for load-memory changes, retry with `WATCHDOG_MIB=0` only while watching VRAM (the desktop can die), or lower `GPU_UTIL`.
- **Boot fails:** `stack/serve/var/servers/8000.log` (radiance) / `8000.boot` + `8000.log` (sly) / `8000.watchdog` (watchdog trip). Never leave an orphan: `docker rm -f radiance-8000 vllm-8000`, then check `amd-smi metric -g 0 -m` FREE_VRAM (iron rule 14).
- **Heretic dir clean-up (not done):** it holds a 99 KB HTML file named `swift-1.5-heretic-mxfp4-radiance-1.2.3` (a failed HF download saved as the file name) and the real `.rad` has a mangled name (`…-ra~ce-1.2.3.rad`); `rad.sha256`, LICENSE and NOTICE are missing, so the file is unverified beyond its `RAD1` header and README-matching size.
- Not measured here: speed/quality of any of the three (these are launchers, not benchmarks); the speed figures in the model READMEs are `CLAIMED`.
