<!-- meta
date: 2026-07-12 00:06
takeaway: 27B dense (Q4_K_S, 15.01 GiB) max-context on Vulkan. **Both formula ceilings exceeded**: f16 KV loads + serves a 40K prompt at **65536 (64K)**, q8_0 at **122880 (120K)** — the conservative 30–31 GiB budget under-called by ~10% (real usable ≈ 31.2 GiB, compute buffer only ~0.6 GiB). First 27B-dense numbers at 40K depth: **prefill ~742 tok/s f16 / ~635 q8_0 (−14%), decode flat ~28.5 tok/s (dense = weight-bound → KV quant is decode-neutral, even slightly faster)**. TTFT 54s f16 vs 63s q8_0. No upper OOM captured (ceilings pinned from below); no VRAM sampled (inferred from KV math). q8-c104k/c112k not re-run but fit by monotonicity (c120k passed).
-->

# Benchmark: 27B dense — f16 & q8_0 max-context ceilings + first 40K-depth throughput — R9700 (gfx1201)

- **Date:** 2026-07-12 00:06 · **Track:** engine-bench campaign (`run.sh` per-probe, `serve_llamacpp.sh` Vulkan launcher; consolidated by the `27b-maxctx-f16` campaign)
- **GPU/Host:** AMD Radeon AI PRO R9700, ~31.86 GiB usable · `HSA_OVERRIDE_GFX_VERSION=12.0.1` · ROCm 7.x · Ryzen 5 3600, 31 GB RAM, no swap
- **Runtimes/builds:** llama.cpp **Vulkan/RADV** — base knobs `-ub 2048 -b 4096 -fa on -ngl 99` · build **b9950** *(per campaign spec; `build_commit` was `null` in the captured `/props`, so unconfirmed from artifacts)*
- **Models:** `Qwen3.6-27B-Q4_K_S.gguf` (dense, 15.01 GiB, **no MTP/draft layer**) · **Data:** `bench/runs/2026-07-12-27b-maxctx-f16/` (consolidated) + per-probe `bench/runs/2026-07-12-00{09,12,15,18,21,28}-engine-maxctx-*/` dirs

## Summary

Pinning how deep the **27B dense** model can go on this 32 GB box. Unlike the 35B MoE (tiny KV, RoPE-bound to 262144), the 27B is **VRAM-bound**: f16 KV costs **260 KiB/token** (~12× the MoE), so context is gated by the VRAM budget, not the RoPE cap. **Both empirical ceilings landed ~10% above the conservative formula.** f16 KV **loads and serves a 40K prompt at 65536 (64K)** — the top of the requested f16 bracket, and already at ~98% of usable VRAM; q8_0 KV does the same at **122880 (120K)**. First 27B-dense throughput at 40K depth: **prefill ~742 tok/s (f16) vs ~635 (q8_0), a −14% KV-quant tax**, while **decode is flat at ~28.5 tok/s** and essentially unchanged by KV quant (dense decode is weight-bandwidth-bound, so q8_0 is decode-neutral — even a hair faster). The one caveat that bounds every claim here: **no VRAM was sampled and no server was pushed to OOM**, so both ceilings are pinned **from below** (highest config that loaded), with the upper bound established only by KV-budget arithmetic.

## Legend — every knob & label used in this run

