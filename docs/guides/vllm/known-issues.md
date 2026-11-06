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

## Native Radiance default headroom starves the desktop — **live**
- **symptom:** with the default `--gpu-headroom-mib` of 96, Radiance claims nearly the whole card: 232.52 MiB free at
  load (log), 32,511 of 32,624 MiB at peak, 113 MiB free (MEASURED). Chrome crashed at 17:32 and GNOME Shell at 17:33,
  and the desktop session restarted. The container was not OOM-killed.
- **status:** **live**. The VRAM cause is INFERRED from timing; the crash reports and `/var/log/kern.log` were not
  readable from the account that ran the test.
- **version seen:** `stilldeadcode/radiance:1.16.0`, Ornith 1.5 w4a8, 2026-11-04.
- **workaround (recommended only, not required):** the operator's choice is to keep the launcher at the default and close
  Chrome if VRAM gets tight. `EXTRA_ARGS="--gpu-headroom-mib 2048" ./ornith_rad_mtp.sh start` is the optional
  alternative. **Unmeasured.** It should shrink only the KV cache, from 11.37 GiB to about 9.5 GiB (INFERRED). The launcher
  has no VRAM watchdog.
- **not affected:** the 27B on `sly-redhat` is stable as configured and needs no extra headroom (operator report; 1,427 MiB
  min free at ctx 262000, MEASURED).
- **report:** `docs/analysis/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`.

## MXFP4 MoE `EMULATION` slow path — **live on `sly-amd`**
- **symptom:** `amd/Qwen3.5-35B-A3B-MXFP4` decodes at about 16 tok/s with DFlash K=7, at any depth. Prefill is healthy.
- **status:** **live**. The profile default is still `EMULATION`; `--moe-backend triton_unfused` is a working
  override. No AMD or vLLM source recommends it, but a community checkpoint card does for gfx12 (CLAIMED). The log says it
  runs BF16 activations instead of the checkpoint's quantized ones (quality effect unmeasured).
- **version seen:** sly 1.9.1 (vLLM 0.32.0), 2026-11-04.
- **workaround:** `bench/engine-bench/vllm/archive/qwen35_sly_dflash.sh` passes `--moe-backend triton_unfused`: 110.2 / 92.9 / 67.3 tok/s at 10k / 50k / 100k
  against 16.6 / 15.4 / 15.8 (MEASURED, DFlash K=7).
- **trap:** arms without DFlash logged `Capturing CUDA graphs (FULL): 0it`, so they ran with no full-model graph.
  Their decode (`nospec` 6.2, `nospec-unfused` 8.7, `mtp-k4` 16.8 tok/s at 10k) does not measure backend cost. The cause
  is open.
- **report:** `docs/analysis/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`;
  `docs/research/2026-11-04-1702-qwen35-35b-a3b-radiance-config-alternatives.md`.

## MTP does not load on the Ornith 1.5 MXFP4 checkpoint — **live on Sly**
- **symptom:** `Capicua25x/Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4` with `method: mtp` fails at load. Its experts are MXFP4 and
  its MTP layer's experts are unquantized BF16, and no usable backend serves both (MEASURED):
  `triton_unfused` → `not supported for unquantized MoE`; `triton` → `kernel does not support MoEActivation.SILU activation`;
  `aiter` → `AITER_TRITON_MXFP4_BF16 ... does not support current device rocm`.
- **status:** **live**. Only `EMULATION` is left, not tested because it ran the Qwen 35B at about 16 tok/s. A failed load leaves
  the container up, so the launcher waits until `WAIT` runs out.
- **version seen:** sly 1.9.1 (vLLM 0.32.0), 2026-11-04.
- **workaround:** use `ornith_rad_mtp.sh` for MTP. DFlash K=3 does load on Sly (`bench/engine-bench/vllm/archive/ornith_sly_dflash.sh`; its checkpoints were deleted, fetch commands in its header). Native Radiance is not affected: its
  image has no vLLM, and it measured MTP K=3 at 219.8 tok/s.
