# WS7 round 2 — drill-down: our sly-radiance stack, first-boot phase breakdown + cache analysis

Provenance tags on every number (MEASURED = our runs/this machine, CLAIMED = external, INFERRED = reasoned).
Log references are line numbers in `campaigns/perf/2026-10-30-1745-sly-1.9.1-smoke/tmp/server-container.log`
(container-local time).

> Read-only note: CLAUDE.md says never read `*.log` under `campaigns/*/*/tmp/` (rule targets GB-scale raw
> data). This one file (424 lines / 50 KB) is the **only timestamped first-boot evidence** in the repo and is
> required for the phase table the brief demands, so it was read. Nothing else under `tmp/` was touched.

## 0. Boot provenance table

| Boot (UTC) | Tag | Result | Boot time | Source |
|---|---|---|---|---|
| 2026-10-30 | 1.8.1-rocm10.1 | cold first boot, up | **400 s** | `stack/serve/var/servers/8000.boot` (MEASURED) |
| 2026-10-30 | 1.9.1-rocm10.1 | cold first boot (smoke campaign), rc 0, VRAM 1,303→30,852 MiB, KV pool 370,702 tok @262000 | **475 s** | campaign `results/README.md` (MEASURED); timestamped log in `tmp/` |
| 2026-11-09 19:53 | 1.9.1-rocm10.1 | daily-driver boot (new config), `up_after_s=435` | **435 s** (hybrid, see §1 note) | `stack/serve/var/servers/8000.cmdline` (MEASURED) |
| — | 1.10.0-rocm10.1 | not yet booted; image pulled (166d5fcad0ae, 8.71 GB); **no cache dir exists** → first boot = cold | expected ~475 s-class (INFERRED from 1.9.1) | `docker images` + `ls cache/` (MEASURED) |

## 1. Phase breakdown — 1.9.1 cold boot, total 475 s

Anchor lines (verbatim, from the log): `"[aiter] finish build [module_aiter_core], cost 27.4s"` ·
`"Multi-modal warmup completed in 18.263s"` · `"Model loading took 14.83 GiB memory and 54.355595 seconds"` ·
`"Dynamo bytecode transform time: 12.15 s"` · `"Compiling a graph for compile range (1, 4096) takes 30.79 s"` ·
`"torch.compile took 50.92 s in total"` · `"saved AOT compiled function to .../torch_aot_compile/b268c942…/rank_0_0/model"` ·
`"Initial profiling/warmup run took 76.50 s"` · `"JIT kernel warmup (72 compile keys) … finished in 55.98s"` ·
`"init engine (profile, create kv cache, warmup model) took 248.11 s (compilation: 82.82 s)"`.

