---
name: vllm-image
description: Upgrade/rollback the Sly vLLM image (ghcr.io/slybase/vllm-sly-radiance) on the R9700 — first check and show the improvements (release notes + src/<tag>/ source, incl. quality/KLD effects and the exact config needed) and let the user decide continue or skip; on GO install the new tag (previous versions are never removed or replaced), smoke-boot (gpu_exclusive.sh + VRAM watchdog), bench vs previous at ≥4 depths (log-log, iron rule 16), and promote only after bench proof + user manual test + explicit OK. Every outcome (promote/skip/reject/boot-fail/rollback) is logged to stack/serve/vllm/UPGRADES.md. Use whenever the user wants to update, upgrade or try a new Sly image tag, asks whether a newer Sly release is faster or regressed, or wants the track rolled back — even if they never say "skill" or "image".
argument-hint: "[x.y.z] [--profile <engine>/<model>]"
---
<!-- LLM-PRIMARY: install → user gate → smoke → bench-vs-previous → user proof → promote a vllm-sly-radiance image tag. -->

# vllm-image — Sly vLLM image upgrades

## Fixed facts (do not re-investigate)

- Image: `ghcr.io/slybase/vllm-sly-radiance:<tag>-rocm10.1` · releases + notes: https://github.com/SlyBase/vllm-sly-radiance/releases (release tag `v<ver>`)
- Serve: `stack/serve/vllm/serve_vllm.sh` (env beats profile: `IMAGE`, `PROFILE`, `WATCHDOG_MIB`, `WAIT=1200`, `KVCACHE`, `KVCACHE_PATCHES`) · profiles: `stack/serve/vllm/profiles/<engine>/{_engine,<model>}.env` — the `IMAGE=${IMAGE:-…}` line in `_engine.env` **is** the current default (the previous tag)
- Install layout — every piece is version-keyed and **coexists; install never replaces or deletes anything**: image tag · compile cache `/mnt/Lin1/work/vllm/sly-radiance/cache/<image>@<tag>/` (per tag → first boot of a new tag is slow, 1.9.1 = 400–475 s MEASURED) · reference source `src/<tag>/` · models `models/<org>__<repo>@<rev8>/`. **`KVCACHE_PATCHES` defaults to `src/v1.6.0` and must match the image tag** when `KVCACHE=ram` → pass `KVCACHE_PATCHES=$VLLM_ROOT/src/<tag>`
- Quality claims (KLD / quantization fidelity) live in the installed source, not the release page: `src/<tag>/{CHANGELOG.md,MXFP4-NOTES.md,README.md,docs/}` — grep `-il "kld\|divergence\|quality"` there; release notes stay the entry point, the source settles "how + which config + measured how much". KLD = per-position KL divergence (nats/tok) vs a bf16/FP8 reference; project change budget dKLD ≤ 0.010. Verify on our own server: `sly/bench_fidelity.py` + `sly/check_fidelity.py` inside the image (top-20 prompt logprobs; paired dNLL 95 %/KL; ~0.01 NLL resolution) + GSM8K-200 as task proxy. Quality items are usually opt-in — always state whether OUR profile picks them up automatically or needs which exact env vars
- Knowledge base: `docs/guides/vllm/` (`versions.md` keystone = MEASURED rows, `settings.md`, `known-issues.md`) · upgrade log: `stack/serve/vllm/UPGRADES.md` (append-only)
- Launchers (amd-private, thin — they only set `IMAGE=` and call `serve_vllm.sh`): `../amd-private/clients/claude/claude-sly-{redhat,heretic,amd}.sh`. **Manual A/B needs no file edits**: `IMAGE=ghcr.io/slybase/vllm-sly-radiance:<tag>-rocm10.1 ./claude-sly-<x>.sh`
- Boot rules: `stack/gpu/gpu_exclusive.sh` floor before every boot (iron rule 14); desktop shares the card — never raise `GPU_UTIL` without watching VRAM; VRAM only MEASURED (amd-smi/vram_sampler, iron rule 7); poll the log for `Memory Fault` while a request is in flight (iron rule 15)
- Current (2026-11-08): **1.9.1-rocm10.1** (vLLM 0.32.0) = `sly-redhat`/`sly-amd` · **1.8.1** = `sly-official` — re-read the profile lines for truth

## Process