| Term | What it is | Effect on this box (R9700 / RDNA4, 32 GB) | How it's tested here |
|------|------------|-------------------------------------------|----------------------|
| `Q4_K_S` | GGUF weight quantization of the 27B dense model | weights = **15.01 GiB** resident; leaves ~16.2 GiB for KV+compute out of ~31.86 usable | fixed per run (meta.txt) |
| KV `f16` | 16-bit KV-cache entries — the baseline | **260 KiB/token** here (block_count 65 · head_count_kv 4 · key/value_length 256) → the dominant VRAM consumer; caps context near **64K** | f16 arm, 4 ctx steps 48K→64K |
| KV `q8_0` | 8-bit block-quantized KV cache | **138 KiB/token** (~0.53× f16) → ~1.9× the context depth; costs **−14% prefill**, **decode-neutral** here (MEASURED) | q8_0 arm, ctx 96K & 120K |
| `-ub 2048` (n_ubatch) | micro-batch: tokens per prefill forward pass | held at the 35B sweep optimum; **not re-swept for the dense model** (separate scope) | fixed |
| `-b 4096` (n_batch) | logical batch: max tokens per submission | held fixed | fixed |
| `-fa on` (flash attention) | fused attention kernel | on everywhere; **required for q8_0 KV** | fixed |
| MTP | multi-token-prediction speculative decode | **N/A** — the 27B dense GGUF has no embedded draft layer | not a knob here |
| depth (40K probe) | `codereview-40000.txt` (~39,973 tok real) prefill + 256-token decode | one reused fixture that fits every slot; server-start is the ceiling gate, the 40K prefill confirms it actually serves | `PREFIX_MODE=unique`, REPS=2, `--api completions` |
| ctx / `-c` | KV slots allocated at load (full alloc up front) | **server-start success = the ceiling gate** (KV is allocated to full `-c` on load) | one server per ctx step |
| Prefill tok/s | prompt-processing rate over the 40K prompt | ctx-alloc-invariant (see f16 flatness); the f16↔q8_0 gap isolates KV dtype | `results.jsonl` aggregate |
| Decode tok/s | text-generation rate (per stream), 256-token sample at ~40K depth | dense → **weight-bandwidth-bound** (~15 GiB read/token) → slow & KV-dtype-insensitive | `results.jsonl` aggregate |
| TTFT p50/p95 | time to first token (≈ full 40K prefill here) | ~54s f16 / ~63s q8_0 — the agent-facing latency of a 40K code-review prompt | per-request timing |
| `ttfa` / `think_tokens` | time-to-first-*answer* / reasoning tokens | **spurious here** (completions API + non-thinking fixture emits a stray `think_tokens:1`); ignore — not a thinking run | n/a |
| `prefix_mode=unique` | cold prompt cache (honest prefill) | avoids the ~2.4× warm-cache inflation | probe default |
| formula max `-c` | `gen_campaign.py vram-ctx` prediction from KV KiB/tok + a 30–31 GiB budget | **under-called by ~10%** here — real usable ≈ 31.2 GiB, compute buffer only ~0.6 GiB | compared vs measured ceiling |

## Results (all MEASURED; consolidated `results.jsonl`, n_ok=2/2 each)

| Config | ctx (`-c`) | KV | prompt tok | Prefill tok/s | Decode tok/s | TTFT p50/p95 (s) | Aggregate tok/s | Load+serve 40K |
|--------|-----------:|:--:|-----------:|--------------:|-------------:|-----------------:|----------------:|:--------------:|
| maxctx-f16-c48k | 49152 | f16 | 39,973 | 744.2 | 28.48 | 53.43 / 53.71 | 4.09 | **PASS** |
| maxctx-f16-c56k | 57344 | f16 | 39,973 | 743.6 | 28.49 | 53.74 / 53.75 | 4.08 | **PASS** |
| maxctx-f16-c60k | 61440 | f16 | 39,969 | 741.4 | 28.35 | 53.83 / 53.91 | 4.07 | **PASS** |
| **maxctx-f16-c64k** | **65536** | f16 | 39,971 | 740.8 | 28.47 | 53.91 / 53.96 | 4.07 | **PASS (f16 ceiling)** |
| maxctx-q8-c96k | 98304 | q8_0 | 39,971 | 636.3 | 29.09 | 62.66 / 62.82 | 3.58 | **PASS** |
| maxctx-q8-c104k | 106496 | q8_0 | — | — | — | — | — | not re-run¹ |
| maxctx-q8-c112k | 114688 | q8_0 | — | — | — | — | — | not re-run¹ |
| **maxctx-q8-c120k** | **122880** | q8_0 | 39,972 | 634.7 | 29.13 | 62.87 / 62.98 | 3.57 | **PASS (highest q8_0 tested)** |

¹ c104k/c112k FAILED in a **broken first pass** (a probe/consolidation error, **not** a server OOM — the entries in `failures.txt` are `FAILED:` lines, never `SERVER-OOM`) and were not re-run. Both sit **below** the passing c120k (122880) in KV footprint, so **they are guaranteed to load** by monotonicity (INFERRED). ⚠️ Note `failures.txt` lists all 8 slugs as FAILED — it is **stale from that first pass**; the authoritative success signal is `done/` + `results.jsonl` (6 configs, n_ok=2/2).

## Ceiling vs formula (the headline)

