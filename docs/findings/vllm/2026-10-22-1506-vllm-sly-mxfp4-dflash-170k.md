<!-- meta
date: 2026-10-22 15:45
slug: vllm-sly-mxfp4-dflash-170k
title: Sly radiance 1.6.0 · Qwen3.8-27B MXFP4 · fp8 KV · DFlash2 — 170k window filled to the edge: memory over time
takeaway: vLLM (Sly radiance 1.6.0) + MXFP4 + fp8 KV + DFlash2 at **max-model-len 170000**, conversation filled to 150k then grown by hard-thinking turns to **169.3k** (MEASURED): **no memory creep** — device VRAM peaked at **30,259 MiB** (29.55 GiB) during the cold 150k prefill, then stepped down and stayed flat at 29,774 MiB for ~5 min and two conversations; GTT 64–120 MiB (no spill). KV pool **332,822 tok** (11.84 GiB, 1.96 × 170k); one full 170k sequence occupies **51 %** of it (`kv_cache_usage_perc`). Memory is not the limit at util 0.90 — **reliability is**: a 2nd GPU memory fault in the same `radiance_mxfp4_fp8_gemm_atiled` kernel (rep 1, ~156k context) hung the engine 387 s → EngineDead. MXFP4 tally: 2 faults in 84 requests, 2 of 4 serving boots, both in the 2nd deep conversation of a boot. Side finding: novel 1k-token thinking at 150k decodes at **~65 tok/s**; repeated-task turns copy the earlier answer at ~178 tok/s (not representative).
campaign: campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k
-->

# Benchmark: 170k window filled to the edge — memory over time · Sly radiance vLLM + DFlash2 — R9700 (gfx1201)

- **Date:** 2026-10-22 15:06–15:27 local · **Track:** engine-bench campaign (`gen_campaign.py`, `engine: vllm`, conversation probe with `turn_prompt`)
- **GPU/Host:** AMD Radeon AI PRO R9700, 32624 MiB, power cap 210 W (user tuning, unchanged), desktop GUI on the same card · Ryzen 5 3600, 31 GB RAM · kernel 7.0.0-38
- **Runtime:** `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` @ `sha256:bf153fa38868…7506` (vLLM 0.31.0) · profile `sly-radiance/qwen38-mxfp4-dflash` with **MAXLEN 170000**
- **Model:** `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` @ `5233554c` + drafter `syvai/Qwen3.8-27B-DFlash2-W4A16` @ `4d30ec73` (k=7) · KV fp8 · max-num-seqs 1 · gpu-mem-util 0.90
- **Data:** `campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k/` (probe dir `campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k/results/2026-10-22-1513-engine-fill170k/`, 1 s `gpu_samples.csv`, 453 samples over 504 s)

## Summary

The question was whether memory stays flat while a 170k window fills to the edge, or creeps as llama.cpp+MTP does. It stays flat. Device VRAM peaked at **30,259 MiB** during the cold 150k prefill. It then stepped *down* to 29,774 MiB and stayed there through ~5 minutes and two conversations, the deepest at **169.3k tokens**. GTT never left its 64–120 MiB noise band (MEASURED). On vLLM, memory is reserved at boot (`--gpu-memory-utilization 0.90`), and what moves with context is KV-pool occupancy. One full 170k sequence fills **51 %** of the 332,822-token pool, so memory is not the limit. The limit is **reliability**: the second conversation hit the same GPU memory fault in Sly's MXFP4 prefill GEMM as the baseline, at ~156k context, and the engine hung for 387 s before dying.

## Legend

| Term | What it is | Effect on this box (this run) | How it's tested here |
|------|------------|-------------------------------|----------------------|
| fill-then-think | turn 0 = 150k tokens of code (cold prefill); every later turn = the hard-thinking task only (`turn_prompt`, `step_tokens 0`), 1024 max tokens, `reasoning_effort: high`; prior turns cached | grows the context ~1.1–1.2k per turn until prompt + 1024 would pass 170000 | `capture_engine.py conversation --turn-prompt` (new), 2 reps in one boot |
| device VRAM / GTT | `vram_used_mib` / `gtt_used_mib` of the whole GPU, 1 s samples | includes the desktop GUI (~600–850 MiB idle) — not vLLM alone | `vram_sampler.py` across the whole probe |
| `kv_usage_peak` | max of vLLM's `kv_cache_usage_perc` polled every 0.5 s during a turn (blocks held by the running request ÷ pool) | 45.9 % at 149.7k → 51.1 % at 169.3k (MEASURED) | new field in conversation rows |
| KV pool | `GPU KV cache size` at boot | 332,822 tokens in 11.84 GiB at MAXLEN 170000 (≈ 37.3 KiB/token incl. drafter + padding) | server log |
| util | `--gpu-memory-utilization` — the share of VRAM vLLM reserves at boot | 0.90 → weights 14.89 GiB + KV 11.84 GiB + activations/graphs | fixed |

