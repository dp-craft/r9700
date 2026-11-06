# vLLM track — settings (config knobs)

One section per flag: **what-for / how-to-use / side-effect / version measured**. A flag that fixes
an issue cross-links to `known-issues.md`. `HIP_FORCE_DEV_KERNARG=0` is **not** a current setting
— it is historical (see `historical.md`); the current `sly-official` recipe does not set it.

## `--enforce-eager` (vs FULL_DECODE_ONLY CUDA graphs)
- **what-for:** disable CUDA graphs (CompilationMode.NONE, CUDAGraphMode.NONE, capture sizes cleared).
- **how-to-use:** `--enforce-eager` in ENGINE_ARGS. Restoring graphs = re-add
  `--compilation-config.cudagraph_mode FULL_DECODE_ONLY` + `CUDAGRAPH_SIZES` to `_engine.env`.
- **side-effect:** sly-radiance uses **eager** (2026-10-23 user decision); sly-official uses
  **FULL_DECODE_ONLY** + capture sizes `[8,16,24,32,40,48,56,64]`. Eager = no graph-capture overhead
  but no graph speedup. The README's capture sizes assume k=7 × 8 seqs. Verified in the 1.6.0 image
  source that eager cleanly overrides the compilation flags (config/vllm.py:1694-1712,1967-1972).
- **version measured:** sly-radiance 1.6.0 (eager), sly-official 1.8.1 (graphs).

## `--gpu-memory-utilization` (0.90 vs 0.93)
- **what-for:** bound the serving KV pool + weights budget.
- **how-to-use:** `GPU_UTIL=0.90` (sly-radiance) or `0.93` (sly-official, official).
- **side-effect:** the desktop GUI shares the card (CLAUDE.md, Gemma device-loss) — 0.90 leaves
  headroom. Each 0.01 util ≈ 326 MiB ≈ 8.9k tokens (INFERRED). **Does not bound the load phase** —
  the NVFP4 load peak crashed the desktop at 0.90 (see `known-issues.md`, NVFP4 load-peak OOM).
- **version measured:** 0.90 (sly-radiance 1.6.0), 0.93 (sly-official 1.8.1).

## `--gpu-headroom-mib` (native Radiance only)
- **what-for:** the VRAM native Radiance leaves unclaimed. Default 96.
- **how-to-use:** recommended only, not required: `EXTRA_ARGS="--gpu-headroom-mib 2048" ./ornith_rad_mtp.sh start`. The
  alternative is to keep the default and close Chrome if VRAM gets tight.
- **side-effect:** at 96 only about 232 MiB stayed free and the desktop crashed (see `known-issues.md`). 2048 should cost
  about 1.9 GiB of KV: about 3.1 sessions at 262k instead of 3.8 (INFERRED, because all weights stay resident).
- **version measured:** 96 on radiance 1.16.0. **2048 is not measured.**

## `--moe-backend triton_unfused` (MXFP4 MoE on Sly)
- **what-for:** replaces the `EMULATION` backend vLLM picks for `amd/Qwen3.5-35B-A3B-MXFP4`.
- **how-to-use:** `EXTRA_ARGS="--moe-backend triton_unfused"`. It is not the `sly-amd` profile default; the archived starters in
  `bench/engine-bench/vllm/archive/` pass it. It cannot load with `method: mtp` on a checkpoint whose MTP layer is unquantized.
- **side-effect:** decode rises from 16.6 to 110.2 tok/s at 10k and KV capacity from 305,666 to 448,702 tokens; prefill drops
  14–21% (MEASURED, DFlash K=7). It runs BF16 activations, and no AMD or vLLM source recommends it. See `known-issues.md`.
- **version measured:** sly 1.9.1 (vLLM 0.32.0), short replies only.

## fp8 KV (`--kv-cache-dtype fp8`)
- **what-for:** halve KV-cache memory vs f16.
- **how-to-use:** `KV_DTYPE=fp8` → `--kv-cache-dtype fp8` in the profile.
- **side-effect:** MEASURED **exact null** on the INT4 hybrid (radiance 0.9.3 — two pairs identical to
  the digit, block size unchanged). On the MXFP4 hybrid it is the standard path (fp8 scale 1.0,
  checkpoint has 0 k/v scale tensors).
- **version measured:** radiance 0.9.3 (null), sly-radiance 1.6.0 (standard).

## `--attention-backend TRITON_ATTN`
- **what-for:** fix the decode collapse at depth on the INT4 hybrid — the ROCM_ATTN default collapses
  to **2.8 tok/s @32k** (custom paged kernel needs head_size 128 + block 16; the model has head_dim
  256 / block 1568 → fallback grid (1,4)).
- **how-to-use:** `--attention-backend TRITON_ATTN` (EXTRA_ARGS).
- **side-effect:** fixes decode (14.1 tok/s @32k, +10% at 512) but costs 32k prefill (222 vs ~470
  tok/s). The 32k prefill loss is from a hard-coded `is_device_capability_family(100)` gate
  (Blackwell-only) — `triton_unified_attention.py:944`.
- **version measured:** host 0.29.0 venv (INT4 report). Note: on the MXFP4 hybrid the main attention
  is **R4D_HYBRID** (not TRITON_ATTN); the **drafter** uses TRITON_ATTN.

## DFlash2 (speculative drafter, capture sizes)
- **what-for:** the decode multiplier — k=7 tokens/step (4.0× @8k, 5.6× @136k cold).
- **how-to-use:** `--speculative-config.method dflash --speculative-config.model /draft
  --speculative-config.num_speculative_tokens 7 --speculative-config.draft_sample_method
  greedy|probabilistic --speculative-config.attention_backend TRITON_ATTN`; `DRAFT_DIR` mounted
  read-only at `/draft`.