| KV | KiB/tok | Formula max `-c` (30/31 GiB budget) | **Measured highest PASS** | Total VRAM at PASS (INFERRED) | % of 31.86 GiB |
|----|--------:|------------------------------------:|--------------------------:|------------------------------:|---------------:|
| f16  | 260 | ~54.9K / ~58.8K | **65536 (64K)** | 15.01 + 16.25 KV ≈ **31.26 GiB** (+~0.6 compute) | ~98% |
| q8_0 | 138 | ~103K / ~111K   | **122880 (120K)** | 15.01 + 16.16 KV ≈ **31.17 GiB** (+~0.6 compute) | ~98% |

Both measured ceilings **exceed** the formula by ~8–11%. Root cause is arithmetic, not luck: the formula reserved a conservative 30–31 GiB budget, but both configs actually pass while sitting at **~31.2 GiB total → the real usable budget is ~31.2 GiB and the Vulkan compute buffer at `-ub 2048` is only ~0.6 GiB** (INFERRED from KV math; not VRAM-sampled). At that occupancy **64K is effectively the f16 max** (no room for another step) and **120K is at/near the q8_0 max** (~122–124K theoretical) — consistent with the empirical results, not just below them.

## What moved the needle (deltas)

| Change | Prefill Δ | Decode Δ | TTFT Δ | Note |
|--------|----------:|---------:|-------:|------|
| ctx 48K → 64K (f16, fixed 40K prompt) | 744→741, **−0.5%** | ±0.1, tie | +0.5s | `plateau_within_noise` — **prefill is ctx-alloc-invariant** (control for the row below) |
| **f16 → q8_0 KV** (at 40K depth) | 742.5 → 635.5, **−14.4%** | 28.45 → 29.11, **+2.3%** | 54.0 → 62.8s, **+17%** | KV-quant tax lands on **prefill only**; decode-neutral (tie-to-slightly-faster) |

## Consequences & root causes (ultrathink)

1. **The 27B dense is VRAM-bound, and the practical ceilings are 64K (f16) / 120K (q8_0).** — *Observation:* every f16 step to 65536 and every q8_0 step to 122880 loaded and served. *Root cause:* KV at 260 KiB/tok (f16) fills 16.25 GiB by 64K, putting the box at ~98% of 31.86 GiB usable; q8_0 halves that and reaches 120K at the same ~98%. *Consequence for practice:* **use f16 KV up to ~64K; switch to q8_0 only when you need 64K–120K of context.** Beyond ~120K the 27B dense does not fit on this card at Q4_K_S. (MEASURED ceilings; VRAM figures INFERRED.)

2. **The `vram-ctx` formula is ~10% pessimistic — the real usable budget is ~31.2 GiB with a ~0.6 GiB compute buffer.** — *Observation:* measured PASS at 64K/120K vs formula ~55–59K / ~103–111K. *Root cause:* the formula's 30–31 GiB budget reserves ~1–2 GiB for compute, but at `-ub 2048` the actual Vulkan compute buffer is only ~0.6 GiB, so ~1 GiB more of that budget is available for KV. *Consequence:* trust the live load over the formula (as the campaign intended); or tighten the budget constant toward ~31.2 GiB for the dense model at this `-ub`. (INFERRED from KV arithmetic.)

3. **Decode is flat at ~28.5 tok/s and KV-quant-insensitive — the opposite of the 35B MoE.** — *Observation:* decode 28.35–29.13 across all 6 configs, f16↔q8_0 within +2.3% (a tie/slight q8_0 win). *Root cause:* the dense 27B reads **all ~15 GiB of weights per generated token**, so decode is **weight-bandwidth-bound**; the KV read is a small fraction of per-token traffic, so shrinking it (q8_0) barely touches decode and never dominates. *Consequence:* **for the dense model, q8_0 KV is nearly free at decode time** — the ~2× context depth costs essentially nothing in tok/s once you're generating. This directly contrasts the deep-context 35B finding (q8_0 −22% decode at depth): that penalty was a MoE/deep-depth effect, **not** a universal rule. (MEASURED; mechanism INFERRED.)

4. **The KV-quant tax is asymmetric: it hits prefill (−14%), not decode.** — *Observation:* q8_0 prefill 635 vs f16 743 (−14.4%) while decode is a tie. The f16 ctx-invariance row (finding-adjacent, −0.5% over a 33% ctx increase) confirms the drop is the **KV dtype**, not the larger allocation. *Root cause:* prefill's flash-attention over the growing KV must read/quantize/dequantize q8_0 blocks each step — compute the dense model isn't otherwise bottlenecked on at prefill; decode touches far less KV per token. *Consequence:* going q8_0 to reach 120K costs **~9 extra seconds of TTFT on a 40K prompt (54s→63s)** and ~14% prefill throughput — a real but modest UX cost, paid once per request, in exchange for ~2× context. Note this −14% is far milder than the 35B's −40% (fewer KV heads here: head_count_kv 4), so the tax is model-specific. (Prefill delta MEASURED; head-count mechanism INFERRED.)

