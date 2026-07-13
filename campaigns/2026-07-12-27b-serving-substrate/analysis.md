<!-- meta
date: 2026-07-13 07:33
slug: 27b-serving-substrate
title: 27B serving substrate — real prefill curve, KV f16/q8_0, MTP decode, cache reuse (R9700)
takeaway: The "slow prefill" was a small-input artifact — real prefill at depth is 666–831 tok/s (3–4× the 75-token number) and sags with depth. Prompt-cache reuse cuts 32K ttft 42.7s→3.1s (13.7×) — the big agentic win (built-in; explicit --cache-reuse flags add nothing). KV q8_0 REJECTED (−12%/−19% prefill for ~0 decode gain). MTP = 2.0× decode for −5% prefill + ~1.4 GiB. ROCm/HIP ~92× slower prefill than Vulkan on gfx1201 (8 vs 756 tok/s). Frozen substrate for Campaign 2: vulkan · f16 · MTP-on.
-->

# Benchmark: 27B serving substrate — real prefill curve, KV f16/q8_0, MTP decode, cache reuse — R9700 (gfx1201)

- **Date:** 2026-07-13 07:33 · **Track:** engine-bench campaign (`run.sh`, resumable, 10 probes)
- **GPU/Host:** AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB / 32624 MiB) · Ryzen 5 3600 · Ubuntu 24.04 · ROCm 7.x · `HSA_OVERRIDE_GFX_VERSION=12.0.1`
- **Runtimes/builds:** llama.cpp **b9950-961e4b26a**, **Vulkan/RADV** (:8081) · `-ub 2048 -b 4096 -fa on` · ctx 65536 · np 1
- **Models:** `Qwen3.6-27B-MTP-Q4_K_M.gguf` (the substrate transfers to jackrong-qwopus; same hybrid arch + Q4_K_M — re-confirmed in Campaign 2 B0)
- **Data:** `bench/runs/2026-07-12-27b-serving-substrate/` (`results.jsonl`, per-probe `gpu_samples.csv`, `report.html`) · Plan: `docs/plans/2026-07-12-27b-agentic-config-campaign-series.md` (this is **Campaign 1 of 3**)

## Summary

The previous campaign's "slow prefill" was a **measurement artifact of 51–99-token prompts**, now put
to rest: at real depth, prefill is **831 tok/s @8K → 756 @32K → 666 @64K** (3–4× the ~200 figure) and
sags with depth as attention grows. The decisive agentic result is **prompt-cache reuse: a warm 32K
prefix drops time-to-first-token from 42.7 s to 3.1 s (13.7×)** — reuse, not raw prefill speed, is
what makes 10–50K agentic turns viable. **KV q8_0 is rejected**: it costs −11.8% prefill at 32K and
−19.1% at 64K for a decode tie (−1.4%, noise), and the ~2 GiB it saves is VRAM you don't need (peak
was 21.5 GiB with ~11 GiB headroom). **MTP delivers a clean 2.0× decode** (27.8→55.2 tok/s) for a
−5.2% prefill tax and +1.4 GiB. No failures, no guard skips, no throttling. Two follow-up passes (below) settled the last questions:
**ROCm/HIP prefills ~92× slower than Vulkan (~8 vs 756 tok/s)** — Vulkan is decisively the backend;
and the explicit `--cache-reuse`/`--cache-ram` flags **change nothing** for a stable prefix (the
built-in cache already wins). **Frozen substrate for Campaign 2: Vulkan · KV f16 · MTP-on**, with
prompt-prefix reuse relied on as-is. MTP's *quality* (the temp-1.0 runaway) is deferred to Campaign 2.

## Legend — knobs & labels in this run