- **side-effect:** KV pool −20% (drafter + padding), +1.2 GiB drafter model memory (peak VRAM +401 MiB), prefix-cache granularity
  64 → 880 tokens, decode becomes **acceptance-bound** (acceptance 30–67%, τ 3–6). Cold decode
  33.8 → 136.6 tok/s @8k. `draft_sample_method`: greedy (sly-radiance) vs probabilistic (sly-official).
- **version measured:** sly-radiance 1.6.0 (dflash campaign), sly-official 1.8.1 (probabilistic).

## `RADIANCE_*` knobs (MXFP4 kernel family + diagnostics)
- **what-for:** select the MXFP4 W4A8 GEMM path + the acceptance transform + diagnostics.
- **how-to-use** (in MODEL_ENV / ENGINE_ENV), the key ones:
  - `RADIANCE_MXFP4=1` — enable the MXFP4 GEMM path
  - `RADIANCE_MXFP4_W4A8=1` — W4A8 (4-bit weights, fp8 activations)
  - `RADIANCE_MXFP4_W4A8_MIN_M=0` — allow W4A8 down to any M (small batches)
  - `RADIANCE_MXFP4_DECODE_MAX_M=128` — decode W4A8 up to M=128
  - `RADIANCE_MXFP4_A_TILED_MIN_M=513` — A-tiled GEMM above M=513 (**the kernel that faulted
    historically** — `known-issues.md`; `historical.md` for the fix)
  - `RADIANCE_MXFP4_WPERM=1` — weight permute for the WMMA path
  - `RADIANCE_MXFP4_WIDE_MAX_M=192 RADIANCE_ADAPTIVE_WIDTH=perseq` — wide adaptive-width GEMM
  - `RADIANCE_LMHEAD_INT4=1` / `RADIANCE_LMHEAD_FP8=1` — lm_head quant
  - `RADIANCE_FUSED_NORM_QUANT=1` — fused norm+quant
  - `RADIANCE_KV_GROUP_SIZE=8` — KV group size. The 35B MoE cannot boot at 262000 with 5 and DFlash K=7 (MEASURED, 1.9.1);
    `sly-amd` uses 2 (305,666 KV tokens on `EMULATION`, 448,702 on `triton_unfused`). A value of 1 gave 348,641 on `EMULATION`.
  - `RADIANCE_EMBED_INT8=1 RADIANCE_EMBED_BITS=4` — INT8/4-bit embeddings
  - `RADIANCE_MXFP4_SANITIZE=0` (sly-official)
  - `RADIANCE_CACTUS_DELTA` — **0** (sly-radiance: bit-exact stock acceptance) vs **0.5** (sly-official:
    the official value; a LOSSY acceptance transform patched into the spec-decode rejection kernel —
    Sly issue #164, open, reports locking into endless repetition on long outputs)
  - `RADIANCE_CACTUS_FADE_START` / `_FADE_END` / `_CAP_R` — Sly 1.9.x only (the 1.8.1 image reads only `_DELTA`). Per request
    `req_delta = δ·clamp((END − out_len)/max(END − START, 1), 0, 1)`, `out_len = pos − prompt_len`; cap `h = min(h, 1 − R·(1 − q))`.
    Defaults 4096 / 16384 / 0.5; **`FADE_END=0` disables the fade** (constant δ), **`CAP_R=0` disables the cap**; R outside [0,1] raises.
    Read from `rejection_sampler_utils.py:10-16,775-783`, image `vllm-sly-radiance:1.9.1-rocm10.1`. Env knobs (unset = no `-e`):
    `CACTUS_FADE_START` `CACTUS_FADE_END` `CACTUS_CAP_R` (`profiles/sly-official/_engine.env`; usable in gen_campaign `env`).
  - `RADIANCE_RUN_BWTEST=0` (image default 1 = a P2P bandwidth self-test at every start; diagnostic only)
  - diagnostics: `RADIANCE_MXFP4_PTRLOG=1`, `RADIANCE_MXFP4_SPLIT_M=192`, `RADIANCE_MXFP4_PAD_A`,
    `RADIANCE_MXFP4_PAD_OUT_ROWS`
- **side-effect:** `A_TILED_MIN_M=513` selects the historical-fault kernel; `CACTUS_DELTA=0.5` is the
  lossy transform (repetition risk, #164).
- **version measured:** sly-radiance 1.6.0, sly-official 1.8.1.

## `--shm-size 16g`
- **what-for:** container shared memory (instead of `--ipc=host`).
- **how-to-use:** `--shm-size 16g` (serve_vllm.sh). With `KVCACHE=ram`, the SHM is grown to the tier + 16.
- **side-effect:** port bound to 127.0.0.1; `no-new-privileges`; numeric render/video GIDs read from
  the host (992/44 here, README assumes 109/44); containers run as root (cache files root-owned).
- **version measured:** sly-radiance 1.6.0.

## `HIP_FORCE_DEV_KERNARG=0` — **not a current setting**
- The current `sly-official` recipe does **not** set it, and the `radiance_mxfp4_fp8_gemm_atiled`
  GEMM fault it fixed is **historical** (graduated to `historical.md`). It was the default in the
  `sly-radiance`/`radiance` profiles during the 2026-10-22/23 fault window; it is a *diagnostic* for
  a bit-44 kernarg-pointer corruption, not a general rule. If a future image/driver reintroduces the
  `0x6…` fault-address shape, this is the fix to reach for. See `historical.md`.
