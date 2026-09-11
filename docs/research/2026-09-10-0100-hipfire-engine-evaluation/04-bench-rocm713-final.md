# hipfire vs llama.cpp on R9700 (gfx1201) — final benchmark

**Date:** 2026-09-10 · **GPU:** AMD Radeon AI PRO R9700-class, `gfx1201` (RDNA4), 32 GB, 210 W cap
**Host:** Ubuntu 24.04.4, kernel 7.0, ROCm 7.13, 12 cores
**Engines:** hipfire 0.3.0-beta (`800ddf7`) · llama.cpp Vulkan `6fdd0ac` behind llama-swap
**Models:** hipfire `qwen3.8:27b-mq4-pro` (MQ4V2 Pro, 16.46 GB) · llama.cpp Qwen3.8-27B `Q4_K_XL`

## Verdict

**Split decision, and which side wins depends on prompt length.**

- **hipfire wins generation decisively** — 1.9–2.4× faster decode, driven almost entirely by DFlash
  being a far stronger speculator than llama.cpp's MTP.
- **llama.cpp wins prefill, and the gap widens with context** — 1.4× at 6.4 k, **2.0× at 70 k**.
- **hipfire's long-context prefill is bottlenecked on a single CPU core**, not on the GPU. This is
  the most consequential finding in the whole exercise.

For **dp-forge's actual runner workload this matters a lot**: `runner.config.json` sets
`numCtx: 131072` and `contextBudgetTokens: 204800`. The runner operates deep in the regime where
hipfire is *weakest*, not where it is strongest.

## Headline numbers (medians of 3, except longctx = 2)

All figures use the same harness against each engine's OpenAI endpoint, with a per-request UUID
prefix forcing a cold prefill (`cache_n = 0` verified on every measured llama.cpp run).

### Fair comparison — both engines emitting non-reasoning tokens

| Workload | hipfire (DFlash on) | llama.cpp (MTP, `reasoning_effort:none`) | winner |
|---|---|---|---|
| decode tok/s (512 cap) | **120.00** | 66.32 | **hipfire +81%** |
| coding-turn decode tok/s | **150.30** | 63.50 | **hipfire +137%** |
| coding-turn wall | **1.55 s** | 3.27 s | **hipfire 2.1×** |
| prefill tok/s @ 6.4 k | 497.10 | **858.35** | llama.cpp 1.7× |
| prefill tok/s @ 70 k | 292.90 *(CASK on)* | **595.12** | llama.cpp 2.0× |
| 70 k turn wall | 188.51 s *(CASK on)* | **95.17 s** | llama.cpp 2.0× |

hipfire's best prefill (615.30, DFlash **off**) still trails llama.cpp's 858.35 by 28%.

### Prefill degradation with context — the core problem

| Engine | 6.4 k | 70 k | degradation |
|---|---|---|---|
| llama.cpp Q4_K_XL | 858.35 | 595.12 | **1.44×** |
| hipfire, CASK off | 615.30 | 186.20 | **3.31×** |
| hipfire, CASK on | — | 292.90 | 2.10× |

llama.cpp holds 69% of its short-prompt prefill throughput at 70 k. hipfire holds **30%**. That
divergence, not the absolute numbers, is the finding.

## Feature deltas — both are workload-shaped, neither is free

### DFlash (speculative decode, 1.21 GB draft)

| Workload | DFlash on | DFlash off | delta |
|---|---|---|---|
| decode tok/s | **120.00** | 28.90 | **+4.15×** |
| coding decode tok/s | **150.30** | 28.90 | **+5.20×** |
| prefill tok/s @ 6.4 k | 497.10 | **615.30** | **−19%** |

Acceptance is excellent on real work: `tau` 10.6–11.4 with 14–15 verify windows per request. The
draft is pure overhead during prefill — resident, fed, and contributing nothing.

### CASK / TriAttention (KV matrix folding, 2.36 MB sidecar)

| ~70 k prompt | CASK on | CASK off | delta |
|---|---|---|---|
| prefill tok/s | **292.90** | 186.20 | **+57%** |
| wall | **188.51 s** | 296.47 s | **−36% (−108 s)** |
| decode tok/s | 18.30 | **22.40** | **−18%** |

Run-to-run variance is negligible (wall stdev 0.001 / 0.081 s).

**Not enabled by default and not installable as shipped.** `hipfire sidecar-gen` fails with
`triattn_validate is not installed`; the helper must be built by hand:

```bash
cargo build --release --features deltanet -p hipfire-runtime --example triattn_validate
```

**Accuracy is untested here.** Calibration reported `overall mean r̄ = 0.579` (paper target ≈0.5)
but emitted `⚠ r̄ ... is CONTAMINATED by corpus/val-prompt overlap`, and the tool itself advises
validating against a downstream long-context **recall** test. CASK buys speed by discarding KV
information; the synthetic prompt used here contains no facts to recall, so **the speed number is
sound and the quality question is open.**

## Root cause: hipfire long-context prefill is single-core CPU-bound

Measured during the 70 k CASK-on run:

| Signal | Value | Reading |
|---|---|---|
| GFX activity | 53–58% | GPU idle roughly half the time |
| UMC (memory) activity | 9–12% | not bandwidth-bound |
| Socket power | 78–112 W of 210 W | card waiting, not throttled |
| Daemon threads | **4** (on 12 cores) | almost no host parallelism |
| Busiest thread | **89.4% `R`** | one core pegged, running |
| GPU-wait thread | **0.0% `kfd_wait_on_events`** | GPU is not the constraint |
| user : system ticks | **1502 : 3** over 10 s | userspace compute, not I/O |

**This rules out PCIe.** A transfer stall cannot consume userspace cycles — it would appear as
`S`-state sleep and land in *system* time. The busy thread is `R`-state with a 500:1 user/system
ratio, while the only thread that waits on the GPU sits idle. The GPU is starved by a
single-threaded host loop doing arithmetic.

`THROTTLE_STATUS: THROTTLED` appears even at 3 W idle on this card with hotspot at 51 °C — it is a
spurious flag, not a power limit.

The work involved (KV fold/eviction, attention scoring over ~70 k tokens) is data-parallel in
principle. No threading knob is exposed; `memory.cask.core_fraction` refers to the KV core/fold
split, not CPU cores. **This is a good upstream bug report:** first-class target GPU, reproducible
workload, unambiguous profile.

## Negative result: prefill chunk size is inert

`serve.multi_slot_prefill_chunk` swept 1024 → 8192:

| chunk | 1024 | 2048 | 4096 | 8192 |
|---|---|---|---|---|
| prefill tok/s | 613.70 | 614.60 | 615.20 | 615.50 |

