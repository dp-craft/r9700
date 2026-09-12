<!-- meta
date: 2026-09-12 15:35
takeaway: The vLLM row's 36864 window could not serve the dp-forge spec-pipeline (dies at the first LLM stage); the row is now ctx 114688 / MTP-3 and MEASURED to boot (138k-token pool). fp8 KV measured as an exact null on this hybrid; MTP is the only window lever. At ~98k prompts vLLM decodes 25% faster than the llama.cpp 200k row (flat vs decaying decode), though llama.cpp leads decode by 60% at 8k.
-->

# vLLM window vs spec-pipeline budgets, and the ROCm decode-knob list — R9700 (gfx1201)

- **Date:** 2026-09-12 15:35 (runs 18:44–20:22) · **Track:** static investigation + config change, then engine-bench boot matrix (Phase A) and depth curve (Phase B)
- **GPU/Host:** AMD Radeon AI PRO R9700, RDNA4 gfx1201, 32624 MiB · ROCm 10.0.0 · Ryzen 5 3600, 31 GB
- **Runtimes:** `stilldeadcode/vllm-radiance:0.9.3` (vLLM 0.27.1, torch 2.11.0+rocm7.14) · host venv vLLM 0.29.0+rocm723 · llama.cpp b10909
- **Model:** `RedHatAI/Qwen3.8-27B-INT4` @ `bf08f3db` (compressed-tensors W4A16 g128)
- **Data:** **`bench/runs/2026-09-12-1844-vllm-window-bootmatrix/`** (Phase A), **`bench/runs/2026-09-12-1943-vllm-bigwindow-depthcurve/`** (Phase B), `bench/runs/2026-09-12-1330-depth-curve-mtp/`, `bench/runs/2026-09-11-2047-vllm-qwen38-27b-int4/`; consumer evidence `dippe/dp-forge/docs/test/2026-09-11-w4-t1-restart2.md`

## Summary

The generated vLLM row (`--max-model-len 36864`) cannot serve the dp-forge spec-pipeline, and not for the
reason that was assumed. vLLM admits `max_model_len − max_tokens` = **12 864** prompt tokens, and the
pipeline's **first** LLM stage sends 74 507 — so the run dies at step 3 of 24 (`spec-a-resolve`), five steps
before `spec-b2-fill`, the stage that failed in run 912. No budget tuning closes a 4.4× gap. The row is now
**ctx 114 688 / mtp 3** as instructed, and `generate.py` no longer advertises an opencode `output` limit that
crowds out the prompt on small-window rows.

**The row boots (MEASURED, Phase A §2c):** 138 416-token pool, concurrency 1.21×. Source inspection
explained why speculation costs window on a hybrid (`MambaSpec.num_speculative_blocks`, §2a), and the
boot matrix quantified it: MTP is taxed three ways — more blocks per request, a larger padded attention
block (1568 → 1600 → 1648 tokens for MTP 0/3/8), and 1.12 GiB of draft-head weights. Turning MTP off
roughly doubles KV capacity per GiB. **`--kv-cache-dtype fp8` changed nothing at all** — two controlled
pairs identical to the digit — because the attention block is pinned to the mamba page.

**Performance at the new window (MEASURED, Phase B §2d),** vs the llama.cpp 200k row it would replace,
8k → 98k prompts: llama.cpp decodes 60% faster at 8k and **25% slower at 98k** (35.4 vs 44.3 tok/s) —
its decode decays (−0.257, R² 0.97) while vLLM's is flat (42–51 tok/s, no trend). Cold prefill is
near-parity past 20k. At the pipeline's real ~75–98k prompts and 24k-token answers, vLLM is the faster
row by an INFERRED ~2¼ min per long stage. The comparison is deployment-level (quant, KV precision and
window all differ), not engine-level.

On the ROCm knob list: most of it is CDNA (MI300X/MI355X) guidance. Two items looked like the clearest
path to *this* box's actual problem — **fp8 KV cache** (radiance ships `attn_decode_h256_gqa6_fp8kv`, a
kernel built for exactly this model's geometry) and **`--max-num-seqs`**, which the list never mentions.
**Phase A measured both as nulls** (§2c): fp8 KV changes nothing on a mamba-pinned block size, and np 1
is worse than np 4, not better. One item, "reduce the prefill chunk size", is actively wrong here. The
only measured window lever left is MTP itself.

## What changed (this session)

| File | Change | Blast radius |
|---|---|---|
| `~/.config/llama-swap/generate.py` | opencode `limit.output` is now `min(OPENCODE_MAX_OUTPUT, ctx // 2)` | 1 row of 23. Binds only below ctx 65536; 131072/150000/200000 rows keep the exact 32768 they had |
| `~/.config/llama-swap/tests/test_cmd.py` | 2 assertions corrected (they pinned the pre-fix behaviour), +3 tests for the guard | — |
| `~/.config/llama-swap/models.yaml` | vllm row `ctx: 36864 → 114688`, `mtp: 8 → 3`, rationale comment | id becomes `qwen38-27b-int4-ctx112k-mtp-vllm` |
| `~/.config/llama-swap/config.yaml` + `opencode.json` | regenerated | diff is the vllm row only — 5 lines in config.yaml, 3 in opencode.json, nothing else moved |
| `~/.config/llama-swap/tests/golden/*` | regenerated | absorbed a **pre-existing** staleness wave (see Methodology) |

Test suite: **234 passed, 0 failed** — the first fully green run (baseline was 4 failed / 227 passed).
GPU runs (Phase A + B) and their artefacts:

| Artefact | Change |
|---|---|
| `bench/runs/2026-09-12-1844-vllm-window-bootmatrix/` | 8 arms + 3 clean re-collections; w1/c3/c4 originals moved to `quarantine/` with `CAVEAT.txt`; `summary.txt` carries an ERRATA block for three mislabelled rerun lines; `meta.txt`; `scripts/` |
| `bench/runs/2026-09-12-1943-vllm-bigwindow-depthcurve/` | 2 arms × 4 depths × 3 reps; `summary.txt` from `scripts/summarize_depth.py`; `meta.txt`; `scripts/` |
| `~/.config/llama-swap/models.yaml` | rationale comment corrected: fp8 removed from the fallback order, Phase A/B results recorded (comment only — generated config unchanged) |
| This document | §2c, §2d added; §2b consequences, §3 fp8 row, §4 fallback order and the Summary corrected — every pre-run prediction that failed is left visible and marked WITHDRAWN/SUPERSEDED rather than deleted |

Backups: `generate.py.bak-pre-outputlimit`, `models.yaml.bak-pre-bigwindow`, `config.yaml.bak-pre-bigwindow`,
`opencode.json.bak-pre-bigwindow`, `tests/golden.bak-pre-regen`, `tests/test_cmd.py.bak-pre-outputlimit`.

## 1. The window arithmetic (MEASURED + source)

vLLM subtracts the output reserve from the window *before* checking the prompt:
`renderers/params.py:204-210` → `max_input_tokens = max_total_tokens − max_output_tokens`, enforced in
`_token_len_check` (l.450-478), which raises `VLLMValidationError` → HTTP 400 **before generation**.

| Term | Value | Source |
|---|---:|---|
| `max_model_len` | 36 864 | generated `config.yaml:366` |
| `max_tokens` per call | 24 000 | `budgets.outputTokens` → `src/wiring/env.ts:98`, `src/transport/direct.ts:45` |
| **Admissible prompt** | **12 864** | derived |

All three author stages are `"agent": "stage-pure"` → direct transport → all three carry the reserve.

| Run-912 call | Real in | Cached | vs 12 864 | On a 36 864 window |
|---|---:|---:|---:|---|
| **spec-a-resolve a1** (step 3/24) | **74 507** | 155 | **5.79×** | **400 — run ends here** |
| spec-b1-outline a1 (6/24) | 46 238 | 155 | 3.59× | never reached |
| spec-b2-fill a1 (8/24) | 52 251 | — | 4.06× | never reached |
| spec-b2-fill a2 | 2 190 | 50 354 | 4.08× | never reached |

The prefix cache does not rescue it: `_token_len_check` counts the full tokenised prompt, hit or miss.

**Predicted failure shape vs run 912's actual one:**

| | Run 912 (llama.cpp ctx 200k) | Predicted (vLLM ctx 36 864) |
|---|---|---|
| Stage | spec-b2-fill (8/24) | spec-a-resolve (3/24) |
| Cause | output cap, `finish_reason "length"` | input over `max_model_len − max_tokens` |
| failureKind | `output-truncated` | `http-status:context-overflow` |
| Exit | 4 (paused) | 3 (step failed) |
| Retries burned | 2 of 2, ~1 049 s | 0 — `retryableStatus` is `429 \|\| ≥500`, so 400 is not retried (`run-stage.ts:509`) |

The diagnosis would at least be correct: `CONTEXT_OVERFLOW = /context (size|length)/i`
(`src/diagnose/classify.ts:32,183`) matches vLLM's wording and emits the right hint.

**Budgets cannot be shrunk to fit.** spec-b2-fill a1 legitimately used 18 999 output tokens, so
`outputTokens` cannot fall much below ~20 000, leaving ≤16 864 for a prompt measured at 46 238–74 507.
And `bundleTokens: 85000` is not even a hard prompt cap: `applyBudget` (`src/evidence/trim.ts:121-133`)
trims only trimmable sections and leaves `AUTHORED_SECTIONS` intact with a warning.

**Required window:** 74 507 + 24 000 = **98 507** (worst measured) / ≥**109 000** (budget contract).
`114 688` is the round number above both; `max_position_embeddings` is 262 144, so no rope scaling.

## 2. The KV pool — and the confound that invalidates the obvious reading

vLLM refuses to **boot** (not degrade) when one `max_model_len` sequence does not fit the pool:
`v1/core/kv_cache_utils.py:870-886` `check_enough_kv_cache_memory`, whose message carries an
`estimate_max_model_len(available_memory)` figure. So a wrong `ctx` is a loud, self-diagnosing failure.

MEASURED boot lines, all at ctx 36 864 / np 4 / gpu-mem-util 0.90:

| Arm | Model load | Available KV | GPU KV pool | Concurrency @36 864 | prefix cache | mamba mode |
|---|---:|---:|---:|---:|:--:|:--:|
| R4D + MTP-8 (T3 boot) | 17.8 GiB | 3.89 GiB | 50 079 tok | 1.36× | **ON** | align |
| R4D + MTP-8 (T1 boot, same argv) | 17.8 GiB | 5.04 GiB | 65 381 tok | 1.77× | **ON** | align |
| R4D, MTP off | 16.68 GiB | 6.94 GiB | 197 973 tok | 5.37× | **OFF** | (unset) |

> **The third row is not comparable to the first two** — it differs in three variables (speculation,
> prefix caching, mamba-cache-mode), so "MTP costs 75% of the pool" cannot be read off it. That was the
> right caution, but source inspection has now settled the mechanism outright, and the answer is sharper
> than the table suggested.