| Term | What it is | Effect on this box (MEASURED here) | How it's tested |
|------|------------|-------------------------------------|-----------------|
| depth / `crN` | code-review prompt padded to N tokens from the tracked corpus | prefill **sags** with depth (831→666 tok/s, 8K→64K); decode too (30.7→25.5) | openai_probe vs a fresh server, `PREFIX_MODE=unique`, 256-tok decode |
| `prefix_mode` | `unique` = cold prompt cache, `shared` = warm | **shared 32K = 13.7× faster ttft** (42.7→3.1 s) — reuse dominates | `pf-*` (unique) vs `warm-*` (shared) |
| KV `f16` | 16-bit KV entries — baseline | 64 KiB/tok; peak 21.5 GiB @65536 ctx, 11 GiB headroom | baseline side of the KV A/B |
| KV `q8_0` | 8-bit block-quantized KV | saves ~2 GiB but **−12%/−19% prefill** at 32K/64K, decode tie | `sub-q8` servers |
| MTP | multi-token prediction (`--spec-type draft-mtp`, draft head in the GGUF) | **+99% decode** (2.0×), −5.2% prefill, +1.4 GiB VRAM, +GTT | `sub-mtp1` server |
| prefill tok/s | prompt_tokens ÷ ttft | **the real number**; 75-tok prompts gave ~200 (fixed-overhead artifact), 8–64K give 666–831 | cold `pf-*` probes |
| decode tok/s | generation rate | ~30 f16 single-stream; **~55–61 with MTP** | 256/512-tok generation |
| ttft s | time to first token | dominated by prefill (or the ~0.66 s fixed floor at tiny prompts) | streamed |
| peak GTT MiB | host-RAM (GTT) spill; idle ≈ 77 MiB | 424–911 MiB parked **with 11 GiB VRAM free** → Vulkan allocation choice, not forced; MTP parks most | `gpu_samples.csv` |

## Results (all MEASURED; memory columns mandatory)

reps 3 (warm 4), request-only means. Server ctx 65536, np 1, `-ub 2048 -b 4096 -fa on`, Vulkan b9950.

| probe | KV | MTP | prefix | prompt tok | Prefill tok/s | Decode tok/s | ttft s | Peak VRAM MiB | Peak GTT MiB | avg W |
|-------|:--:|:---:|:------:|-----------:|--------------:|-------------:|-------:|--------------:|------------:|------:|
| pf-cr8000 | f16 | 0 | unique | 8131 | **830.8** | 29.8 | 9.79 | 21414 | 424 | 287 |
| pf-cr32000 | f16 | 0 | unique | 32264 | 756.3 | 27.8 | 42.66 | 21484 | 469 | 291 |
| pf-cr64000 | f16 | 0 | unique | 62368 | 666.1 | 25.5 | 93.63 | 21536 | 538 | 291 |
| **warm-cr32000** | f16 | 0 | **shared** | 32242 | **10332.3** | 27.8 | **3.12** | 21336 | 531 | 288 |
| dec-think | f16 | 0 | unique | 238 | 358.2 | 30.7 | 0.66 | 21320 | 531 | 281 |
| pf-cr32000-q8 | q8_0 | 0 | unique | 32262 | 666.9 | 28.2 | 48.38 | 19423 | 445 | 294 |
| pf-cr64000-q8 | q8_0 | 0 | unique | 62366 | 539.0 | 26.3 | 115.70 | 19765 | 500 | 297 |
| dec-think-q8 | q8_0 | 0 | unique | 238 | 326.1 | 30.2 | 0.73 | 19753 | 487 | 277 |
| pf-cr32000-mtp1 | f16 | 1 | unique | 32264 | 716.7 | **55.2** | 45.02 | 22949 | **911** | 293 |
| dec-think-mtp1 | f16 | 1 | unique | 237 | 315.4 | **61.0** | 0.76 | 22602 | 884 | 250 |

Peak VRAM never exceeded **22.9 GiB** (≈9.7 GiB below the 32624 MiB physical) — the guard skipped
nothing and there was no OOM. Peak GTT sat 424–911 MiB above the ~77 MiB idle baseline (flagged
below).

### Follow-up passes (both run)

| pass | probe | result | vs Vulkan baseline | verdict |
|------|-------|--------|--------------------|---------|
| **cache-reuse flags** (`--cache-reuse 256 --cache-ram 8192`) | pf-cr32000 (cold) | 755.6 tok/s, ttft 42.70 s | 756.3 / 42.66 — **identical** | flags don't help the *identical-prefix* case |
| **cache-reuse flags** | warm-cr32000 | prefill 10388.7 tok/s, ttft **3.11 s** | 10332 / 3.12 — **identical** | built-in prefix cache already wins; residual 3.1 s is a re-eval floor, not uncached prefill |
| **ROCm/HIP b9950** (same flags, :8080) | pf-cr32000 (cold) | **~8.1 tok/s** prefill (from server `print_timing`, steady 8.06–8.23 tok/s at 4K/8K/12K) | vs **756** tok/s | **~92× slower — HIP unusable at depth; killed after 12K/32K tokens (~25 min in)** |

## KV decision — q8_0 REJECTED (≤5% rule, decisively)

