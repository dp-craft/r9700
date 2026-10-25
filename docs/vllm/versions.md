# vLLM track — versions (the keystone matrix)

**Rule:** one row per **MEASURED** combination. **No row without a citation** (iron rule 1). The
lead row is the **current model under test**; a row's MEASURED numbers are added when its campaign
lands (see the update-trigger rule in `README.md`). "kernel behavior" = the attention + GEMM path
that actually ran.

| engine | image tag | vLLM ver | radiance ver | ROCm | model / format | kernel behavior | VRAM (MEASURED) | status |
|---|---|---|---|---|---|---|---|---|
| **sly-official** (current) | `ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1` | n/a (newer than 1.6.0) | 1.8.1 | 10.1 | `slybase/Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ@3bb379dc` (GPTQ-MXFP4) + DFlash2 drafter k=7 | MXFP4 W4A8, fp8 KV, R4D_HYBRID, FULL_DECODE_ONLY graphs, Cactus 0.5, ctx 260000 | not yet benchmarked (current model under test) | **current model under test** — citation: profile `sly-official/heretic-mxfp4.env`; MEASURED row added on campaign landing (update-trigger) |
| sly-radiance | `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` @ `sha256:bf153fa38868…7506` | **0.31.0 (image reports) — OPEN discrepancy: Sly PR #162 says 1.6.0 = 0.32.0; do not assert** | 1.6.0 | 10.1 (in-image) / 10.1.0 host | `amd/Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c` (Quark MXFP4 W4A8) + DFlash2 `syvai/…@4d30ec73` k=7 | MXFP4 W4A8 (fp8 WMMA all linears), fp8 KV, R4D_HYBRID, eager, Cactus 0, ctx 150000/170000 | peak **30,259 MiB** (170k cold prefill) → flat 29,774; KV pool 433,957 tok @150k / 332,822 tok @170k; GTT 64–120 MiB (no spill) | MEASURED (4 campaigns: depth, dflash, dflash-170k, + fault) |
| radiance (native R4D) | `stilldeadcode/vllm-radiance:0.9.3` (vLLM 0.27.1 + libr4d) | 0.27.1 | 0.6.2 (provenance discrepancy inside tag 0.9.3) | 7.14 userspace (in-image) / 10.0.0 host | `RedHatAI/Qwen3.8-27B-INT4@bf08f3db` (W4A16) | R4D + MTP, fp8 KV (R5), TRITON_ATTN (host 0.29.0 venv), ctx 114688 | peak **28,706 MiB** (R4 MTP8); KV pool 138,416 tok @114688 (MTP3) | **dead image** (not migrated to the new data-root); MEASURED 2026-09 |
| radiance (native `.rad`) | `stilldeadcode/radiance:1.11.0` | n/a (native radiance, not vLLM) | 1.11.0 | n/a | a `.rad` checkpoint (not an HF checkpoint) | native `.rad` load path | n/a | **native `.rad` path** — the only engine that loads `.rad` (sly loads HF only); citation: the `.rad`-vs-HF distinction (known-issues.md) |

## Citation notes (provenance per row)

- **sly-radiance 1.6.0** (row 2): `campaigns/2026-10-22-vllm-sly-mxfp4-depth/analysis.md` (baseline,
  no spec), `campaigns/2026-10-22-vllm-sly-mxfp4-dflash/analysis.md` (DFlash2),
  `campaigns/2026-10-22-vllm-sly-mxfp4-dflash-170k/analysis.md` (170k max), and
  `docs/analysis/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md` (the fault + fix).
- **The 0.31.0 vs 0.32.0 discrepancy** (row 2): the image *reports* vLLM 0.31.0, but Sly PR #162
  says 1.6.0 = 0.32.0. **Do not assert a settled version** — the row is flagged open, not resolved.
- **radiance 0.9.3** (row 3): `docs/analysis/2026-09-12-1055-vllm-radiance-r9700-evaluation.md`
  (R4D + MTP, the "tuned" build behind Puget's numbers) and
  `docs/analysis/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md` (window budgets, fp8-KV
  null). The INT4 + TRITON_ATTN finding is
  `docs/analysis/2026-09-11-2047-vllm-qwen38-27b-int4.md` (host 0.29.0 venv).
- **sly-official 1.8.1** (row 1): config-only (profile `sly-official/heretic-mxfp4.env`). The
  MEASURED row is added when the campaign lands — the update-trigger rule in `README.md`.
- **`.rad` native** (row 4): the `.rad`-vs-HF-checkpoint loading distinction is documented in
  `known-issues.md` (sly loads HF only, radiance loads `.rad`).

## How to add a row

1. A new campaign lands via `/benchmark-results` → add a row (engine, image tag, vLLM ver, radiance
   ver, ROCm, model/format, kernel behavior, VRAM, status).
2. Tag the VRAM `MEASURED` and cite the campaign `analysis.md` (iron rule 1) — **no row without a citation**.
3. If a version is ambiguous (image report vs PR), flag it open rather than assert (see the 0.31/0.32 row).