1.8 tok/s across an 8× range. **Cause confirmed, not inferred: `serve.multi_slot = false`.** The
key only enters the path under multi-slot serving, so all four values were inert. Anyone tuning
this parameter on a single-slot server is tuning nothing.

## Methodology corrections made during the run

Three measurement errors were caught and fixed; each invalidated a result that looked plausible.

1. **Prefix-cache contamination.** Repeating an identical 6.4 k prompt let llama.cpp serve it from
   KV cache — wall collapsed to 0.53 s, `prompt_n` ~4, prefill read a nonsensical **18.5 tok/s**.
   Fixed with a per-request UUID prefix; the same measurement then read **805–843 tok/s**, a 45×
   correction. First sweep discarded.
2. **Insufficient warmup on hipfire.** hipfire graph-captures per batch size
   (`verify-graph captured for B=16, 11, 7, 4, 2`, 1106 blobs each) and its own bench defaults to
   `--warmups 10`. With one warmup the harness measured the ramp: `65.8 → 22.2 → 34.8 → 35.0`
   tok/s. All hipfire runs redone with 10 warmups. llama.cpp has no comparable ramp.
3. **Reasoning asymmetry.** hipfire runs used `reasoning.mode=off` (forced — hipfire *hard-errors*
   with `open think span at end of generation` where llama.cpp truncates). The original baseline
   had thinking on and Qwen3.8 burned its entire 1024-token budget reasoning with
   `content_chars = 0`. Re-run with `chat_template_kwargs.reasoning_effort: "none"` for the fair
   comparison above.

## Operational findings

- **`.mq4-pro` is not in hipfire's recognized extension list.** `hipfire pull` verifies the file
  ("Already downloaded", sha256 matches the registry exactly) but `hipfire list` never shows it,
  and DFlash refuses to pair its draft: *"not a registry-managed artifact"*. Worked around with
  `developer.dflash_draft` pointing at the draft explicitly. The V2 ladder's naming appears to have
  outrun its own local scanner.
- **`install.sh` exits 0 on a failed build.** Gate on `hipfire --version` / `hipfire diag`, never
  on exit status.
- **Reasoning is config-owned in hipfire** (`reasoning.mode` / `effort` / `budget`), not the
  request-body `chat_template_kwargs` mechanism llama-swap rows use. The opencode `variants` block
  will not transfer.
- **No `HSA_OVERRIDE_GFX_VERSION` needed** — gfx1201 is native, unlike the current ROCm llama.cpp row.
- **Environment trap:** `/home/dev/scripts/cc` (a `claude` launcher) shadows the C compiler on PATH
  and breaks any native build. Cost one full build before diagnosis.

## Recommendation

**Do not replace llama.cpp. Adopt hipfire selectively, if at all.**

The runner's configured context (`numCtx: 131072`, `contextBudgetTokens: 204800`) sits squarely in
the regime where hipfire is 2× slower and degrading faster. A short-prompt coding turn runs 2.1×
faster on hipfire; a 70 k-context turn runs 2.0× slower. Which number dominates depends entirely on
how much context the runner actually sends.

**Next step before any wiring decision:** measure the real prompt-length distribution of runner
tasks. If most turns are short, hipfire earns a row; if they routinely approach the configured
budget, it does not — and Phase 3 (the `generate.py` surgery) should not be paid for.

If adopted, rows must be split by workload rather than enabling everything at once:
DFlash on for generation-heavy rows, CASK on for long-context rows, and never both assumed free.
## Per-run detail

### `baseline-q4km-vulkan-mtp`

- model: `qwen27b-q4km-ctx128k-mtp-frog-coding`
- endpoint: `http://127.0.0.1:9292/v1`
- started: 2026-09-10T01:26:28 · reps: 3
- note: llama.cpp vulkan 6fdd0ac; Qwen3.6-27B-Q4_K_M; ctx128k; kv f16; MTP on (--spec-type draft-mtp); froggeric tpl; via llama-swap :9292; prefix-cache defeated by per-request nonce

#### workload `coding`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 326.17 | 55.43 | 51.74 | 19.79 | 0.58 | 0.82 | length | 0 |
| 1 | 338.40 | 55.68 | 53.14 | 19.27 | 0.55 | 0.82 | length | 0 |
| 2 | 344.32 | 55.88 | 53.49 | 19.14 | 0.55 | 0.82 | length | 0 |
| 3 | 339.47 | 56.72 | 54.02 | 18.96 | 0.55 | 0.84 | length | 0 |
| **median** | 339.47 | 55.88 | 53.49 | 19.14 | 0.55 | 0.82 | | |
| range | 338.40–344.32 | 55.68–56.72 | 53.14–54.02 | 18.96–19.27 | 0.55–0.55 | 0.82–0.84 | | |
| stdev | 3.15 | 0.55 | 0.44 | 0.16 | 0.00 | 0.01 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 187 |
| `timings.prompt_ms` | 552.59 |
| `timings.prompt_per_token_ms` | 2.96 |
| `timings.prompt_per_second` | 338.40 |
| `timings.predicted_n` | 1,024 |
| `timings.predicted_ms` | 18,391.12 |
| `timings.predicted_per_token_ms` | 17.98 |
| `timings.predicted_per_second` | 55.62 |
| `timings.draft_n` | 888 |
| `timings.draft_n_accepted` | 726 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 187 |
| `usage.completion_tokens` | 1,024 |
| `usage.total_tokens` | 1,211 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `decode`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 38.57 | 51.79 | 40.94 | 12.51 | 1.63 | 0.74 | length | 0 |
| 1 | 177.24 | 58.10 | 54.49 | 9.40 | 0.34 | 0.89 | length | 190 |
| 2 | 169.56 | 51.53 | 48.57 | 10.54 | 0.35 | 0.73 | length | 0 |
| 3 | 171.68 | 54.90 | 51.59 | 9.93 | 0.35 | 0.80 | length | 84 |
| **median** | 171.68 | 54.90 | 51.59 | 9.93 | 0.35 | 0.80 | | |
| range | 169.56–177.24 | 51.53–58.10 | 48.57–54.49 | 9.39–10.54 | 0.34–0.35 | 0.73–0.89 | | |
| stdev | 3.97 | 3.29 | 2.96 | 0.57 | 0.01 | 0.08 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 61 |
| `timings.prompt_ms` | 344.17 |
| `timings.prompt_per_token_ms` | 5.64 |
| `timings.prompt_per_second` | 177.24 |
| `timings.predicted_n` | 512 |
| `timings.predicted_ms` | 8,812.59 |
| `timings.predicted_per_token_ms` | 17.25 |
| `timings.predicted_per_second` | 57.99 |
| `timings.draft_n` | 417 |
| `timings.draft_n_accepted` | 372 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 61 |
| `usage.completion_tokens` | 512 |
| `usage.total_tokens` | 573 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 831.61 | 61.49 | 1.92 | 8.35 | 7.73 | 1.00 | length | 0 |
| 1 | 843.33 | 62.01 | 1.84 | 8.70 | 7.62 | 1.00 | length | 0 |
| 2 | 844.03 | 61.64 | 1.88 | 8.50 | 7.62 | 1.00 | length | 0 |
| 3 | 841.43 | 39.28 | 1.83 | 8.75 | 7.64 | 0.53 | length | 0 |
| **median** | 843.33 | 61.64 | 1.84 | 8.70 | 7.62 | 1.00 | | |
| range | 841.43–844.03 | 39.28–62.01 | 1.83–1.88 | 8.50–8.74 | 7.62–7.64 | 0.53–1.00 | | |
| stdev | 1.34 | 13.02 | 0.03 | 0.13 | 0.01 | 0.27 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 6,429 |
| `timings.prompt_ms` | 7,623.37 |
| `timings.prompt_per_token_ms` | 1.19 |
| `timings.prompt_per_second` | 843.33 |
| `timings.predicted_n` | 16 |
| `timings.predicted_ms` | 258.00 |
| `timings.predicted_per_token_ms` | 17.20 |
| `timings.predicted_per_second` | 58.14 |
| `timings.draft_n` | 11 |
| `timings.draft_n_accepted` | 11 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 6,429 |
| `usage.completion_tokens` | 16 |
| `usage.total_tokens` | 6,445 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `baseline-qwen38-longctx`

