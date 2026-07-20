<!-- meta
date: 2026-07-19 18:21
slug: ornith-35b-gemma-4-31b-configs
title: Ornith-1.0-35B & Gemma-4-31B-it-qat — recommended configs + arch facts for R9700 benchmarking
takeaway: Two new models staged in the HF cache. Ornith-1.0-35B is a qwen35moe HYBRID (MEASURED 40 blocks = 10 full-attn KV + 30 SSM linear-attn, **0 nextn/MTP**), native 262144, f16 KV 20 KiB/tok, weights 20.6 GiB → full 262K fits 32 GB; sampling is the Qwen coding recipe (temp 0.6/top_p 0.95/top_k 20), `<think>` blocks, qwen3_xml tools. **MTP is NOT possible for Ornith** (no embedded nextn tensors, no drafter shipped). Gemma-4-31B-it-qat is a gemma4 DENSE hybrid (sliding-window 1024 + global, 60 blocks, per-layer KV-head array), native 262144, QAT-Q4 (UD-Q4_K_XL 16.1 GiB); a thinking model (`<|think|>`/`<|channel>` template CONFIRMED in gguf); sampling temp 1.0/top_p 0.95/top_k 64. **MTP IS possible for Gemma** via a separate 280 MB drafter `mtp-gemma-4-31B-it.gguf` (NOT yet downloaded) + `--spec-type draft-mtp -md <drafter>`. Tooling gap: `gguf_kv.py` cannot size gemma4 (head_count_kv is a per-layer array, not a scalar) — VRAM guard must be set by hand for Gemma until the tool learns gemma4. **UPDATE 2026-07-19 (MEASURED): Gemma deep prefill CRASHES the Vulkan/RADV driver (`vk::DeviceLostError`, GUI-crashing device-loss) at ~65.5k @ctx163840 / ~24.5k @ctx140000 — a DRIVER bug, not memory — but on `BACKEND=rocm` it runs the full depth suite CLEAN (q8_0, ctx150000, n=1: 56.6% TS, 0/5 hard-pass, decode 11.6 t/s). So Gemma→ROCm, Ornith→Vulkan. Gemma emits `<think>` (not `<|channel>`; capture.py splits fine). Ornith (Vulkan) = 62.2% TS n=3.**
-->

# Research: Ornith-1.0-35B & Gemma-4-31B-it-qat — configs + arch for benchmarking

- **Date:** 2026-07-19 18:21 (research)  · **Question:** how do we benchmark the two newly-staged models (`Ornith-1.0-35B-UD-Q4_K_M.gguf`, `gemma-4-31B-it-qat-UD-Q4_K_XL.gguf`), and what are their vendor-recommended run configs?
- **Sources:** HF model cards `unsloth/Ornith-1.0-35B-GGUF` and `unsloth/gemma-4-31B-it-qat-GGUF` (extracted by a haiku subagent) = **CLAIMED**; local GGUF metadata via `bench/gguf_kv.py` + a bounded header read = **MEASURED**.

## Summary

Both models are already in the HF cache (paths below). Neither lives in the harness default
`models_dir` (`/home/dev/models/gguf`), so a campaign must point `MODEL=` at the absolute cache
path (or symlink the blobs in).

| | **Ornith-1.0-35B** | **Gemma-4-31B-it-qat** |
|---|---|---|
| Arch (MEASURED) | `qwen35moe`, HYBRID | `gemma4`, DENSE hybrid |
| Blocks / KV layers (MEASURED) | 40 blocks = **10 full-attn KV** + 30 SSM linear-attn, **0 nextn/MTP** | 60 blocks, sliding-window(1024)+global interleave |
| Heads (MEASURED) | head_count 16, head_count_kv 2, k/v_len 256 | head_count 32, head_count_kv **per-layer array `[16,…]`**, k/v_len 512 |
| Quant / file | UD-Q4_K_M, **21 GB** (weights ~20.6 GiB) | UD-Q4_K_XL (QAT), **17 GB** (weights ~16.1 GiB) |
| Native ctx (MEASURED) | 262144 | 262144 |
| KV/token f16 (MEASURED) | **20 KiB/tok** (q8_0 ~11) → full 262K fits 32 GB | **unknown — `gguf_kv.py` can't size gemma4** (array KV heads); size by hand |
| Sampling (CLAIMED) | temp **0.6** / top_p 0.95 / top_k 20 / min_p 0 (Qwen coding recipe) | temp **1.0** / top_p 0.95 / top_k 64 |
| Thinking | `<think>…</think>` (Qwen family) | `<|think|>` / `<|channel>thought` (**CONFIRMED** in gguf template) |
| Tools (CLAIMED) | qwen3_xml / qwen3_coder parser | native function-calling |
| **MTP** | **NOT possible** — 0 embedded nextn, no drafter file, no unsloth guidance | **possible** — separate **280 MB** drafter `mtp-gemma-4-31B-it.gguf` (**not yet downloaded**) |

