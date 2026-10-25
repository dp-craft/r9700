# Plan A: vLLM knowledge base + clean tools (no server-affecting code)

- **Date:** 2026-10-25 · **Goal:** make the vLLM track easy to **find**, **use**, and **trust**: one
  CLAUDE.md routing line (no vLLM rules in CLAUDE.md), a living knowledge base split by task /
  workflow / user-flow / version / settings, a clean finalized tools dir, and visible starter configs.
- **Scope boundary:** this plan is **documentation + a dev-tool tweak** only. It touches **no**
  server-affecting code. The llama-swap code path (`generate.py`, the add-model skill, the
  `claude-llama-swap.sh` launcher) is **Plan B** (`docs/plans/2026-10-25-vllm-llama-swap-path.md`) —
  split out because it needs GPU testing and is riskier.
- **Why:** the vLLM track (Sly radiance / vLLM 0.31 / MXFP4) is mature and producing real results,
  but its knowledge is scattered across **nine dated reports**, a session handoff, and a README that
  mixes layout + plan + deviations. CLAUDE.md's map doesn't even list the track. To answer "which
  image + which flag + which version + what happens", you currently read five dated reports.

## Work items

### 1. CLAUDE.md routing (request 1)
Add one line to the `bench/` map:
```
bench/engine-bench/vllm/   ← vLLM (Sly radiance) tools: serve_vllm.sh + profiles/ + capture_proxy.py
docs/vllm/                 ← vLLM knowledge base (versions matrix / settings / issues / workflows)
```
Keep `HIP_FORCE_DEV_KERNARG=0` where it is (it's a *general* ROCm fixpoint, not vLLM-specific — it
also applies to hipfire). The routing line is the only addition; no vLLM rule is added.

### 2. Knowledge base `docs/vllm/` (requests 2 + 3)
Create the six docs. Each is small, routed from `docs/vllm/README.md`, and **references** dated
reports for provenance (iron rule 1) rather than restating them. `docs/vllm/` is a **living** layer,
distinct from the dated immutable reports; `reindex.py` does not scan it (it globs only
`docs/{analysis,research}`), so it is **not** in `INDEX.md` — deliberate.