- model: `qwen38-27b-q4kxl-ctx130k-kvq8-mtp-frog-coding`
- endpoint: `http://127.0.0.1:9292/v1`
- started: 2026-09-10T07:32:22 · reps: 2
- note: llama.cpp vulkan 6fdd0ac; Qwen3.8-27B Q4_K_XL; ctx130k kv q8; MTP on; ~70k cold prompt (nonce-forced); cross-engine reference for hipfire CASK arms

#### workload `longctx`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 586.28 | 23.14 | 0.12 | 134.20 | 94.07 | 0.83 | length | 0 |
| warmup* | 595.61 | 44.34 | 0.17 | 95.11 | 92.60 | 0.83 | length | 0 |
| 1 | 594.92 | 44.34 | 0.17 | 95.01 | 92.70 | 0.83 | length | 0 |
| 2 | 595.32 | 44.26 | 0.17 | 95.34 | 92.64 | 0.83 | length | 0 |
| **median** | 595.12 | 44.30 | 0.17 | 95.17 | 92.67 | 0.83 | | |
| range | 594.92–595.32 | 44.26–44.34 | 0.17–0.17 | 95.00–95.34 | 92.64–92.70 | 0.83–0.83 | | |
| stdev | 0.28 | 0.06 | 0.00 | 0.23 | 0.04 | 0.00 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 55,150 |
| `timings.prompt_ms` | 92,701.01 |
| `timings.prompt_per_token_ms` | 1.68 |
| `timings.prompt_per_second` | 594.92 |
| `timings.predicted_n` | 16 |
| `timings.predicted_ms` | 360.89 |
| `timings.predicted_per_token_ms` | 24.06 |
| `timings.predicted_per_second` | 41.56 |
| `timings.draft_n` | 12 |
| `timings.draft_n_accepted` | 10 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 55,150 |
| `usage.completion_tokens` | 16 |
| `usage.total_tokens` | 55,166 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `baseline-qwen38-noreason`

- model: `qwen38-27b-q4kxl-ctx130k-kvq8-mtp-frog-coding`
- endpoint: `http://127.0.0.1:9292/v1`
- started: 2026-09-10T07:39:22 · reps: 3
- extra body: `{"chat_template_kwargs": {"reasoning_effort": "none"}}`
- note: llama.cpp vulkan 6fdd0ac; Qwen3.8-27B Q4_K_XL; ctx130k kv q8; MTP on; chat_template_kwargs.reasoning_effort=none so both engines emit non-reasoning tokens - the apples-to-apples wall-time arm

#### workload `coding`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 345.90 | 62.99 | 44.58 | 3.59 | 0.54 | 0.98 | stop | 576 |
| 1 | 371.45 | 64.26 | 50.44 | 3.45 | 0.52 | 1.00 | stop | 604 |
| 2 | 370.06 | 63.50 | 49.19 | 3.25 | 0.52 | 0.98 | stop | 576 |
| 3 | 372.16 | 63.31 | 49.01 | 3.26 | 0.52 | 0.98 | stop | 576 |
| **median** | 371.45 | 63.50 | 49.19 | 3.27 | 0.52 | 0.98 | | |
| range | 370.06–372.16 | 63.31–64.26 | 49.01–50.44 | 3.25–3.45 | 0.52–0.52 | 0.98–1.00 | | |
| stdev | 1.07 | 0.50 | 0.78 | 0.11 | 0.00 | 0.01 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 194 |
| `timings.prompt_ms` | 522.28 |
| `timings.prompt_per_token_ms` | 2.69 |
| `timings.prompt_per_second` | 371.45 |
| `timings.predicted_n` | 174 |
| `timings.predicted_ms` | 2,707.80 |
| `timings.predicted_per_token_ms` | 15.65 |
| `timings.predicted_per_second` | 63.89 |
| `timings.draft_n` | 132 |
| `timings.draft_n_accepted` | 132 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 194 |
| `usage.completion_tokens` | 174 |
| `usage.total_tokens` | 368 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `decode`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 96.92 | 61.72 | 45.68 | 11.21 | 0.66 | 0.99 | length | 512 |
| 1 | 193.13 | 66.30 | 61.83 | 8.28 | 0.34 | 0.99 | length | 512 |
| 2 | 180.80 | 66.71 | 62.06 | 8.25 | 0.34 | 1.00 | length | 512 |
| 3 | 192.30 | 66.32 | 61.79 | 8.29 | 0.34 | 0.99 | length | 512 |
| **median** | 192.30 | 66.32 | 61.83 | 8.28 | 0.34 | 0.99 | | |
| range | 180.80–193.13 | 66.30–66.71 | 61.79–62.06 | 8.25–8.29 | 0.34–0.34 | 0.99–1.00 | | |
| stdev | 6.89 | 0.23 | 0.15 | 0.02 | 0.00 | 0.01 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 65 |
| `timings.prompt_ms` | 336.57 |
| `timings.prompt_per_token_ms` | 5.18 |
| `timings.prompt_per_second` | 193.13 |
| `timings.predicted_n` | 512 |
| `timings.predicted_ms` | 7,722.11 |
| `timings.predicted_per_token_ms` | 15.11 |
| `timings.predicted_per_second` | 66.17 |
| `timings.draft_n` | 386 |
| `timings.draft_n_accepted` | 382 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 65 |
| `usage.completion_tokens` | 512 |
| `usage.total_tokens` | 577 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 860.51 | 29.94 | 0.26 | 7.78 | 7.47 | 1.00 | stop | 3 |
| 1 | 858.35 | 30.01 | 0.25 | 8.05 | 7.50 | 1.00 | stop | 3 |
| 2 | 858.65 | 29.93 | 0.24 | 8.34 | 7.49 | 1.00 | stop | 3 |
| 3 | 857.33 | 30.00 | 0.25 | 8.06 | 7.50 | 1.00 | stop | 3 |
| **median** | 858.35 | 30.00 | 0.25 | 8.06 | 7.50 | 1.00 | | |
| range | 857.33–858.65 | 29.93–30.01 | 0.24–0.25 | 8.05–8.34 | 7.49–7.50 | 1.00–1.00 | | |
| stdev | 0.69 | 0.04 | 0.01 | 0.16 | 0.00 | 0.00 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 6,434 |
| `timings.prompt_ms` | 7,495.80 |
| `timings.prompt_per_token_ms` | 1.17 |
| `timings.prompt_per_second` | 858.35 |
| `timings.predicted_n` | 2 |
| `timings.predicted_ms` | 66.64 |
| `timings.predicted_per_token_ms` | 66.64 |
| `timings.predicted_per_second` | 15.01 |
| `timings.draft_n` | 3 |
| `timings.draft_n_accepted` | 3 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 6,434 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 6,436 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `baseline-qwen38-q4kxl-vulkan-mtp`

