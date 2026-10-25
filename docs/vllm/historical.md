# vLLM track — historical fixes (version/environment-specific)

**What this is:** a register of **version- or environment-specific** fixes and workarounds that were once
carried as *generic rules* (e.g. in CLAUDE.md) but are **historical** — they applied to a specific
image/ROCm/kernel/driver combination, and are not needed on the current stack. CLAUDE.md holds only
**generic** rules (hardware fixpoints, tooling contracts); a fix that only exists because of a
specific version belongs here, not there.

**Why the split:** a "set this env var" rule that is actually tied to one driver + one image rotates
silently — the next image/driver makes it a no-op, and it reads as if it were still load-bearing.
This doc records *why* it was needed and *when* it stopped being needed, so the history is kept
without polluting the generic rules.

**Format** — one entry per fix:
- **Date** · **Issue / goal** · **Solution** · **Environment** (tools + versions) · **Why it's historical** (short).

---

## `HIP_FORCE_DEV_KERNARG=0` — ROCm kernel-argument fault (historical)

- **Date:** 2026-10-22 evening → 2026-10-23 (fix verified); superseded on the current `sly-official`
  recipe by 2026-10-25 (the recipe does not set it).
- **Issue / goal:** random `HSA_STATUS_ERROR_MEMORY_FAULT` ("page not present"), then a 5–16 min hang
  and a dead engine. Hit the first request on ~12 of ~21 boots of Sly radiance 1.5.1/1.6.0 MXFP4 +
  DFlash, at any ctx, with or without llama-swap. Goal: find the root cause and a fix that kept full
  speed.
- **Root cause (INFERRED, strong):** a **corrupted kernel-argument pointer** — the fault address was a
  valid buffer pointer with **bit 44 cleared** (all fault addresses `0x6…`, all buffers `0x7…`). By
  default HIP places kernel arguments in **device memory that the CPU writes over the PCIe BAR**;
  moving them to **host memory** stops the faults. Ruled out (MEASURED): llama-swap, ctx size, Sly
  version, the A-tiled path, an M-tail over-read/over-write, prefill-only kernels, and the amdgpu
  driver (7.0.0-38 and 7.0.0-34 both faulted).
- **Solution:** `HIP_FORCE_DEV_KERNARG=0` in the container env (kernargs in host memory). Was the
  default in `bench/engine-bench/vllm/profiles/{sly-radiance,radiance}/_engine.env` and in CLAUDE.md
  as a generic "every ROCm engine" rule.
- **Evidence:** with the fix, 3/3 boots × 4 Claude turns, 0 faults, at full speed (decode med 111–150
  tok/s, prefill med 2.4–3.0k tok/s, DFlash acceptance 4.8–6.2).
- **Environment (tools + versions):** R9700 gfx1201 32 GB; kernel 7.0.0-34 (fix runs; -38 also
  faulted without the fix); host ROCm 10.1.0 (HIP 7.16, clang 24); image
  `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` (vLLM 0.31.0, AITER 0.1.23, transformers 5.17.0,
  torch 2.13.0+rocm10.1.0, triton 3.8.0); model `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` + DFlash2 drafter.
- **Why it's historical:** the fault is tied to a **specific driver + image window** (7.0.0-34/38
  amdgpu + Sly 1.6.0/1.5.1), and the **current `sly-official` recipe does not set it** — the GEMM
  fault is not a live issue on the current stack. It is a *diagnostic* for a bit-44 kernarg-pointer
  corruption, not a general rule. If a future image/driver reintroduces the `0x6…` fault address
  shape, this is the fix to reach for.
- **Provenance:** `docs/analysis/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md` (MEASURED
  rows in `docs/plans/2026-10-22-mxfp4-qwen38-options/FASTPATH.md`, `results.tsv`).

---

## Related (not yet graduated — same bug family, untested)

- **2026-10-07 llama.cpp ROCm `-fa on` fault** — the *same* `0x6…` address shape, seen on
  llama.cpp ROCm (not vLLM). **INFERRED** to be the same kernarg bug; **untested** (the
  `HIP_FORCE_DEV_KERNARG=0` fix has not been verified on the llama.cpp path). Keep here as a
  candidate; graduate to a full entry (or drop) once a future llama.cpp ROCm boot confirms/rejects it.

---

## How to add an entry

1. A fix is a **candidate** here the moment it is *specific* to a version/env (a driver, an image
   tag, a kernel, a container's userspace) rather than a property of the hardware or the tools.
2. Record the date, issue, solution, **exact environment (tools + versions)**, and **why it's
   historical** (what stopped needing it).
3. Keep the full MEASURED evidence in the dated `docs/analysis/` report; this doc **links** to it
   (iron rule 1) rather than restating it.
4. When a CLAUDE.md "rule" is actually a candidate for here, remove it from CLAUDE.md and add the
   entry here — CLAUDE.md keeps only generic rules.
