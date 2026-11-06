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
| **sly-redhat** (RedHat image since 2026-10-30; was 1.8.1) | `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` @ `sha256:9744caf31e96…abc8` | 0.32.0 (image reports) | 1.9.1 | 10.1 | `RedHatAI/Qwen3.8-27B-MXFP4@16a86728` (compressed-tensors MXFP4) + DFlash2 `syvai/…@4d30ec73` k=7 | sly-official engine layer (MXFP4 W4A8, fp8 KV, R4D_HYBRID, FULL_DECODE_ONLY graphs), Cactus 0.5 + 1.9.x fade (4096→16384 out tok) and cap (defaults), template `qwen3.8-froggeric-v22.5-sly2`, ctx 262000 | **30,852 MiB** used after boot; KV pool 370,702 tok @262000 (= 1.8.1) | MEASURED: smoke test + depth probe at ctx 110000 (decode = 1.8.1 within n=2 noise; DFlash2 k=7 122.72/86.34/86.24 tok/s at 10k/50k/100k) + one real Claude Code session (W2-08); citation below |
| radiance (native `.rad`), Ornith 1.5 | `stilldeadcode/radiance:1.16.0` @ `sha256:b1017ce0e615…` | n/a (native radiance, not vLLM) | 1.16.0 | not recorded | `keptn/ornith-1.5-35b-a3b-w4a8@cfed0f8f` (19.74 GiB `.rad`), MTP K=3 | creator's single-card config, fp8 KV, ctx 262144, 8 seqs, default 96 MiB headroom | **32,511 MiB peak**, 113 MiB min free, 339 MiB GTT; KV 992,288 tok | MEASURED: 219.8/205.0/174.5 tok/s decode, 13,059/8,029/5,301 tok/s prefill at 10k/50k/100k. **Not desktop-safe as measured** (known-issues.md); coding quality untested; citation below |
| **sly-amd** | `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` @ `sha256:9744caf31e96…abc8` | 0.32.0 | 1.9.1 | 10.1 | `amd/Qwen3.5-35B-A3B-MXFP4@2e19c657` + DFlash `z-lab/…@52cb554b` k=7 | `EMULATION` MoE backend by default; `--moe-backend triton_unfused` via `EXTRA_ARGS` (BF16 activations); `RADIANCE_KV_GROUP_SIZE=2`, fp8 KV, ctx 262000 | 31,597 MiB peak (`EMULATION`), 31,327 MiB (`triton_unfused`) | MEASURED: `EMULATION` 16.6/15.4/15.8 tok/s, `triton_unfused` 110.2/92.9/67.3 tok/s at 10k/50k/100k; short replies only; citation below |
| **sly-amd profile**, Ornith 1.5 | `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` @ `sha256:9744caf31e96…abc8` | 0.32.0 | 1.9.1 | 10.1 | `Capicua25x/Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4@9e488f46` + DFlash `ornith-ai/Ornith-1.5-35B-A3B-DFlash@942d20fe` k=3 | `--moe-backend triton_unfused`, fp8 KV, ctx 262144, 8 seqs, batched 2048, `presence_penalty` 1.5 | 31,510 MiB peak, 1,114 MiB min free, 78 MiB GTT; KV 612,807 tok | MEASURED: 95.2/71.0/66.5 tok/s decode, 3,802/3,122/2,604 tok/s prefill at 10k/50k/100k. MTP fails at load (known-issues.md); coding quality untested; checkpoints deleted after the run (fetch commands in the archived starter); citation below |

## Citation notes (provenance per row)

- **sly-radiance 1.6.0** (row 2): `docs/findings/vllm/2026-10-22-1324-vllm-sly-mxfp4-depth.md` (baseline,
  no spec), `docs/findings/vllm/2026-10-22-1406-vllm-sly-mxfp4-dflash.md` (DFlash2),
  `docs/findings/vllm/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md` (170k max), and
  `docs/findings/vllm/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md` (the fault + fix).
- **The 0.31.0 vs 0.32.0 discrepancy** (row 2): the image *reports* vLLM 0.31.0, but Sly PR #162
  says 1.6.0 = 0.32.0. **Do not assert a settled version** — the row is flagged open, not resolved.
- **radiance 0.9.3** (row 3): `docs/findings/radiance/2026-09-12-1055-vllm-radiance-r9700-evaluation.md`
  (R4D + MTP, the "tuned" build behind Puget's numbers) and
  `docs/findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md` (window budgets, fp8-KV
  null). The INT4 + TRITON_ATTN finding is
  `docs/findings/vllm/2026-09-11-2047-vllm-qwen38-27b-int4.md` (host 0.29.0 venv).
- **sly-official 1.8.1** (row 1): config-only (profile `sly-official/heretic-mxfp4.env`). The
  MEASURED row is added when the campaign lands — the update-trigger rule in `README.md`.
- **sly-redhat 1.9.1** (row 5): MEASURED smoke test `campaigns/perf/2026-10-30-1745-sly-1.9.1-smoke/` (`summary.txt`: boot 475 s
  incl. first compile, VRAM, `RADIANCE_VERSION=1.9.1`, vLLM 0.32.0, template line; replay check: an older turn's
  reasoning adds 0 prompt tokens, the newest turn's adds 1,169). Fade/cap/template behaviour and the loop and speed
  gains are CLAIMED (Sly v1.9.0/v1.9.1 release notes). Depth probe (MEASURED, 2026-10-30 19:32-19:59, ctx 110000,
  fp8 KV, 1 stream, 256 tok, 2 reps): `docs/findings/radiance/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md` § "Sly 1.9.1
  rerun" (run dirs `bench/runs/2026-10-30-vllm-redhat-sly191{,-mtp,-dflash}-depth/`). Real session (loops reduced, not
  removed): `docs/findings/agentic/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md`. Previous RedHat image 1.8.1: profile comment
  `profiles/sly-redhat/_engine.env` (rollback) and `docs/findings/radiance/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md`.
- **`.rad` native** (row 4): the `.rad`-vs-HF-checkpoint loading distinction is documented in
  `known-issues.md` (sly loads HF only, radiance loads `.rad`).
- **Radiance 1.16.0 + Ornith 1.5, sly-amd (Qwen and Ornith), and the sly-redhat rerun (2026-11-04):**
  `docs/findings/radiance/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`; raw data in
  `campaigns/perf/2026-11-04-1527-ornith15-radiance-vs-sly/results/2026-11-04-1730-ornith15-w4a8-radiance/`, `campaigns/perf/2026-11-04-1527-ornith15-radiance-vs-sly/results/2026-11-04-1557-35b-perf-10k-50k-100k/`,
  `campaigns/perf/2026-11-04-1527-ornith15-radiance-vs-sly/results/2026-11-04-1802-ornith15-sly-dflash/` and `campaigns/perf/2026-11-04-1527-ornith15-radiance-vs-sly/results/2026-11-04-1740-27b-sly-baseline/`. The sly-redhat rerun used ctx 262000 and the `dp-sharp`
  template: 86.9/96.0/82.5 tok/s at 10k/50k/100k, 31,197 MiB peak. It adds to the ctx 110000 row and does not replace it.

## How to add a row

1. A new campaign lands via `/benchmark-results` → add a row (engine, image tag, vLLM ver, radiance
   ver, ROCm, model/format, kernel behavior, VRAM, status).
2. Tag the VRAM `MEASURED` and cite the campaign `analysis.md` (iron rule 1) — **no row without a citation**.
3. If a version is ambiguous (image report vs PR), flag it open rather than assert (see the 0.31/0.32 row).
