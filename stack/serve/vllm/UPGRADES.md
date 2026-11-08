# vLLM (Sly) image upgrade log

Append-only, newest first. One entry per upgrade attempt — **including rejected and failed ones** — so no
reinvestigation ever starts from scratch. Entry fields: date · from→to · what changed (release notes) ·
measured delta (campaign citation) · verdict · action · rollback (old tag stays local + exact `IMAGE=` to revert).
Driven by the `/vllm-image` skill (`.claude/skills/vllm-image/SKILL.md`); previous images/caches/src checkouts are
never deleted.

## 2026-11-08 · 1.9.1 → 1.10.0 — IN PROGRESS (user decision pending)

- 1.10.0 released 2026-11-07 (commit `e516549`); **vLLM pin stays 0.32.0** (no engine bump).
- **What changed** (release notes, https://github.com/SlyBase/vllm-sly-radiance/releases/tag/v1.10.0):
  `RADIANCE_EMBED_HOST` embed_tokens host offload (opt-in, default off; **refused under our `RADIANCE_EMBED_INT8=1`** —
  only acts with bf16 embeds); ROCm prune −≈1 GB (zstd image push, 2.23 GB → ~1.6 GB download);
  MXFP4 HAD-signs fp32 fix (vLLM bf16 default dtype corrupted `set_had`); `RADIANCE_LMHEAD_INT4_CODES`
  (opt-in offline GPTQ codes vs load-time RTN); MCB→BCQ rename + multi-codebook loader (opt-in).
  Upstream ABBA (CLAIMED): C1 150.1 vs 149.8 t/s vs 1.9.1 — parity, all other gate checks green.
  Caveat: **released without a green acceptance gate** (red only on a stale 1.7.0 conc-1 baseline).
- **Quality (KLD) — investigated from `src/1.10.0` (2026-11-08).** KLD here = per-position KL divergence
  (nats/token) between the quantized server's token distribution and a reference (bf16/FP8); the project's change
  budget is dKLD ≤ 0.010 nats. **All quality items in 1.10.0 are opt-in (default off), and none applies to our
  RedHat profile automatically** — 1.10.0 runs our setup at the same quality as 1.9.1 (parity), the KLD wins are
  opt-in experiments:
  - `RADIANCE_MXFP4_ACT_SPLIT=1` (fp8 hi/lo activation split): "removes ~3/4 of the fp8 activation KLD"
    (CLAIMED, code comment, their measurement 2026-11-04: bf16 weights 0.0049 → 0.0012 nats/tok). Only the
    **unfused** path splits → needs `RADIANCE_FUSED_NORM_QUANT=0` (our recipe runs `=1`) — i.e. an official-recipe
    deviation, speed unmeasured on our config. **The one applicable lever → A/B candidate after the upgrade.**
  - HAD-signs fp32 fix (vLLM bf16 dtype corrupted `set_had`): matters only with `RADIANCE_MXFP4_HAD=128` + a BCQ
    table — our checkpoint has neither → **no-op for us**.
  - `RADIANCE_LMHEAD_INT4_CODES`: needs an offline GPTQ `.pt` codes file (claims 10–20 % lower quant error, MSE
    context; no KLD figure) — we don't have one.
  - `RADIANCE_EMBED_HOST`: default off **and** refused under our `RADIANCE_EMBED_INT8=1`.
  - Verify quality on our own server: `sly/bench_fidelity.py` + `sly/check_fidelity.py` inside the image
    (top-20 prompt logprobs; paired dNLL 95 % / KL; ~0.01 NLL resolution) + GSM8K-200 as task proxy.
- Install: **done** — image `1.10.0-rocm10.1` pulled + `src/1.10.0/` cloned (2026-11-08) · old 1.9.1 + 1.8.1 images, caches, `src/v1.6.0` untouched.
- **Decision: GO** (user, 2026-11-08). Runs in a fresh session (the upgrade kills the serving container the deciding session runs on): smoke → bench vs 1.9.1 → user manual test + explicit OK → promote.
- Smoke: — · Bench: — (pending, fresh session)
- Verdict: — · Action: — · Rollback: `IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (kept, `KVCACHE_PATCHES=$VLLM_ROOT/src/v1.6.0`)