### 2a. RESOLVED: why speculation costs window on a hybrid

`MambaSpec.num_speculative_blocks` is set straight from `num_speculative_tokens`
(`vllm/model_executor/layers/mamba/abstract.py:63-79`) and multiplies the **per-request block
reservation of every mamba group** (`vllm/v1/kv_cache_interface.py:727-738`):

| `--mamba-cache-mode` | blocks reserved per mamba group per request |
|---|---|
| `none` (vLLM default) | `1 + S` |
| **`align` (what we pass)** | **`2 + S`** |
| `all` | `cdiv(max_model_len, block_size) + S` |

The reservation exists because a rejected draft must roll the recurrent state back, and Gated-DeltaNet
state is irreversible: `single_type_kv_cache_manager.py:1472-1478` ("Allocate extra
`num_speculative_blocks` blocks … with linear attention") and `mamba_utils.py:1045-1100` ("Copy the mamba
state of previous step to the last `(1 + num_speculative_blocks)` block"). Attention KV needs no
equivalent — a rejected token is just an uncommitted slot.

It reaches the printed pool figure through
`max_concurrency = num_blocks / Σ_groups(blocks per request)` (`kv_cache_utils.py:937-959`) and
`pool_tokens = max_concurrency × max_model_len` (`kv_cache_utils.py:1877-1887`).

Two MEASURED structural constants make this arithmetic rather than theory:

| Constant | Value | Source |
|---|---|---|
| Attention block size (auto-raised to match the mamba page) | **1648 tokens** | boot log: `Setting attention block size to 1648 tokens to ensure that attention page size is >= mamba page size` |
| Mamba groups | **3** (48 GDN layers ÷ group_size 16) | group heuristic `kv_cache_utils.py:1245-1257`; 16 attention layers ÷ 16 = 1 attention group |

**The headline, at the shipped 36 864 window with MTP-8:** the attention term is
`cdiv(36864, 1648)` = **23 blocks**, the mamba+speculation term is `3 × (2+8)` = **30 blocks**.
*The speculation reservation is larger than the entire attention reservation* — 57% of the per-request
budget. That, not any per-token KV cost, is what collapsed the pool.

### 2b. The consequence: MTP is expensive at SMALL windows, cheap at large ones

The mamba+spec term is a **fixed block count**, independent of the window; the attention term grows with
it. So speculation's share falls as the window grows — at ctx 114 688 with MTP-3 it is 18%, not 57%.
The user's "mtp 3 + big window" instinct is better founded than the raw pool numbers suggested.

Calibrating the affordable budget from the two measured boots (concurrency 1.36 and 1.77 at 53
blocks/request ⇒ the config can afford 72 and 94 blocks/request respectively):

| ctx | S | mode | attn blocks | mamba+spec blocks | blocks/req | vs T3 boot (72) | vs T1 boot (94) |
|---|---:|---|---:|---:|---:|---|---|
| 36 864 | 8 | align | 23 | 30 | 53 | BOOTS | BOOTS |
| 36 864 | 3 | align | 23 | 15 | 38 | BOOTS | BOOTS |
| **114 688** | **3** | **align** | **70** | **15** | **85** | **REFUSES** | **BOOTS** |
| 114 688 | 3 | none | 70 | 12 | 82 | REFUSES | BOOTS |
| 114 688 | 0 | align | 70 | 6 | 76 | REFUSES | BOOTS |
| 114 688 | 8 | align | 70 | 30 | 100 | REFUSES | REFUSES |
| **114 688 + fp8 KV** | **3** | **align** | **35** | **15** | **50** | **BOOTS** | **BOOTS** |
| 114 688 + fp8 KV | 8 | align | 35 | 30 | 65 | BOOTS | BOOTS |

> INFERRED — arithmetic over MEASURED constants (block size 1648, 3 mamba groups, the two measured
> concurrencies) and the source formula. Not a measurement. Phase A tests every row of it.
>
> **SUPERSEDED IN PART — Phase A has now run (§2c).** The MTP rows held; the two **fp8 rows are
> FALSIFIED** — fp8 KV changed nothing at all, and the predicted block-size doubling did not happen.

**Three things follow, and two of them correct earlier statements in this document:**

1. **The shipped row sits exactly on the knife edge** (85 needed, 72–94 affordable). The +31% boot-to-boot
   spread is therefore decisive, not cosmetic: the same argv boots or refuses depending on how the
   memory profiler lands. This must not ship unverified.
   → **Phase A verdict: it boots** on a clean card (§2c). The one REFUSED observation turned out to be
   VRAM contention from a `llama-server` started in another session, not a real ceiling.
2. **fp8 KV is the decisive lever, and it is nearly free structurally.** Halving attention bytes/token
   doubles the aligned block size to ~3296, which halves the attention term to 35 while leaving the
   page size — and therefore the block budget — unchanged. It boots on both calibrations, with margin,
   and would even carry MTP-8.
   → **WITHDRAWN — Phase A measured this as an exact null** (§2c). Two controlled pairs came back
   identical to the digit, and the block size did **not** double. The premise was wrong: the attention
   block is padded *up* to the mamba page, so cheaper attention bytes/token buy padding, not capacity.
3. **`--max-num-seqs` is NOT a lever for the boot check — correcting §3 below.** `blocks_per_request`
   contains no `max_num_seqs` term; the check asks whether *one* request fits. Dropping np may still
   free activation memory during profiling, but that is a different quantity. Phase A's np arm now
   tests a falsifiable prediction (it should move nothing) rather than an assumed lever.
   `--mamba-cache-mode none` is real but tiny: 3 blocks, ~4%.
   → **Prediction held.** np 1 did not help; it measured *worse* than np 4, and that arm is itself
   suspected contended (§2c). Source reading confirmed by measurement.

KV geometry from `config.json` (planning bound only — rule 7, never the reported usage):

| Quantity | Value |
|---|---|
| Layers | 64 = **48 `linear_attention` (Gated-DeltaNet)** + **16 `full_attention`** |
| Attention KV/token f16 | 16 × 4 kv-heads × 256 head_dim × 2 (K+V) × 2 B = **64 KiB/tok** |
| GQA ratio | 24 / 4 = **6** |

That geometry — **head_dim 256, GQA 6** — is exactly what radiance's fp8 decode kernel is named for
(see §3), which is a strong signal this stack was built for this model.

## 2c. MEASURED: the Phase A boot matrix

**Data:** `bench/runs/2026-09-12-1844-vllm-window-bootmatrix/` · 8 arms + 3 re-collections, boot-log
only (aborted at the pool line, before graph capture). All rows MEASURED.

| arm | ctx | MTP | np | KV | avail KV | pool tokens | conc | attn block | weights | verdict |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---|
| w1 | 114 688 | 3 | 4 | auto | 4.35 GiB | REFUSED @ 108 800 | — | 1600 | 17.8 GiB | **QUARANTINED** |
| **w1 rerun** | 114 688 | 3 | 4 | auto | 5.50 GiB | **138 416** | 1.21× | 1600 | 17.8 GiB | **BOOTS** |
| w2 | 114 688 | 3 | 4 | **fp8** | 5.50 GiB | **138 416** | 1.21× | 1600 | 17.8 GiB | BOOTS |
| w3 | 114 688 | 0 | 4 | auto | 7.13 GiB | 213 606 | 1.86× | 1568 | **16.68 GiB** | BOOTS |
| w4 | 114 688 | 3 | **1** | auto | 4.76 GiB | 119 961 | 1.05× | 1600 | 17.8 GiB | BOOTS (suspect) |
| c1 | 36 864 | 8 | 4 | auto | 5.04 GiB | **65 381** | 1.77× | 1648 | 17.8 GiB | BOOTS |
| c4 rerun | 36 864 | 8 | 4 | **fp8** | 5.04 GiB | **65 381** | 1.77× | 1648 | 17.8 GiB | BOOTS |
| c2 | 36 864 | 3 | 4 | auto | 4.33 GiB | 78 454 | 2.13× | 1600 | 17.8 GiB | BOOTS (suspect) |
| c3 rerun | 36 864 | 0 | 4 | auto | 7.22 GiB | 184 320 | 5.00× | 1568 | **16.68 GiB** | BOOTS |

### Finding A1 — the shipped row boots (MEASURED)

`ctx 114688 / MTP 3 / np 4 / auto` sizes a 138 416-token pool, concurrency 1.21×. The knife-edge
prediction was right about the margin being thin and wrong about which side it fell on.

### Finding A2 — `--kv-cache-dtype fp8` is an exact null on this model (MEASURED)

Two controlled pairs, one variable each:

| pair | auto | fp8 | delta |
|---|---|---|---|
| ctx 36 864 / MTP 8 (c1 vs c4) | 5.04 GiB → 65 381 tok, 1648-block | 5.04 GiB → 65 381 tok, 1648-block | **none** |
| ctx 114 688 / MTP 3 (w1r vs w2) | 5.50 GiB → 138 416 tok, 1600-block | 5.50 GiB → 138 416 tok, 1600-block | **none** |

Identical to the last digit, including the attention block size that was predicted to double. The
flag did reach the engine — `kv_cache_dtype=fp8` appears in both fp8 arms' logs and `auto` in both
baselines — so this is a real null, not a dropped argument.

**Why (INFERRED, consistent with the MEASURED block sizes):** vLLM raises the attention block size
until the attention page is ≥ the mamba page. With 48 of 64 layers Gated-DeltaNet, the mamba page is
the binding constraint. Halving attention bytes/token therefore does not shrink the page — it just
adds padding inside a block whose size is pinned by mamba. **Consequence for practice:** do not
build the per-row `--kv-cache-dtype` knob for this model; fp8 KV buys no window and no capacity here,
and it would still carry the uncalibrated-scale quality risk (vLLM force-disables `calculate_kv_scales`
on hybrids). It may still pay on a non-hybrid model, where nothing pins the block size.

### Finding A3 — MTP is taxed three separate ways, and the total is large (MEASURED)

At the same window, normalising for the differing available memory:

| ctx | MTP | pool tok/GiB | attn block | weights |
|---:|---:|---:|---:|---:|
| 36 864 | 8 | 12 972 | 1648 | 17.8 GiB |
| 36 864 | 3 | 18 119 | 1600 | 17.8 GiB |
| 36 864 | 0 | **25 529** | **1568** | **16.68 GiB** |
| 114 688 | 3 | 25 167 | 1600 | 17.8 GiB |
| 114 688 | 0 | **29 959** | **1568** | **16.68 GiB** |

1. **Block count** — the `MambaSpec.num_speculative_blocks` multiplier of §2a.
2. **Block size** — NEW, not predicted: the mamba page grows with the speculative reservation, so the
   attention block is padded further (1568 → 1600 → 1648 for MTP 0 → 3 → 8). Every attention block
   wastes more room, at every depth.
3. **Weights** — the draft head costs **1.12 GiB** (`Model loading took` 17.8 vs 16.68 GiB), which is
   1.12 GiB not available to the KV pool before any of the above applies.

Turning MTP off roughly doubles KV capacity per GiB at ctx 36 864 (12 972 → 25 529 tok/GiB).
Whether that trade is worth it depends entirely on the decode gain MTP actually delivers — which is
Phase B's job, not this section's.

### OPEN — capacity per GiB rises with the window at fixed MTP

MTP-3 yields 18 119 tok/GiB at ctx 36 864 but 25 167 tok/GiB at ctx 114 688, with the same 1600-token
block. The block arithmetic of §2b does not predict a ctx dependence in this ratio. Logged as OPEN
rather than explained; it does not affect any recommendation here.

### Methodology note — one arm was contaminated, and it nearly became a finding

w1's REFUSED verdict and its 4.35 GiB availability were produced while a `llama-server` started in
**another session** held VRAM (user-reported, confirmed by the re-collection at 5.50 GiB). Two further
arms, w4 (4.76 GiB) and c2 (4.33 GiB), show the same depressed-availability signature and are marked
suspect pending re-collection. `gpu_exclusive.sh` proves the card is free *before* boot; it cannot
prove it stays free, and llama-swap reloads on demand. **Tool debt:** the probe needs a contention
sentinel that samples throughout the arm and quarantines automatically (rule 18), not just a
precondition gate.

**Script bug found and fixed:** `bootmatrix.sh` ran the probe with `docker run --rm`, so an arm that
exited was removed by the daemon and the follow-up `docker logs` failed — overwriting `server.log`
with the daemon's error and destroying the diagnostics. Two arms (c3, c4) were lost that way and
re-collected with `bootarm.sh`, which keeps the container and never overwrites a good log.

## 2d. MEASURED: Phase B — the big-window depth curve

**Data:** `bench/runs/2026-09-12-1943-vllm-bigwindow-depthcurve/` · 2 arms × 4 depths × 3 reps, 12/12
requests OK per arm, 0 errors · `codereview-{8000,20000,40000,100000}` · `--prefix-mode unique --api chat`
· 256 generated tokens · temperature 0.2. Arms run back to back in one session, card exclusive for each.

- **ARM A** llama.cpp Vulkan b-`latest-vulkan`, `Qwen3.8-27B-UD-Q4_K_XL`, MTP, q8_0 KV, ctx 200 000
  (llama-swap row `qwen38-27b-q4kxl-q8-mtp-ctx200000-kvq8-mtp-sharp-planning`)
- **ARM B** vllm-radiance 0.9.3, `Qwen3.8-27B-INT4` W4A16, R4D, MTP-3, auto KV, ctx 114 688, np 4 —
  **the shipped row**, pool 138 416 tokens, concurrency 1.21× (reproduces Phase A exactly)

| depth | ARM A prefill | ARM B prefill | ARM A decode | ARM B decode | ARM A TTFT | ARM B TTFT | ARM A wall | ARM B wall |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 297 / 8 182 | 890.0 ±62.6 | **1242.2** ±46.9 | **67.40** ±0.45 | 42.11 ±0.53 | 11.67 s | **6.59 s** | 15.47 s | **12.65 s** |
| 20 236 / 20 123 | **882.4** ±10.8 | 807.4 ±0.5 | **57.43** ±4.57 | 43.43 ±3.38 | **23.96 s** | 24.92 s | **28.42 s** | 30.82 s |
| 40 137 / 40 023 | **804.8** ±2.9 | 768.0 ±0.3 | 49.48 ±3.29 | 50.56 ±2.05 | **51.56 s** | 52.12 s | 56.73 s | 57.17 s |
| 98 105 / 97 991 | 636.6 ±0.7 | **661.8** ±1.7 | 35.43 ±1.06 | **44.32** ±4.20 | 158.60 s | **148.07 s** | 165.81 s | **153.86 s** |

| fit (log-log, 4 points, 8k–98k) | prefill exp | R² | decode exp | R² | wall exp | R² |
|---|---:|---:|---:|---:|---:|---:|
| ARM A llama.cpp | −0.136 | 0.826 | **−0.257** | 0.965 | +0.964 | 0.983 |
| ARM B radiance | −0.241 | 0.877 | +0.035 | **0.208** | +0.999 | 0.998 |

| memory (vram_sampler, whole arm) | VRAM mean | VRAM peak | GTT peak | verdict |
|---|---:|---:|---:|---|
| ARM A llama.cpp | 27 631 MiB | 28 101 MiB | **2 283 MiB** | host-RAM spill (baseline ~77) |
| ARM B radiance | 26 840 MiB | **30 534 MiB** | 271 MiB | no spill; 2 090 MiB headroom to physical |

Draft acceptance, ARM B (vLLM rolling log, MEASURED): mean acceptance length **2.42–3.97** of a
maximum 4 (3 drafts + bonus), median ~2.8; per-window acceptance rate 47.5–99.1%, median ~62%.

### Finding B1 — the decode ranking inverts with depth (MEASURED)

llama.cpp leads decode by 60% at 8k and loses by 25% at 98k; they cross near 40k (49.5 vs 50.6,
inside noise). llama.cpp decode decays cleanly (−0.257, R² 0.965); radiance decode has **no depth
trend** (R² 0.208) — it is flat at 42–51 t/s from 8k to 98k. This is rule 16 again: any comparison
taken at ≤20k picks llama.cpp, and it is the wrong pick for this workload.

**Plausible cause (INFERRED, not isolated):** ARM A runs q8_0 KV, which pays dequantisation against
the whole history on every decode step (benchmark-results rule 12 measured q8_0 decaying ~1.7× faster
than f16 on this model). ARM B's decode touches attention in only 16 of 64 layers, and its
Gated-DeltaNet state is constant-size. The arms differ in KV precision, window and engine at once,
so the split between those causes is not established.

### Finding B2 — cold prefill is near-parity past 20k, and radiance wins only at the ends (MEASURED)

radiance leads at 8k (+40%) and at 98k (+4%); llama.cpp leads at 20k (+9%) and 40k (+5%). radiance
decays faster (−0.241 vs −0.136) yet leads at the deepest point — the fits are R² 0.83–0.88, i.e. the
curves are not clean power laws over this range, and neither exponent should be extrapolated.

### Finding B3 — at the pipeline's real shape, radiance is the faster engine (MEASURED + INFERRED)

At 98k, wall for a 256-token answer is 153.9 s vs 165.8 s (−7.2%). But the dp-forge stages generate up
to **24 000** tokens, where decode dominates: at the 98k decode rates that is **24 000 / 44.32 ≈ 542 s**
vs **24 000 / 35.43 ≈ 677 s** — about **2¼ minutes saved per long stage**. INFERRED: both rates were
measured over 256 tokens and will sag further as the answer itself deepens the context; llama.cpp's
cleaner decay suggests the gap widens rather than closes, but that is not measured.

### Caveats

- **Not window- or KV-matched** (ctx 200 000/q8_0 vs 114 688/auto) and **not quant-matched** (GGUF
  UD-Q4_K_XL vs compressed-tensors W4A16). This is a *deployment* comparison — the two rows that would
  actually be served — not an engine comparison.
- **Cold prefill only.** Prefix reuse (T1: radiance ~13 300 vs llama.cpp ~620 tok/s on cache hits) is
  not in these numbers and favours radiance heavily for the growing-conversation pattern (rule 17).
- **ARM B runs 2 090 MiB from physical VRAM** at peak — with a desktop session on the card, that is
  the thin margin to watch, not KV concurrency.
- **Tooling:** the script's inline printer and fit used the wrong keys (`prompt_tok`/`ttft_p50` vs
  capture_engine's `prompt_tokens`/`ttft_s`) and printed `None`/"no fit"; the JSONL was complete and
  the tables above come from reading it directly. `report.py` wrote **0 charts** for either arm dir —
  a fourth instance of the chart gap logged in §5 (it does not render per-request depth rows).

## 3. The ROCm knob list, item by item

**Framing first.** Every citation in the list is MI300X / MI355X (CDNA3/4) or a Strix (gfx1151) page.
This box is RDNA4 **gfx1201** under `HSA_OVERRIDE_GFX_VERSION=12.0.1`. AITER is a CDNA-first library,
and the shipped recipe already holds 8 of its 9 sub-flags at 0 — that is the measured recipe, not neglect.

**The structural point the list cannot see: 48 of 64 layers are not attention at all.** Every
attention-kernel item on the list can touch at most 25% of the model. The dominant decode cost is the
Gated-DeltaNet recurrence plus the dense GEMMs — which is what `RADIANCE_SKINNY_GEMM=all` already targets.
That caps the realistic upside of the attention-backend items and is the reason to spend the next run's
budget on memory/window levers instead.

| Item | Status | Source verdict | Arm? |
|---|---|---|---|
| `VLLM_V1_USE_PREFILL_DECODE_ATTENTION=1` | not set | **DEAD — the env var does not exist** in vLLM 0.27.1 or 0.29.0 (zero hits; not in `envs.py`). It became the `ROCM_ATTN` backend (`registry.py:52`), unreachable from R4D: `R4DAttentionBackend` subclasses `TritonAttentionBackend` and its only fallback is `unified_attention`, so `chunked_prefill_paged_decode` is never in its call graph. The kernel is **triply ineligible here anyway** — the RDNA branch of `rocm.py:374-410` requires `head_size == 128` (we have **256**), `kv_cache_dtype == "auto"`, and `max_seq_len ≤ 128k`. `VLLM_ROCM_CUSTOM_PAGED_ATTN` does not exist either | **no** |
| `VLLM_ROCM_USE_AITER=1` | **we already set it** via `-e`; it is not in the image ENV | — | no |
| `VLLM_ROCM_USE_AITER_MHA=1` | we set **0** | Eligible but unattractive. gfx1201 passes the platform gate and AITER FA declares head sizes `[64,128,256]`, so 256 *is* supported — I was wrong to guess otherwise. But every hand-written ASM path excludes gfx12 (`aiter/ops/mha.py:1672-1760`: gfx942/gfx950/gfx1250 only), leaving the CK-tile fallback, which has a gfx12 `(256,256)` tile but ships **no prebuilt `.so`** → JIT-compiles on first use. It also competes with R4D rather than adding to it | low |
| **FP8 KV cache** | **MEASURED — exact null (§2c)** | **Retracted.** Predicted to halve the attention term; measured as changing *nothing*: two controlled pairs identical to the digit, block size unchanged, flag confirmed applied. The attention block is padded up to the mamba page, and with 48/64 layers Gated-DeltaNet the mamba page binds. Prior source reading (still valid, just not decisive): hybrid-supported, no gfx1201 exclusion (`is_fp8_fnuz()` false → OCP `e4m3`), R4D declares `["auto","bfloat16","fp8","fp8_e4m3"]` with a bound kernel (`radiance_r4d_attn.py:98-121,214`). Quality caveat stands but is now moot: vLLM force-disables `calculate_kv_scales` on hybrids. |
| Tune `num_speculative_tokens` | now 3 | Right, and §2a shows it is also a *memory* knob, linear in the mamba term. Acceptance is content-dependent, so τ must be reported per workload | yes, τ per row |
| `HIP_FORCE_DEV_KERNARG=1` | **not** in the image ENV (`docker inspect`) | The flag string exists in `libamdhip64.so` but its default is **NOT SETTLED BY SOURCE**. An arm was already run (`mtp0-tritonattn-kernarg`) | low |
| `PYTORCH_TUNABLEOP_ENABLED=1` | not set | **Barely applies.** `grep -rn "tunable" vllm/` → **zero hits**; TunableOp only intercepts `at::cuda::blas::gemm/bgemm`, and vLLM's ROCm path runs aiter/Triton/radiance kernels instead. Coverage is whatever torch-level GEMMs remain. Also worthless unless `PYTORCH_TUNABLEOP_FILENAME` points into `/cache` | **no** |
| `TORCH_BLAS_PREFER_HIPBLASLT=1` | not set | **Verified no-op.** Measured in-container: `torch.backends.cuda.preferred_blas_library()` returns `Cublaslt` with the var unset, `=0`, and `=1`. torch 2.11+rocm7.14 already resolves to hipBLASLt by default | **no** |
| Reduce prefill chunk size | 16384 | **Wrong for this workload** — the rationale is multi-tenant prefill/decode contention; the pipeline is serial. Lowering only makes a 90k prefill slower (7 chunks → 56) | no |
| `--gpu-memory-utilization 0.95` | 0.90 | "Single-tenant node" does not hold: this box runs a desktop GUI, and measured peak at 0.90 was already 30 148 MiB, ~800 MiB *above* the 0.90 target — 0.95 lands near 31.8 of 32.6 GiB. It does raise the block budget, so it is a real window lever | yes, at **0.93** |

**Two levers the list omits, both more relevant here than most of what it lists:**

| Lever | Why it matters on this box |
|---|---|
| **`--max-num-seqs` (currently 4)** | Worth testing, but **not for the reason I first gave** — see §2b(3): `blocks_per_request` carries no `max_num_seqs` term, so it does not move the boot check at all. It may still free activation memory at profiling time, which *would* raise the block budget. Phase A now tests it as a falsifiable prediction (it should move nothing) rather than an assumed lever |
| **`--max-num-batched-tokens` as a *window* knob (the inversion of item 9)** | Activation/graph memory is profiled *before* the KV pool is sized, so it is subtracted from it. On a memory-bound card, **lowering** the chunk size buys pool — i.e. window. The list frames this knob purely as a latency trade and misses that on a 32 GB card it is a capacity trade |

**A config-coherence risk the image ENV exposes.** `docker inspect` shows the image already bakes in
`RADIANCE_DYNAMIC_DRAFT=1` and `RADIANCE_DRAFT_SCHEDULE=1:8,2:7,4:6,8:5,16:4` — radiance picks the draft
length *dynamically from the running batch size*, and at batch 1 that schedule asks for **8**. Our
`--speculative-config num_speculative_tokens: 3` is what vLLM uses to size the mamba reservation (§2a),
so if the radiance schedule is not clamped by it, the engine would reserve for 3 and draft 8 — paying
the wrong memory and possibly corrupting rollback. The image also sets `RADIANCE_DRAFT_TAU=0.35` (we
override to 0.28) and reports `RADIANCE_VERSION=0.6.2` inside a tag named `0.9.3`, which is a provenance
discrepancy worth resolving before any number from it is published. **Must be checked before Phase B:**
one arm with `RADIANCE_DYNAMIC_DRAFT=0` to see whether the pool figure or the acceptance length moves.

Also untested and arguably more consequential than any attention flag, given 48/64 layers:
**`--mamba-cache-mode`** (we pass `align`; the alternatives have never been measured here), and the
**pool cost of prefix caching** on a hybrid — which T1 measured as worth 44.3 s → 2.4 s TTFT, so it is a
real trade, not a free win, and nobody has quantified its memory side.

## 4. Recommended config, and what to test next

Shipped now (**boot VERIFIED — §2c, Phase A w1 rerun: 138 416-token pool, concurrency 1.21×**):

```
--language-model-only --max-model-len 114688 --max-num-batched-tokens 16384
--max-num-seqs 4 --gpu-memory-utilization 0.90
--attention-backend R4D --enable-prefix-caching --mamba-cache-mode align
--speculative-config '{"method":"mtp","num_speculative_tokens":3,"attention_backend":"R4D","disable_padded_drafter_batch":true}'
--no-async-scheduling
```

§2b predicted this was marginal (85 blocks/request against an affordable 72–94). Phase A measured it
as **booting with a 1.21× concurrency margin** — thin, but real. Fallback order, **rewritten after
Phase A** (the pre-Phase-A ordering led with fp8 and was wrong):
1. **`mtp 3 → 0`** — now the only measured lever. MEASURED at ctx 114 688: pool 138 416 → 213 606
   tokens, concurrency 1.21× → 1.86×, and 1.12 GiB of weights returned. Costs whatever decode gain
   MTP delivers (Phase B).
2. **`--gpu-memory-utilization 0.93`** — raises the budget rather than lowering the demand. Bounded
   by the desktop GUI: MEASURED peak at 0.90 was already 30 148 MiB.
3. Take the `estimate_max_model_len` figure out of vLLM's own refusal and put it in `ctx` (the one
   refusal observed named **108 800**, but that boot was contended — §2c).