| Depth | f16 prefill | q8_0 prefill | Δ prefill | f16 decode | q8_0 decode | Δ decode | VRAM saved | Verdict |
|------:|------------:|-------------:|----------:|-----------:|------------:|---------:|-----------:|---------|
| 32K | 756.3 | 666.9 | **−11.8%** | 27.8 | 28.2 | +1.4% (tie) | ~2.0 GiB | **REJECT** |
| 64K | 666.1 | 539.0 | **−19.1%** | 25.5 | 26.3 | +3.1% (tie) | ~1.8 GiB | **REJECT** |

The classic ≤5% rule targets decode; decode is a tie here, but **prefill fails badly and worsens with
depth** (−12% → −19%). For an agentic workload that prefills 10–50K every turn, prefill is
first-class, so q8_0 is disqualified. The ~2 GiB it frees is meaningless at these depths (11 GiB
already free). **Stay f16.**

## What moved the needle

| Change | Prefill Δ | Decode Δ | Memory Δ | Note |
|--------|----------:|---------:|---------:|------|
| **prefix reuse** (warm 32K) | **+13.7×** (756→10332) | — | ~0 | ttft 42.7→3.1 s — the agentic headline |
| **MTP on** (32K) | −5.2% (756→717) | **+99%** (27.8→55.2) | +1.5 GiB VRAM, +442 GiB→wait +442 MiB GTT | 2.0× decode for a small prefill tax |
| **q8_0** (32K) | −11.8% | +1.4% (tie) | −2.0 GiB VRAM | rejected (see above) |
| depth 8K→64K (f16) | −20% (831→666) | −17% (29.8→25.5) | +122 MiB VRAM | both sag with context |

## Consequences & root causes (ultrathink)

1. **The "slow prefill" was a small-input artifact — CONFIRMED (MEASURED).** Last campaign's 51–99-tok
   prompts measured ~200 tok/s because `prefill_tps = prompt_tokens ÷ ttft` and a ~0.25–0.66 s
   fixed per-request floor (Vulkan command-buffer/pipeline setup + graph build + single-ubatch
   launch) dominated. At real depth the floor amortizes: **831 tok/s @8K, 756 @32K, 666 @64K.** The
   `dec-think` probe (238 tok, ttft 0.66 s, "prefill" 358 tok/s) is the left tail of the same curve —
   another point on the fixed-floor line. **Consequence:** never quote prefill from sub-1K prompts;
   your 10–50K operating point runs at ~700–830 tok/s cold. Prefill **declines** with depth
   (quadratic attention), so a 64K turn costs ~94 s cold — which is exactly why reuse matters.

2. **Prefix reuse is the real agentic lever, not raw prefill — MEASURED.** A warm 32K prefix reaches
   first token in **3.1 s vs 42.7 s cold (13.7×)**. For a coding agent whose 10–20K system+code
   prefix is stable across tool-call turns, the big prefill is paid once; every subsequent turn is
   near-instant to first token. **Consequence:** keep the prefix byte-stable (no timestamps/
   reordering at the head — the "prompt-cache killer"); the reuse is automatic. **RESOLVED (was
   OPEN):** the warm ttft floors at **3.1 s, not ~0**, and adding `--cache-reuse 256 --cache-ram
   8192` did **not** lower it (3.11 vs 3.12 s). So the built-in prefix cache already reuses the full
   matched prefix; the residual ~3.1 s is a **re-eval floor** — the server still runs ~one micro-batch
   (~2048 tok at ~756 tok/s ≈ 2.7 s) at the tail plus the first-token forward pass. The KV-shift
   flags' payoff is for a *prefix + changed tail* (a real tool-result turn), which the identical-
   prompt `shared` probe can't exercise — build a fixed-prefix+delta fixture in Campaign 2 to measure
   it. Net: for a stable agentic prefix you get ~3 s to first token vs ~43 s cold, out of the box.

7. **ROCm/HIP is unusable for prefill at depth on gfx1201 — MEASURED, decisive.** Same model, same
   build (b9950), same flags (`-fa on -ub 2048 -b 4096`), only the backend changed: HIP prefilled at
   a steady **~8.1 tok/s** (8.06–8.23 across 4K/8K/12K tokens, from the server's own `print_timing`)
   vs Vulkan's **756 tok/s at 32K — a ~92× gap.** A single 32K prefill would take ~66 min on HIP, so
   the probe was killed. **Consequence:** the substrate uses **Vulkan**, full stop; this quantifies
   the repo's standing "Vulkan is champion" fixpoint at the agentic operating point. **OPEN (parked,
   low priority):** the pathology is likely the ROCm flash-attention path on RDNA4 (`-fa on`) rather
   than ROCm compute per se — an `-fa off` / hipBLASLt-tuned retry might recover, but it's a rabbit
   hole with no upside given Vulkan already wins; revisit only if a ROCm-only feature is ever needed.