5. **OPEN — upper OOM bracket not captured; ceilings are pinned from below only.** No server in this data was pushed to a `SERVER-OOM` (the f16 100K/200K guards in `run.sh` were mis-slugged and left no clean OOM record). So "f16 = 64K, q8_0 = 120K" means *"highest config that loaded and served ≥40K,"* bounded above only by the KV arithmetic in finding 2 — not by an observed OOM. **Also unmeasured:** VRAM peak (no `gpu_samples.jsonl` was captured in any sub-run), and last-token usability (a 40K prompt does not fill a 64K/120K slot — runtime OOM as the compute buffer grows near the top remains untested). These are cheap follow-ups (§Methodology).

## Recommended config

For 27B dense on this box, pick KV by the context you need:

```bash
# ≤64K context — f16 KV (best prefill/TTFT, ~98% VRAM at 64K):
BACKEND=vulkan CTX=65536  NP=1 KV=f16  MTP=0 UB=2048 B=4096 FA=on PORT=8081 \
  bench/engine-bench/serve_llamacpp.sh start   # model: Qwen3.6-27B-Q4_K_S.gguf

# 64K–120K context — q8_0 KV (~2× depth; −14% prefill, decode-neutral):
BACKEND=vulkan CTX=122880 NP=1 KV=q8_0 MTP=0 UB=2048 B=4096 FA=on PORT=8081 \
  bench/engine-bench/serve_llamacpp.sh start
```

## Methodology & caveats

- **Fixture:** one reused `codereview-40000.txt` (~39,973 real tokens via `usage`), built from the tracked corpus; fits every slot (smallest = 49152). `PREFIX_MODE=unique` (cold cache), `--api completions`, `MAX_TOKENS=256`, 1 warm-up + **REPS=2**, `CONCURRENCY=1` (np=1 — max-context is a single-slot question).
- **Ceiling gate = server-start success** (KV allocated to full `-c` at load); the 40K prefill confirms the server actually serves at depth. **This validates "loads + serves ≥40K," not "usable to the last token"** — the 40K prompt does not fill the 64K/120K slots.
- **Held fixed:** Vulkan/RADV, `-ub 2048 -b 4096 -fa on -ngl 99`, model Q4_K_S. `-ub`/`-b` were **not** re-swept for the dense model (they carry over from the 35B optimum — a separate tuning campaign). MTP is absent (no draft layer). ROCm backend out of scope.
- **Noise/ties:** the f16 prefill spread (744→741) and the q8_0 decode ≥ f16 decode are within the ±3% band → reported as ties, not wins.
- **Not captured (limits the report):** (a) no `gpu_samples.jsonl` → **VRAM peak is INFERRED from the KV formula**, not measured; (b) no `SERVER-OOM` → **ceilings pinned from below**; (c) `build_commit` was `null` in `/props` → build **b9950 is from the campaign spec, unconfirmed in artifacts**.
- **Data hygiene:** `failures.txt` is stale (all 8 FAILED from a broken first pass, ~00:07–00:08); authoritative results = `done/` markers + consolidated `results.jsonl` (6 PASS, n_ok=2/2). Two `q8-c96k` sub-run dirs (0021, 0024) exist from a retry; one clean aggregate row survives.
- **Cheap follow-ups to close the OPEN items:** one f16 server at ~68–72K and one q8_0 at ~126–130K to record the exact `SERVER-OOM` (upper bracket); add `gpu_samples` to any re-run for a MEASURED VRAM peak; a single near-full-slot prompt on the 64K/120K servers to confirm last-token usability.

## External comparison

None pulled — the relevant prior is our own **deep-context 35B** report (`docs/analysis/2026-07-11-2200-deep-context-35b.md`, MEASURED on this box): 35B MoE f16 KV ran to 200K with **no** VRAM pressure (RoPE-bound), and q8_0 there cost **−40% prefill / −22% decode** at depth. The 27B dense here is the opposite regime — **VRAM-bound**, with a **much milder and decode-neutral** q8_0 tax. The two are complementary, not contradictory: KV-quant cost scales with KV-traffic share, which is high for the deep MoE and low for the weight-bound dense decode.