**Not** `--kv-cache-dtype fp8` — MEASURED as an exact null on this model (§2c, Finding A2). The
`generate.py` knob proposed for it should **not** be built.
**Not** `np` — `blocks_per_request` carries no `max_num_seqs` term (§2b(3)), and np 1 measured worse
than np 4, not better.

### Staged runs (Phase A and Phase B EXECUTED — §2c, §2d)

| Phase | Script | Cost | Answers |
|---|---|---|---|
| A — boot matrix | `scratchpad/bootmatrix.sh` | 8 arms × ~3 min, **no workload** | Does the shipped row boot; is MTP / np / fp8 the lever; and the clean MTP-0-with-prefix-caching cell that closes the §2 confound |
| B — depth curve | `scratchpad/depthcurve_bigwindow.sh` | 2 arms × 4 depths | Does the big-window vLLM row actually beat the llama.cpp 200k row it would replace, at the prompt size the pipeline really sends |

Phase A is boot-log-only by design: `Available KV cache memory`, `GPU KV cache size`, `Maximum concurrency`
and the refusal message are all printed *before* torch.compile graph capture, so each arm aborts the moment
that line appears. A refused boot is a result — it names the achievable ceiling.

Phase B depths use existing fixtures (8000 / 20000 / 40000 / 100000; the last is ~90.6k tokens by chars/4,
which brackets the pipeline's real 74 507-token stage prompt and still fits 114 688 with the 256-token
sample). `PREFIX_MODE=unique`, `--api chat`, reps 3, log-log fit with exponent + R² per rule 16, and draft
acceptance (τ) reported per arm.

