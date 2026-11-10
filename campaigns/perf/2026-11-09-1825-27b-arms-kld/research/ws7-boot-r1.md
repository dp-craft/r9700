# WS7 round 1 — holistic: how vLLM / ROCm / HIP deployments handle first-boot kernel compilation

Research for the sly-radiance first-boot question (brief: `brief-ws7-boot.md`). Round 1 = external/Tier-1
synthesis; round 2 (`ws7-boot-r2.md`) drills into our stack. Provenance tags on every number
(MEASURED = our runs, CLAIMED = external source, INFERRED = reasoned, UNREACHABLE = source not fetchable).

## Summary table

| Topic | Finding | Source | Provenance |
|---|---|---|---|
| vLLM compile model | `torch.compile` (Dynamo+Inductor) is **on by default** in the V1 engine; **all compilation finishes before any request is served** ("No requests will trigger new compilations") | vLLM docs `design/torch_compile.md` (main) | CLAIMED |
| Compile cache location | `~/.cache/vllm/torch_compile_cache/<hash>/rank_0_0/…`, enabled by default; `VLLM_DISABLE_COMPILE_CACHE=1` disables; `VLLM_COMPILE_CACHE_SAVE_FORMAT=unpacked` for debug | vLLM docs `design/torch_compile.md` | CLAIMED |
| Cache key | (1) all related configs via `compile_factors` in the config classes, (2) PyTorch configs (`compiler_interface.py`), (3) the model's forward + all traced files — "any code change in the above files will trigger compilation cache miss". **The image tag / deployment identity is not part of the key** | vLLM docs `design/torch_compile.md` | CLAIMED |
| Cache reuse guidance | vLLM explicitly recommends: "you can directly copy the whole `~/.cache/vllm/torch_compile_cache` directory in your deployment scenario to save a great amount of compilation time" | vLLM docs `design/torch_compile.md` | CLAIMED |
| Warm-boot behavior | Inductor compilation "is completely bypassed, and we will load from disk" (log: `Directly load the 0-th graph … from inductor via handle`) | vLLM docs `design/torch_compile.md` | CLAIMED |
| Triton cache | An explicit `TRITON_CACHE_DIR` is preserved; "the first compilation populates it and later matching specializations reuse it" | vLLM docs `design/torch_compile.md` | CLAIMED |
| Autotune | Cached but **off by default**; on only for explicit `compile_sizes` (tuned configs replayed on later boots) | vLLM docs `design/torch_compile.md` | CLAIMED |
| `--enforce-eager` trade-off | Skips compile+graph entirely → faster, more predictable boot but no graph speed; in the wild: graph-capture startup hang "reportedly fixed by eager mode" (vLLM #52682). We used `--enforce-eager` for the 1.6.0 smoke (cmdline 10013, 2026-10-23) | vLLM issue #52682; our `10013.cmdline` | CLAIMED / MEASURED |
| ROCm: aiter JIT | aiter lazily **hipcc-JIT-builds** `module_aiter_core.so` on first use; the JIT output path is **not** governed by `AITER_ROOT_DIR` — it builds into `site-packages/aiter/jit` (container layer), so a mounted aiter cache only receives an empty `build/` skeleton and the cost repeats on every container recreate. Fix: bake the `.so` into the image (build-time, hipcc needs no GPU) or copy it out into a one-layer child image | Sly `FASTBOOT.md` (1.10.0 src, §1) | CLAIMED (vendor, Tier-1 local) |
| ROCm: Triton-on-RDNA first boot | vLLM issue **#52663** (RDNA3 gfx1100, W7900D, vLLM 0.27.1+rocm723, FP8): first launch took **1474 s** — almost all Triton JIT of W8A8 FP8 GEMM kernels (no tuned config shipped for the RDNA device); warm-cache init ≈ **49 s**, later starts ≈ 2 min; the **first request can hide ~43 min** of additional JIT | vLLM issue #52663 | CLAIMED |
| What first boot does that warm skips | (1) inductor/AOT compile of model graphs, (2) Triton kernel JIT (autotune), (3) aiter module build, (4) CUDA/HIP graph capture (always, not cached), (5) profiling/warmup forward runs (execution always; JIT inside is cached) | vLLM docs + Sly FASTBOOT §2/§4 + our boots | CLAIMED / MEASURED (see r2) |
| Warmup practice: cache copy | Copy `torch_compile_cache` (+ `TRITON_CACHE_DIR`) across deployments/machines to pre-warm | vLLM docs `design/torch_compile.md` | CLAIMED |
| Warmup practice: compile-once image | Bake compiled artifacts into image layers at build time (Sly FASTBOOT Method A: `bake_aiter_core.py` at `docker build`; Method B: `docker cp` the JIT tree into a child image). Sly's ggz14 image uses Method A; the **production 1.10.0 Dockerfile does not bake aiter** (only `Dockerfile.ggz14` does) | Sly `FASTBOOT.md` + 1.10.0 `Dockerfile` grep | CLAIMED / MEASURED (local grep) |
| Warmup practice: persistent cache volume | "One cache directory per (image + model + config). New image, new directory." Reuse across a changed image/config **replays the old graph** (key factors like engine env knobs are not in the key) → "We have produced false A/B results exactly this way" | Sly `FASTBOOT.md` §2 | CLAIMED (vendor, Tier-1 local) |
| Warmup practice: health timeout | Cold boot is legitimately several minutes; an orchestrator health timeout shorter than the cold boot **kills the container mid-load with no crash/log**. Give generous headroom (1800 s in FASTBOOT §3). vLLM #58544: Helm charts request tunable startup probes; #52663: default 600 s readiness aborted a 1474 s first init | Sly FASTBOOT §3; vLLM issues #58544, #52663 | CLAIMED |
| Academic seeds | Semantic Scholar seed URL: **UNREACHABLE** (HTTP 429 rate-limit, retried ×2). arXiv seed: reachable; the broadened query hit one directly relevant paper (see source 7). ROCm docs seed (`rocm.docs.amd.com/en/docs-6.2/`): **UNREACHABLE** (404; current docs root exposes no kernel-compilation page). vLLM blog link from docs: 301 → 404 | — | UNREACHABLE |

## Details

### 1. vLLM's compilation model (V1)

- V1 is the engine in current vLLM (our own boots log `Initializing a V1 LLM engine (v0.32.0)` — MEASURED,
  `stack/serve/var/servers/8010.log:167`). In V1, `torch.compile` is enabled by default and is "a critical
  part of the framework" (CLAIMED, vLLM docs `design/torch_compile.md`).
- Compilation flow per boot: Dynamo traces the model `forward` (and everything it inlines — vLLM ops,
  attention wrappers, attention is hidden behind `torch.ops.vllm.unified_attention_with_output`), the graph is
  split at attention ops, each piece is compiled by **Inductor** to cached artifacts
  (`torch_compile_cache/<hash>/rank_0_0/{computation_graph.py,transformed_code.py,inductor_cache/…,model}`
  — the AOT binary artifact path matches what we observe on disk in our tag caches).
- **Keying**: the cache directory hash covers (configs via `compile_factors`, PyTorch/compiler configs, and
  all traced source files). Consequence 1: a config change (max-model-len, max-num-seqs, spec config, KV
  dtype, TP…) re-keys the directory → cold compile again for that config. Consequence 2: **a code change
  (vLLM bump, radiance patch) re-keys it** — so an image bump is a compile miss by construction for changed
  code paths, even if the vLLM pin is unchanged.
- **Cross-deployment reuse is officially supported**: copy `torch_compile_cache` (and `TRITON_CACHE_DIR` if
  set) to a new deployment to "save a great amount of compilation time". This is the upstream basis for the
  cache-key question in option (b): vLLM's own key is content-derived (config+torch+code), not tag-derived.
- `TRITON_CACHE_DIR` "can start empty: the first compilation populates it and later matching specializations
  reuse it" — Triton artifacts are keyed by kernel source hash, i.e. tag-agnostic as long as the kernel code
  is unchanged.
- Autotuning (per-shape kernel selection) is cached but disabled by default; vLLM recommends explicit
  `compile_sizes` for max performance, with the first run slow and later runs bypassing tuning.
- `--enforce-eager` skips all of the above: no torch.compile, no graphs. Trade-off in the wild: vLLM #52682
  (startup hang during graph capture on Ampere; "eager mode reportedly fixes it") — i.e. eager is the
  escape valve when compilation/graph-capture itself is the failure mode, at the cost of runtime speed. Our
  own 1.6.0 smoke used `--enforce-eager` (MEASURED: `10013.cmdline`, 2026-10-23), but the daily drivers run
  compiled mode with `cudagraph_mode FULL_DECODE_ONLY`.
- vLLM guarantees all compilation happens **before serving**: "No requests will trigger new compilations."
  In practice that guarantee is about inductor graphs; Triton kernels outside the compiled regions can still
  JIT at first-request time (see below — observed on our stack).
- Independent academic characterization (arXiv **2606.07362**, "Breaking the Ice: Analyzing Cold Start Latency
  in vLLM", 2026-06-05): first systematic study of vLLM startup (V1 API + torch.compile era); breaks startup
  into **six foundational steps**; startup is "predominantly CPU-bound"; each step shows consistent,
  interpretable scaling with model-/system-level parameters; the authors release an analytical model that
  predicts startup latency per hardware config (CLAIMED — their per-step numbers not verified against our rig).

### 2. ROCm / HIP specifics

- **aiter JIT (the one cost that cannot be cached into a mount).** With aiter enabled, `module_aiter_core.so`
  is built by `hipcc` on first use, into `site-packages/aiter/jit/` — the container's writable layer. Sly's
  FASTBOOT.md documents (with a live-container proof) that `AITER_ROOT_DIR` does not govern this path: a
  mounted aiter cache directory only ever receives an empty `build/` skeleton, and "the ~7 minutes of hipcc
  is paid again on the next recreate, forever" (their TP=2 rig; our single-GPU rig pays **27.4 s** —
  MEASURED, see r2). The sanctioned fixes are image-layer fixes: bake at build time (`bake_aiter_core.py`,
  GPU_ARCHS/CU_NUM set by hand, GPU not needed) or copy the JIT tree out of one slow boot into a one-layer
  child image. **The production 1.10.0 Dockerfile does not bake aiter** (verified by grep: only
  `Dockerfile.ggz14` calls `bake_aiter_core.py`) → a 1.10.0 first boot still pays the aiter JIT.
- **Triton on RDNA is the biggest first-boot swing factor in public reports.** vLLM issue #52663 (RDNA3,
  gfx1100, FP8): first launch **1474 s** vs warm ≈ **49 s** — an ~30× ratio, caused purely by Triton JIT of
  FP8 GEMM kernels because the wheel shipped no tuned config for the consumer-RDNA device name; a second
  tester found 0 tuned configs for `AMD_Radeon_*` vs 28 for `AMD_Instinct_MI300X`. Crucially: "the initial
  request can hide another ~43 min of JIT work" — JIT continues at request time even after "healthy"
  (same phenomenon we see as `jit_monitor` warnings in our own boot log, r2).