- **not the same as:** vLLM's comment `TRITON_UNFUSED has bug with MTP support` (`oracle/mxfp4.py`:403, :442), whose symptom nobody
  documents ([#49446](https://github.com/vllm-project/vllm/issues/49446), open).
- **report:** `docs/analysis/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`; raw boots in
  `bench/runs/2026-11-04-1802-ornith15-sly-dflash/ornith-mtp-k3-*FAILED*`.

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
- **upstream mitigation (2026-10-30):** Sly 1.9.0 adds a fade (δ falls to 0 between 4,096 and 16,384 output
  tokens; `RADIANCE_CACTUS_FADE_END=0` = off) and a cap (`RADIANCE_CACTUS_CAP_R`, default 0.5; `0` = off; env knobs `CACTUS_FADE_START/END`, `CACTUS_CAP_R`, see `settings.md`); 1.9.1 adds the
  `v22.5-sly2` template (older turns' reasoning not replayed). CLAIMED: loops 20/32 → 3/32; #164 still open.
  The sly-redhat profile runs 1.9.1 since 2026-10-30 (smoke test `bench/runs/2026-10-30-1745-sly-1.9.1-smoke/`);
  MEASURED on a real session (`docs/analysis/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md`, Claude Code
  dp-forge brief fix W2-08, RedHat MXFP4 + DFlash2 k=7, budget RUNBOOK): **reduced, not removed**. 10-s decode windows
  at acceptance ≥ 7 of 8 = 58 of 514 (11.3 %) on 1.9.1 (δ 0.5 + fade/cap, `v22.5-sly2`), vs 777 of 1,067 (72.8 %) on
  1.8.1 δ 0.5 (whole 3-h run, 0 of 3 briefs finished) and 7 of 650 (1.1 %) on 1.8.1 δ 0 (not a controlled A/B: RUNBOOK and briefs in the prompt differ too). Still 3 decision loops and
  1 output-cap hit on 1.9.1; the largest began at δ 0.5 and kept going after the fade reached δ 0, so pinned acceptance
  is a symptom rather than the cause (INFERRED). Short-probe speed is unchanged vs 1.8.1 (depth 10k/50k/100k,
  `docs/analysis/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md`).
- **mechanism (2026-10-31; code MEASURED, mechanism INFERRED):**
  - **Rule:** the accept test uses `h = min(1, p + sqrt(2δ·p(1−p)))` instead of the target probability p of the drafted token, so δ is
    a per-token divergence budget (KL ≈ δ).
  - **1.8.1 (no cap):** h = 1 for p ≥ 1/(1+2δ) = 0.5 at δ 0.5. Every confident drafted token is accepted with certainty, so a
    repetition cycle has no exit. MEASURED: the 3 largest loops of the 1.8.1 δ 0.5 run all ran to `max_tokens` 64,000.
  - **1.9.x cap R = 0.5:** keeps at least half the stock escape. MEASURED: 2 of 3 loops escaped, but only 23-30k tokens after the
    fade had reached δ 0, because by then the target itself predicts the copy.
  - **Fade too late:** 4 of 6 1.9.1 loop onsets were before `FADE_START` 4,096 output tokens, at full δ.
  - **δ 0.3 is not a safe middle:** under the cap it accepts exactly like δ 0.5 for every drafted token with p ≥ 0.29.
  - **Replay rule:** k = 1 replay (`v22.5-sly2`) did not stop δ 0.5 loops on our workload.
  - **Verdict:** inherent to lossy acceptance plus a 1.8.1 saturation flaw; not a coding bug (δ 0 is bit-exact).
  - **Knobs that matter:** `CACTUS_CAP_R` (0.8 keeps ≥ 80% of the escape), an early fade (`FADE_START=0`, `FADE_END` a few
    thousand), or δ 0.
  - Full write-up: `docs/analysis/2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops.md` §5.
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