**Bottom line for benchmarking.** Ornith is the same family the repo already tunes (Qwen3.6/3.5
hybrid MoE) → reuse the Vulkan substrate, the Qwen coding sampler, and the quality harness as-is,
but **MTP off** (it has no MTP tensors — unlike `Qwen3.6-27B-MTP`). Gemma is a new arch: different
sampler, a thinking template, an *external* MTP drafter, and no automatic VRAM guard.

> ### ⚠ UPDATE 2026-07-19 (MEASURED) — Gemma deep-context CRASHES on the Vulkan/RADV driver
> The `campaigns/2026-07-19-ornith-vs-gemma/` run shipped **Ornith-only at depth**: Gemma-4-31B
> **cannot complete a deep prefill** on the Vulkan/RADV build (b9950, gfx1201). `llama-server` dies
> mid-prefill with `decode() failed: vk::Queue::submit: ErrorDeviceLost` → `terminate … vk::DeviceLostError`,
> a **GPU device-loss that crashes the whole Ubuntu desktop**. MEASURED crash points: n_tokens ≈ **65.5k
> @ctx 163840** (q8_0 KV) and **~24.5k @ctx 140000** — so lowering ctx does NOT fix it. No `allocation failed`
> line in the log (solo VRAM 26.3/32.6 GiB), i.e. a RADV device hang — **but a concurrent VRAM consumer turns
> it into a hard OOM** (a stray 31 GiB `Q5_K_M-35B` server on :8092 + Gemma ~26 GiB = 57 GiB on a 32 GB card;
> always verify VRAM idle + kill stray servers first). No Vulkan workaround at deep ctx (q8_0 forces `-fa on`).
> **FIX = `BACKEND=rocm`** (MEASURED 2026-07-19): `bench/llamacpp/llama-server` (b1-049326a) + `HSA_OVERRIDE_GFX_VERSION=12.0.1`
> ran the **full ~140k prefill + all 5 replies clean** at q8_0/ctx150000 — past the exact ~65k Vulkan crash point, no
> device-loss, no GUI crash (VRAM 27.1 GiB, GTT 90 MiB). ROCm prefill ~650→200 t/s (decays), **decode ~11.6 t/s
> (~6× slower than Vulkan)** — the old "ROCm ~92× slower" figure did NOT hold. So the Vulkan crash is a RADV bug, not hardware.
> **Ornith (Vulkan) is unaffected — completed the 120k suite clean (62.2% TS n=3, decode 70.9 t/s, 25.4 GiB).**

## Ornith-1.0-35B — detail

