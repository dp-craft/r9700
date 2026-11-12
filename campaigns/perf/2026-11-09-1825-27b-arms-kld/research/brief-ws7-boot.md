# WS7 research brief — sly first-boot time (two-round)

**Context.** The sly-radiance stack (SlyBase `vllm-sly-radiance` images, a vLLM + Radiance hybrid for
RDNA4) has a slow FIRST boot of a tag: 400–475 s MEASURED on 1.9.1 (two boots, 2026-10-30); the launcher
timeout is 1200 s. The user's target: first real boot of a promoted tag ≈ **≤ ~400 s**. The campaign
prologue (GPU session) measures the actual per-phase breakdown for 1.10.0 (cold or warm, per pre-check).
This research feeds the session-4 **recommendation note** with three standing options:
(a) **pre-warm step in the image-upgrade skill** — one background boot right after `docker pull` fills
the tag cache during the upgrade window (zero risk, moves cost into maintenance time);
(b) **cache-key change** tag → (vLLM pin, ROCm, arch) — ONLY if research proves the artifacts are
tag-independent (validate, never assume);
(c) **document-and-keep** if (a) already hits the target.

**Repo rules:** provenance tags (MEASURED/CLAIMED/INFERRED), Tier-1 first, English, tables first.
Result files in this same `research/` dir.

## Round 1 — holistic → write `research/ws7-boot-r1.md`

How vLLM / ROCm / HIP deployments handle first-boot kernel compilation:
- vLLM's compilation model: torch.compile + Inductor cache mechanics (`VLLM_CACHE_ROOT`,
  `TORCHINDUCTOR_CACHE_DIR`), what is keyed (torch version, GPU arch, model shape, vLLM version),
  `--enforce-eager` trade-off, V0/V1 engine differences if relevant.
- ROCm specifics: HIPRTC/AOT vs JIT kernel compilation, aiter/ck kernel caches, Triton-on-ROCm cache,
  what first-boot does that warm-boot skips.
- Warmup-boot practices in the wild: CI pre-warming, "compile once in CI" images, prewarm containers,
  Docker layer caching of compile caches; any vLLM-ROCm-specific docs/issues about slow first boot.

Seed URLs: https://docs.vllm.ai/en/latest/serving/optimization.html (compilation/caching),
https://docs.vllm.ai/en/latest/design/v1/architecture.html,
https://github.com/vllm-project/vllm/issues?q=slow+first+boot (issue search),
https://rocm.docs.amd.com/en/docs-6.2/ (ROCm runtime docs — kernel compilation sections),
https://api.semanticscholar.org/graph/v1/paper/search?query=compiler+warmup+inference+latency

## Round 2 — drill down (OUR stack) → write `research/ws7-boot-r2.md`

Local Tier-1 (read, don't guess):
1. **Boot logs with timestamps:** find recent sly 1.9.1 / 1.10.0 boot logs (they live under
   `/home/dev/work/dp-craft/amd/stack/serve/var/servers/*.log` — historical; also `docker logs` is NOT
   needed, the state is on disk). Build a phase breakdown: docker start → engine init → model weight
   load → kernel compile (inductor/aiter/triton lines) → cuda/HIP graph capture → warmup → /health.
   Timestamp deltas per phase. (If 1.10.0 logs don't exist, use 1.9.1 + the 2026-10-30 MEASURED rows.)
2. **Cache dirs:** `/mnt/Lin1/work/vllm/sly-radiance/cache/` — list what exists (which tags: 1.6.0, 1.9.1,
   1.10.0?), contents/sizes of `root-cache` (inductor), `triton`, `aiter` subdirs; what keys the cache
   (file naming inside inductor cache — hash of what?).
3. **sly src docs on the cache:** grep `cache` in `/mnt/Lin1/work/vllm/sly-radiance/src/1.10.0/` (and
   1.9.1 if present) — what the image bakes in vs what is mounted, any env knobs (TORCHINDUCTOR_CACHE_DIR
   etc. already seen in the cmdline records under stack/serve/var/servers/*.cmdline — cross-reference).
4. **Is the cache tag-keyed or (vLLM pin, ROCm, arch)-keyed?** Evidence from the cache-dir naming
   (`vllm-sly-radiance@<TAG>-rocm<ROCm>/...`) vs the artifact contents (do 1.9.1 and 1.10.0 images pin
   different vLLM versions? check the tags' release notes — ghcr.io/slybase or the sly repo if local).

Deliverable in `research/ws7-boot-r2.md`:
- the phase-breakdown table (phase, seconds, what runs, cache hit/miss) with MEASURED/INFERRED tags;
- an answer to: what fraction of first-boot is cache-miss compilation (vs weight load, which is constant)?
- whether (b) cache-key change is viable with the evidence (what would need to be validated on GPU);
- a concrete spec for option (a): what exactly the pre-warm step runs (image, model, flags), what it
  writes into which cache dirs, how it verifies success (e.g. /health + a cached-kernel marker), and how
  the `/vllm-image` skill would invoke it.