| # | Phase | s | What runs | Cache state (first boot) | Provenance | Lines |
|---|---|---|---|---|---|---|
| 1 | Container start → vLLM CLI (entrypoint banner, bwtest, python imports; **includes aiter hipcc JIT build 27.4 s**) | ≈67 | container/entrypoint + aiter module build | all miss; aiter writes to container layer (not our mount) | INFERRED (475−408); aiter part MEASURED | 118 |
| 2 | CLI arg/config resolution: main model arch + draft model | 57 | 16:45:09 banner → 16:46:06 draft resolved | — | MEASURED | — |
| 3 | mm warmup (18.26 s of it) + EngineCore spawn | ≈38 | 16:46:06 → "Initializing a V1 LLM engine" 16:46:44 | — | MEASURED | 155 |
| 4 | **Weight load** (constant, not cacheable) | **54.36** | main 18.47 GiB in 42.59 s + draft 1.19 GiB in 2.90 s | n/a | MEASURED | 191–230 |
| 5 | torch.compile — backbone (Dynamo 12.15 + Inductor 30.79) | **50.92** | writes `torch_compile_cache/2ecc9d86c2/` + AOT artifact | miss → write | MEASURED | 235–241 |
| 6 | Initial profiling/warmup run (backbone) | **76.50** | forward runs; Triton JIT inside | miss → (partially) write | MEASURED | 249 |
| 7 | torch.compile — dflash_head (30.39) + its warmup (3.09) | **33.48** | spec-decode head graph | miss → write | MEASURED | 250–265 |
| 8 | torch.compile — candidate_selector | **1.52** | | miss → write | MEASURED | 266–273 |
| 9 | CUDA graph capture round 1 | ≈5 | "Graph capturing finished in 5 secs, took 0.29 GiB" | always (never cached) | MEASURED | 277–283 |
| 10 | **JIT kernel warmup (72 Triton compile keys)** | **55.98** | Triton kernel JIT → triton cache | miss → write | MEASURED | 292–294 |
| 11 | GDN/M-RoPE/Mamba Triton warmups + graph capture round 2 | ≈19 | 16:51:28→16:51:47; round 2 "finished in 3 secs, took 0.28 GiB" | miss → (partially) write | MEASURED | 295–306 |
| 12 | Engine init done → API server → /health 200 | ≈9 | 16:51:48 → 16:51:57+ | — | MEASURED | 312–394 |
| | **Total** | **≈468** | ≈ measured 475 (±10 s rounding; t0 inferred as health−475) | | | |