## Results — memory per turn (all MEASURED)

| Rep | Turn | Context tok | New tok | TTFT s | Decode tok/s | Gen (think) tok | finish | KV pool used | Peak VRAM MiB (turn) | Peak GTT MiB (turn) |
|----:|-----:|------------:|--------:|-------:|-------------:|----------------:|--------|-------------:|---------------------:|--------------------:|
| 0 | 0 | 148,642 | 148,642 | 101.57 | 66.4 | 1024 (542) | length | 45.9 % | **30,259** | **120** |
| 0 | 1 | 149,866 | 2,906 | 3.38 | 64.5 | 1024 (732) | length | 46.5 % | 30,234 | 100 |
| 0 | 2 | 151,090 | 2,370 | 2.68 | 134.1 | 879 (616) | stop | 46.6 % | 30,230 | 86 |
| 0 | 3 | 152,168 | 2,568 | 3.03 | 174.0 | 875 (613) | stop | 46.8 % | 30,233 | 100 |
| 0 | 4 | 153,242 | 2,762 | 3.09 | 179.3 | 875 (613) | stop | 47.4 % | 30,206 | 108 |
| 0 | 5 | 154,316 | 2,076 | 2.57 | 179.4 | 876 (614) | stop | 47.5 % | 29,929 | 82 |
| 0 | 8 | 157,541 | 2,661 | 3.07 | 178.2 | 876 (614) | stop | 48.5 % | 29,929 | 88 |
| 0 | 13 | 162,916 | 2,756 | 3.19 | 176.6 | 876 (614) | stop | 49.9 % | 29,831 | 74 |
| 0 | 18 | **168,291** | 1,971 | 2.69 | 176.0 | 876 (614) | stop | **51.1 %** | 29,774 | 70 |
| 1 | 0 | 148,642 | 148,642 | 98.70 | 65.7 | 1024 (536) | length | 45.9 % | 29,774 | 71 |
| 1 | 1 | 149,866 | 2,906 | 3.29 | 66.3 | 1024 (760) | length | 46.5 % | 29,774 | 72 |
| 1 | 2 | 151,090 | 2,370 | 2.61 | 73.5 | 1024 (746) | length | 46.6 % | 29,774 | 71 |
| 1 | 3–6 | 152,314–155,374 | 1,974–2,714 | 2.53–3.01 | 143.6–179.3 | 821 (612) | stop | 47.2–47.7 % | 29,774 | 68–70 |
| 1 | 7 | ~156.4k | — | — | — | — | **FAILED** | — | 29,774 → 29,669 | 66–74 |

Rep 0 turns 6–7, 9–12 and 14–17 are omitted, as they lie between the rows shown (all in `results.jsonl`). The deepest request: 168,291 prompt + 876 generated = **169,167 tokens** in a 170,000 window. The tool stops before the next turn would overflow, and no request was rejected. VRAM at load (before the probe) was 29,680 MiB.

**Memory over time** (1 s samples, every change ≥ 8 MiB; MEASURED). No chart: `report.py` has no time-series view, and its `memory.svg` needs several probes. A `memory_timeline.svg` view is proposed as a tool extension.

| t (s from probe start) | Device VRAM MiB | GTT MiB | What was running |
|-----------------------:|----------------:|--------:|------------------|
| 0 | 29,680 | 90 | idle, before turn 0 |
| 1–153 | 30,185–30,254 | 84–108 | rep 0 turn 0 (cold 150k prefill) → turns 1–4 |
| 157–186 | 29,923–29,944 | 74–88 | rep 0 turns 5–8 |
| 219–227 | 29,831 → 29,774 | 68–72 | rep 0 turn 13 |
| 227–452 | 29,774 (flat) | 66–74 | rep 0 turns 13–18, rep 1 turns 0–7 |
| 452–504 | 29,686 / 29,669 | 66–74 | fault and hang (busy 10 % → 100 %) |