- model: `qwen38-27b-q4kxl-ctx130k-kvq8-mtp-frog-coding`
- endpoint: `http://127.0.0.1:9292/v1`
- started: 2026-09-10T01:29:02 · reps: 3
- note: llama.cpp vulkan 6fdd0ac; Qwen3.8-27B-Q4_K_XL; ctx130k; kv q8; MTP on; froggeric tpl; via llama-swap :9292; APPLES-TO-APPLES target vs hipfire qwen3.8:27b-mq4-pro; prefix-cache defeated by nonce

#### workload `coding`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 313.90 | 52.43 | 47.13 | 10.82 | 0.60 | 0.93 | stop | 590 |
| 1 | 328.34 | 51.93 | 48.39 | 11.94 | 0.57 | 0.91 | stop | 590 |
| 2 | 338.96 | 52.71 | 48.94 | 10.99 | 0.55 | 0.93 | stop | 590 |
| 3 | 338.05 | 47.39 | 45.21 | 17.50 | 0.57 | 0.79 | stop | 471 |
| **median** | 338.05 | 51.93 | 48.39 | 11.94 | 0.57 | 0.91 | | |
| range | 328.34–338.96 | 47.39–52.71 | 45.21–48.94 | 10.99–17.50 | 0.55–0.57 | 0.80–0.93 | | |
| stdev | 5.89 | 2.87 | 2.01 | 3.51 | 0.01 | 0.07 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 186 |
| `timings.prompt_ms` | 566.49 |
| `timings.prompt_per_token_ms` | 3.05 |
| `timings.prompt_per_second` | 328.34 |
| `timings.predicted_n` | 578 |
| `timings.predicted_ms` | 11,129.52 |
| `timings.predicted_per_token_ms` | 19.29 |
| `timings.predicted_per_second` | 51.84 |
| `timings.draft_n` | 465 |
| `timings.draft_n_accepted` | 423 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 186 |
| `usage.completion_tokens` | 578 |
| `usage.total_tokens` | 764 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `decode`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 140.37 | 55.79 | 8.52 | 60.08 | 0.42 | 0.98 | length | 466 |
| 1 | 178.58 | 56.92 | 53.10 | 9.64 | 0.35 | 1.00 | length | 465 |
| 2 | 169.65 | 56.93 | 53.42 | 9.58 | 0.35 | 1.00 | length | 481 |
| 3 | 179.68 | 56.53 | 53.17 | 9.63 | 0.35 | 0.99 | length | 465 |
| **median** | 178.58 | 56.92 | 53.17 | 9.63 | 0.35 | 1.00 | | |
| range | 169.65–179.68 | 56.53–56.93 | 53.10–53.42 | 9.58–9.64 | 0.34–0.35 | 0.99–1.00 | | |
| stdev | 5.50 | 0.23 | 0.17 | 0.03 | 0.01 | 0.01 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 63 |
| `timings.prompt_ms` | 352.78 |
| `timings.prompt_per_token_ms` | 5.60 |
| `timings.prompt_per_second` | 178.58 |
| `timings.predicted_n` | 512 |
| `timings.predicted_ms` | 8,995.03 |
| `timings.predicted_per_token_ms` | 17.60 |
| `timings.predicted_per_second` | 56.81 |
| `timings.draft_n` | 384 |
| `timings.draft_n_accepted` | 383 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 63 |
| `usage.completion_tokens` | 512 |
| `usage.total_tokens` | 575 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 790.78 | 35.96 | 1.82 | 8.81 | 8.13 | 0.69 | length | 0 |
| 1 | 805.65 | 38.46 | 1.80 | 8.89 | 7.98 | 0.69 | length | 0 |
| 2 | 788.89 | 38.38 | 1.75 | 9.16 | 8.15 | 0.69 | length | 0 |
| 3 | 805.89 | 38.56 | 1.80 | 8.91 | 7.98 | 0.69 | length | 0 |
| **median** | 805.65 | 38.46 | 1.80 | 8.91 | 7.98 | 0.69 | | |
| range | 788.89–805.89 | 38.38–38.56 | 1.75–1.80 | 8.89–9.16 | 7.98–8.15 | 0.69–0.69 | | |
| stdev | 9.75 | 0.09 | 0.03 | 0.15 | 0.10 | 0.00 | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `timings.prompt_n` | 6,432 |
| `timings.prompt_ms` | 7,983.57 |
| `timings.prompt_per_token_ms` | 1.24 |
| `timings.prompt_per_second` | 805.65 |
| `timings.predicted_n` | 16 |
| `timings.predicted_ms` | 415.97 |
| `timings.predicted_per_token_ms` | 27.73 |
| `timings.predicted_per_second` | 36.06 |
| `timings.draft_n` | 13 |
| `timings.draft_n_accepted` | 9 |
| `timings.cache_n` | 0 |
| `usage.prompt_tokens` | 6,432 |
| `usage.completion_tokens` | 16 |
| `usage.total_tokens` | 6,448 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `hipfire-longctx-cask-off`

- model: `/home/dev/.hipfire/models/qwen3.8-27b.mq4-pro`
- endpoint: `http://127.0.0.1:11435/v1`
- started: 2026-09-10T02:20:40 · reps: 2
- note: hipfire 0.3.0 beta; ~70k-token cold prompt; memory.cask.enabled=false (control)

