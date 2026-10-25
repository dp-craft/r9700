# Plan A: vLLM knowledge base + clean tools (no server-affecting code)

- **Date:** 2026-10-25 · **Goal:** make the vLLM track easy to **find**, **use**, and **trust**: one
  CLAUDE.md routing line (no vLLM rules in CLAUDE.md), a living knowledge base split by task /
  workflow / version / settings / issue, a clean finalized tools dir, and visible starter configs.
- **Scope boundary:** this plan is **documentation + a dev-tool tweak** only. It touches **no**
  server-affecting code. The llama-swap code path (`generate.py`, the add-model skill, the
  `claude-llama-swap.sh` launcher) is **Plan B** (`docs/plans/2026-10-25-vllm-llama-swap-path.md`) —
  split out because it needs GPU testing and is riskier.
- **Why:** the vLLM track (Sly radiance / vLLM 0.31 / MXFP4) is mature and producing real results,
  but its knowledge is scattered across **seven vLLM-named reports** (2 research + 5 analysis) plus
  two broader RDNA4 reports, a session handoff, and a README that mixes layout + plan + deviations.
  CLAUDE.md's map doesn't even list the track. To answer "which image + which flag + which version +
  what happens", you currently read five dated reports.

## Work items

### 1. CLAUDE.md routing — make it discoverable
Two lines, in two **different** map sections (not one block):
- `bench/` tree (next to `engine-bench/`): `bench/engine-bench/vllm/` ← vLLM (Sly radiance) tools:
  `serve_vllm.sh` + `profiles/` + `capture_proxy.py` + `monitor.sh` (observe).
- `docs/` tree (next to `analysis/` / `research/`): `docs/vllm/` ← vLLM knowledge base (versions /
  settings / known-issues / workflows / sources).
- `HIP_FORCE_DEV_KERNARG=0` is **removed from CLAUDE.md** (it was a version/environment-specific fix,
  not a generic rule — see D1, resolved). It now lives in `docs/vllm/historical.md`. The routing line
  is the only vLLM addition.

### 2. Knowledge base `docs/vllm/` — the trust layer
Create the docs. Each is small, routed from `docs/vllm/README.md`, and **references** dated reports
for provenance (iron rule 1) rather than restating them. `docs/vllm/` is a **living** layer, distinct
from the dated immutable reports; `reindex.py` does not scan it (it globs only
`docs/{analysis,research}`), so it is **not** in `INDEX.md` — deliberate.

**Responsibility boundary (write this into the README):**
- `versions.md` = **which combo works** (one row per MEASURED combo; no flags)
- `settings.md` = **config knobs** (one section per flag: what-for / use / side-effect / version)
- `known-issues.md` = **live failures** (one section per issue: symptom / status / version / workaround / report); links to `settings.md` for the fix
- `workflows.md` = **procedures** (boot / observe / run campaign / debug)
- `sources.md` = **where to look** (external keywords + repos)
- `historical.md` = **graduated fixes** (version/env-specific fixes that were once rules, now historical; links to dated reports for provenance)

A flag that fixes an issue lives in `settings.md`; the fault lives in `known-issues.md` and cross-links. A fix that was *specific* to a version/env (not a generic rule) lives in `historical.md`, not CLAUDE.md.

- **`README.md`** (entry point): one paragraph on what the vLLM track is; an **Engines** section
  (the 3 engines — `radiance/` = native upstream R4D, `sly-radiance/` = Sly MXFP4 base track,
  `sly-official/` = Sly-docs official recipe = **current model under test**); a routing table (what →
  which doc); a quickstart (boot the MXFP4 model / **observe a running server** → `monitor.py` / run a
  campaign / add a model to llama-swap → Plan B / run Claude → Plan B). The **update-trigger rule**
  (the anti-rot rule, below) is written here.
- **`versions.md`** (keystone): a matrix. One row per **MEASURED** combination:
  `engine · image tag · vLLM ver · radiance ver · ROCm · model/format · kernel behavior · VRAM · status`
  with a `MEASURED` citation to the report that measured it. **No row without a citation.**
  **Lead row = `sly-official/heretic-mxfp4` on `1.8.1-rocm10.1`** (the current model under test).
  Seed rows: `sly-radiance:1.6.0` MXFP4 + fp8 KV — **flag the open discrepancy**: the image reports
  **vLLM 0.31.0** but Sly PR #162 says 1.6.0 = **0.32.0**; do **not** assert a settled version.
  `vllm-radiance:0.9.3` INT4 + TRITON_ATTN (dead image). `stilldeadcode/radiance:1.11.0` native `.rad`.
