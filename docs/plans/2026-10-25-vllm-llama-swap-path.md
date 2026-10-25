# Plan B: vLLM llama-swap path (running code — needs GPU testing)

- **Date:** 2026-10-25 · **Goal:** make llama-swap a first-class vLLM path: fix the broken vLLM
  rows, add a vLLM path to the `llama-swap-add-model` skill, and add a `claude-llama-swap.sh`
  launcher so you can **start Claude with any llama-swap model and swap within one session** for
  easy manual testing.
- **Scope boundary:** this is the **running-code** half, split from Plan A
  (`docs/plans/2026-10-25-vllm-docs-and-tools.md`) because it touches `generate.py` (a 73KB file
  with a test suite), the skill, and a launcher — all of which need stress testing + GPU boots.
  Plan A is the docs + tools layer; Plan B is the code layer.
- **Depends on:** Plan A (the "add a model to llama-swap" and "run Claude via llama-swap"
  procedures are documented in `docs/vllm/workflows.md`, which Plan B fills in).

## Why the split matters (the gap this plan closes)

Today, to *manually test a model in Claude* you must boot a **direct** server (the
`bench/engine-bench/claude/` launchers) — one model, one boot, no swap. llama-swap's whole point is
multi-model on one port with mid-session swap, which is exactly what "easy manual testing of any
models" needs. But the vLLM rows are **broken** and there's no llama-swap Claude launcher, so the
path doesn't exist.

## Work items

### 1. Fix the broken vLLM rows in `llama-swap/generate.py` (prerequisite)
- **Current state:** `generate.py` hardcodes `VLLM_IMAGE = "stilldeadcode/vllm-radiance:0.9.3"`
  (line 124). That image is **not in the new docker data-root** (`/mnt/Lin1/work/docker`), so the
  existing INT4 rows (`qwen38-27b-int4`) are **broken today** — they don't just "default", they
  fail.
- **Change:** add a **per-row `image` key** (the vLLM README step 6 already flags this as the
  intended fix). The row's `image` overrides the module constant; rows without it fall back to
  `VLLM_IMAGE`.
- **Decide the INT4 disposition** (open, D1): the existing INT4 rows point at a dead image.
  - (a) **Fix** them to a working image (e.g. point at `sly-radiance:1.6.0` if it serves INT4 —
    verify it does), or
  - (b) **Add a new sly-radiance MXFP4 row** (the model under test, `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1`)
    and **mark the INT4 rows broken/deprecated** (comment out, note the dead image).
  - *Recommended:* (b) — the MXFP4 model is the one under test; don't silently fix a row whose
    recipe (TRITON_ATTN INT4) may not match the new image.
- **Backward-compat guard:** the `image` key must **not** break existing rows or `tests/test_vllm.py`
  (run the suite before/after). The `image` key must be additive (optional), not a rewrite of the
  row schema.

### 2. Add a vLLM path to the `llama-swap-add-model` skill
Extend the skill (iron rule 6 — extend the tool, don't fork) with a **vLLM section**:
- A vLLM row needs `vllm_model` (absolute host **directory**), `backends: [vllm]`, **no** `path`,
  **no** `chat_template`, an integer `mtp`, and (after item 1) an `image` key.
- The "add a model to llama-swap" procedure is documented in `docs/vllm/workflows.md` (Plan A) — the
  skill and that doc must agree.

### 3. Add `claude-llama-swap.sh` (the launcher)
- **VERIFY FIRST (D2 — do not build on an unverified assumption):** does Claude Code's `/model`
  actually work against a **custom `ANTHROPIC_BASE_URL`** (the llama-swap router on `:9292`)? Smoke
  test this **before** writing the launcher. If mid-session swap does **not** work, the launcher is
  just a second direct-boot launcher with **no** advantage over the existing `claude/` launchers —
  in that case document the limitation and stop (don't ship a false "easy swap" story).
- **If verified:** a launcher that points `ANTHROPIC_BASE_URL` at `:9292` with model = the swap id,
  reusing the `claude/_lib.sh` settings-rewrite pattern (URL / model name / window / autocompact %).
- **GPU testing:** boot llama-swap with the new vLLM row, confirm the row answers `/v1/models`, then
  run the launcher with a `claude -p` prompt (log in `bench/.servers/`).

## Open decisions

- **D1** — INT4 row disposition: fix to a working image (a) vs. add a new MXFP4 row + deprecate
  INT4 (b, recommended).
- **D2** — Verify the mid-session swap mechanism (D2 smoke test) before building the launcher.
  This gates the whole "easy manual testing" value prop.

## Phasing

1. **Verify the swap mechanism** (D2) — a quick `claude -p` against a running llama-swap; if it
   fails, stop and re-scope (the launcher may not be worth building).
2. **Fix `generate.py`** (per-row `image` key) + resolve the INT4 disposition (D1) + run
   `tests/test_vllm.py`.
3. **Extend the skill** + fill in `docs/vllm/workflows.md` (with Plan A).
4. **Add `claude-llama-swap.sh`** + GPU test it.

## Verification

- **`generate.py`** — `python3 llama-swap/generate.py` succeeds and emits a vLLM row with the
  correct `image`; `llama-swap/tests/test_vllm.py` passes; existing rows unchanged.
- **Swap** — a `claude -p` prompt through `:9292` answers, and (if D2 passes) a mid-session `/model`
  swap to a second row works.
- **Launcher** — `claude-llama-swap.sh` boots llama-swap, confirms the row answers `/v1/models`, and
  answers a `claude -p` prompt (log in `bench/.servers/`).

**Depends on:** Plan A. **Blocks:** nothing.
