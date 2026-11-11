# vLLM (Sly) image upgrade log

Append-only, newest first. One entry per upgrade attempt — **including rejected and failed ones** — so no
reinvestigation ever starts from scratch. Entry fields: date · from→to · what changed (release notes) ·
measured delta (campaign citation) · verdict · action · rollback (old tag stays local + exact `IMAGE=` to revert).
Driven by the `/vllm-image` skill (`.claude/skills/vllm-image/SKILL.md`); previous images/caches/src checkouts are
never deleted.

## 2026-11-10 · no image change — 27B MAXLEN 262000 → 260000 (`27b.conf` + heretic profile, commit `6f9d1a4`)

- **MAXLEN 262000 → 260000** in `stack/serve/27b.conf` and `sly-official/heretic-mxfp4.env` (both changed by
  `6f9d1a4`; DC1 re-tune 2026-11-09). The conf accepts the lower window without re-testing, because 262000 fit
  (MEASURED 2026-10-30, `campaigns/perf/2026-10-30-1745-sly-1.9.1-smoke/results/`, MAXSEQS 1, util 0.93). MAXSEQS 2
  (the `e217e6c` fix), SPEC_K 7 and HEADROOM_MIB 596 are unchanged.
- **Where it is read:** `claude-sly-redhat.sh` and `claude-sly-heretic.sh` take MAXLEN from `27b.conf`. The vLLM
  starters (`start_redhat_27b.sh`, `start_heretic_27b.sh`) take `CLAUDE_CODE_MAX_CONTEXT_TOKENS` from the settings
  file instead, which the conf calls authoritative on this track.
- **Supersedes** the 2026-11-09 heretic-profile bullet below (`MAXLEN 260000→262000`, "drift fixed"): `6f9d1a4`
  reverses that fix. The bullet stays as history.
- **Rollback:** `MAXLEN` back to 262000 in `27b.conf` and in the heretic profile; for the starters, also
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` in the settings file. The 260000 asserts in
  `stack/serve/tests/check_27b_consistency.sh` then need updating too.

## 2026-11-09 · no image change — 27B config centralization + compaction fix (TDD)

- **The 27B convention now has one home: `stack/serve/27b.conf`** (MAXLEN 262000 / MAXSEQS 2 / SPEC_K 7 /
  HEADROOM_MIB 596, all `${VAR:-…}`). Both 27B starters source it — **behavior change: `start_redhat_27b.sh` /
  `start_heretic_27b.sh` now pass MAXSEQS 2, was the stale 1** (aligns with the 2026-10-25 user decision and the
  sly launchers' measured-working 2). `sly-official/heretic-mxfp4.env` MAXLEN 260000→262000 (drift fixed; the
  per-model default now matches the conf). The starters also gained a `print` pass-through and a served-name
  contract check (`start` refuses if the profile's `--served-model-name` ≠ the settings file's ANTHROPIC_MODEL).
- **Compaction fix (the "compacted at 140k" bug, user flag 2026-11-09):** the per-run settings writer
  (`amd-private/clients/claude/_lib.sh` `write_claude_settings`, used by every launcher's `run_claude`) now emits
  exactly ONE authoritative knob: `CLAUDE_CODE_AUTO_COMPACT_WINDOW = window − max-output` (262000−64000 = 198000,
  ≈ the "200k would be optimal" the user stated), and any base-file `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is dropped,
  never inherited. Before: three conflicting knobs (base absolute 220000 + base PCT 95/100 + per-run PCT) made the
  effective window non-deterministic, and 220000 > window−output could overflow on a full-length reply (HTTP 400).
  Base files fixed: `~/.config/claude/local_vllm_direct/settings.json` (heretic base — model ×4
  `qwen38-27b-redhat-mxfp4-dflash` → `swift-1.5`, the heretic profile's served name; 220000→198000, PCT 95 dropped)
  and `settings-redhat.json` (220000→198000, PCT 100 dropped; model names were already correct).
- **`serve_vllm.sh` stop** now uses the shared `wait_port_bindable` from `stack/serve/serve_lib.sh` (settings-file
  reader + the LISTEN/TIME_WAIT port wait); behavior unchanged, the two hand-rolled loops replaced — same helper
  the radiance daemon's stop uses.
- **TDD:** `stack/serve/tests/check_27b_consistency.sh` red 24/36 → green 62/62 (GPU-free: bash -n over every
  launcher/starter, conf = single source of truth, print-mode resolution of every 27B starter, settings
  invariants); `tests/test_claude_settings.sh` unit-tests the writer against a hostile base file (red → green).
  Pre-existing `serve_vllm_test.sh` still 31/31.
- Verification: **no-GPU only** (print modes, bash -n, unit tests) — the docker lifecycle rides the 1.10.0 queue
  below; the per-run settings writer is unit-tested, the base files hand-verified.

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