#### workload `longctx`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 186.00 | 18.20 | 0.01 | 296.77 | — | — | stop | 3 |
| warmup* | 186.10 | 22.40 | 0.01 | 296.59 | — | — | stop | 3 |
| 1 | 186.20 | 22.40 | 0.01 | 296.47 | — | — | stop | 3 |
| 2 | 186.20 | 22.40 | 0.01 | 296.47 | — | — | stop | 3 |
| **median** | 186.20 | 22.40 | 0.01 | 296.47 | — | — | | |
| range | 186.20–186.20 | 22.40–22.40 | 0.01–0.01 | 296.47–296.47 | — | — | | |
| stdev | 0.00 | 0.00 | 0.00 | 0.00 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 55,153 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 55,155 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `hipfire-longctx-cask-on`

- model: `/home/dev/.hipfire/models/qwen3.8-27b.mq4-pro`
- endpoint: `http://127.0.0.1:11435/v1`
- started: 2026-09-10T07:19:46 · reps: 2
- note: hipfire 0.3.0 beta; ~70k cold prompt; memory.cask.enabled=true + TriAttention sidecar (2.36MB, triattn_validate built manually); fold=2 budget=512; dflash=off

#### workload `longctx`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 292.40 | 15.10 | 0.01 | 188.86 | — | — | stop | 3 |
| warmup* | 292.80 | 18.30 | 0.01 | 188.57 | — | — | stop | 3 |
| 1 | 292.80 | 18.30 | 0.01 | 188.57 | — | — | stop | 3 |
| 2 | 293.00 | 18.30 | 0.01 | 188.46 | — | — | stop | 3 |
| **median** | 292.90 | 18.30 | 0.01 | 188.51 | — | — | | |
| range | 292.80–293.00 | 18.30–18.30 | 0.01–0.01 | 188.46–188.57 | — | — | | |
| stdev | 0.14 | 0.00 | 0.00 | 0.08 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 55,155 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 55,157 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `hipfire-mq4pro-dflash-off`

- model: `/home/dev/.hipfire/models/qwen3.8-27b.mq4-pro`
- endpoint: `http://127.0.0.1:11435/v1`
- started: 2026-09-10T01:58:56 · reps: 3
- note: same as A but speculation.dflash=off (pure autoregressive decode)

