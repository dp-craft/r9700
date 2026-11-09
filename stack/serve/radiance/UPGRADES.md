# Native Radiance image upgrade log

Append-only, newest first. One entry per upgrade attempt — **including rejected and failed ones** — so no
reinvestigation ever starts from scratch. Entry fields: date · from→to · what changed · measured delta (campaign
citation) · verdict · action · rollback (old tags stay local + exact `IMAGE=` to revert).
Driven by the `/radiance-image` skill (`.claude/skills/radiance-image/SKILL.md`); previous images/src checkouts are
never deleted.

## 2026-11-09 · no image change — `serve_radiance.sh` daemon modes + 27B config centralization (TDD)

- **`serve_radiance.sh` now has daemon modes `start|stop|status|logs`** (before: `run|print` only — the skill's
  step-6 `serve_radiance.sh start` did not exist until now). start: `gpu_exclusive.sh` free-VRAM floor → state file
  (pid/cmdline) → boot → `/v1/models` poll (default `WAIT` 900 s; container death = loud abort + cleanup); stop:
  `docker stop -t 60` (SIGTERM, iron rule 15) then `timeout 60 docker rm -f` backstop (a wedged GPU process hangs
  `rm` → loud failure, never silent), then `wait_port_bindable` (serve_lib.sh: LISTEN gone + TIME_WAIT drained);
  status/logs are port-scoped and work with no model. `run`/`print` unchanged (llama-swap compat; print stays
  GPU-free — it is the unit-test seam).
- **The 27B convention now has one home: `stack/serve/27b.conf`** (MAXLEN 262000 / MAXSEQS 2 / SPEC_K 7 /
  HEADROOM_MIB 596, all `${VAR:-…}` so env still wins). Sourced by the iq4r-l-v4 starter + the 5 `claude-rad-*`
  27B launchers (the qwen35 150000 launcher and the Ornith starter keep their own values — the conf is sourced
  ONLY by 27B entry points, never by the engine drivers). `start_qwen38_27b_iq4r-l-v4_rad.sh` is now a thin
  wrapper over the daemon modes; `rad_run` in `amd-private/clients/claude/_lib.sh` is the shared tail of every
  `claude-rad-*` launcher (free_gpu → boot in background → wait_health → run_claude).
