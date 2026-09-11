# Bench: llama.cpp baseline on R9700 (gfx1201) — pre-hipfire reference

**Date:** 2026-09-10 · **Host:** Ubuntu 24.04.4, kernel 7.0.0-30-generic
**GPU:** AMD Radeon AI PRO R9700-class, `RADV GFX1201` (RDNA4), 32 GB
**Purpose:** establish the reference numbers hipfire must beat, using a harness that will measure
both engines identically. This file is the **baseline half**; the hipfire half is blocked on the
ROCm HIP SDK install (see § Status).

## Status

| Track | State |
|---|---|
| Baseline bench (llama.cpp / llama-swap) | **complete** — this document |
| hipfire model artifacts | **downloaded, byte-exact** (17.67 GB) |
| Rust toolchain | **installed** — cargo 1.98.1 |
| ROCm HIP SDK | **BLOCKED — needs one `sudo` command from the user** |
| hipfire bench | pending ROCm |

## Method

Engine-agnostic harness (`bench.py`) driving the OpenAI `/v1/chat/completions` endpoint, so the
identical script will later drive hipfire on `:11435` and produce directly comparable rows.

- 1 warmup (discarded — pays model load / cache warm) + **3 measured reps** per workload.
- Non-streaming requests; `temperature=0.6, top_p=0.95` to match the runner's coding profile.
- Every engine-reported counter is captured verbatim, not just derived rates.

### Prefix-cache defeat (methodology correction)

The first sweep was **discarded as invalid**. Repeating an identical 6 k-token prompt let llama.cpp
serve it from the KV prefix cache: `wall` collapsed to **0.53 s** and `prompt_n` to ~4, so the
"prefill" workload was timing a cache lookup rather than prefill — it reported a nonsensical
**18.5 tok/s**.

Fix: every request now carries a unique `[run <uuid>]` prefix, forcing a full cold prefill. The same
measurement then reports **805–843 tok/s**, a 45× correction. `timings.cache_n = 0` on every
measured run in this document confirms no run was cache-assisted. The discarded runs are retained
under `hipfire-bench/discarded/` for audit.

This matters beyond the baseline: hipfire must be measured under the same cold-prefill discipline,
or the comparison is meaningless.

### Workloads

| Workload | Shape | Isolates |
|---|---|---|
| `decode` | ~15-token prompt → 512 tokens out | decode tok/s |
| `prefill` | ~6,430-token prompt → 16 tokens out | prefill tok/s |
| `coding` | ~190-token TS refactor → 1,024 tokens out | realistic mixed turn |

### Models measured

| Label | Model | Quant | ctx | KV | Speculation |
|---|---|---|---|---|---|
| `baseline-q4km-vulkan-mtp` | Qwen3.6-27B | Q4_K_M | 128k | f16 | MTP (`--spec-type draft-mtp`) |
| `baseline-qwen38-q4kxl-vulkan-mtp` | Qwen3.8-27B | Q4_K_XL | 130k | q8 | MTP |

Both via llama.cpp Vulkan build `6fdd0ac` behind llama-swap `:9292`, froggeric chat template.
`baseline-qwen38-q4kxl-vulkan-mtp` is the **apples-to-apples target** — hipfire's
`qwen3.8:27b-mq4-pro` is the same model and parameter count, differing only in quantization format.

> **No non-MTP 27B row exists** in the current llama-swap config, so a baseline MTP-on/off delta
> could not be measured without adding one. hipfire's DFlash on/off delta **will** be measured.

## Headline numbers (medians of 3)

| Metric | Qwen3.6-27B Q4_K_M | Qwen3.8-27B Q4_K_XL |
|---|---|---|
| **decode tok/s** | **56.92** | **54.90** |
| **prefill tok/s** (6.4k cold) | **805.65** | **843.33** |
| coding-turn decode tok/s | 51.93 | 55.88 |
| MTP draft acceptance (decode) | 0.997 | 0.804 |
| MTP draft acceptance (coding) | 0.910 | 0.821 |
| prompt-eval wall, 6.4k (s) | 7.98 | 7.63 |

Run-to-run variance is very low (decode stdev ≤ 0.55 tok/s, prefill stdev ≤ 1.4 tok/s), so these are
solid reference values rather than single-shot noise.