#### workload `coding`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 565.70 | 28.90 | 10.26 | 16.95 | — | — | stop | 614 |
| warmup* | 571.20 | 28.90 | 13.61 | 12.78 | — | — | stop | 614 |
| warmup* | 572.50 | 28.90 | 13.62 | 12.78 | — | — | stop | 620 |
| warmup* | 572.90 | 28.90 | 13.62 | 12.78 | — | — | stop | 614 |
| warmup* | 574.20 | 28.90 | 13.62 | 12.78 | — | — | stop | 614 |
| warmup* | 515.50 | 28.90 | 13.57 | 12.82 | — | — | stop | 620 |
| warmup* | 573.40 | 28.90 | 13.57 | 12.82 | — | — | stop | 620 |
| warmup* | 573.70 | 28.90 | 13.61 | 12.79 | — | — | stop | 620 |
| warmup* | 517.60 | 28.90 | 13.56 | 12.84 | — | — | stop | 620 |
| warmup* | 572.40 | 28.90 | 13.56 | 12.84 | — | — | stop | 620 |
| warmup* | 572.60 | 28.90 | 13.61 | 12.79 | — | — | stop | 614 |
| warmup* | 571.40 | 28.80 | 13.61 | 12.79 | — | — | stop | 620 |
| warmup* | 572.70 | 28.90 | 13.60 | 12.79 | — | — | stop | 620 |
| warmup* | 570.70 | 28.80 | 13.59 | 12.81 | — | — | stop | 614 |
| warmup* | 518.00 | 28.80 | 13.53 | 12.86 | — | — | stop | 614 |
| warmup* | 611.10 | 28.80 | 13.56 | 12.83 | — | — | stop | 620 |
| warmup* | 519.40 | 28.80 | 13.56 | 12.83 | — | — | stop | 614 |
| warmup* | 572.30 | 28.90 | 13.55 | 12.84 | — | — | stop | 604 |
| warmup* | 571.60 | 28.90 | 13.61 | 12.79 | — | — | stop | 604 |
| warmup* | 516.60 | 28.70 | 13.51 | 12.88 | — | — | stop | 614 |
| 1 | 567.40 | 28.80 | 13.49 | 12.90 | — | — | stop | 620 |
| 1 | 612.30 | 28.80 | 12.98 | 12.33 | — | — | stop | 580 |
| 2 | 570.90 | 28.90 | 14.15 | 12.30 | — | — | stop | 614 |
| 2 | 571.80 | 28.90 | 13.62 | 12.77 | — | — | stop | 620 |
| 3 | 573.30 | 28.90 | 13.62 | 12.77 | — | — | stop | 614 |
| 3 | 510.60 | 28.60 | 13.51 | 12.88 | — | — | stop | 614 |
| **median** | 570.90 | 28.90 | 13.62 | 12.77 | — | — | | |
| range | 567.40–573.30 | 28.80–28.90 | 13.49–14.15 | 12.30–12.90 | — | — | | |
| stdev | 2.97 | 0.06 | 0.35 | 0.32 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 189 |
| `usage.completion_tokens` | 174 |
| `usage.total_tokens` | 363 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `decode`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 473.10 | 28.90 | 28.61 | 17.89 | — | — | length | 512 |
| warmup* | 435.40 | 28.90 | 14.62 | 35.03 | — | — | length | 512 |
| warmup* | 434.10 | 28.90 | 14.32 | 35.74 | — | — | length | 512 |
| warmup* | 536.40 | 28.90 | 14.34 | 35.70 | — | — | length | 512 |
| warmup* | 536.90 | 28.90 | 14.36 | 35.66 | — | — | length | 512 |
| warmup* | 435.50 | 28.90 | 14.34 | 35.70 | — | — | length | 512 |
| warmup* | 501.20 | 28.90 | 14.33 | 35.74 | — | — | length | 512 |
| warmup* | 537.30 | 28.90 | 14.34 | 35.70 | — | — | length | 512 |
| warmup* | 528.10 | 28.90 | 14.35 | 35.67 | — | — | length | 512 |
| warmup* | 537.90 | 28.90 | 14.35 | 35.67 | — | — | length | 512 |
| warmup* | 434.00 | 28.90 | 14.34 | 35.71 | — | — | length | 512 |
| warmup* | 433.30 | 28.90 | 14.32 | 35.74 | — | — | length | 512 |
| warmup* | 536.60 | 28.90 | 14.34 | 35.71 | — | — | length | 512 |
| warmup* | 537.20 | 28.90 | 14.35 | 35.67 | — | — | length | 512 |
| warmup* | 438.40 | 28.80 | 14.32 | 35.75 | — | — | length | 512 |
| warmup* | 490.10 | 28.80 | 14.30 | 35.80 | — | — | length | 512 |
| warmup* | 501.50 | 28.80 | 14.30 | 35.80 | — | — | length | 512 |
| warmup* | 505.40 | 28.80 | 14.28 | 35.84 | — | — | length | 512 |
| warmup* | 538.60 | 28.80 | 14.29 | 35.82 | — | — | length | 512 |
| warmup* | 500.80 | 28.90 | 14.32 | 35.74 | — | — | length | 512 |
| 1 | 530.90 | 28.90 | 14.35 | 35.68 | — | — | length | 512 |
| 1 | 501.20 | 28.70 | 14.31 | 35.78 | — | — | length | 512 |
| 2 | 533.30 | 28.60 | 14.24 | 35.96 | — | — | length | 512 |
| 2 | 530.80 | 28.80 | 14.26 | 35.90 | — | — | length | 512 |
| 3 | 513.10 | 28.90 | 14.32 | 35.76 | — | — | length | 512 |
| 3 | 523.50 | 28.80 | 14.32 | 35.75 | — | — | length | 512 |
| **median** | 530.90 | 28.90 | 14.32 | 35.76 | — | — | | |
| range | 513.10–533.30 | 28.60–28.90 | 14.24–14.35 | 35.68–35.96 | — | — | | |
| stdev | 11.04 | 0.17 | 0.06 | 0.14 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 62 |
| `usage.completion_tokens` | 512 |
| `usage.total_tokens` | 574 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 612.20 | 27.70 | 0.07 | 28.48 | — | — | stop | 3 |
| warmup* | 609.30 | 27.70 | 0.09 | 21.26 | — | — | stop | 3 |
| warmup* | 611.10 | 27.70 | 0.09 | 21.31 | — | — | stop | 3 |
| warmup* | 610.80 | 28.10 | 0.09 | 21.28 | — | — | stop | 3 |
| warmup* | 611.30 | 28.00 | 0.09 | 21.28 | — | — | stop | 3 |
| warmup* | 611.60 | 27.70 | 0.09 | 21.27 | — | — | stop | 3 |
| warmup* | 614.40 | 28.10 | 0.09 | 21.22 | — | — | stop | 3 |
| warmup* | 615.50 | 28.10 | 0.09 | 21.14 | — | — | stop | 3 |
| warmup* | 618.30 | 28.20 | 0.09 | 21.07 | — | — | stop | 3 |
| warmup* | 618.60 | 28.10 | 0.10 | 21.01 | — | — | stop | 3 |
| warmup* | 615.50 | 28.10 | 0.09 | 21.07 | — | — | stop | 3 |
| warmup* | 615.80 | 28.00 | 0.09 | 21.12 | — | — | stop | 3 |
| warmup* | 618.10 | 28.10 | 0.09 | 21.07 | — | — | stop | 3 |
| warmup* | 617.30 | 28.10 | 0.10 | 21.04 | — | — | stop | 3 |
| warmup* | 612.90 | 28.00 | 0.09 | 21.14 | — | — | stop | 3 |
| warmup* | 610.80 | 28.00 | 0.09 | 21.25 | — | — | stop | 3 |
| warmup* | 609.40 | 27.20 | 0.09 | 21.32 | — | — | stop | 3 |
| warmup* | 609.80 | 28.10 | 0.09 | 21.33 | — | — | stop | 3 |
| warmup* | 613.80 | 28.10 | 0.09 | 21.25 | — | — | stop | 3 |
| warmup* | 611.30 | 28.10 | 0.09 | 21.22 | — | — | stop | 3 |
| 1 | 613.20 | 28.10 | 0.09 | 21.23 | — | — | stop | 3 |
| 1 | 615.30 | 28.10 | 0.09 | 21.17 | — | — | stop | 3 |
| 2 | 615.30 | 28.10 | 0.09 | 21.13 | — | — | stop | 3 |
| 2 | 614.60 | 28.10 | 0.09 | 21.14 | — | — | stop | 3 |
| 3 | 618.00 | 28.10 | 0.09 | 21.09 | — | — | stop | 3 |
| 3 | 615.60 | 28.00 | 0.09 | 21.08 | — | — | stop | 3 |
| **median** | 615.30 | 28.10 | 0.09 | 21.13 | — | — | | |
| range | 613.20–618.00 | 28.10–28.10 | 0.09–0.09 | 21.09–21.23 | — | — | | |
| stdev | 2.41 | 0.00 | 0.00 | 0.07 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 6,435 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 6,437 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `hipfire-mq4pro-dflash-on`

- model: `/home/dev/.hipfire/models/qwen3.8-27b.mq4-pro`
- endpoint: `http://127.0.0.1:11435/v1`
- started: 2026-09-10T01:53:06 · reps: 3
- note: hipfire 0.3.0 beta 800ddf7; Qwen3.8-27B MQ4V2 Pro; gfx1201 HIP 7.13; KV Q8; reasoning.mode=off; speculation.dflash=on w/ explicit developer.dflash_draft; 10 warmups to clear verify-graph capture ramp