> Flat, no upward drift. The two steps *down* (30,2xx → 29,93x at turn 5; → 29,774 at turn 13) are device-wide; the sampler cannot attribute them to vLLM or the desktop. GTT stays inside the 64–120 MiB idle band throughout: no host-RAM spill. MEASURED.

**KV pool occupancy** — vLLM's `kv_cache_usage_perc` scales linearly with context: (context + generated) ÷ 332,822 matches it within ~3k tokens on every turn (e.g. 0.5114 × 332,822 = 170,205 vs 169,167). The ~3k gap is INFERRED to be block rounding at the 880-token cache granularity plus the drafter's slots. Between turns the gauge falls to 0. Finished requests' blocks stay cached but count as free.

**Conversation: decode per turn** — ![Conversation decode](../../../campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k/results/charts/conv_decode.svg)

> Two regimes, explained in finding 3: ~65 tok/s while the model reasons from scratch (1024-token `length` turns), ~171–179 tok/s once it reproduces its earlier answer (`stop` turns with identical 876/821-token lengths). MEASURED.

**Power by phase** — ![Power by phase](../../../campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k/results/charts/power_phase.svg)

> Prefill 207 W, decode 210 W on average, peaks 318 / 240 W. Decode mclk was 1,258 MHz in 98 % of samples; prefill mclk median 456 MHz at sclk ~2.6 GHz (power-limited, as before). No phase flagged. MEASURED.

## FAILED rows

| What | Where | Evidence (MEASURED) | Handling |
|------|-------|---------------------|----------|
| **GPU memory fault, engine dead** | rep 1, turn 7: prefill of the new turn on ~154k cached / ~156.4k context | `HSA_STATUS_ERROR_MEMORY_FAULT` at 15:21:17, kernel `radiance_mxfp4_fp8_gemm_atiled<2, true, 128, false, 4, false, 0>`, "Page not present or supervisor privilege", grid [139264, 4, 1]; GPU busy fell to ~10 % then 100 %; `EngineDeadError` at 15:27:30; the client got "no tokens received" after **387.3 s** | turn recorded with `error` (iron rule 18); conversation stopped; `run.sh` stopped the server; VRAM verified idle afterwards (32,186 MiB free) |

**MXFP4 fault tally across all four campaigns today** (smoke, baseline, DFlash 150k, this run): **2 faults in 84 requests, 2 of 4 serving boots**. Both were in the same kernel, during the prefill of a turn on ≥115k cached tokens, in the **second** deep conversation of a boot, and both hung the engine ~6.5 min (387 s here; 402 s in the baseline).

## Consequences & root causes