- **HIPRTC/AOT vs JIT on our stack.** The stack is JIT-first: aiter via `hipcc` (MEASURED 27.4 s), Triton
  per-kernel JIT (MEASURED 55.98 s warmup phase + JIT inside profiling runs), inductor per-graph AOT
  (MEASURED 82.82 s). There is no AOT pre-build in the production image for any of the three, except the
  unused `bake_aiter_core.py` path.
- What a warm boot skips (union of the sources above): inductor/AOT graph compilation, Triton kernel JIT
  (cache-hit replay), aiter module build **only if baked into the image** (not in production 1.10.0), and
  the autotune pass. What a warm boot still does: weight load, mm warmup forward, CUDA/HIP graph capture
  (never cached), profiling forward execution (execution part), docker/entrypoint overhead.

### 3. Warmup-boot practices in the wild

| Practice | What it is | Where seen |
|---|---|---|
| Copy compile cache across deployments | Ship/reuse `torch_compile_cache` + `TRITON_CACHE_DIR` so the first real boot is warm | vLLM docs (explicit recommendation) |
| Compile-once image (bake into layer) | Build artifacts (aiter `.so`) at `docker build` time; hipcc needs no GPU | Sly FASTBOOT Method A (ggz14 image does this) |
| Copy-out overlay image | One slow boot, `docker cp` the JIT tree, build a one-layer child image; rebuild whenever the base changes (stale `.so` = crash, not slow boot) | Sly FASTBOOT Method B |
| Persistent per-(image, model, config) cache volume | One dir per key; never reuse across image/config change — stale-graph replay produces "false A/B results" | Sly FASTBOOT §2 |
| Health-timeout headroom | Set start timeout > worst cold boot, or the container is killed mid-compile with no log | Sly FASTBOOT §3; vLLM #58544 (Helm probes), #52663 (600 s default vs 1474 s first init) |
| Prewarm boot during maintenance window | A background boot right after image install fills the tag cache before users care (option (a) in our brief) | General practice; our launcher already documents "first boot compiles, up to 1200 s" (`serve_vllm.sh` line 389, MEASURED in-repo) |