## 5. Methodology, caveats, and gaps logged

- **§1–§2b and §3 used no GPU** — source inspection, existing run logs, and the consumer's own recorded
  metrics; every predicted figure there is labelled INFERRED. **§2c and §2d are GPU measurements** taken
  after the gate was opened; where they contradict a prediction, the prediction is marked, not removed.
- **Contention mid-run (rule 14/18).** A `llama-server` started in another session reloaded through
  llama-swap during Phase A and produced one false REFUSED and two EXITED arms. `gpu_exclusive.sh` gates
  *before* boot only. **Tool debt:** probes need a sentinel that samples residency throughout the arm and
  auto-quarantines — `scripts/bootarm.sh` has a minimal process-count version; it belongs in
  `bench/lib/`.
- **Three script bugs, all found by the runs, all fixed:** `docker run --rm` destroyed exited arms' logs;
  the rerun label was hardcoded; the depth-curve printer and inline fit read `prompt_tok`/`ttft_p50`
  where `capture_engine.py` writes `prompt_tokens`/`ttft_s` (the JSONL was complete; tables come from
  `summarize_depth.py`). A fourth, the sentinel's `pgrep -c … || echo 0` yielding `"0\n0"`, disabled the
  sentinel during the reruns — which is why those reruns rest on the user's confirmation that the other
  session's server was gone, plus the clean re-collected availability figures.