1. **Status.** Previous tag = the `IMAGE=` line in `profiles/<engine>/_engine.env` of the running launcher's profile (default; ask if ambiguous). No tag given → WebFetch the releases page for the newest. Newest == previous → report "up to date", stop.
2. **Investigate improvements (read-only fetch, no GPU — before any decision).** WebFetch the release notes (every tag since the previous one) + fetch the reference source: `git clone --branch v<tag> --depth 1 https://github.com/SlyBase/vllm-sly-radiance /mnt/Lin1/work/vllm/sly-radiance/src/<tag>` (only if `src/<tag>/` is missing; old src checkouts stay). For quality-relevant changes read the `src/<tag>/` docs (grep `kld|divergence|quality` — see Fixed facts; WebFetch the specific GitHub commit only if the source is ambiguous).
3. **Decision gate — show, then WAIT for the user to choose: continue (upgrade) or skip.** Present: (a) old→new table (image tag, vLLM pin, radiance ver); (b) what changed — new env vars, changed defaults, kernel fixes, stated known issues; (c) **user-visible effects** — quality (KLD/quantization fidelity: what changed, the source's measured numbers, whether it applies to OUR profile, the exact env var needed or "on by default"), speed, VRAM, image size; (d) risk (vLLM bump? new default? release-gate status); (e) your recommendation. If the user skips → log the outcome (step 9) with what was shown + the reason, stop. Nothing GPU-touching before the decision.
4. **Install.** `docker pull ghcr.io/slybase/vllm-sly-radiance:<tag>-rocm10.1` (background if large; "Image is up to date" = done; skip if already pulled).
5. **Smoke.** `gpu_exclusive.sh` → `IMAGE=<new> PROFILE=<profile> serve_vllm.sh start` → `/health` (≤1200 s) → check `stack/serve/var/servers/<port>.log`: version line + `Memory Fault`; one short generation via curl; VRAM via amd-smi → `serve_vllm.sh stop` → verify port free + VRAM idle (iron rule 14). Watchdog trip (`WATCHDOG_MIB` default 256; 1.8.0 tripped at 90 MiB free) → read `known-issues.md`, retry `WATCHDOG_MIB=0` only while watching VRAM.
6. **Bench vs previous.** Boot the new tag; `bench/perf/engine-bench/run.sh` (drives `capture_engine.py probe`; `CAMPAIGN_DIR=campaigns/perf/<stamp>-sly<tag>-<slug>` required; prompt fixture from `bench/workloads/build_prompt.py`) at ≥4 depths (e.g. 10k/30k/60k/110k, bounded by profile MAXLEN). Fit log-log: quote per-depth decode/prefill t/s beside exponent + R² (iron rule 16). Baseline = the previous tag's MEASURED row in `versions.md`; if stale, re-measure the previous tag first — a single-point comparison is not a result.
7. **Verdict + user proof (mandatory).** Show the per-depth table + verdict (table below). User manually tests the new tag (`IMAGE=<new> ./claude-sly-<x>.sh` in amd-private). **Promote only on the user's explicit OK after bench proof + manual test — never auto-promote.**
8. **Promote** (after user OK): `profiles/<engine>/_engine.env` `IMAGE=` default → new tag, old tag moved into the rollback comment (existing pattern). `versions.md`: new MEASURED row + citation note (iron rule 1). `known-issues.md`/`settings.md` where the notes warrant. amd-private launcher defaults (cross-repo — ask first). **Never `docker rmi` the previous image or delete its cache/src — only if the user explicitly asks.**
9. **Log — every terminal outcome**, promoted / skipped / rejected / boot-failed / rolled back: append to `stack/serve/vllm/UPGRADES.md` — date · from→to · what changed (notes) · measured delta + campaign citation · verdict · action · rollback (old tag still local + the exact `IMAGE=` to revert).
10. **Present** in this order: summary table; conclusion (2–4 sentences: what moved, by how much, at which depths); recommendation + campaign path; **then the per-depth detail tables** — MUST NOT omit or summarize them away.

## Verdict → action

| Verdict | Meaning | Action |
|---|---|---|
| IMPROVEMENT | ≥1 depth ▲, no ▼ | step 7 (user proof), then promote on OK |
| NEUTRAL | all depths within n=2 noise | step 7 — user still decides (new fixes may justify it) |
| REGRESSION | ≥1 depth ▼ (≥5% at n=1) | default: reject; show ▼ depths + offer n=2 re-run; user decides |
| BOOT_FAIL | watchdog trip / load failure / Memory Fault / device loss | FORBIDDEN to promote; cite `known-issues.md`, fix, retry |
| NO-BASELINE | no recent MEASURED row for the previous tag | measure the previous tag first (or record a fresh baseline row; do not promote) |

## Known landmines (this track)

- 1.8.0: watchdog trip — free VRAM 90 MiB just after `lm_head quantised to int4` (MEASURED 2026-10-24).
- 1.9.1: vLLM 0.32.0, `RADIANCE_VERSION=1.9.1`, boots 400–475 s; RedHat boot once dipped to 71 MiB free → `WATCHDOG_MIB=32` in `claude-sly-redhat.sh`.
- 1.10.0 (2026-11-07, commit e516549): image ≈1 GB smaller (zstd push); vLLM pin stays 0.32.0; `RADIANCE_EMBED_HOST` embed offload (opt-in, default off — **refused under our `RADIANCE_EMBED_INT8=1`**, only acts with bf16 embeds); MXFP4 HAD-signs fp32 fix (vLLM bf16 default corrupted `set_had`); `RADIANCE_LMHEAD_INT4_CODES` opt-in; MCB→BCQ rename + multi-codebook loader (opt-in). Upstream ABBA (CLAIMED): C1 150.1 vs 149.8 t/s vs 1.9.1 — parity. Caveat: released **without a green acceptance gate** (red only on a stale 1.7.0 conc-1 baseline).
- The image reports its own vLLM version at boot — record what it *says* and flag discrepancies (1.6.0 reported 0.31.0, Sly PR #162 says 0.32.0); do not assert from release notes.