### 4. Implications for the WS7 options (bridge to round 2)

1. First-boot cost splits into **three stores with different keying/persistence**:
   inductor/AOT (content-keyed: config+torch+code; copyable), Triton (kernel-hash-keyed; copyable), aiter
   (container-layer only; **not** copyable via our mounts — must be pre-warmed by a boot or baked into the
   image). Option (a) covers all three; option (b) can only ever cover the first two, and only what hash-matches.
2. vLLM's own keying makes cross-tag cache sharing *safe* (content hashes, not tag) but *limited*: changed
   radiance code re-keys the inductor entries; only unchanged kernels (same vLLM pin) hit across tags.
   Whether 1.9.1→1.10.0 (same vLLM pin 0.32.0) leaves enough of the kernel set unchanged to matter is a
   round-2 question.
3. The public ROCm data point (#52663: 1474 s → 49 s) and Sly's own rig numbers (cold 381 s → warm 251 s)
   bracket the expected warm-boot saving on our machine: order of 100+ s, i.e. a pre-warmed boot should land
   well under our 400 s target **if** the pre-warm uses the same (model, config) as the first real boot —
   config is part of the key, so pre-warming with a *minimal* smoke config does not pre-warm the
   daily-driver config. This is the central design constraint for the option-(a) spec in round 2.

## Source list

| # | Source | Status |
|---|---|---|
| 1 | vLLM docs, `docs/design/torch_compile.md` (main branch, raw GitHub) | fetched, CLAIMED (Tier-1 upstream docs) |
| 2 | vLLM issue #52663 — RDNA3 FP8 first launch >600 s (Triton JIT) | fetched, CLAIMED (Tier-1 upstream issue) |
| 3 | vLLM issues #52682 (graph-capture hang; eager fixes), #58544 (tunable startup probes), #54383 (first-boot KV), #54237 (host-RAM at start) | fetched via search page, CLAIMED |
| 4 | Sly `src/1.10.0/FASTBOOT.md` (local checkout) | local, CLAIMED (vendor doc, measured on 2×R9700 rig) |
| 5 | Sly `src/1.10.0/Dockerfile`, `Dockerfile.ggz14`, `bake_aiter_core.py` (local) | local grep, MEASURED (code state) |
| 6 | Semantic Scholar seed (`api.semanticscholar.org/…/compiler+warmup…`) | **UNREACHABLE** — HTTP 429 rate-limit (retried ×2, ~5 s apart) |
| 7 | arXiv 2606.07362 "Breaking the Ice: Analyzing Cold Start Latency in vLLM" (2026-06-05; six-step startup decomposition, CPU-bound, startup-latency prediction model; code: github.com/upb-cn/…) | fetched, CLAIMED (academic) |
| 8 | ROCm docs seed `rocm.docs.amd.com/en/docs-6.2/` | **UNREACHABLE** — HTTP 404; current docs root exposes no kernel-compilation page |
| 9 | vLLM blog `blog.vllm.ai/2025-08-20/torch-compile` | **UNREACHABLE** — 301 → 404 |