- **Suspect rows pending re-collection:** w4 (np 1, 4.76 GiB) and c2 (MTP-3 @ 36k, 4.33 GiB). Neither
  carries a conclusion in this document on its own; c2 supports A3 only in the direction that makes the
  finding conservative.
- **Golden regeneration absorbed pre-existing staleness.** The 4 failing golden tests predate this session:
  `config.yaml` was regenerated at 12:48 after a models.yaml rename wave (`ctx220k` → `q8-ctx200000`,
  `ctx160k` → `ctx150000`, the muse f16 variants, the ornith rename) without refreshing goldens.
  Regenerating absorbed ~40 row ids' worth of that rename plus this session's vllm row. Recorded here so
  the sweep is not silent; `tests/golden.bak-pre-regen` holds the previous state.
- **The opencode fix is currently unexercised by the live config** — the only small-window row grew to
  114 688, where the 32768 constant wins again. It is a guard, covered by 3 dedicated tests.
- **`report.py` chart gap (logged, not fixed).** Three things it cannot do that this work needed:
  (a) no log-log fit — it plots `depth_prefill.svg` / `depth_decode.svg` but never fits or annotates the
  exponent + R² that rule 16 requires beside the rates; (b) no multi-arm overlay — `detect()` takes one
  `results.jsonl` per run dir, so a cross-engine A/B needs two invocations and hand comparison;
  (c) no renderer for a capacity/boot matrix — a boot-only run dir has no `results.jsonl` and is skipped
  entirely. Phase A's output is therefore tables only. (d) **Phase B confirmed a fourth gap:** run on
  each arm dir, `report.py` wrote **0 charts** — it does not render per-request depth rows at all.
- **Still open from earlier sessions:** finding 22 (agentic-vs-codereview cross-family comparison is not
  internally controlled); the llama.cpp GTT spill (now 2 283 MiB peak in Phase B, still unexplained); folding everything into
  `docs/analysis/2026-09-11-2047-vllm-qwen38-27b-int4.md`; disk at 96% with the 13.7 GB radiance image.

## 6. External comparison (CLAIMED)

The knob list supplied by the user is sourced to `rocm.docs.amd.com` (vLLM optimization, 7.1.0/7.1.1),
`rocm.blogs.amd.com` (vllm-optimize, spec_decode_mi300x) and `strix-benchmarks.vercel.app`. All are
**CDNA (MI300X/MI355X)** or **gfx1151 Strix** targets; none is RDNA4/gfx1201. The "~2.5M vs ~1.2M tokens"
fp8-KV figure is an MI300X 192 GB number — the 2× ratio may transfer, the absolute scale does not. No
number from those pages is used as a measurement anywhere above.