#### workload `coding`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 469.90 | 149.80 | 110.86 | 1.57 | — | — | stop | 620 |
| warmup* | 484.10 | 150.30 | 111.95 | 1.55 | — | — | stop | 620 |
| warmup* | 487.90 | 141.30 | 107.05 | 1.63 | — | — | stop | 620 |
| warmup* | 510.80 | 150.00 | 113.15 | 1.54 | — | — | stop | 620 |
| warmup* | 487.10 | 150.20 | 112.05 | 1.55 | — | — | stop | 620 |
| warmup* | 483.30 | 149.90 | 112.09 | 1.55 | — | — | stop | 620 |
| warmup* | 445.90 | 150.50 | 109.15 | 1.59 | — | — | stop | 620 |
| warmup* | 443.00 | 160.10 | 114.10 | 1.52 | — | — | stop | 614 |
| warmup* | 484.90 | 150.40 | 112.18 | 1.55 | — | — | stop | 620 |
| warmup* | 484.20 | 149.40 | 111.60 | 1.56 | — | — | stop | 620 |
| 1 | 513.20 | 150.30 | 113.45 | 1.53 | — | — | stop | 620 |
| 2 | 446.90 | 150.50 | 109.24 | 1.59 | — | — | stop | 604 |
| 3 | 484.00 | 150.10 | 111.95 | 1.55 | — | — | stop | 614 |
| **median** | 484.00 | 150.30 | 111.95 | 1.55 | — | — | | |
| range | 446.90–513.20 | 150.10–150.50 | 109.24–113.45 | 1.53–1.59 | — | — | | |
| stdev | 33.23 | 0.20 | 2.13 | 0.03 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 192 |
| `usage.completion_tokens` | 174 |
| `usage.total_tokens` | 366 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `decode`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 295.80 | 119.10 | 112.84 | 4.54 | — | — | length | 512 |
| warmup* | 302.20 | 119.90 | 114.14 | 4.49 | — | — | length | 512 |
| warmup* | 294.10 | 119.90 | 114.44 | 4.47 | — | — | length | 512 |
| warmup* | 311.80 | 117.50 | 112.19 | 4.56 | — | — | length | 512 |
| warmup* | 312.20 | 120.00 | 114.56 | 4.47 | — | — | length | 512 |
| warmup* | 281.00 | 119.60 | 113.33 | 4.52 | — | — | length | 512 |
| warmup* | 309.00 | 120.10 | 114.65 | 4.47 | — | — | length | 512 |
| warmup* | 304.60 | 117.60 | 112.33 | 4.56 | — | — | length | 512 |
| warmup* | 302.80 | 119.90 | 114.18 | 4.48 | — | — | length | 512 |
| warmup* | 313.40 | 119.90 | 114.48 | 4.47 | — | — | length | 512 |
| 1 | 289.60 | 122.60 | 116.93 | 4.38 | — | — | length | 512 |
| 2 | 309.00 | 120.00 | 114.52 | 4.47 | — | — | length | 512 |
| 3 | 280.90 | 119.30 | 113.01 | 4.53 | — | — | length | 512 |
| **median** | 289.60 | 120.00 | 114.52 | 4.47 | — | — | | |
| range | 280.90–309.00 | 119.30–122.60 | 113.01–116.93 | 4.38–4.53 | — | — | | |
| stdev | 14.39 | 1.74 | 1.98 | 0.08 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 58 |
| `usage.completion_tokens` | 512 |
| `usage.total_tokens` | 570 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 484.40 | 11.30 | 0.15 | 13.46 | — | — | stop | 3 |
| warmup* | 496.90 | 11.30 | 0.15 | 13.14 | — | — | stop | 3 |
| warmup* | 496.40 | 11.50 | 0.15 | 13.14 | — | — | stop | 3 |
| warmup* | 496.60 | 11.50 | 0.15 | 13.14 | — | — | stop | 3 |
| warmup* | 496.50 | 11.40 | 0.15 | 13.14 | — | — | stop | 3 |
| warmup* | 497.20 | 11.70 | 0.15 | 13.12 | — | — | stop | 3 |
| warmup* | 497.00 | 11.30 | 0.15 | 13.13 | — | — | stop | 3 |
| warmup* | 496.10 | 11.50 | 0.15 | 13.16 | — | — | stop | 3 |
| warmup* | 493.90 | 11.40 | 0.15 | 13.21 | — | — | stop | 3 |
| warmup* | 493.90 | 11.40 | 0.15 | 13.21 | — | — | stop | 3 |
| 1 | 496.30 | 11.40 | 0.15 | 13.15 | — | — | stop | 3 |
| 2 | 497.70 | 11.60 | 0.15 | 13.11 | — | — | stop | 3 |
| 3 | 497.10 | 11.40 | 0.15 | 13.13 | — | — | stop | 3 |
| **median** | 497.10 | 11.40 | 0.15 | 13.13 | — | — | | |
| range | 496.30–497.70 | 11.40–11.60 | 0.15–0.15 | 13.11–13.15 | — | — | | |
| stdev | 0.70 | 0.12 | 0.00 | 0.02 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 6,434 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 6,436 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `hipfire-prefill-chunk-1024`

- model: `/home/dev/.hipfire/models/qwen3.8-27b.mq4-pro`
- endpoint: `http://127.0.0.1:11435/v1`
- started: 2026-09-10T02:14:28 · reps: 3
- note: hipfire 0.3.0 beta; Qwen3.8-27B MQ4V2 Pro; gfx1201; dflash=off; serve.multi_slot_prefill_chunk=1024; 6.4k cold prefill (nonce-forced)

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 611.30 | 21.80 | 0.19 | 10.65 | — | — | stop | 3 |
| warmup* | 613.50 | 28.10 | 0.19 | 10.60 | — | — | stop | 3 |
| warmup* | 614.30 | 28.00 | 0.19 | 10.58 | — | — | stop | 3 |
| warmup* | 614.30 | 28.10 | 0.19 | 10.58 | — | — | stop | 3 |
| warmup* | 615.10 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| 1 | 615.40 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| 2 | 613.70 | 27.60 | 0.19 | 10.59 | — | — | stop | 3 |
| 3 | 611.10 | 28.00 | 0.19 | 10.64 | — | — | stop | 3 |
| **median** | 613.70 | 28.00 | 0.19 | 10.59 | — | — | | |
| range | 611.10–615.40 | 27.60–28.10 | 0.19–0.19 | 10.56–10.64 | — | — | | |
| stdev | 2.17 | 0.27 | 0.00 | 0.04 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 6,434 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 6,436 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `hipfire-prefill-chunk-2048`

- model: `/home/dev/.hipfire/models/qwen3.8-27b.mq4-pro`
- endpoint: `http://127.0.0.1:11435/v1`
- started: 2026-09-10T02:16:01 · reps: 3
- note: hipfire 0.3.0 beta; Qwen3.8-27B MQ4V2 Pro; gfx1201; dflash=off; serve.multi_slot_prefill_chunk=2048; 6.4k cold prefill (nonce-forced)

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 615.70 | 21.90 | 0.19 | 10.57 | — | — | stop | 3 |
| warmup* | 617.70 | 28.10 | 0.19 | 10.52 | — | — | stop | 3 |
| warmup* | 615.00 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| warmup* | 615.10 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| warmup* | 615.10 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| 1 | 614.60 | 27.30 | 0.19 | 10.58 | — | — | stop | 3 |
| 2 | 617.60 | 28.10 | 0.19 | 10.52 | — | — | stop | 3 |
| 3 | 613.00 | 28.10 | 0.19 | 10.61 | — | — | stop | 3 |
| **median** | 614.60 | 28.10 | 0.19 | 10.58 | — | — | | |
| range | 613.00–617.60 | 27.30–28.10 | 0.19–0.19 | 10.52–10.61 | — | — | | |
| stdev | 2.33 | 0.46 | 0.00 | 0.04 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 6,436 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 6,438 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `hipfire-prefill-chunk-4096`