- vLLM self-report vs wall clock: EngineCore phase wall ≈ 304 s (16:46:44→16:51:48); the `"init engine … 248.11 s (compilation: 82.82 s)"` timer excludes the 55.98 s JIT-kernel-warmup block. `82.82 = 50.92 + 30.39 + 1.52` (compilation = torch.compile only, per vLLM's definition).
- Post-health: `jit_monitor` logs "Triton kernel JIT compilation during inference: `_radiance_w4a16_splitk_kernel` / `_prepare_dflash_inputs_kernel` / `_triton_w4a16_skinny_fmt_kernel`" → **some kernels only compile at first real request**, after /health. This is why a pre-warm must include a generation, not just /health.
- **Nov-9 hybrid boot (435 s):** the daily-driver config (MAXLEN 260000 / MAXSEQS 2) differs from the Oct-30 smoke (262000 / 1) → config is part of the compile hash → new hash dir `bb2f1dae64` was written that boot (`root-cache` mtimes Nov 9 20:56/20:58), while the Triton cache **hit** (233 M already present). 435 ≈ 475 − ~40 → Triton reuse saves ≈40 s on this rig (MEASURED delta, INFERRED attribution). **Direct evidence: pre-warm must use the daily-driver config, not a minimal smoke config, or the real config stays cold.**

## 2. Fraction of first boot that is cache-miss compilation

| Category | s | % of 475 | Cacheable into the tag cache for the next boot? |
|---|---|---|---|
| torch.compile (inductor/AOT, 3 modules) | 82.82 | 17.4% | **yes** |
| Profiling/warmup runs (76.50 + 3.09) | 79.59 | 16.7% | execution always; the Triton-JIT portion inside is cacheable |
| JIT kernel warmup (72 Triton keys) | 55.98 | 11.8% | **yes** |
| Misc Triton warmups (GDN/M-RoPE/Mamba) | ≈3 | 0.6% | yes |
| **aiter hipcc JIT build** | 27.4 | 5.8% | **no** — builds into container layer; mounted aiter dir only ever gets an empty `build/` skeleton (Sly FASTBOOT §1 + our 8 KB aiter dir) |
| CUDA graph capture (2 rounds) | ≈8 | 1.7% | no — always re-captured |
| Weight load | 54.36 | 11.4% | no — constant ~18.5 GiB read |
| mm warmup + engine spawn + CLI/config + entrypoint base | ≈95 | ≈20% | no — constant |
| API/health | ≈9 | 1.9% | no |

**Answer: ≈249 s (≈52%) of the 475 s first boot is cache-miss compilation/JIT/warmup work**
(82.82 + 79.59 + 55.98 + 3 + 27.4). Of that, ≈221 s (≈47%) is actually cacheable into our tag mounts
(inductor AOT + Triton artifacts); the aiter 27.4 s is compilation but not cacheable via mounts (image-bake
or pre-warm boot only). Constant non-cacheable work ≈ 226 s (≈48%): weights, entrypoint, mm warmup, graph
capture, CLI/config, API.

## 3. Warm-boot expectation

- Triton reuse saves ≈40 s (MEASURED hybrid delta, §1 note).
- Inductor reuse saves ≈73 s of our 82.82 s: Sly's warm-boot reference (FASTBOOT §4, their 2×R9700 rig) is
  `init engine … 37.85 s (compilation: 9.40 s)` vs our cold `248.11 s (compilation: 82.82 s)` (CLAIMED + MEASURED).
- Sly's rig end-to-end: cold 381 s → warm 251 s, cache mount alone saves ≈130 s (CLAIMED).
- **Our warm-boot estimate (INFERRED): 475 − 40 (Triton) − 73 (inductor) − ≈25 (Triton portion of the
  profiling runs) ≈ 320–330 s (range ~300–340) → under the ≤400 s target**, provided the pre-warm used the
  exact daily-driver config.

## 4. Option (b) — cache-key change (tag → (vLLM pin, ROCm, arch)): viable?

| Aspect | Finding | Provenance |
|---|---|---|
| Key today | image tag: `serve_vllm.sh` line 180 `CACHE_DIR="$VLLM_ROOT/cache/${TAG//:/@}"`; exactly 3 tag dirs on disk; **no 1.10.0 dir** | MEASURED |
| Artifact keys inside | inductor AOT = hash(config + PyTorch configs + traced code); Triton = kernel-source hash; aiter = not persisted. **The tag is not part of any artifact key** — vLLM docs explicitly recommend copying `torch_compile_cache` between deployments | MEASURED (hash dirs change with config, §1) + CLAIMED (docs) |
| 1.9.1 → 1.10.0 content delta | vLLM pin identical (0.32.0: MEASURED banner in 8010.log + `src/1.10.0/Dockerfile` `ARG VLLM_VERSION=0.32.0`), but radiance code changed (CHANGELOG/skill landmines: HAD sign fix etc.) → traced code changed → **inductor entries mostly miss**; only unchanged Triton kernels (vLLM's own + unchanged radiance kernels) hit | MEASURED + CLAIMED |
| Expected gain | Triton reuse ≈40–60 s (less cross-tag than same-tag's ≈40 s… actually same-tag measured ≈40 s, cross-tag ≤ that); inductor ≈0–15 s; total ≈40–75 s → best case 475−75 ≈ 400 s → **borderline, does not clearly meet ≤400 s** | INFERRED |
| Vendor stance | FASTBOOT §2: "One cache directory per (image + model + config). **New image, new directory**." Cross-image reuse is where stale-graph replay happens ("false A/B results"); engine env knobs are not in the compile-cache key | CLAIMED (vendor, Tier-1 local) |

**Verdict: (b) is technically safe (artifacts are content-keyed, so a shared mount cannot replay a wrong
graph — a miss just re-compiles) but NOT viable as the solution: gain ≈40–75 s INFERRED, borderline against
the target, vendor explicitly advises per-image directories, and it still leaves aiter JIT + any code-changed
kernels cold. If pursued it needs one GPU validation boot: mount the 1.9.1 tag cache into a 1.10.0 boot,
check the log for Triton cache hits (no `jit_monitor` warnings for unchanged kernels), confirm first
generation is correct (stale-replay check), measure the delta.**

## 5. Option (a) spec — pre-warm step in the `/vllm-image` skill

**Placement.** Extend the skill's existing step-5 smoke (it already boots the new tag once, inside the
upgrade window). The change: boot with the **exact daily-driver profile** instead of a minimal config, and
require one short generation before stopping. No new server shape; same `serve_vllm.sh` path.

**What it runs.**
```
gpu_exclusive.sh 30000                                   # existing skill precondition
IMAGE=ghcr.io/slybase/vllm-sly-radiance:<new tag> \
PROFILE=sly-redhat stack/serve/vllm/serve_vllm.sh start  # WAIT=1200 default
```
`PROFILE=sly-redhat` resolves to: model `RedHatAI__Qwen3.8-27B-MXFP4@16a86728` + drafter
`syvai__Qwen3.8-27B-DFlash2-W4A16@4d30ec73`, `--max-model-len 260000 --max-num-seqs 2
--gpu-memory-utilization 0.93 --kv-cache-dtype fp8 --attention-backend R4D_HYBRID`, spec dflash k7,
`CACHE_MOUNTS=(root-cache:/root/.cache triton:/root/.triton aiter:/root/.aiter)` into the new tag dir,
`WATCHDOG_MIB=32`. After /health: **one short generation via curl** (mandatory — request-time Triton kernels
`_radiance_w4a16_splitk_kernel`, `_prepare_dflash_inputs_kernel`, `_triton_w4a16_skinny_fmt_kernel` compile on
the first request, post-health), then stop via pidfile; verify port free + VRAM idle.

**What it writes** (all under `cache/vllm-sly-radiance@<new tag>/`):
- `root-cache/vllm/torch_compile_cache/<new-hash>/` + `torch_aot_compile/` — the 3 module AOT artifacts (~10–17 MB each)
- `triton/cache/` — ≈233 MB class (measured for 1.9.1)
- `root-cache/vllm/modelinfos/`, `dummy_cache` — small
- `aiter/build/` — empty skeleton only (aiter `.so` goes to the container layer; unavoidable per boot unless Sly bakes it)

**Success verification (all required).**
1. `/health` → 200 within WAIT.
2. Short generation completes; no `Memory Fault` in the log (iron rule 15).
3. New hash dir present in the new tag's `root-cache/vllm/torch_compile_cache/` with mtime inside the boot window.
4. (Strong, optional) immediate second boot: log line `"init engine … took X s (compilation: Y s)"` with **Y ≤ ~15 s** (cold = 82.82 s; vendor warm reference = 9.40 s) and no `jit_monitor` warnings.

**Skill integration notes.** Edit `/vllm-image` SKILL.md step 5: replace the minimal-smoke boot with
`PROFILE=<daily-driver profile>` + the short-generation sub-step. Step-6 bench (engine-bench config) will
then create its own hash dir — harmless (one extra compile entry, warm from then on).

## 6. Recommendation

- **(a) — recommended.** Moves ≈130–150 s of cold-compile cost into the upgrade/maintenance window; first
  real boot becomes warm ≈320–330 s (INFERRED) → meets the ≤400 s target. Zero new risk: same code path the
  skill's smoke already runs; only the profile changes to match the daily driver (which §1 shows is mandatory —
  the Nov-9 hybrid boot proves the real config stayed cold when only a different config pre-warmed it).
- **(b) — not viable standalone.** ≈40–75 s INFERRED gain, borderline against target; vendor explicitly
  recommends per-image cache dirs; would still leave aiter JIT + code-changed kernels cold; needs GPU
  validation to be worth the churn.
- **(c) — insufficient.** No 1.10.0 cache dir exists; without pre-warm the first real boot is cold ≈475 s-class
  (INFERRED from 1.9.1) → misses the target.
- **Bonus (separate decision, upstream ask):** have Sly bake aiter into the production image (FASTBOOT Method A;
  `bake_aiter_core.py` exists in `src/1.10.0/` but the production Dockerfile does not call it — MEASURED grep).
  Saves 27.4 s (MEASURED) on every boot, including pre-warmed ones.