3. **q8_0 hurts prefill but not decode, and the hit grows with depth — MEASURED + INFERRED.** −11.8%
   at 32K → −19.1% at 64K, decode unaffected. **INFERRED mechanism:** quantized KV must be
   dequantized on every attention read; during *prefill* the model attends over the whole growing
   context, so dequant overhead scales with depth (hence the widening gap); during *decode* (one
   query against KV) the per-step KV read is small relative to other work, so the cost hides in the
   noise. **Consequence:** q8_0 only makes sense when VRAM actually binds (very long context / many
   `-np` slots) — not at 10–50K where f16 has 11 GiB to spare.

4. **MTP is a 2.0× decode win with a small, depth-independent prefill tax — MEASURED.** 27.8→55.2
   (cr32k) and 30.7→61.0 (think), prefill −5.2%, VRAM +1.4 GiB (draft head), GTT +~400 MiB. Decode is
   the bottleneck for long agentic outputs (tool args, code, reasoning), so the 2× dwarfs the −5%
   prefill. **Consequence:** keep MTP **on** in the substrate. ⚠️ **Quality caveat (deferred):** the
   finetune-quality campaign saw MTP-on diverge into a runaway at **temp 1.0** — a
   sampling-trajectory effect, not a speed issue. Campaign 2 fixes sampling (temp 0.6) and tunes
   `--spec-draft-p-min` before MTP-on is blessed for quality.

5. **Decode also sags with depth — MEASURED.** 30.7 (238) → 27.8 (32K) → 25.5 (64K), f16, as KV grows
   and each decoded token reads more cache. MTP lifts the whole curve ~2×. **Consequence:** a long
   agentic context taxes both phases; reuse (keeps prefill off the critical path) + MTP (lifts
   decode) are complementary and both belong in the substrate.

6. **GTT parking, not a spill — MEASURED, flagged.** Peak GTT 424–911 MiB (MTP worst at 911) sat well
   above the ~77 MiB idle baseline **while 9–11 GiB of VRAM was free**, and nothing froze. So this is
   the Vulkan backend electing to place some host-visible buffers in GTT, not a forced overflow.
   Same pattern as the finetune-quality run. **OPEN (low priority):** does it vanish at a smaller
   ctx, and does it ever matter for latency? Not a blocker at this operating point.

## Recommended config (frozen substrate → Campaign 2 input)

```bash
# Vulkan · KV f16 · MTP on · prompt-cache reuse — the serving substrate for agentic coding
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
  CTX=65536 NP=1 KV=f16 MTP=1 UB=2048 B=4096 FA=on \
  EXTRA_ARGS="--cache-reuse 256 --cache-ram 8192" \
  bash bench/engine-bench/serve_llamacpp.sh
```
(For jackrong-qwopus swap the model path and drop `MTP=1` — it has no MTP head. Sampling and
`--reasoning-budget` are set in Campaign 2, not here.)

## Methodology & caveats

- **Fixtures:** tracked `codereview-{8000,32000,64000}.txt` (real code corpus) + `thinking-hard.txt`.
  Prefill probes `--api completions`, cold (`PREFIX_MODE=unique`), max_tokens 256; warm probe
  `PREFIX_MODE=shared`; decode probes `--api chat`, max_tokens 512. reps 3 (warm 4).
- **Decode probes hit the 512-token thinking cap** (`think_tokens=512`, no answer) — fine for a
  *decode-rate* measurement (tok/s is phase-agnostic), but that's why `ttfa_s` is null on those rows;
  ttfa/quality are Campaign 2's job, not this one.
- **Follow-up passes (both run, results above):** (A) the `--cache-reuse`/`--cache-ram` variant
  (README §A) — no change for a stable prefix (finding #2); (B) the **Vulkan vs ROCm/HIP** @32K
  spot-check (README §B) — HIP ~92× slower, killed early (finding #7). HIP data is the server
  `print_timing` log, not a completed `results.jsonl` row (the probe never finished a rep).
- **Held fixed:** model, backend (Vulkan b9950), ub/b/fa, ctx 65536, np 1. One variable per row.
- **No throttling:** avg power 250–297 W across probes; no thermal cap observed in `gpu_samples.csv`.
- **Single model:** substrate measured on the unsloth-MTP build (uniquely carries MTP); prefill/KV/
  cache are arch+quant-determined and expected to transfer to jackrong — Campaign 2 B0 confirms.
- `report.html` auto-generated by `run.sh` (`bench/lib/report.py`) in the run dir.