- model: `/home/dev/.hipfire/models/qwen3.8-27b.mq4-pro`
- endpoint: `http://127.0.0.1:11435/v1`
- started: 2026-09-10T02:17:34 · reps: 3
- note: hipfire 0.3.0 beta; Qwen3.8-27B MQ4V2 Pro; gfx1201; dflash=off; serve.multi_slot_prefill_chunk=4096; 6.4k cold prefill (nonce-forced)

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 612.00 | 22.10 | 0.19 | 10.64 | — | — | stop | 3 |
| warmup* | 614.80 | 28.20 | 0.19 | 10.58 | — | — | stop | 3 |
| warmup* | 615.00 | 28.20 | 0.19 | 10.57 | — | — | stop | 3 |
| warmup* | 615.30 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| warmup* | 615.10 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| 1 | 615.20 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| 2 | 615.30 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| 3 | 615.20 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| **median** | 615.20 | 28.10 | 0.19 | 10.57 | — | — | | |
| range | 615.20–615.30 | 28.10–28.10 | 0.19–0.19 | 10.57–10.57 | — | — | | |
| stdev | 0.06 | 0.00 | 0.00 | 0.00 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 6,435 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 6,437 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

### `hipfire-prefill-chunk-8192`

- model: `/home/dev/.hipfire/models/qwen3.8-27b.mq4-pro`
- endpoint: `http://127.0.0.1:11435/v1`
- started: 2026-09-10T02:19:07 · reps: 3
- note: hipfire 0.3.0 beta; Qwen3.8-27B MQ4V2 Pro; gfx1201; dflash=off; serve.multi_slot_prefill_chunk=8192; 6.4k cold prefill (nonce-forced)

#### workload `prefill`

| rep | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept | finish | out chars |
|---|---|---|---|---|---|---|---|---|
| warmup* | 612.90 | 21.50 | 0.19 | 10.62 | — | — | stop | 3 |
| warmup* | 612.00 | 28.10 | 0.19 | 10.62 | — | — | stop | 3 |
| warmup* | 615.20 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| warmup* | 615.40 | 28.00 | 0.19 | 10.57 | — | — | stop | 3 |
| warmup* | 617.70 | 28.10 | 0.19 | 10.52 | — | — | stop | 3 |
| 1 | 615.50 | 28.10 | 0.19 | 10.56 | — | — | stop | 3 |
| 2 | 615.30 | 28.10 | 0.19 | 10.57 | — | — | stop | 3 |
| 3 | 615.70 | 28.10 | 0.19 | 10.56 | — | — | stop | 3 |
| **median** | 615.50 | 28.10 | 0.19 | 10.56 | — | — | | |
| range | 615.30–615.70 | 28.10–28.10 | 0.19–0.19 | 10.56–10.57 | — | — | | |
| stdev | 0.20 | 0.00 | 0.00 | 0.00 | — | — | | |

<details><summary>raw engine counters (rep 1)</summary>

| field | value |
|---|---|
| `usage.prompt_tokens` | 6,434 |
| `usage.completion_tokens` | 2 |
| `usage.total_tokens` | 6,436 |
| `usage.prompt_tokens_details.cached_tokens` | 0 |

</details>

## Cross-engine comparison (medians)

### `coding`

| label | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept |
|---|---|---|---|---|---|---|
| `baseline-q4km-vulkan-mtp` | 339.47 | 55.88 | 53.49 | 19.14 | 0.55 | 0.82 |
| `baseline-qwen38-noreason` | 371.45 | 63.50 | 49.19 | 3.27 | 0.52 | 0.98 |
| `baseline-qwen38-q4kxl-vulkan-mtp` | 338.05 | 51.93 | 48.39 | 11.94 | 0.57 | 0.91 |
| `hipfire-mq4pro-dflash-off` | 570.90 | 28.90 | 13.62 | 12.77 | — | — |
| `hipfire-mq4pro-dflash-on` | 484.00 | 150.30 | 111.95 | 1.55 | — | — |

### `decode`

| label | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept |
|---|---|---|---|---|---|---|
| `baseline-q4km-vulkan-mtp` | 171.68 | 54.90 | 51.59 | 9.93 | 0.35 | 0.80 |
| `baseline-qwen38-noreason` | 192.30 | 66.32 | 61.83 | 8.28 | 0.34 | 0.99 |
| `baseline-qwen38-q4kxl-vulkan-mtp` | 178.58 | 56.92 | 53.17 | 9.63 | 0.35 | 1.00 |
| `hipfire-mq4pro-dflash-off` | 530.90 | 28.90 | 14.32 | 35.76 | — | — |
| `hipfire-mq4pro-dflash-on` | 289.60 | 120.00 | 114.52 | 4.47 | — | — |

### `longctx`

| label | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept |
|---|---|---|---|---|---|---|
| `baseline-qwen38-longctx` | 595.12 | 44.30 | 0.17 | 95.17 | 92.67 | 0.83 |
| `hipfire-longctx-cask-off` | 186.20 | 22.40 | 0.01 | 296.47 | — | — |
| `hipfire-longctx-cask-on` | 292.90 | 18.30 | 0.01 | 188.51 | — | — |

### `prefill`

| label | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept |
|---|---|---|---|---|---|---|
| `baseline-q4km-vulkan-mtp` | 843.33 | 61.64 | 1.84 | 8.70 | 7.62 | 1.00 |
| `baseline-qwen38-noreason` | 858.35 | 30.00 | 0.25 | 8.06 | 7.50 | 1.00 |
| `baseline-qwen38-q4kxl-vulkan-mtp` | 805.65 | 38.46 | 1.80 | 8.91 | 7.98 | 0.69 |
| `hipfire-mq4pro-dflash-off` | 615.30 | 28.10 | 0.09 | 21.13 | — | — |
| `hipfire-mq4pro-dflash-on` | 497.10 | 11.40 | 0.15 | 13.13 | — | — |
| `hipfire-prefill-chunk-1024` | 613.70 | 28.00 | 0.19 | 10.59 | — | — |
| `hipfire-prefill-chunk-2048` | 614.60 | 28.10 | 0.19 | 10.58 | — | — |
| `hipfire-prefill-chunk-4096` | 615.20 | 28.10 | 0.19 | 10.57 | — | — |
| `hipfire-prefill-chunk-8192` | 615.50 | 28.10 | 0.19 | 10.56 | — | — |


## Artifacts

- Raw per-run JSONL: `docs/test/hipfire-bench/*.jsonl`
- Discarded (cache-contaminated / under-warmed) runs: `docs/test/hipfire-bench/discarded/`
- Harness: `docs/test/hipfire-bench/bench.py` — engine-agnostic, nonce-forced cold prefill,
  configurable warmups, captures every `timings`/`usage`/`hipfire` field the endpoint returns
- Report generator: `docs/test/hipfire-bench/report.py`