- **`settings.md`**: one section per flag: **what-for / how-to-use / side-effect / version measured**.
  Seed: `--enforce-eager` (vs FULL_DECODE_ONLY CUDA graphs), `--gpu-memory-utilization` (0.90 vs 0.93),
  fp8 KV, `--attention-backend TRITON_ATTN`, DFlash2 (drafter, capture sizes), `RADIANCE_*` knobs,
  `--shm-size 16g`. **`HIP_FORCE_DEV_KERNARG=0` is NOT a current setting** (the `sly-official` recipe
  doesn't set it; the GEMM fault it fixed is historical — see `historical.md`).
- **`known-issues.md`**: one section per issue: **symptom / status / version seen / workaround / report**.
  Seed: the `radiance_mxfp4_fp8_gemm_atiled` GEMM fault (**historical** — graduated to `historical.md`;
  status = resolved/not live), NVFP4 load-peak OOM (parked), the `.rad`-vs-HF-checkpoint loading
  distinction (sly loads HF only, radiance loads `.rad`).
- **`workflows.md`**: task-based procedures (boot a server / **observe a running server** → `monitor.py`
  / run a campaign / debug a fault). The "add a model to llama-swap" and "run Claude via llama-swap"
  procedures are **Plan B** — this doc links to them.
- **`sources.md`** *(optional, D2)*: keywords that work (SlyBase, vllm-sly-radiance, stilldeadcode,
  radiance, R4D, gfx1201, MXFP4, W4A8) + what to exclude (aggregator blogs, Puget marketing) + where
  the truth is (the upstream repos, not secondary coverage).
- **`historical.md`** *(created, D1 resolved)*: version/env-specific fixes that were once rules, now
  historical. Seed entry: `HIP_FORCE_DEV_KERNARG=0` (the GEMM fault, 2026-10-23, Sly 1.6.0/1.5.1 +
  kernel -34/-38 — removed from CLAUDE.md, not needed on the current `sly-official` recipe).

**Update trigger (the anti-rot rule — a living doc without a trigger decays):**
> When a new vLLM campaign lands (via `/benchmark-results`), the write-up step MUST add a row to
> `versions.md` and update the affected `known-issues.md` status. This is a standing rule, not a
> one-time task — it is what keeps the keystone current.

**Tool README migration:** move the existing `bench/engine-bench/vllm/README.md` `## Plan` +
`## Deviations` sections into `docs/vllm/` (Plan → `workflows.md` / `sources.md`; Deviations →
`known-issues.md` / `settings.md`), then trim the tool README to Layout / Models / Usage / Monitoring.

### 3. Clean tools dir — the use layer
In `bench/engine-bench/vllm/`, verified references determine keep/move (not assumption):
- **KEEP** (referenced / stable): `serve_vllm.sh`, `fetch_model.sh`, `profiles/`, `README.md` (tool
  doc — Layout/Models/Usage/Monitoring), `templates/` (mounted by `radiance/_engine.env` line 23),
  `overlays/` (used by `qwen38-mxfp4-mtp.env`), and the `warm_start.sh` + `capture_proxy.py` + `warmup/`
  replay set (a coherent dev tool, not core serving — keep together).
- **OBSERVE** (in sibling dirs, referenced from `docs/vllm/`): `monitor.py` (`bench/lib/`),
  `monitor.sh` (`bench/engine-bench/claude/`).
- **DELETE** `HANDOFF-2026-10-22.md` — a session handoff, superseded by this knowledge base +
  Plan B (not a reference).
- **gitignore** `overlays/__pycache__` (not currently in `.gitignore`).
Definition of "finalized" = stress-tested + documented + in-repo + stable.

### 4. Starter configs + visible full config
**Do not build a second, inline-script system** — it would drift from the profiles. Instead:
- Keep `profiles/` as the single mechanism.
- **Distinguish** the *starter* (minimal config: `sly-radiance/qwen38-mxfp4.env`) from the *current
  model under test* (`sly-official/heretic-mxfp4.env`). Mark the starter as the canonical minimal
  config and add a short header comment block explaining each line (what-for / side-effect, cross-ref
  `settings.md`).
- Enhance `serve_vllm.sh print` to dump the **full resolved config** (all env + docker argv + image
  digest + model repo@rev + drafter). `print` mode (line 206) currently echoes **only** the docker argv;
  only `start` mode writes `bench/.servers/<port>.cmdline` (line 235). So `print` should surface the same
  resolved config `start` records — visible in one command, **no GPU** (docker image inspect + local file reads).

## Open decisions (this plan)

- **D1** — **Resolved:** `HIP_FORCE_DEV_KERNARG=0` is **removed from CLAUDE.md** (it was a
  version/environment-specific fix, not a generic rule). It now lives in `docs/vllm/historical.md`.
  The 2026-10-07 llama.cpp ROCm `-fa on` fault (same `0x6…` shape) is a candidate there (untested).
- **D2** — `sources.md` as a separate doc, or folded into `known-issues.md` / the README.
- **D3** — `docs/vllm/` (knowledge in `docs/`, tools in `bench/`) — recommended, keeps the map clean
  — vs. co-locating knowledge under `bench/engine-bench/vllm/` (one dir).

## Phasing

1. **CLAUDE.md routing lines** (10 min) — do first; makes the rest discoverable.
2. **`docs/vllm/`** — `README` + `versions` + `settings` + `known-issues` first (the trust layer),
   then `workflows` + `sources`.
3. **Clean tools dir** + **starter profile + `print`** (the use layer).

## Verification (how each item is done)

- **CLAUDE.md** — both lines present (one in `docs/`, one in `bench/`); no vLLM rule added; the
  `HIP_FORCE_DEV_KERNARG=0` rule is **removed** (it's historical, in `docs/vllm/historical.md`);
  `reindex.py` still passes (it doesn't scan `docs/vllm/`, confirming it's not a report).
- **`docs/vllm/`** — every `versions.md` row has a `MEASURED` citation (and the 0.31/0.32 row is flagged
  as an open discrepancy, not asserted); the lead row is `sly-official/heretic-mxfp4` on `1.8.1`;
  every `settings.md` flag has what-for / how / side-effect; the README has the Engines section +
  routing table linking all docs + the update-trigger rule; the tool README's Plan/Deviations are
  migrated out; `historical.md` has the kernarg entry with date/issue/solution/environment/why-historical.
- **Clean tools dir** — `bench/engine-bench/vllm/` contains only the referenced set; `HANDOFF` is gone;
  `git status` is clean; `__pycache__` is ignored.
- **Starter** — `serve_vllm.sh print` (no GPU) shows the full resolved config (env + argv + digest +
  model + drafter); the starter profile has a comment header; the current model under test is
  distinguished from the starter.

**Depends on:** nothing. **Blocks:** Plan B (the llama-swap flow is documented in `docs/vllm/`
`workflows.md`, which Plan B fills in).