1. **No memory creep on vLLM, by construction and by measurement.** vLLM reserves `util × VRAM` at boot and allocates KV blocks from that fixed pool, so filling the window changes pool occupancy, not device memory (INFERRED from vLLM's design, CLAIMED in its docs). The measurement agrees: the peak (30,259 MiB) came during the first cold 150k prefill (activation buffers), and the following 5 minutes were flat or lower (MEASURED). The llama.cpp+MTP creep you have seen has no counterpart here.
   **→ A boot that survives its first deep prefill does not grow afterwards. Watch the boot and the first deep prefill, not the long tail.**

2. **At util 0.90 the window is not memory-bound.** A full 170k sequence uses 51 % of the pool (MEASURED). The pool would hold 332k tokens, more than the model's native 262,144. So a single-agent `MAXLEN` up to 262,144 fits by arithmetic (INFERRED; untested, and rule 7 forbids presenting it as usage). In the other direction, each 0.01 of util is ~326 MiB ≈ 8.9k tokens of pool at 37.3 KiB/token. util **0.85** would still leave a ~288k pool for a 170k window and give the desktop ~1.6 GiB more headroom (INFERRED).
   **→ "Safe maximum": util 0.90 peaks at 30,259 MiB device-wide, below your 30.8 GB stability reference. Raising util buys nothing for one agent. If the desktop needs room, lowering it to 0.85 costs nothing at 170k.**

3. **Repeating the same task makes the model repeat its answer, and the drafter feeds on it.** From turn 2–3 on, every reply has the identical length (876 tokens, 614 thinking in rep 0; 821/612 in rep 1) and ends with `stop`, against 1024 `length` turns before (MEASURED). INFERRED: the model sees the same question again with its previous answer in context and reproduces it. The image's n-gram lookup draft copies it almost token for token (overall acceptance 66.6 %, τ 5.66, MEASURED), which inflates decode to ~178 tok/s. The fresh-reasoning turns are the representative ones: **~65 tok/s for 1k-token hard thinking at 149–151k context**, against 17.9 tok/s AR at 136k in the baseline (≈ 3.6×; MEASURED rates, not depth-matched). Reply text is still not captured, so "identical" rests on identical token counts. This is not Sly #164 (lock-in *within* one output); it is cross-turn copying of an identical prompt.
   **→ For speed figures, use distinct tasks per turn. `thinking-hard.prompt.txt` holds one task; a `---`-separated file with several would fix that.**

4. **Reliability is the real ceiling, and the fault now looks patterned.** The same `radiance_mxfp4_fp8_gemm_atiled` kernel faulted twice under the same conditions: prefill on a deep cached prefix, in the boot's second deep conversation (MEASURED). The DFlash 150k campaign ran two deep conversations without a fault, so it is not deterministic. INFERRED candidates, in priority order:
   - (a) The A-tiled prefill GEMM path itself. `RADIANCE_MXFP4_A_TILED_MIN_M` above the 2048 chunk would bypass it.
   - (b) Prefix-cache block reuse once the pool has to evict blocks cached by the first conversation. Here rep 0's ~169k plus rep 1's ~156k ≈ 325k of the 332,822-token pool at the fault turn.
   - (c) Something in 1.6.0's new prefill stack, testable with the 1.5.x image.
   **OPEN.** A hung engine keeps `/health` answering, and the client waited 387 s.
   **→ Not safe for unattended long agent runs yet. Concretely: one deep conversation per boot has not faulted (0 of 4 first conversations); restarting between long sessions is a workaround (INFERRED, n small).**

## Recommended config

```bash
MAXLEN=170000 PROFILE=sly-radiance/qwen38-mxfp4-dflash PORT=8000 stack/serve/vllm/serve_vllm.sh   # util 0.90, fp8 KV
# optional desktop headroom (INFERRED, untested): GPU_UTIL=0.85 → pool ≈ 288k tokens, still > 1.6 × 170k
```

Memory-safe at 170k with no creep (MEASURED). Use it with a client-side timeout well under 387 s, and restart between long sessions until the fault is bisected.

## Methodology & caveats

- One server: the DFlash profile from `campaigns/perf/2026-10-22-1406-vllm-sly-mxfp4-dflash/` with only MAXLEN changed (150000 → 170000). Boot took 408 s (the new max length triggered a recompile; INFERRED from the 236 s warm boot).
- Turn 0 = 148,642 tokens of `codereview-200000.txt` (the tool targets 150,000 from a sampled chars/token ratio). Turns ≥ 1 = `thinking-hard.prompt.txt` + the previous reply in history, temperature 0.2, `reasoning_effort: high`. The new-token counts (~2–2.9k per turn for ~1.2k of genuinely new text) include the re-prefill from the 880-token cache granularity (see the DFlash 150k analysis, finding 6).
- VRAM is device-wide and includes the desktop GUI. Per-process residency (`amd-smi process`) was not sampled.
- Tool changes made for this run (approved): `capture_engine.py conversation --turn-prompt` and `kv_usage_peak`; `engine-bench/run.sh` `TURN_PROMPT`; `gen_campaign.py` probe key `turn_prompt`. They were stress-tested on a mock vLLM (turn cycling, stop rule never overflows, KV polling, no `/metrics` → null) and run end-to-end through `run.sh`. Regression: all 7 emittable campaign specs re-emit byte-identically, and conversation mode without `--turn-prompt` sends identical requests and rows.
- Not measured: util other than 0.90, MAXLEN > 170000, concurrency > 1, reply text.

Full chart appendix: [`appendix.md`](../../../campaigns/perf/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k/results/appendix.md) (adds `conv_prefill_new.svg`, `conv_ttft.svg`). Proposed tool extension: a `report.py` VRAM/GTT-over-time chart from `gpu_samples.csv` with turn boundaries.
