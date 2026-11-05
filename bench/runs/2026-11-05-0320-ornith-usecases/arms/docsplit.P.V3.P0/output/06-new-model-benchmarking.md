## New-model benchmarking — Ornith-1.0-35B & Gemma-4-31B (2026-07-19)

Full facts + provenance: `docs/research/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md`.
**Conclusion (2026-07-19 campaign, `campaigns/2026-07-19-ornith-vs-gemma/analysis.md`):** Ornith is the
**viable, ship-it model on this stack** — runs the full 120k TS-TDD suite clean on Vulkan/f16 (n=3:
**62.2% TS**, 1/5 hard-pass, decode 70.9 t/s, 25.4 GiB), and is **~2× more consistent than Qwen3.6-35B-A3B**
(within-task sd 7.4 vs 12.9). The 35B-A3B scores ~11 pts higher (73.3%) but the gap is **not significant**
(paired t=−1.16) and its speed edge is **MTP-only** (Ornith has 0 nextn → can't use it). Trade: 35B better on
strict types/edge; Ornith lighter, steadier, thinks less. **Gemma-4-31B needs `BACKEND=rocm`** — Vulkan/RADV
device-losts (crashes GUI) at depth, but on ROCm it completes the full run (56.6% TS, 0/5 hard-pass, n=1;
decode ~11.6 t/s — slow but viable; hits the lint/types wall harder than Ornith). Both are
staged **in the HF cache** (not `models_dir`), so a campaign sets `MODEL=` to the absolute path:
- Ornith: `~/.cache/huggingface/hub/models--unsloth--Ornith-1.0-35B-GGUF/snapshots/78e1321ef86b69126dc991f481bb0cdc37614ed0/Ornith-1.0-35B-UD-Q4_K_M.gguf`
- Gemma:  `~/.cache/huggingface/hub/models--unsloth--gemma-4-31B-it-qat-GGUF/snapshots/43cc1aeb31adf47ec06a854507ce552cd9862e6f/gemma-4-31B-it-qat-UD-Q4_K_XL.gguf`

**Runbook — new-model QUALITY campaign** (`gen_campaign.py`'s `kind: quality` does not cover the TS
`tsc + eslint + vitest` harness; this track is the legit hand-written exception, iron rule 6 — but
REUSE a grader-fixed harness, don't reinvent). **Worked example scaffold: `campaigns/2026-07-19-ornith-vs-gemma/`.**
1. **Canonical harness = the TS `hardest-tasks` one** (`campaigns/2026-07-14-hardest-tasks-27b-vs-35b/`):
   real `tsc + eslint + vitest` grading with a **pre-grade `score_typescript.py selftest`** that aborts
   if vitest can't spawn (the fix for the silent tests=0 bug). It is **`configs.jsonl`-driven** (one JSON
   cell/line: `label,model,mtp,kv,depth,tokens,ctx,budget,temp,top_p,top_k,min_p[,presence_penalty],role`).
   `cp` it into `campaigns/<date>-<slug>/` (exclude `out/ charts/ __pycache__/ ts-harness/node_modules/`;
   **symlink** node_modules; `capture.py`/`make_charts.py` stay referenced from the sibling
   `2026-07-12-27b-finetune-quality/` dir). Write a NEW `configs.jsonl`; **patch the copied `run_capture.sh`
   campaign identity** (title + the `SUMMARY` heredoc's paths) and default `JUDGE_ENGINE=none SUMMARY=0`.
   (Lighter deterministic alt for non-TS tasks: `27b-finetune-quality/` `score_deterministic.py`.)
2. Point models at `MODELS_DIR=/home/dev/models/gguf` — **symlink HF-cache ggufs in** by clean filename;
   `configs.jsonl.model` is resolved as `$MODELS_DIR/$model`. Substrate = Vulkan · f16 · `-ub 2048 -b 4096
   -fa on` (serve via `serve_llamacpp.sh`; the driver owns start/stop + VRAM sampling).
3. `run_capture.sh` = capture → `score_typescript.py batch` (self-check gated) → `make_charts.py` +
   `make_charts_detailed.py` → `aggregate.py` (→ `out/summary.md`); write co-located `analysis.md` via
   **/benchmark-results** (memory column mandatory). Resumable: row-level in `capture.py` + `out/done/` markers.
- Debugging/tracing: kill servers by pidfile `bench/.servers/<port>.pid` (iron rule 14); an orphan
  `llama-server` fabricates fake findings — verify port free + VRAM idle before relaunch.

**Per-model config** (arch = MEASURED via `gguf_kv.py`; sampler = CLAIMED, HF card):
- **Ornith** `qwen35moe` HYBRID (40 blk = 10 full-attn KV + 30 SSM, **0 nextn**): temp **0.6**/top_p
  0.95/top_k 20/min_p 0, penalties 0. f16 KV **20 KiB/tok**, weights 20.6 GiB → **full 262K fits f16**.
  `<think>` split works. **MTP off — impossible** (no nextn tensors, no drafter, no unsloth guidance).
- **Gemma** `gemma4` dense hybrid (sliding-window 1024 + global, 60 blk): temp **1.0**/top_p 0.95/top_k
  64. **KV is heavy: MEASURED ~86 KiB/tok f16 (~5× Ornith)** — f16 @ctx 163840 loads at **32272 MiB + 2.5 GiB
  GTT spill** (does NOT fit 32 GB), so **use `KV=q8_0` at deep ctx** (~25.8 GiB, fits; Ornith stays f16 →
  documented KV asymmetry, ≤5% rule). Weights ~16.1 GiB. **MEASURED: the model OUTPUTS `<think>…</think>`
  (capture.py splits it fine — no fix needed), despite the gguf template's `<|channel>` markers.** **MTP possible**
  but needs the separate **280 MB** drafter `mtp-gemma-4-31B-it.gguf` (**download first** — not in cache), then
  `EXTRA_ARGS="-md <drafter>" MTP=1` (→ `--spec-type draft-mtp --spec-draft-n-max 4`). Untested → smoke-test first.
  **⚠ RUN GEMMA ON `BACKEND=rocm`** (`HSA_OVERRIDE_GFX_VERSION=12.0.1`): Vulkan/RADV device-losts at deep prefill
  and crashes the GUI; ROCm completes the full depth run clean (slow: decode ~11.6 t/s). See Errors & fixes.
  **2026-07-19 MEASURED (ROCm, q8_0, ctx150000, n=1): Gemma 56.6% TS, 0/5 hard-pass, decode 11.6 t/s** vs Ornith
  62.2% (n=3) — but Gemma n=1 (CI [33,80]) is not yet a real comparison.

**Errors & fixes (encountered):**
- `gguf_kv.py` → `could not read KV geometry (arch=gemma4 hkv=None)`: **gemma4 stores `head_count_kv`
  as a per-layer array `[16,…]`**, not a scalar, so the tool can't size it. Fix (TODO, extend the
  tool): teach `gguf_kv.py` to reduce an array `*.attention.head_count_kv` and honor the sliding-window
  layers. Until then **hand-set Gemma's VRAM guard** and **MEASURE** usage with `vram_sampler.py`
  (iron rule 7 — never publish the calc).
- **Gemma f16 KV spills at deep ctx** (VRAM full → CPU/GTT offload): MEASURED f16 @ctx 163840 = **32272 MiB
  + 2529 MiB GTT** (gemma4 KV ~86 KiB/tok, ~5× Ornith). Symptom = `vram_used ≈ vram_total` + rising
  `gtt_used` in `gpu_*.csv`, degraded decode. **Fix: `KV=q8_0`** → MEASURED **26872 MiB, no spill** (Ornith
  stays f16; asymmetry within the ≤5% rule). (Ornith f16 @163840 = 25748 MiB, fits native.)
- **⚠ Gemma-4-31B deep prefill CRASHES on Vulkan/RADV but WORKS on ROCm/HIP — the crash is a RADV driver bug,
  not a memory/hardware limit.** On **Vulkan** (b9950): `llama-server` dies mid-prefill with
  `decode() failed: vk::Queue::submit: ErrorDeviceLost` → `vk::DeviceLostError`, a GPU device-loss that
  **takes down the whole Ubuntu GUI** — MEASURED crash at n_tokens ≈ **65.5k @ctx163840** / **~24.5k @ctx140000**
  (lowering ctx does NOT fix it; no `allocation failed` line, VRAM 26.3/32.6 solo). A concurrent VRAM consumer
  (a stray 31 GiB Q5_K_M-35B server on :8092) turns it into a hard OOM. **Fix = run Gemma on `BACKEND=rocm`**
  (`bench/llamacpp/llama-server`, needs `HSA_OVERRIDE_GFX_VERSION=12.0.1`): MEASURED it prefilled the full
  **~140k @ctx150000 q8_0** and generated all 5 tasks clean, **no device-loss, no GUI crash** (VRAM 27.1 GiB,
  GTT only 90 MiB). **Cost = speed:** ROCm prefill ~650→200 tok/s (decays with depth), **decode ~11.6 t/s
  (~6× slower than Vulkan's 70)**. So: **Ornith→Vulkan (fast), Gemma→ROCm (only backend that survives depth).**
  The old repo "ROCm ~92× slower / 8 tok/s" figure did NOT hold here (prefill was ~600 tok/s). Ornith (qwen35moe)
  is unaffected by the Vulkan bug — completes 120k clean.
- `--spec-type draft-mtp` on a model with **0 nextn tensors** (Ornith) has nothing to draft → keep MTP off.
- `strings` on a 17–21 GB gguf hangs — read metadata from the **header only** (bounded `head -c` /
  gguf KV parse), never scan the whole file.

