# vLLM track — known issues (live failures)

One section per issue: **symptom / status / version seen / workaround / report**. A flag that fixes
an issue lives in `settings.md`; a fix that was version/env-specific lives in `historical.md`.

## `radiance_mxfp4_fp8_gemm_atiled` GEMM fault — **historical (graduated)**
- **symptom:** `HSA_STATUS_ERROR_MEMORY_FAULT` ("Page not present") in `radiance_mxfp4_fp8_gemm_atiled`
  (and `_folded`) — the MXFP4 W4A8 prefill GEMMs — then a 5–16 min hang (up to 387 s) and a dead
  engine (`EngineDeadError`). Pattern: prefill on a deep cached prefix (≥115k cached), the **2nd
  deep conversation of a boot**; MEASURED tally **2 faults in 84 requests, 2 of 4 serving boots**,
  both in the 2nd deep conversation.
- **status:** **resolved / not live** — graduated to `historical.md`. Root cause (INFERRED, strong): a
  corrupted kernel-argument pointer (bit 44 cleared); fixed by `HIP_FORCE_DEV_KERNARG=0` (kernargs in
  host memory). The current `sly-official` recipe does not set it and the fault is not live on the
  current stack.
- **version seen:** sly-radiance 1.6.0 / 1.5.1 + kernel 7.0.0-34 / -38.
- **workaround:** `HIP_FORCE_DEV_KERNARG=0` (historical fix); interim: client timeout < 387 s +
  restart between long sessions.
- **report:** `docs/analysis/2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md`,
  `docs/analysis/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md`; graduated to `historical.md`.

## NVFP4 load-peak OOM — **parked**
- **symptom:** the load-time NVFP4→MXFP4 requant + fp8→bf16 lm_head transient filled the card: peak
  **32,600 / 32,624 MiB + 2,956 MiB GTT** (MEASURED), HIP allocator OOM retries. The engine survived
  (load 13.79 GiB) but the **desktop session exited 22 s later** (INFERRED from timing; GUI shares the
  card). `--gpu-memory-utilization` does **not** bound the load phase.
- **status:** **parked** — A2 NVFP4 retry only with the card free of the desktop (TTY/SSH, GUI stopped)
  or after a load-peak fix.
- **version seen:** sly-radiance 1.6.0 (A2 = `unsloth/Qwen3.8-27B-NVFP4@f0b7c9e7`).
- **workaround:** boot watchdog (sysfs 0.2 s poll, `docker kill` below 256 MiB free);
  `RADIANCE_NVFP4_LMHEAD=fp8` (keep the 0.6 GiB lm_head out of bf16); run with the GUI stopped.
- **report:** `campaigns/2026-10-22-vllm-sly-mxfp4-depth/analysis.md` (setup lesson);
  `docs/vllm/workflows.md` (Roadmap, A2).

## `.rad`-vs-HF-checkpoint loading distinction — **live (design, not a bug)**
- **symptom:** not a fault — a loading distinction. **sly loads HF checkpoints only; radiance loads
  `.rad` files.** A `.rad` checkpoint (e.g. the Swift-1.5 heretic "production" checkpoint) loads
  **only** in native radiance, not in sly.
- **status:** **live** — a design distinction to respect when picking the engine for a checkpoint.
- **version seen:** sly (all), radiance (native `.rad`).
- **workaround:** use the right engine for the checkpoint format — sly → HF checkpoint (e.g. the
  Quark MXFP4), radiance → `.rad`.
- **report:** `profiles/sly-radiance/qwen38-heretic-mxfp4.env` (comment); `profiles/radiance/` (native `.rad`).

## Cactus lossy acceptance — Sly issue #164 (repetition lock-in) — **live on the current model**
- **symptom:** the image-default Cactus (`RADIANCE_CACTUS_DELTA=0.5`) is a **lossy acceptance
  transform** patched into the spec-decode rejection kernel for every sampled request. Sly issue #164
  (open) reports it **locking into endless repetition on long outputs**.
- **status:** **live** — sly-official uses the official `0.5` (the current model under test); sly-radiance
  deliberately uses `0` (bit-exact stock acceptance) to avoid it (2026-10-23 user decision, quality first).
- **version seen:** sly-radiance 1.6.0 (Cactus off), sly-official 1.8.1 (Cactus 0.5).
- **workaround:** `RADIANCE_CACTUS_DELTA=0` for bit-exact stock acceptance (what upstream radiance runs).
- **report:** `settings.md` (RADIANCE_CACTUS_DELTA); `profiles/sly-radiance/_engine.env` (comment);
  Sly issue #164.

## Resolved (tooling / setup) — kept for provenance
- **vLLM 0.31 streams thinking as `delta.reasoning`** — `capture_engine.py` read only `reasoning_content`
  → a first capture was all "no tokens" (tool fixed, not an engine fault).
- **containerd image store ignores docker `data-root`** — Docker 29 uses the containerd snapshotter, so
  images stayed on `/var/lib/containerd`; fixed by moving containerd `root` to `/mnt/Lin1/work/containerd`
  + `RequiresMountsFor=/mnt/Lin1`.
- **36864 window cannot serve the dp-forge spec-pipeline** — the old radiance row died at the first LLM
  stage (HTTP 400 `VLLMValidationError`); fixed by ctx 114688 (radiance 0.9.3, now a dead image).
- **first-shape Triton JIT during inference** — −13% to −27% prefill on rep 0; warm each shape first.