## Findings

**1. MTP acceptance is extremely high on Qwen3.6 short-form decode — 99.7%.** On the counting task
the draft head was accepted 1,529 of 1,533 times. Acceptance drops to 0.80–0.82 on Qwen3.8 and on
mixed coding work, which is the expected shape: repetitive output drafts almost perfectly, genuine
reasoning does not. Any hipfire DFlash comparison must be read per workload, never as one number.

**2. Qwen3.8 Q4_K_XL never finished the coding task inside 1,024 tokens.** All three reps ended
`finish_reason: length` with **content_chars = 0** and ~4,050 characters of `reasoning_content` —
it spent the entire budget thinking and emitted no answer. Qwen3.6 Q4_K_M completed the same task
in all three reps (`finish_reason: stop`, 471–590 chars of answer after 1,384–2,767 chars of
reasoning).

This is the more consequential finding. The `coding` row's tok/s for Qwen3.8 measures *throughput
while thinking*, not useful work — so when hipfire's `qwen3.8:27b-mq4-pro` is benched, a raw tok/s
win would not by itself mean it does the job better. Either the cap must be raised or reasoning
effort pinned lower for the coding workload to measure completed work. Flagged rather than silently
compared.

**3. Prefill is ~15× decode throughput** (805–843 vs 55–57 tok/s), so hipfire's published prefill
gains (+27.8%/+42.4% at 27B) would move total turn latency far less than its decode claims. On a
6.4 k prompt, prefill costs ~7.9 s against ~18 s of generation in the coding turn.

## Reference for the hipfire comparison

When ROCm lands, the identical harness runs against `:11435`:

```bash
python3 bench.py --base-url http://127.0.0.1:11435/v1 \
  --model qwen3.8:27b-mq4-pro --label hipfire-mq4pro-dflash-on \
  --out docs/test/hipfire-bench --reps 3
```

Then again with `speculation.dflash off` for the DFlash delta. The head-to-head row that decides the
gate is **`baseline-qwen38-q4kxl-vulkan-mtp` vs `hipfire-mq4pro-dflash-*`** on `decode` and `prefill`.

---

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

## Cross-engine comparison (medians)

### `coding`

| label | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept |
|---|---|---|---|---|---|---|
| `baseline-q4km-vulkan-mtp` | 339.47 | 55.88 | 53.49 | 19.14 | 0.55 | 0.82 |
| `baseline-qwen38-q4kxl-vulkan-mtp` | 338.05 | 51.93 | 48.39 | 11.94 | 0.57 | 0.91 |

### `decode`

| label | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept |
|---|---|---|---|---|---|---|
| `baseline-q4km-vulkan-mtp` | 171.68 | 54.90 | 51.59 | 9.93 | 0.35 | 0.80 |
| `baseline-qwen38-q4kxl-vulkan-mtp` | 178.58 | 56.92 | 53.17 | 9.63 | 0.35 | 1.00 |

### `prefill`

| label | prefill tok/s | decode tok/s | e2e tok/s | wall s | prompt-eval s | draft accept |
|---|---|---|---|---|---|---|
| `baseline-q4km-vulkan-mtp` | 843.33 | 61.64 | 1.84 | 8.70 | 7.62 | 1.00 |
| `baseline-qwen38-q4kxl-vulkan-mtp` | 805.65 | 38.46 | 1.80 | 8.91 | 7.98 | 0.69 |


## Artifacts

- Raw per-run JSONL: `docs/test/hipfire-bench/*.jsonl`
- Discarded (prefix-cache-contaminated) first sweep: `docs/test/hipfire-bench/discarded/`
- Harness: `bench.py` (engine-agnostic, nonce-forced cold prefill)
- Report generator: `report.py`

## Reproduce

```bash
python3 bench.py --base-url http://127.0.0.1:9292/v1 \
  --model qwen38-27b-q4kxl-ctx130k-kvq8-mtp-frog-coding \
  --label baseline-qwen38-q4kxl-vulkan-mtp --out docs/test/hipfire-bench --reps 3
python3 report.py docs/test/hipfire-bench
```
