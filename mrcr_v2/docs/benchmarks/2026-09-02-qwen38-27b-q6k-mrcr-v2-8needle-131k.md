# MRCR v2, 8-needle, 131K context — Qwen3.8-27B Q6_K on a single R9700

**Date:** 2026-09-02 · **Operator:** dp · **Hardware:** 1× AMD Radeon R9700 (gfx1201, 32 GB)

## Headline

| | |
|---|---|
| **MRCR v2 score (8-needle, ~131K ctx)** | **0.8500** |
| Samples | 35 (of 103 in the bucket, stride 3) |
| 95% CI | ±0.113 |
| Errors / refusals | 0 |
| Wall clock | 1928 s (32 min) |
| Tools given to the model | **none** |

A 27B open-weight model at Q6_K, running locally on one 32 GB consumer card,
scored 0.850 on the deepest 128K MRCR v2 bucket. For scale, the published
128K figures for Gemini 3.1 Pro and Claude Sonnet 4.6 are both 0.849 — but see
[Comparison](#comparison) before reading anything into that, because the
published numbers are measured on an *easier* set than this run.

---

## 1. What was measured

**MRCR v2** ("multi-round coreference resolution") is Google DeepMind's
long-context benchmark ([paper](https://arxiv.org/abs/2409.12640v2), this repo).
The model is given a long synthetic transcript of `User:`/`Assistant:` turns in
which the user repeatedly requests a piece of writing matching a
(format, topic, style) triple, and the assistant answers each time. The
transcript is closed with a request like:

> `User: Prepend HROIt7tHWU5j to the fourth essay about space exploration in a formal style. Do not include any other text in your response.`

To score, the model must (a) identify which of the 8 relevant needles is the
*fourth* one, (b) reproduce it **verbatim**, and (c) prefix it with the given
12-character random string.

**Why this is not a needle-in-a-haystack test.** Retrieval alone is
insufficient — the model must *count instances* of a repeated pattern and
reproduce a long passage exactly. The task complexity is fixed, so score
differences across context length isolate length generalisation.

### Subset used

| | |
|---|---|
| File | `mrcr_v2p1_8needle_in_(65536,131072)_dynamic_fewshot_text_style_fast.csv` |
| Needles | 8 (the hardest of the 2/4/8 variants) |
| Rows in file | 103 |
| Rows evaluated | 35 (`--stride 3`, spanning the whole file) |
| Context length | **130,870–130,875 tokens** (GDM tokenizer) — the bucket is effectively fixed-depth |
| Same measured in Qwen tokens | **132,992–132,998** |

This is a **pointwise deepest bucket**, not a cumulative set. Every sample sits
at ~131K. This matters for comparison and is the single most important caveat in
this document.

### Noise floor

From the repo README: a model that reproduces one of the **relevant** assistant
responses uniformly at random scores **~0.15** on the 8-needle variant. A model
that reproduces *any* assistant response at random scores ~0.01. Our 0.850 is
far above both.

---

## 2. How it was measured

### Model and quantisation

| | |
|---|---|
| Weights | `unsloth/Qwen3.8-27B-UD-Q6_K.gguf` (20.47 GiB, Unsloth Dynamic) |
| Architecture | `qwen35` hybrid — 65 blocks, of which **16 full-attention**, 48 SSM/linear-attention, 1 nextn/MTP |
| Engine | `llama.cpp` master `6fdd0ac`, **Vulkan/RADV** backend |
| Router | `llama-swap` v240 on `:9292` (OpenAI-compatible) |

The hybrid geometry is why 131K context fits at all: only 16 layers grow a KV
cache, so KV costs 64 KiB/tok at f16 and ~34 KiB/tok at q8_0 — roughly a quarter
of what `block_count` alone would imply.

### Serving configuration

llama-swap row `qwen38-27b-q6k-mrcr-ctx200k-kvq8-mtp-frog-eff-medium`:

```
llama-server --model unsloth/Qwen3.8-27B-UD-Q6_K.gguf
  -c 204800 -ctk q8_0 -ctv q8_0
  -np 1 --kv-unified
  --host 127.0.0.1 -ngl 99 -fa on -ub 2048 -b 4096 --jinja
  --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0 --no-context-shift
  --chat-template-file froggeric-chat_template.jinja
  --chat-template-kwargs '{"reasoning_effort":"medium"}'
  --spec-type draft-mtp
env GGML_VK_ALLOW_GRAPHICS_QUEUE=1
```

Each non-obvious choice, and why:

- **`-c 204800` with q8_0 KV, not the 133120/f16 row.** Decisive, not cosmetic.
  Qwen tokenises this bucket to **132,997** tokens against GDM's 130,874 — a
  1.6% expansion. The f16 row is `-c 133120`, leaving **123 tokens of margin**.
  With `--no-context-shift` that is a *refusal*, not a truncation, so part of the
  bucket would simply have failed to run. The q8_0/204800 row leaves ~72K spare.
- **`--no-context-shift`.** With context shift enabled, an over-long prompt is
  still served with the **oldest tokens silently dropped** — which deletes
  needles and produces a low score with no error anywhere in the logs or output.
  Off, the server refuses. For a benchmark, a loud failure beats a quiet wrong
  answer. (This only pins the pinned build's existing default.)
- **`--temp 1.0`, no presence penalty.** Temperature 1.0 matches the reference
  harness (`run_evaluation.py` uses `GenerateContentConfig(temperature=1.0)`)
  *and* the Qwen3.8 card's thinking recipe. Critically, the vendor's
  *instruct* recipe carries `presence_penalty 1.5`, which penalises exactly the
  token reuse a verbatim-reproduction task requires — using it here would be
  actively wrong, not merely suboptimal.
- **`reasoning_effort: medium`.** The froggeric template's own default, pinned
  explicitly so a template bump cannot move a published score underneath us.
- **froggeric template, not "sharp".** "sharp" is the same file plus an appended
  *terseness* directive, which cannot coexist with "reproduce this ~400-token
  passage exactly."
- **MTP speculative decoding on.** Measured on this model as safe with q8_0 KV
  (54.3% acceptance); it is *not* safe on the Qwen3.6 line, where q8_0 KV
  collapses acceptance to ~0.7%.

### Harness

`run_local.py` in this repo — stdlib + `requests` only, pointed at the local
OpenAI-compatible endpoint. Two details that affect correctness:

- **Scoring is not reimplemented.** `mrcr_v2_metric` is imported out of the
  upstream `run_evaluation.py` (with throwaway stubs for its unused
  `google.genai`/`pandas` imports) so there is exactly one scorer and it cannot
  drift from GDM's. Verified: perfect echo → 1.000, missing hash → 0.000,
  duplicate hash → the `rfind` path picks the last occurrence.
- **`csv.field_size_limit(sys.maxsize)`.** Rows are ~600 KB of transcript in a
  single field; without this every row fails to parse.

The metric is `difflib.SequenceMatcher` ratio between the reference answer and
the model output after the last occurrence of the 12-char hash, scored 0 if the
hash never appears.

### Command

```bash
python3 run_local.py \
  --csv ~/mrcr_v2/mrcr_v2/'mrcr_v2p1_8needle_in_(65536,131072)'*.csv \
  --effort medium --stride 3 --time-budget 3300 \
  --out results_128k_medium.csv
```

Raw per-sample output: `results_128k_medium.csv`, console log
`mrcr_128k_run.log`.

---

## 3. Results

### Score

```
n = 35    mean = 0.8500    median = 0.9914    sd = 0.3414
stderr = 0.0577           95% CI = 0.850 ± 0.113
```

### The distribution is bimodal — this is the main finding

| band | n | share |
|---|---|---|
| exactly 1.000 | 9 | 26% |
| ≥ 0.99 | 19 | 54% |
| ≥ 0.90 | **30** | **86%** |
| 0.10 – 0.90 | **0** | **0%** |
| < 0.10 | **5** | **14%** |

**Nothing landed in the middle.** The model either reproduces the correct needle
essentially perfectly, or it reproduces the *wrong* needle and scores ~0.03.
The mean of 0.850 is therefore not "85% of a passage recalled" — it is
**86% of the time completely right, 14% of the time it picked the wrong
instance**. The sub-0.90 scores are 0.013, 0.026, 0.028, 0.030, 0.036.

### What a failure actually looks like

Row 9 (score 0.0128) asked for a specific instance; the model emitted the hash
correctly and then produced a *different* instance of the same request — an
archaic-style poem:

```
NTHFdzSyfnguHark! A wonder doth grip my young soul, a yearning to pierce the night's scroll!
I speak of a quest, newly begun, to realms where shines but a single sun ...
```

So the format instruction and the hash protocol were followed perfectly; only
the *instance selection* (the counting step) failed. This is precisely the
capability MRCR is designed to isolate, and it means the residual 14% is a
counting error, not a context-degradation or copying error.

### Depth of the target within the context

| target position | n | mean | misses |
|---|---|---|---|
| 0–20% | 7 | 0.853 | 1 |
| 20–40% | 7 | 0.979 | 0 |
| 40–60% | 7 | 0.712 | 2 |
| 60–80% | 9 | 0.886 | 1 |
| 80–100% | 5 | 0.793 | 1 |

The 40–60% band is worst and 20–40% best, which *gestures* at a
"lost-in-the-middle" effect — but **with n≈7 per band these differences are not
statistically meaningful** and should not be reported as a finding. Noted only
to say the experiment is underpowered on this axis, not that the effect is
absent.

### Throughput, and why the bench figures were wrong here

| | bench figure (moderate ctx) | **measured at 131K** |
|---|---|---|
| Prefill | 813 tok/s | **294 tok/s** |
| Decode | 45.9 tok/s | **30.5 tok/s** |
| MTP draft acceptance | — | **94% (691/735)** |

Prefill is ~2.8× slower at this depth than the roster's mid-context benchmark,
and decode ~1.5× slower. Any planning that extrapolates shallow-context
throughput to 131K will underestimate by roughly 3×.

**Prefix caching is what made the run affordable.** Consecutive rows in an MRCR
bucket differ *only* in the closing query line, and this whole bucket is one
base transcript:

| | sample 1 | sample 2+ |
|---|---|---|
| `cache_tokens` | 0 | **130,945** |
| tokens actually prefilled | 132,997 | **2,052** |
| wall clock | **551 s** | **~40 s** (median 39.5, range 27.6–65.5) |

That is a 12.5× speedup, and it is why 35 samples at 131K fit in 32 minutes
rather than 5 hours. Sample 1's 551 s = ~70 s cold model load + ~452 s full
prefill + ~31 s decode.

Generation was short: **median 860 completion tokens** (range 493–1664),
including thinking. Medium-effort reasoning on this task is far cheaper than the
~3,400-token figure measured on reasoning-heavy tasks — retrieval-and-copy does
not provoke long deliberation.

### VRAM

| | |
|---|---|
| Predicted (arithmetic, before the run) | 29,761 MiB = 29.06 GiB |
| **Measured, model loaded** | **29.54 GiB** |
| **Measured, under 131K prefill** | **30.42 GiB** |
| Card total | 31.86 GiB |

The static prediction held to within 0.5 GiB. Note the extra ~0.9 GiB that
appears only once real prefill allocates its compute buffers — a static estimate
is not the number to budget against.

**Consequence for the f16 row:** `ctx130k/f16` was predicted at 30.55 GiB
*static*. Applying the same +0.9 GiB under load puts it at ~31.4 GiB of 31.86 —
i.e. it would very likely OOM, on top of already being unusable for this bucket
on the 123-token margin above. That row should be considered unfit for 128K work
and is retained only for shallower buckets.

---

## 4. Comparison

### Published MRCR v2 8-needle scores at 128K

| Model | Score | Type |
|---|---|---|
| Gemini 3.7 Flash | 0.970 | proprietary |
| Gemini 3.6 Flash | 0.918 | proprietary |
| GPT-5.2 (64K–128K range, OpenAI official) | 0.856 | proprietary |
| **Qwen3.8-27B Q6_K, local (this run)** | **0.850** | **open weights, 1× 32 GB** |
| Gemini 3.1 Pro Preview | 0.849 | proprietary |
| Claude Sonnet 4.6 | 0.849 | proprietary |
| Gemini 3.5 Flash | 0.773 | proprietary |
| Gemini 3 Pro | 0.770 | proprietary |
| **Gemma 4 31B** | **0.664** | **open weights** |
| Gemma 4 26B A4B | 0.441 | open weights |
| Gemma 4 E4B | 0.254 | open weights |
| Gemma 4 E2B | 0.191 | open weights |

### Read this before using that table

Four reasons the comparison is indicative, not decisive:

1. **Our subset is harder.** The published "128K" figures are **cumulative
   up-to-128K aggregates**, which mix in shallower, easier samples. This run is
   the **pointwise deepest bucket** — every one of the 35 samples sits at
   ~131K. On a like-for-like cumulative set our score would likely be *higher*,
   so 0.850 is conservative against these rows.
2. **n = 35, CI ±0.113.** The true value plausibly lies anywhere in
   0.74–0.96. Any claim of "ties Gemini 3.1 Pro" is not supported; "lands in the
   same band" is.
3. **Leaderboard provenance is uneven.** These figures come from third-party
   aggregators, and the sources themselves warn that methodological differences
   across reports move scores materially. They are not all reproduced under one
   harness.
4. **Tokenizer mismatch.** The bucket is 130,872 GDM tokens but 132,995 Qwen
   tokens; the model genuinely processes ~1.6% more context than the label says.

### The comparison that *is* clean

**Gemma 4 31B at 0.664 vs this run at 0.850** is the most informative row: a
similar-size open-weight dense model, same benchmark, same needle count. Even
allowing the full ±0.113 interval, the gap is large and in the same direction
throughout.

---

## 5. Conclusion

1. **131K context works on this box, and it works well.** 0.850 on 8-needle
   MRCR v2 at ~131K, with **zero refusals or errors** across 35 samples, from a
   27B model at Q6_K on a single 32 GB consumer GPU.
2. **The failure mode is counting, not context.** 86% of samples were
   essentially perfect and 0% were partial — when it fails, it reproduces a
   different instance flawlessly. There is no sign of the passage-level
   degradation you would expect if 131K were beyond the model's usable range.
3. **The result sits in the same band as proprietary frontier models' published
   128K figures**, and clearly ahead of the nearest open-weight comparison
   (Gemma 4 31B, 0.664) — with the caveat that our subset is the harder one and
   n is small.
4. **Quantisation to Q6_K did not visibly break long-context retrieval.** This
   was the open question the Q6_K row existed to answer.
5. **The KV precision decision was load-bearing.** q8_0 KV at 204800 is what made
   the run possible at all; the f16/133120 alternative had 123 tokens of margin
   and would have refused part of the bucket.

### Recommended next steps

- **Raise n at 131K.** All 103 rows at medium effort ≈ 70 min, given the ~40 s
  per-sample steady state. That would cut the CI roughly in half.
- **Fill in the depth curve.** 32K and 64K buckets under identical settings,
  to turn one point into a length-generalisation curve. Estimated ~25 min and
  ~35 min respectively for full buckets.
- **Ablate reasoning effort.** `none` vs `medium` at 131K would show whether
  thinking is what buys the counting step; `none` runs ~4× faster.
- **Ablate quantisation.** The Q4_K_XL row at the same ctx/KV isolates the cost
  of quantisation on long-context retrieval.

---

## 6. Reproduction

```bash
# 1. data (8-needle, <=128K group)
./download.sh ~/mrcr_v2 -n 8 -s

# 2. serving config
cd ~/.config/llama-swap && python3 generate.py
bash ~/llama_swap_start.sh start

# 3. run
cd <repo>/mrcr_v2
python3 run_local.py \
  --csv ~/mrcr_v2/mrcr_v2/'mrcr_v2p1_8needle_in_(65536,131072)'*.csv \
  --effort medium --stride 3 --time-budget 3300 \
  --out results_128k_medium.csv
```

`--dry-run` reports the projected cost without touching the GPU. It was
recalibrated against this run: it now interpolates prefill/decode rates between
two measured depth anchors (32K and 133K) and uses the measured 2,050-token
cache-reuse tail rather than the 30 tokens the raw character diff implies. On
this run it predicts 27 min against the actual 32 min (**−16%**, down from the
~3× error the pre-run version had). The residual is mostly the ~70 s cold model
load, which it does not model. Treat it as ±20%.

## 7. What this run does *not* establish

- Any context length other than ~131K.
- Behaviour at 2- or 4-needle (both are *easier*; noise floors ~51% and ~27%).
- Whether a position/"lost-in-the-middle" effect exists — underpowered.
- Run-to-run variance: sampling ran at temperature 1.0 and this is a **single
  run** with no repeat seeds.
- Anything about tool-assisted performance. **No tools were provided.** The repo
  README is explicit that MRCR with code tools is a fundamentally different and
  much easier task, and that any report must state which was used. This one did
  not.

## Sources

- [MRCR / Michelangelo paper (arXiv 2409.12640v2)](https://arxiv.org/abs/2409.12640v2)
- [GDM-MRCR v2 (8-needle, 128K) — DataLearner](https://www.datalearner.com/en/benchmarks/gdm-mrcr-v2-8-needle-128k)
- [MRCR v2 (8-needle) leaderboard — LLM Stats](https://llm-stats.com/benchmarks/mrcr-v2-(8-needle))
- [MRCR 128K (8-needle) leaderboard — LLM Stats](https://llm-stats.com/benchmarks/mrcr-128k-(8-needle))
- [Long Context Benchmarks: All Three Hit 1M — Now What?](https://yage.ai/share/long-context-benchmark-en-20260315.html)
- [GPT-5.2 Benchmarks — Vellum](https://www.vellum.ai/blog/gpt-5-2-benchmarks)
