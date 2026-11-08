# vLLM track — knowledge base

**What this is:** the living knowledge base for the vLLM track on the R9700 (gfx1201, RDNA4, 32 GB) —
the **Sly radiance** family of docker images serving **MXFP4** (W4A8: 4-bit weights, fp8 activations
on RDNA4's fp8 WMMA) and other quantizations, with **DFlash2** speculative decoding. It answers
"which image + which flag + which version + what happens" in one place, instead of making you read
five dated reports. This is a **living** layer: it is kept current by the update-trigger rule below,
and it **references** the dated immutable reports in `docs/{analysis,research}` and `campaigns/` for
provenance (iron rule 1) rather than restating them. `docs/guides/vllm/` is **not** in `docs/INDEX.md`
(`reindex.py` scans only `docs/findings/` and `docs/research/`) — deliberate.

## Engines

One engine per `stack/serve/vllm/profiles/<engine>/` folder, plus native Radiance, which has no profile folder (last row):

| Engine | Image | What it is |
|---|---|---|
| `radiance/` | `stilldeadcode/vllm-radiance:0.9.3` (vLLM 0.27.1 + libr4d kernels) | **native upstream R4D** — the "tuned" build behind Puget's R9700 numbers; runs the INT4 checkpoint. Dead image (not migrated to the new data-root). |
| `sly-radiance/` | `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` (vLLM 0.31.0) | **Sly MXFP4 base track** — our MXFP4 + fp8-KV + DFlash2 campaign track (host-driven deviations: eager, Cactus off, drafter arms). |
| `sly-official/` | `ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1` | **Sly-docs official recipe** — the **current model under test** (Swift-1.5 heretic GPTQ-MXFP4 + DFlash2), flag-for-flag from the Sly docs. |
| `sly-redhat/` | `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (vLLM 0.32.0) since 2026-10-30; was 1.8.1 (rollback: profile comment) | **RedHatAI/Qwen3.8-27B-MXFP4 + DFlash2** on sly-official's engine layer (sources `sly-official/_engine.env`, overrides only the image). |
| `sly-amd/` | `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (vLLM 0.32.0) | **amd/Qwen3.5-35B-A3B-MXFP4 + z-lab DFlash**. The profile defaults to the slow `EMULATION` MoE backend; the archived starters in `stack/serve/vllm/retired/` override it with `triton_unfused`: `qwen35_sly_dflash.sh`, and `ornith_sly_dflash.sh`, which reuses the profile for Ornith 1.5 MXFP4 + official DFlash (checkpoints deleted). See `known-issues.md`. |
| native Radiance (`stack/serve/radiance/ornith_rad_mtp.sh`, repo root) | `stilldeadcode/radiance:1.16.0` | **keptn/ornith-1.5-35b-a3b-w4a8 `.rad`** with the creator's single-card flags. A separate engine with its own CLI, so `serve_vllm.sh` does not drive it. Read the headroom issue in `known-issues.md` before starting it. |

## Routing table

| Question | Doc |
|---|---|
| Which image + version + model combo works? | `versions.md` (keystone matrix) |
| What does a flag / env knob do? | `settings.md` |
| What's a live failure / fault / OOM? | `known-issues.md` |
| How do I boot / observe / run / debug? | `workflows.md` |
| Upgrade / try a new Sly image tag? | **`/vllm-image`** skill (`.claude/skills/vllm-image/`: check improvements → your call (continue/skip) → install → smoke → bench vs previous → your call → promote) |
| Upgrade the native Radiance image? | **`/radiance-image`** skill (`.claude/skills/radiance-image/`, same shape) |
| What changed in past image upgrades? | `stack/serve/vllm/UPGRADES.md` (append-only log) · `stack/serve/radiance/UPGRADES.md` |
| Where to look externally (keywords + repos)? | `sources.md` |
| A fix that was once a rule, now historical? | `historical.md` |

## Quickstart

- **Boot the MXFP4 model** (starter, no drafter): `PROFILE=sly-radiance/qwen38-mxfp4 PORT=8000 stack/serve/vllm/serve_vllm.sh` — see `workflows.md` (boot).
- **Boot Ornith 1.5 on native Radiance**: `./ornith_rad_mtp.sh start` (close Chrome if VRAM gets tight; extra headroom is recommended only) — see `workflows.md` (boot) and `known-issues.md` (headroom).
- **Observe a running server** (no GPU, read-only): `python3 stack/gpu/monitor.py --port 8000` — see `workflows.md` (observe).
- **Run a campaign**: `stack/serve/vllm/serve_vllm.sh` + `bench/core/capture_engine.py` — see `workflows.md` (run a campaign).
- **Add a model to llama-swap** → **Plan B** (`notes/plans/2026-10-25-vllm-llama-swap-path.md`), not this track.
- **Run Claude via llama-swap** → **Plan B** (same), not this track.

## Update trigger (the anti-rot rule)

> When a new vLLM campaign lands (via `/benchmark-results`), the write-up step **MUST** add a row to
> `versions.md` and update the affected `known-issues.md` status. This is a standing rule, not a
> one-time task — it is what keeps the keystone current. A living doc without a trigger decays.

## Responsibility boundary

- `versions.md` = **which combo works** (one row per MEASURED combo; no flags)
- `settings.md` = **config knobs** (one section per flag: what-for / use / side-effect / version)
- `known-issues.md` = **live failures** (one section per issue: symptom / status / version / workaround / report); links to `settings.md` for the fix
- `workflows.md` = **procedures** (boot / observe / run campaign / debug)
- `sources.md` = **where to look** (external keywords + repos)
- `historical.md` = **graduated fixes** (version/env-specific fixes that were once rules, now historical)

A flag that fixes an issue lives in `settings.md`; the fault lives in `known-issues.md` and cross-links.
A fix that was *specific* to a version/env (not a generic rule) lives in `historical.md`, not CLAUDE.md.