- **Compaction fix** (the "compacted at 140k" bug, user flag 2026-11-09; full entry in the vllm log): `run_claude`
  writes per-run settings via `write_claude_settings` — exactly one authoritative knob
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW = window − max-output` (262000−64000 = 198000); any base-file
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is dropped, never inherited.
- **TDD:** `stack/serve/tests/check_27b_consistency.sh` red 24/36 → green 62/62 (GPU-free: bash -n over every
  launcher/starter, conf = single source of truth, print-mode resolution of every 27B starter — iq4r prints
  262000/2, Ornith negative-checked at its own 262144/3 — settings invariants); `tests/test_claude_settings.sh`
  unit-tests the writer against a hostile base file (red → green). Pre-existing `serve_vllm_test.sh` still 31/31.
- Verification: **no-GPU only** (print modes, bash -n, unit tests) — this session rides a live radiance container,
  so the daemon's docker start/stop lifecycle is exercised by the first real boot (the 1.17.0 GPU queue below
  runs through `serve_radiance.sh start`).

## 2026-11-08 · 1.16.0 (Ornith 1.5) / 1.11.0 (qwen3.8-27b + heretic) → 1.17.0 — GO (install done; GPU steps pending in a fresh session)

- 1.17.0 is the newest Codeberg tag (https://codeberg.org/StillDeadcode/radiance). Upstream is release-snapshot style
  (one squashed commit per version; no release-notes page) — the 1.16.0→1.17.0 diff is 211 files / ~24.6k insertions.
- Install: **done** — image `stilldeadcode/radiance:1.17.0` pulled + `src/1.17.0/` cloned (2026-11-08) · 1.16.0 +
  1.11.0 images and src checkouts untouched.
- Model gate: qwen3.8-27b `.rad` "Needs radiance 1.2.3 or newer" → 1.17.0 OK; heretic `.rad` same (≥1.2.3);
  Ornith 1.5 `.rad` booted clean on 1.16.0 → re-verify at smoke.
- **What changed** (investigated from `src/1.17.0`, 211-file squashed diff, 2026-11-08):
  - **`--gpu-memory-mib N`** (new flag, exclusive with headroom): the VRAM claim stops tracking whatever the desktop
    frees → first-class fix for the **live headroom issue** (113 MiB desktop-crash mode); startup warning now suggests
    the exact value. `--gpu-headroom-mib` default still 96; "claims all free VRAM" behavior otherwise unchanged.
  - **IQR quant ladder for Qwen3.8-27B** (`docs/IQR.md`; opt-in via a NEW `.rad` conversion — 15 recipes +
    `vhead.py` vocabulary-weighted lm_head). Measured (source): IQ4R-S-V4 decodes one stream **4 % faster than the
    MXFP4 checkpoint at 5× lower KL**; IQ2R-L-V4 (2.8 bpw) below the AWQ-tuned MXFP4 checkpoint's KL (4.994 bpw,
    0.03824); IQ4R-L-V4 24 % below the official FP8 checkpoint's KL. → quality/speed upside, but a
    model-conversion campaign, not part of the image upgrade.
  - Default behavior change: prefill KV-split now uses live seqused instead of max_ctx → reduction order can change →
    **expect small prefill logit shifts vs 1.16.0** (unmeasured; the main quality delta for existing `.rad`).
  - MXFP4/W4A8 kernel numerics unchanged (determinism-only init fix); sampler edge-case fixes (top_k=1 path,
    n-gram-ban upload bug).
  - New archs (Ling-3.0-flash, Spark X2.6, Gemma-4-12B) + vision/video endpoints + DSpark drafter ops — inert for our models.
  - Flags: nothing renamed/removed (verified 1.16→1.17) — our launchers' `EXTRA_ARGS` safe; `--ngram-placement`
    gains `disk=DIR`.
  - Compat: RAD format v2 unchanged — **existing `.rad` files load as-is, no re-convert**. No gfx1201-specific
    broken note (gfx1201 stays default target).
- **Decision: GO** (user, 2026-11-08) — all three setups (Ornith 1.5 on 1.16.0; qwen3.8-27b + heretic on 1.11.0) → 1.17.0,
  with explicit validation emphasis ("make it sure it will be successful"). Runs in a fresh session (this session serves on
  sly 1.9.1 vllm-8000 — any GPU upgrade kills that container).
- **No-GPU validation (2026-11-08) — PASSED.** Flag-table diff of `core/config.cpp`: **no flag removed** in 1.11→1.17
  (105 → 133 flags) nor 1.16→1.17 (132 → 133); every launcher flag present in 1.17.0 (`--model --host --port --tp
  --max-num-seqs --max-model-len --kv-cache-dtype --gpu-headroom-mib --chat-template-kwargs --reasoning-effort-map
  --max-num-batched-tokens --reasoning-effort`, + new `--gpu-memory-mib`); **no default changed** — only `--gpu-headroom-mib`'s
  help text gained "Not with --gpu-memory-mib" (default stays 96). All three local `.rad` files intact, magic `RAD1\2`
  (RAD format v2): `qwen3.8-27b-mxfp4.rad` 19,377,119,232 B · `swift-1.5-heretic-mxfp4-ra~ce-1.2.3.rad` 18,024,439,808 B ·
  `ornith-1.5-35b-a3b-w4a8.rad` 21,196,345,344 B. Model gates OK (27b-mxfp4 ≥1.2.3; heretic ≥1.2.3; Ornith ≥1.11.0).
  Residual risk = unmeasured prefill logit shift (the live-seqused KV-split change) → caught by smoke generation + bench
  (skill steps 6–7).
- **IQ4R-S-V4 Qwen3.8-27B comparison (user-requested, 2026-11-08) — no local conversion needed.** The V4 ladder is
  **prebuilt on HF**: `StillDeadcode/qwen3.8-27b-iqr-v4` (repo created 2026-11-03; all 15 V4 containers, iq2r-v4 … iq8r-v4
  incl. -l/-s mixes; `qwen3.8-27b-iq4r-s-v4.rad` = 16,512,413,696 B ≈ 15.4 GiB — also `iq3r-s-v4` 13.2 GB, `iq4r-v4` 17.6 GB,
  `iq4r-l-v4` 18.7 GB; 288 GB free on `/mnt/Lin1`). **The card requires radiance newer than 1.16.0** (1.16.0 and older refuse
  these files) → this upgrade is a prerequisite for the comparison. ≤IQ5R fits one 32 GB card with long-context headroom;
  card's one-card serve example: `--max-model-len 200000 --kv-cache-dtype fp8 --max-num-seqs 8` (= `serve_radiance.sh`
  defaults); trained 262k ctx, tested 200k. CLAIMED (source, their TP1 measurement): IQ4R-S-V4 decodes one stream
  **4 % faster than the MXFP4 checkpoint at ~6× lower KL** (0.00643 vs AWQ MXFP4 0.03824; card says "5×"); IQ3R-S-V4 faster
  at every concurrency.
- **Comparison target: `qwen3.8-27b-iq4r-l-v4.rad`** (user, 2026-11-08 — "the better quality version"): 4.793 bpw, KL
  0.00297 (source), 18,700,496,896 B ≈ 17.4 GiB. Source claim: IQ4R-L-V4 sits **24 % below the official FP8 checkpoint's KL**
  (8.766 bpw, 0.00389) at 55 % of its size. Note: the "4 % faster than MXFP4" speed claim is the S-V4 number — L-V4 is
  heavier (4.793 bpw), so its speed vs MXFP4 is **unclaimed → the bench settles it**. Fits one 32 GB card (below IQ5R's
  5.433 bpw).
- **Starter: `stack/serve/radiance/start_qwen38_27b_iq4r-l-v4_rad.sh`** (created 2026-11-08, existing 27b scripts
  untouched): IMAGE pinned 1.17.0 (the .rad refuses ≤1.16.0), 262000 ctx + 2 seqs (same as the fixed MXFP4 twin),
  headroom 596 (live headroom issue), `HIP_FORCE_DEV_KERNARG=0`, served-model alias from settings-redhat.json;
  fetch command with pinned revision `e5f1b3ef…` is in its header (one file, 18.7 GB, not the whole repo).
  **Claude-test path: `amd-private/clients/claude/claude-rad-iq4rlv4.sh`** (same config via `serve_radiance.sh`;
  one command = server up → Claude → server down, the `claude-rad-mxfp4.sh` twin). Kept **both** (SRP, user
  2026-11-08): the starter owns the server lifecycle (start/stop/status/logs, VRAM floor, alias); the launcher
  owns the one-command claude flow — no duplication, neither forks the other. dp-forge root: symlink to the amd
  starter added 2026-11-09 (per the 2026-11-08 symlink batch — all dp-forge starters link into the amd repo; the
  starter post-dated that batch, which is why it was initially missing there).
  **Downloaded + verified 2026-11-08 (MEASURED):** `qwen3.8-27b-iq4r-l-v4.rad` = 18,700,496,896 B (exact match with
  the HF listing), magic `RAD1\2` (RAD format v2), `SOURCE.txt` pinned to revision `e5f1b3ef70741d705a64a28b852acf3fcefcead7`
  → ready for the claude test and the bench (image `1.17.0` already local).
- **Spec-decode A/B (user, 2026-11-09):** the IQR-V4 .rad carries the DFlash2 drafter **merged in** (MEASURED:
  `DFlash2DraftModel` + `dflash.blk.*` tensors in the .rad header; card: "the vision tower and the
  z-lab/Qwen3.8-27B-DFlash2 block-diffusion drafter are merged in"). Radiance auto-enables it
  (`--num-speculative-tokens` default `auto` = the drafter's own 7). **No MTP head in the .rad** (MEASURED: no
  mtp/nextn tensors in the header, no MTP lines in the server log — a bundled MTP head would auto-run with no
  flag) → dflash-vs-mtp is not a testable pair with this file; MTP would need a re-converted .rad. Live state
  (MEASURED, `/stats`): accept ~0.27 (~1.9 of 7 proposed), decode 76.6 t/s @ ~109k ctx (56.5 @ ~141k on
  2026-11-08 — depth decay). A/B launchers (amd-private, differ only in the flag):
  `claude-rad-iq4rlv4-dflash.sh` (`--num-speculative-tokens 7`) vs `claude-rad-iq4rlv4-nospec.sh` (`0`) — a pure
  speed test: card "Drafts are verified, so they change the speed, never the output."
- **Baseline config fix (2026-11-08, user flag):** `amd-private/clients/claude/claude-rad-mxfp4.sh` carried the stale
  card default (200000 ctx / 8 seqs) — the 27B config decision (2026-10-25: 262000 + 2 seqs, as in the sly twins
  `claude-sly-{redhat,heretic}.sh`) had not been copied at the migration. Fixed: `MAXLEN:=262000`, `MAXSEQS:=2`
  (passed through to `serve_radiance.sh`). The A/B baseline is therefore **262000/2**; `claude-rad-heretic.sh`
  (same gap) aligned to 262000/2 as well (user OK 2026-11-08).
- **KLD comparison widened (user, 2026-11-08):** the wanted KLD comparison is not only vs the Quark-AWQ MXFP4 .rad —
  also vs **RedHatAI/Qwen3.8-27B-MXFP4** (the sly-track HF checkpoint this session runs on; a different AWQ
  quantization, llm-compressor GPTQ+AWQ). Clarified: our radiance `.rad` = **Quark-AWQ-MXFP4** (the "AWQ" one);
  neither MXFP4 card publishes a KLD — IQR.md's "AWQ-tuned MXFP4 (4.994 bpw, KL 0.03824)" does not name which
  variant → the measurement will settle it. Available CLAIMED data: RedHat card task accuracy (v2 vs Quark, MI355X:
  GPQA-D 87.4/86.5 · MMLU-Pro 84.4/84.1 · AIME-26 97.8/94.4 · LiveCodeBench 90.3/87.1 · Terminal-Bench 2.1
  55.4/53.2 · SWE-bench 75.8/72.3 · DeepSWE 33.9/22.1 — RedHat leads every row) and vs bf16 (IFEval 99.7 %, GSM8K-Plat
  98.9 %, MATH-500 101.2 %, AIME-25 95.7 %, GPQA-D 97.9 % recovery). Plan: **measured 3-way KLD** — paired
  logprobs-based dNLL/KL vs the official FP8 checkpoint (local: `Qwen__Qwen3.8-27B-FP8@017b9c7a`) as common
  reference: IQ4R-L-V4 (radiance 1.17.0) vs RedHat-MXFP4 (sly) vs Quark-MXFP4 — plus the speed bench vs the
  Quark `.rad` at ≥4 depths + log-log (rule 16), VRAM MEASURED (rule 7).
- Smoke: — · Bench: — · Verdict: — · Action: — (fresh session: smoke → bench vs previous per setup → user manual test + OK → promote)
- Rollback: `IMAGE=stilldeadcode/radiance:1.16.0` (Ornith starter) / `:1.11.0` (`serve_radiance.sh` default) — both kept.