- **`README.md`** (descriptor / user flow): one paragraph on what the vLLM track is; a routing table
  (what → which doc); a quickstart ("boot the MXFP4 model", "run a campaign", "add a model to
  llama-swap" → links Plan B, "run Claude" → links Plan B).
- **`versions.md`** (keystone): a matrix. One row per **MEASURED** combination:
  `image tag · vLLM ver · radiance ver · ROCm · model/format · kernel behavior · VRAM · status`
  with a `MEASURED` citation to the report that measured it. **No row without a citation.**
  Seed rows: `vllm-sly-radiance:1.6.0-rocm10.1` MXFP4 + fp8 KV — **flag the open discrepancy**: the
  image reports **vLLM 0.31.0** but Sly PR #162 says 1.6.0 = **0.32.0**; do **not** assert a settled
  version. `vllm-radiance:0.9.3` INT4 + TRITON_ATTN. `stilldeadcode/radiance:1.11.0` native `.rad`.
- **`settings.md`**: one section per flag. Columns: **what-for / how-to-use / side-effect / version
  where it was measured**. Seed: `HIP_FORCE_DEV_KERNARG=0`, `--enforce-eager` (vs FULL_DECODE_ONLY
  CUDA graphs), `--gpu-memory-utilization 0.90` (vs 0.98), fp8 KV, `--attention-backend TRITON_ATTN`,
  DFlash2 (drafter, capture sizes), `RADIANCE_*` knobs, `--shm-size 16g`.
- **`known-issues.md`**: one section per issue: **symptom / status / version seen / workaround /
  report**. Seed: the `radiance_mxfp4_fp8_gemm_atiled` GEMM fault (solved by kernarg — 2026-10-23),
  NVFP4 load-peak OOM (parked), the `.rad`-vs-HF-checkpoint loading distinction (sly loads HF only,
  radiance loads `.rad`).
- **`workflows.md`**: task-based procedures (boot a server / run a campaign / debug a fault). The
  "add a model to llama-swap" and "run Claude via llama-swap" procedures are **Plan B** — this doc
  links to them.
- **`research.md`** *(optional, D2)*: keywords that work (SlyBase, vllm-sly-radiance, stilldeadcode,
  radiance, R4D, gfx1201, MXFP4, W4A8) + what to exclude (aggregator blogs, Puget marketing) + where
  the truth is (the upstream repos, not secondary coverage).

**Update trigger (the anti-rot rule — a living doc without a trigger decays):**
> When a new vLLM campaign lands (via `/benchmark-results`), the write-up step MUST add a row to
> `versions.md` and update the affected `known-issues.md` status. This is a standing rule, not a
> one-time task — it is what keeps the keystone current.

### 3. Clean tools dir (request 4)
In `bench/engine-bench/vllm/`, verified references determine keep/move (not assumption):
- **KEEP** (referenced / stable): `serve_vllm.sh`, `fetch_model.sh`, `profiles/`, `README.md` (tool
  doc), `templates/` (mounted by `radiance/_engine.env` line 23), `overlays/` (used by
  `qwen38-mxfp4-mtp.env`), and the `warm_start.sh` + `capture_proxy.py` + `warmup/` replay set (a
  coherent dev tool, not core serving — keep together).
- **DELETE** `HANDOFF-2026-10-22.md` — a session handoff, superseded by this knowledge base +
  Plan B (not a reference).
- **gitignore** `overlays/__pycache__` (not currently in `.gitignore`).
Definition of "finalized" = stress-tested + documented + in-repo + stable.

### 4. Starter configs with visible full config (request 5)
**Do not build a second, inline-script system** — it would drift from the profiles. Instead:
- Keep `profiles/` as the single mechanism.
- Mark the canonical minimal config (`sly-radiance/qwen38-mxfp4.env`) as the **starter** and add a
  short header comment block explaining each line (what-for / side-effect, cross-ref `settings.md`).
- Enhance `serve_vllm.sh print` to dump the **full resolved config** (all env + docker argv + image
  digest + model repo@rev + drafter). Correction: `print` mode (line 206) currently echoes **only**
  the docker argv; only `start` mode writes `bench/.servers/<port>.cmdline` (line 235). So `print`
  should surface the same resolved config `start` records — visible in one command, **no GPU**.

## Open decisions (this plan)

- **D1** — Keep `HIP_FORCE_DEV_KERNARG=0` in CLAUDE.md as a **general** ROCm rule (recommended —
  it also applies to hipfire) vs. move it fully into `docs/vllm/` for a purer "no vLLM in CLAUDE.md".
- **D2** — `research.md` as a separate doc, or folded into `known-issues.md` / the README.
- **D3** — `docs/vllm/` (knowledge in `docs/`, tools in `bench/`) — recommended, keeps the map clean
  — vs. co-locating knowledge under `bench/engine-bench/vllm/` (one dir).

## Phasing

1. **CLAUDE.md routing line** (10 min) — do first; makes the rest discoverable.
2. **`docs/vllm/`** — `README` + `versions` + `settings` + `known-issues` first (the trust layer),
   then `workflows` + `research`.
3. **Clean tools dir** + **starter profile + `print`** (the use layer).

## Verification (how each item is done)

- **CLAUDE.md** — the line is present; no vLLM rule was added; `reindex.py` still passes (it doesn't
  scan `docs/vllm/`, confirming it's not a report).
- **`docs/vllm/`** — every `versions.md` row has a `MEASURED` citation (and the 0.31/0.32 row is
  flagged as an open discrepancy, not asserted); every `settings.md` flag has what-for / how /
  side-effect; the README routing table links to all five docs; the update-trigger rule is written
  into the README.
- **Clean tools dir** — `bench/engine-bench/vllm/` contains only the referenced set; `HANDOFF` is
  gone; `git status` is clean; `__pycache__` is ignored.
- **Starter** — `serve_vllm.sh print` (no GPU) shows the full resolved config (env + argv + digest +
  model + drafter); the starter profile has a comment header.

**Depends on:** nothing. **Blocks:** Plan B (the llama-swap flow is documented in `docs/vllm/`
`workflows.md`, which Plan B fills in).