- **Cache path:** `/home/dev/.cache/huggingface/hub/models--unsloth--Ornith-1.0-35B-GGUF/snapshots/78e1321ef86b69126dc991f481bb0cdc37614ed0/Ornith-1.0-35B-UD-Q4_K_M.gguf`
- **Arch (MEASURED, `gguf_kv.py`):** `qwen35moe` HYBRID — `block_count=40`, only **10 full-attention layers cache KV** (30 are SSM/Gated-DeltaNet linear-attn, fixed recurrent state), **0 nextn/MTP** tensors. `head_count=16 head_count_kv=2 key_length=value_length=256 context_length=262144`.
- **VRAM (MEASURED geometry):** f16 KV = **20.0 KiB/tok**, q8_0 ≈ 10.6. Weights 20.6 GiB. → f16 max ctx at 32.4 GB budget is RoPE-capped 262144 (i.e. **full context fits at f16** — no q8_0 needed). Paste-ready guard: `"vram": {"weights_gib": 20.61, "kv_kib_per_tok": {"f16": 20, "q8_0": 11}, "budget_mib": 32400, "overhead_mib": 2000}`.
- **Sampling (CLAIMED, HF card):** temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 — identical to Qwen3.6 "thinking mode, precise coding", which the repo has already validated as vendor-correct (see `docs/research/2026-07-15-1000-…variance.md`). Keep penalty samplers at 0 (repo's ~2 ms/tok host-tax finding).
- **Output format (CLAIMED):** `<think>…</think>` reasoning block then answer — `capture.py`'s `THINK_RE` already splits this. Tools: qwen3_xml / qwen3_coder.
- **MTP (INFERRED from MEASURED+CLAIMED):** **not available.** The gguf has 0 nextn tensors, the repo ships no drafter, and unsloth documents no `--spec-type`. `MTP=1` (→ `--spec-type draft-mtp`) would have nothing to draft with → run **MTP off**. If MTP is wanted later, it needs an EAGLE/ngram drafter or a matching MTP module, neither of which exists today.

## Gemma-4-31B-it-qat — detail

- **Cache path:** `/home/dev/.cache/huggingface/hub/models--unsloth--gemma-4-31B-it-qat-GGUF/snapshots/43cc1aeb31adf47ec06a854507ce552cd9862e6f/gemma-4-31B-it-qat-UD-Q4_K_XL.gguf`
- **Arch (MEASURED, header read):** `gemma4` DENSE — `block_count=60`, `head_count=32`, **`head_count_kv` is a per-layer array `[16,16,16,…]`** (the sliding-window/global interleave: local layers use a bounded 1024-token window, periodic global layers grow), `key_length=value_length=512`, `context_length=262144`. Multimodal-capable base, but no `mmproj` downloaded → text-only here.
- **Quant:** UD-Q4_K_XL, QAT (quant-aware trained → "preserves bf16 quality"); file 17 GB (weights ~16.1 GiB).
- **VRAM:** **`gguf_kv.py` fails** on gemma4 (`arch=gemma4 hkv=None`) because it assumes a scalar `head_count_kv`; here it is an array. Until the tool learns gemma4, the VRAM guard for Gemma campaigns must be **set by hand** (weights ~16.1 GiB leaves ample headroom; a whole-model f16 upper bound over 60 layers × k/v_len 512 is generous but the sliding-window layers cache far less, so real usage is well under that — **MEASURE it with `vram_sampler.py`, don't publish the calc**, iron rule 7).
- **Sampling (CLAIMED, HF card):** temp **1.0** / top_p 0.95 / top_k 64 (Gemma default recipe — *not* the Qwen numbers). min_p / penalties unspecified → leave 0.
- **Thinking (CONFIRMED):** gguf chat template contains `<|think|>` and `<|channel>thought … <channel|>` markers → it is a thinking model with a channel format. `enable_thinking` togglable. Because `capture.py` splits on `<think>…</think>`, Gemma's `<|channel>thought` format may need a **template/regex check** before quality grading (the think/answer split may land wrong) — verify on a smoke reply first.
- **MTP (INFERRED from CLAIMED):** **possible** via a *separate* drafter `mtp-gemma-4-31B-it.gguf` (**280 MB, not yet in cache**). Unsloth's documented `-hf` command auto-discovers it: `llama-server -hf unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL --spec-type draft-mtp --spec-draft-n-max 4 -ngl 999 -fa on`. Serving from a **local** path (our case) there is no auto-discovery → download the drafter and pass it explicitly: `--spec-type draft-mtp -md /path/to/mtp-gemma-4-31B-it.gguf`. **Unverified on our build (b9950):** whether the gemma4 draft-mtp path loads cleanly — smoke-test before trusting any MTP number.

## How to benchmark these (campaign plan)

Neither model is emitted by `gen_campaign.py` (that only scaffolds *throughput* probes). The right
harness is the **quality** track — reuse the frozen, grader-fixed
`campaigns/2026-07-12-27b-finetune-quality/` machinery (`capture.py` + `graders/score_deterministic.py`
+ `make_charts.py` + `tasks/`), copied into a new campaign dir, per the operator note now in
CLAUDE.md ("New-model quality campaign"). Substrate = Vulkan · f16 · `-ub 2048 -b 4096 -fa on`
(the repo's frozen quality substrate). Two configs at minimum: `ornith-mtp-off` and
`gemma-mtp-on` (+ optional `gemma-mtp-off` control). Per-model sampler as in the table.

**Open items before a run (documented in CLAUDE.md):** (1) download the Gemma MTP drafter;
(2) hand-set Gemma's VRAM guard (gguf_kv gap); (3) confirm Gemma's `<|channel>thought` split in
`capture.py`; (4) confirm gemma4 `draft-mtp` loads on b9950.
