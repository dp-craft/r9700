# WS8 round 2 — drill down (OURS): local Tier-1 configs, engine facts, KV math (session-4 memo skeleton)

Research for the ctx-350k feasibility question (brief: `brief-ws8-ctx350k.md`). Round 1
(`ws8-ctx350k-r1.md`) = holistic literature. Round 2 = local Tier-1 CPU reads (bounded) + the
session-4 memo skeleton. Provenance on every claim: MEASURED (our runs / local artifact, bounded
read), CLAIMED (external source), INFERRED (reasoned, shown). Engine behaviors below that were not
exercised on our boot are flagged **boot-untested** — a 350k boot is required to confirm any of them.

## Summary table

| # | Finding | Source | Provenance |
|---|---|---|---|
| 1 | All four local 27B artifacts agree: `max_position_embeddings = 262144`, RoPE `rope_type "default"` — **no rope_scaling shipped in any of them**, `rope_theta = 10,000,000`, `partial_rotary_factor 0.25` (64 rotary dims of a 256-d head), mrope sections [11,11,10], native trained ctx **262,144** | 3× local `config.json` + local gguf header + model card (all bounded reads) | MEASURED |
| 2 | The model is a **hybrid**: 64 layers = **48 linear-attention (SSM) + 16 full-attention** (`full_attention_interval 4`); GQA 24:4, head_dim 256, hidden 5120; 1 MTP layer. KV cache grows only with the 16 full-attention layers; SSM state is O(1) in length | local `config.json` `text_config` + gguf keys + `bench/core/gguf_kv.py` | MEASURED (fields) |
| 3 | **At today's 260,000 we are NOT extrapolating**: 260000 < 262144 = 99.2% of the trained range, zero scaling in effect. 350,000 = **1.335× the trained range** (87,856 tokens past it) | 27b.conf + config.json + arithmetic | MEASURED (260000, 262144) + INFERRED (ratios) |
| 4 | sly/vLLM: `--max-model-len 350000` **fails with ValueError unless `VLLM_ALLOW_LONG_MAX_MODEL_LEN=1`** (then only a warning; no rope scaling required by the gate). The vendor card documents the exact 350k-capable recipe: env var + `--hf-overrides` with `rope_type "yarn"` | vLLM core source (Tier-1, fetched) + local model card | CLAIMED (Tier-1); **boot-untested on our image** |
| 5 | radiance 1.17.0: `--max-model-len 350000` is **accepted** (context bound, no hard max); past-trained with no scaling it **warns, does not refuse**; static YaRN is first-class via `--rope-scaling yarn:FACTOR[:ORIG]`; the engine vendor **validated YaRN factor 2 on the Qwen3.8-27B container with retrieval at ~500K** and rope math pinned to vLLM's at this model's exact geometry (theta 1e7, 262144, rotary width 64) | local radiance 1.17.0 source `docs/YARN.md` + `core/engine_bringup.cpp` + `core/config.cpp` | CLAIMED (Tier-1 engine source); **boot-untested** |
| 6 | **Brief correction:** the "q8_0 halves the budget → 740k → 2×350k fits" premise does **not** apply — our serving is already 8-bit (`--kv-cache-dtype fp8`, 1 B/element). q8_0 is the same 8-bit byte class (vLLM has no q8_0 KV dtype; q8_0 is a llama.cpp concept). Halving only exists relative to f16. **2×350k (700k tok) is NO-GO on one 32 GB card at every available KV dtype** (fp8/q8_0 ≈370.7k, f16 ≈185k, 4-bit kv4 ≈575–649k, all < 700k) | 27b.conf + settings.md + sly source (NOT-ADOPTED.md, serve-mxfp4.sh) + config geometry | MEASURED anchors + INFERRED scaling |
| 7 | 1×350k **fits**: fp8 pool 370,702 tok holds the 350k prompt at 94.4%, leaving ~20,702 tok for output (a 55k output turn does NOT fit); 4-bit KV (sly opt-in `KVCACHE_DTYPE=kv4`/TetraAttention, shipped since 1.5.0) gives ≈575–649k tok (INFERRED from sly's measured 1.55–1.70× pool ratios) → 350k+55k output fits at 62–70% of pool | 27b.conf anchor + sly source measurements + arithmetic | MEASURED anchor + INFERRED |
| 8 | RoPE risk at 350k: **LOW** for the RoPE mechanism (scaling in effect today: none — `rope_type default`; at 350k: pure 1.335× extrapolation or static YaRN f≈1.34, both inside the vendor-endorsed and engine-vendor-validated band). **MED** for end-to-end *task* quality at 350k span (span-length degradation literature, independent of RoPE; no quantitative cliff threshold exists anywhere in 1.25×–2×) | r1 §4/§5 + items 1,3,4,5 above | INFERRED |
| 9 | DFlash2 drafter (`syvai/Qwen3.8-27B-DFlash2-W4A16`, 5 layers) has its own `max_position_embeddings = 262144`, rope default → at 350k the drafter's rotary is also OOD. Affects acceptance rate only, not correctness. Untested | local drafter `config.json` (bounded) | MEASURED (config) + INFERRED (consequence) |
| 10 | Reliability caveat for deep ctx on the MXFP4 path: MEASURED 2 GPU memory faults in `radiance_mxfp4_fp8_gemm_atiled` at ~156k context (2026-10-22 campaign, sly 1.6.0) — 350k re-enters that risk zone | `docs/findings/vllm/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md` | MEASURED |

**Go/no-go: GO for 1×350k (conditional — config table below, de-risking measurements in §6); NO-GO
for 2×350k on one card** (KV infeasible at every available dtype; the brief's q8_0-halving premise
was a Gemma/f16 artifact, item 6).

## 1. The model's own config (Q1)

### 1.1 Extracted fields — all local artifacts

| Artifact (local path) | Arch | `max_position_embeddings` | `rope_theta` | `rope_scaling` shipped? | Native trained ctx |
|---|---|---|---|---|---|
| RedHatAI__Qwen3.8-27B-MXFP4 — `/mnt/Lin1/work/vllm/sly-radiance/models/RedHatAI__Qwen3.8-27B-MXFP4@16a86728/config.json` (`text_config`) | `qwen3_5` / `Qwen3_5ForConditionalGeneration` (VLM wrapper, text = `qwen3_5_text`) | **262144** | 10,000,000 | **No** — `rope_parameters.rope_type = "default"`, no `factor`/`original_max_position_embeddings`/`attention_scale` keys | 262,144 |
| Qwen__Qwen3.8-27B-FP8 — `.../Qwen__Qwen3.8-27B-FP8@017b9c7a/config.json` (`text_config`) | same | **262144** | 10,000,000 | **No** — identical `rope_parameters` block | 262,144 |
| slybase__Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ — `.../slybase__Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ@3bb379dc/config.json` (`text_config`) | same | **262144** | 10,000,000 | **No** — identical `rope_parameters` block | 262,144 |
| StillDeadcode__qwen3.8-27b-iqr-v4 — `/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef/` | `.rad` container (18.7 GB, 1 file); **no config.json** — `SOURCE.txt`: repo `StillDeadcode/qwen3.8-27b-iqr-v4`, rev `e5f1b3ef`, fetched 2026-11-08 | not read from the container (needs `rad-info --meta`, Tier-1 per radiance `docs/YARN.md`); base model = Qwen3.8-27B | 1e7 (base model) | No (base model ships `default`; YARN.md: containers carry `text_config.rope_parameters` and expose `n_ctx_train`) | 262,144 (INFERRED from base model; container metadata not read in round 2) |
| gguf — `/home/dev/models/gguf/unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf` (bounded header parse, first 1 MiB; repo tool `bench/core/gguf_kv.py` also runs clean on it) | `qwen35` (GGUF v3, 866 tensors, 50 KVs) | `qwen35.context_length = 262144` | `qwen35.rope.freq_base = 10000000.0` | **No** — no `rope_scaling`/`rope.yarn.*` key anywhere in the header (only `rope.freq_base`, `rope.dimension_count = 64`, `rope.dimension_sections = [11,11,10,0]`) | 262,144 |

All three HF-side `config.json` files carry **identical** `text_config` geometry (verified field by
field). No artifact ships any RoPE scaling of any kind — the 262,144 window is the raw trained
window.

### 1.2 Shared geometry (all values MEASURED from the local configs unless tagged)

- **Hybrid stack:** `num_hidden_layers 64`, `layer_types` = 48 × `linear_attention` + 16 ×
  `full_attention` (`full_attention_interval 4`; gguf: `qwen35.full_attention_interval = 4`,
  `qwen35.block_count = 65` = 64 + 1 MTP, `qwen35.nextn_predict_layers = 1`,
  `mtp_num_hidden_layers 1`). SSM params (gguf): `ssm.conv_kernel 4`, `ssm.state_size 128`,
  `ssm.group_count 16`, `ssm.time_step_rank 48`, `ssm.inner_size 6144`; HF config:
  `linear_num_key_heads 16 × 128`, `linear_num_value_heads 48 × 128`, `mamba_ssm_dtype float32`.
  **KV cache grows only with the 16 full-attention layers; SSM state is fixed-size per sequence**
  (O(1) in context length, scales with seq count) — INFERRED from the architecture fields.
- **Attention:** `hidden_size 5120`, `num_attention_heads 24`, `num_key_value_heads 4` (GQA 6:1),
  `head_dim 256`, `attn_output_gate true`, `intermediate_size 17408`, `vocab_size 248320`.
- **RoPE:** `rope_type "default"` (no scaling), `rope_theta 10,000,000`,
  `partial_rotary_factor 0.25` → **64 rotary dims** (256 × 0.25; card line 53: "Rotary Position
  Embedding Dimension: 64"), `mrope_interleaved true`, `mrope_section [11, 11, 10]` (32 (cos,sin)
  pairs split into 3 axes; for text-only serving all axes take the same position, so text behaves as
  plain RoPE on 64 dims — INFERRED from standard mrope semantics).
- **Native trained ctx: 262,144** (MEASURED: config `max_position_embeddings`, gguf
  `context_length`, card: "Context Length: 262,144 natively and extensible up to 1,000,000
  tokens").

**Corrections to round 1's working assumptions** (r1 §4 computed YaRN by-parts with the Qwen3-family
theta 1e6 / head 128; the real model differs): rope_theta = **1e7** (not 1e6), rotary width = **64**
(not 128), and only **16 of 64** layers do full attention. §2 below re-derives the YaRN split on the
real geometry.

## 2. What is in effect at today's 260k (Q2)

- **Serving point (MEASURED, repo state):** `stack/serve/27b.conf` — `MAXLEN 260000`, `MAXSEQS 2`,
  `SPEC_K 7` (DFlash2), `HEADROOM_MIB 596`; sly track: `vllm serve ... --max-model-len 260000
  --kv-cache-dtype fp8 --max-num-seqs 2` (serve_vllm.sh:244; starter exports `KV_DTYPE=fp8`,
  `GPU_UTIL=0.93`); radiance track: `--tp 1 --max-model-len 260000 --kv-cache-dtype fp8
  --max-num-seqs 2 --gpu-headroom-mib 596` (serve_radiance.sh:105). Claude settings:
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS 260000`, `MAX_OUTPUT_TOKENS 55000`, `AUTO_COMPACT_WINDOW 205000`.
- **Are we extrapolating at 260000? No.** 260000 < 262144: the window uses **99.2%** of the trained
  range (INFERRED: 260000/262144), 2,144 tokens of trained headroom unclaimed, and **no RoPE scaling
  is in effect at all** (`rope_type "default"` in every artifact). Every position the engine serves
  today — target and drafter — is inside the trained range.
- **350,000** = **1.3352×** the trained range (INFERRED: 350000/262144), i.e. 87,856 tokens past the
  last trained position. Vs the current 260000 serving point it is 1.346× — same band (r1 §4).
- **Literature at that ratio (r1, unchanged):** the Qwen family's own practice brackets it — 1.25×
  shipped with zero scaling (40960/32768), factor 2.0 recommended for 64k-typical deployments, 4×
  "validated" (r1 §1/§3, Tier-1 vendor); **no quantitative quality-cliff threshold exists anywhere
  in the 1.25×–2× band** (r1 §5); the only training-free degradation anecdote found is at 16× (r1
  §3). Span-length task degradation (LoMT U-shape, RULER) grows with length *regardless* of RoPE
  method (r1 §2) — that, not RoPE, is the binding quality risk at 350k.
- **YaRN at factor 1.34 on the REAL geometry** (INFERRED, formula from r1 §1, geometry MEASURED
  §1.2): with θd = (1e7)^(−2d/64) and r(d) = 262144·θd/2π = 41,691·10^(−7d/32) over the 64 rotary
  dims: r = 32 at d ≈ 14.2, r = 1 at d ≈ 21.1 → dims 0–14 (~23%) left untouched, dims 15–20 (~9%)
  ramp, dims 21–63 (~67%) get the full 1/1.335 = 0.749 interpolation; attention factor
  `1 + 0.1·ln(1.335) = 1.029` (radiance's documented default; ≡ r1's Llama-fit t ≈ 0.945). Net:
  "PI on two-thirds of an already-quarter-width rotary, identity on the rest, plus a 2.9% logit
  rescale" — a small geometric perturbation, and milder than r1's 1e6/d128 estimate (~50%
  full-interpolation).
- **Structural mitigants (INFERRED from §1.2 fields):** (a) hybrid — 48 of 64 layers are linear
  attention with position-free recurrent state, so the positional signal that could degrade is
  diluted across the stack; (b) partial rotary — 192 of 256 head dims (75%) are never rotated and
  are position-invariant, so OOD exposure is confined to the 64-dim rotation; (c) the model was
  trained *with* this hybrid + partial-rotary structure up to 262,144, so there is no architecture
  change, only a 33.5% position-range extension.
- **Drafter (MEASURED config, INFERRED consequence):** the DFlash2 drafter
  (`syvai__Qwen3.8-27B-DFlash2-W4A16@4d30ec73/config.json`, bounded read) is a 5-layer `qwen3`
  model with `max_position_embeddings 262144`, `rope_theta 1e7`, `rope_type default`. At a 350k
  conversation the drafter's rotary also operates past its trained range → expect possible
  acceptance-rate degradation at depth (unmeasured; correctness is unaffected — target verifies).

## 3. Engine side (Q3)

### 3.1 sly/vLLM — `--max-model-len 350000` validation

Tier-1 sources: vLLM core source (`vllm/config/model.py`, `main`, fetched 2026-11-10) + the local
Qwen3.8-27B model card (vendor, Tier-1). **All of it boot-untested on our image (sly 1.9.1/1.8.1) —
a 350k boot is required to confirm.**

- **The gate (vLLM core, `_get_and_verify_max_len`, model.py:2601):** the derived max length = the
  config's `max_position_embeddings` (262144 here). For `rope_type "yarn"` vLLM deliberately does
  **not** multiply the `factor` into the derived max ("YaRN variants leave max_position_embeddings
  already scaled … `factor` must not be applied to it again" — the transformers convention); other
  scaling types (`linear` etc.) do multiply `factor`. Then: if user `max_model_len >
  derived_max_model_len` (and not ≤ an optional `model_max_length`), vLLM **raises ValueError**
  unless `VLLM_ALLOW_LONG_MAX_MODEL_LEN=1` — with the env var it logs a **warning only** and boots
  ("User-specified max_model_len (…) is greater than the derived max_model_len (…)"; boilerplate
  warning that "positions exceeding derived_max_model_len lead to nan" for RoPE models). **No rope
  scaling is required by the gate** — bare extrapolation passes validation with just the env var.
- **The vendor's documented recipe (model card, "Processing Ultra-Long Texts", verbatim flags):**
  `VLLM_ALLOW_LONG_MAX_MODEL_LEN=1 vllm serve ... --hf-overrides '{"text_config":
  {"rope_parameters": {"mrope_interleaved": true, "mrope_section": [11, 11, 10], "rope_type":
  "yarn", "rope_theta": 10000000, "partial_rotary_factor": 0.25, "factor": 4.0,
  "original_max_position_embeddings": 262144}}}' --max-model-len 1000000` — for **350k use
  `factor ≈ 1.34`** (card: "modify the factor as needed … if the typical context length is
  524,288 … set factor as 2.0", i.e. factor = target/native; 350000/262144 = 1.335 → 1.34 covers
  262144×1.34 = 351,273 positions) and `--max-model-len 350000`. Card warnings carried into the
  memo: "All the notable open-source frameworks implement **static** YaRN … potentially impacting
  performance on shorter texts" and "modify the `rope_parameters` configuration **only when
  processing long contexts is required**".
- **Our serving wiring (MEASURED repo state):** `serve_vllm.sh` builds `vllm serve /model
  --max-model-name … --max-model-len "$MAXLEN" …` (line 244) with `KV_DTYPE` → `--kv-cache-dtype`;
  on the vLLM track `MAXLEN` is authoritative from the Claude settings file
  (`CLAUDE_CODE_MAX_CONTEXT_TOKENS`, redhat starter lines 9–10). A 350k sly boot = `MAXLEN=350000`
  in conf+settings, `MAXSEQS=1`, env `VLLM_ALLOW_LONG_MAX_MODEL_LEN=1`, and the hf-override
  (EXTRA_ARGS) for option A below — no profile changes to the engine layer.

### 3.2 Native radiance — `--max-model-len 350k` support status

Tier-1 source: the local radiance 1.17.0 source checkout
(`/mnt/Lin1/work/radiance/src/1.17.0/` — the exact image version the IQ4R starter pins).

- `--max-model-len N` = "context bound; 0 takes the model's training context" (`core/config.cpp:86`)
  — **no documented hard maximum**; it bounds the KV reservation, not the rotary ("A larger
  `--max-model-len` reserves a larger serving window; it does not change the model's rotary
  embedding" — `docs/YARN.md`).
- **Past-trained with no scaling: accepted with a warning, not refused.** `core/engine_bringup.cpp`
  (`apply_rope_scaling`): "RAD_WARN: --max-model-len … is past the … positions the model was trained
  on and nothing scales its rotary, so positions beyond them are extrapolated; a model card's YaRN
  extension is `--rope-scaling yarn:FACTOR` (docs/YARN.md)". So bare `--max-model-len 350000` boots
  and serves extrapolated positions (logged at startup).
- **Static YaRN is first-class**, two paths (`docs/YARN.md`):
  - at load: `radiance --model <rad> --rope-scaling yarn:FACTOR[:ORIG] --max-model-len 350000` —
    writes `rope_type yarn` + `factor` + `original_max_position_embeddings` (ORIG defaults to the
    container's own trained length) into `text_config.rope_parameters` — "which already says
    `default`" for the Qwen3.8 container; the drafter gets the same factor over its own trained
    length. `none` turns a checkpoint's YaRN off; `linear`/`llama3`/`longrope`/`dynamic` are
    **refused by name at load** (dynamic NTK/YaRN is therefore unavailable on this engine —
    consistent with r1's recommendation to avoid dynamic scaling under prefix caching).
  - at conversion: `rad-convert … --set text_config.rope_parameters.rope_type=yarn --set …factor=2
    --set …original_max_position_embeddings=262144` → a baked-in `.rad`.
- **Factor convention identical to vLLM/transformers** ("`factor` 2 over `original_max_position_
  embeddings` 262144 reaches 524288"). Defaults `beta_fast 32 / beta_slow 1`, `attention_factor =
  1 + 0.1 ln(factor)`, `truncate` on — same math as vLLM's `YaRNScalingRotaryEmbedding`.
- **Engine-vendor validation on this exact model (CLAIMED, Tier-1 engine source):** "Validated: the
  **Qwen3.8-27B** and Qwen3.6-35B-A3B containers and both Flash-Next variants **at factor 2, with
  retrieval at about 500K tokens**, and TP3 perplexity with `--rope-scaling` within about ±1% of the
  unscaled model at factor 2". The test suite pins YaRN correction bounds "to vLLM's integers
  (14/22, 28/43, 56/85 for **rotary widths 64**, 128, 256 at **factor 2, theta 1e7, 262144 trained
  positions**)" — i.e. this model's exact geometry (64-dim rotary, theta 1e7, 262144). Our target
  (factor 1.34, 350k) sits well inside that validated envelope.
- **Status:** 350k on radiance = documented and engine-validated at larger factors, **boot-untested
  on the 27B IQ4R container** (local MEASURED precedent: radiance 1.16.0/1.17.0 served the Ornith
  container at the full `--max-model-len 262144` on this card — `docs/findings/workers/
  2026-11-05-0814-ornith-use-cases.md` — so the flag path works at the native bound; 350k +
  `--rope-scaling` needs the boot).

## 4. KV math (Q4) — budget table per dtype × seq count

**Anchors (MEASURED, cited):**

| Anchor | Value | Source |
|---|---|---|
| KV pool at today's serving config | **370,702 tokens** at 262000/2/fp8, GPU_UTIL 0.93 (sly, DFlash2 k=7) | `stack/serve/27b.conf` comment, "MEASURED 2026-10-30" |
| KV pool size in bytes | 11.84 GiB for 332,822 tokens (≈38.1 kB/tok observed, incl. block/mamba amortization) at 170000, util 0.90, sly 1.6.0 | campaign `docs/findings/vllm/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md` |
| 4-bit KV pool expansion on sly (their boots) | 747,492 vs 439,031 tok (+70%) and 528,722 vs 340,723 tok (+55%); "~1.75x the KV pool" in flag help | sly source `docs/NOT-ADOPTED.md` (2026-10-16 update), `docs/BENCHMARKS.md:126`, `serve-mxfp4.sh` help |

**Per-token KV cost (INFERRED from MEASURED config geometry §1.2; cross-checked):** pure full-
attention KV = 2 × 16 layers × 4 kv-heads × 256 dims × bytes/element:

| KV dtype | Bytes/tok | 16-bit? | Note |
|---|---|---|---|
| f16/bf16 | 65,536 B = 64 KiB | 2 B/elem | `bench/core/gguf_kv.py` on the local gguf agrees (64.0 KiB/tok over the 16 attn layers) |
| fp8 (e4m3, our serving) | 32,768 B = 32 KiB | 1 B/elem | Consistent with both MEASURED pool anchors (370,702 tok × 32 KiB ≈ 11.9 GiB vs the measured 11.84 GiB at 332,822) and inconsistent with f16 (would need ≈23.7 GiB) — INFERRED cross-check |
| q8_0 (llama.cpp class) | ≈ 33.9 KiB | 1 B/elem + block scales | `gguf_kv.py` output; **same byte class as fp8** |
| kv4 / TetraAttention (4-bit + e4m3 scale, sly opt-in) | ≈ 16 KiB + scale | 0.5 B/elem | Shipped opt-in since sly 1.5.0 (PR #151); `KVCACHE_DTYPE=kv4` → `--kv-cache-dtype int4_per_token_head --attention-backend TETRA` |

**Correction to the brief's settled premise (item 6):** "q8_0 KV halves the budget (≈740k tokens) →
2×350k fits with margin" — the halving is real **only relative to f16** (the Gemma precedent in
CLAUDE.md: dense model, f16 KV at deep ctx). Our 27B serving is **already 8-bit**
(`KV_DTYPE=fp8` in both starters; "MEASURED exact null on the INT4 hybrid … standard path on the
MXFP4 hybrid" — `docs/guides/vllm/settings.md` fp8-KV section). vLLM has no `q8_0` KV dtype (its
sub-16-bit path is fp8); q8_0 is a llama.cpp GGUF KV quant with the same 1-byte element cost. So
q8_0 buys **no** budget on the engines that matter here, and the 740k figure does not exist for this
model on this stack.

**Budget table — pool capacity vs the 350k requirement (per seq):**

| KV dtype | Pool (tokens) | Provenance | 1 seq × 350k | 2 seqs × 350k (700k) |
|---|---|---|---|---|
| fp8 (8-bit) | **370,702** | MEASURED anchor (262000/2, util 0.93) | **Fits at 94.4%** (350,000/370,702, INFERRED); leaves ~20,702 tok for output → a 55k output turn does NOT fit (350k+55k = 405k > 370.7k, INFERRED) — read/probe conversations (≤~20k output) OK, full-output agentic turns not | 700k = 1.89× pool → **infeasible** (INFERRED from MEASURED anchor) |
| q8_0 (8-bit) | ≈ 370,702 | INFERRED (same 1 B/elem class as fp8; no q8_0 dtype in vLLM) | same as fp8 | **infeasible** |
| f16 (16-bit) | ≈ 185,351 | INFERRED (fp8 pool ÷ 2, upper bound — the fixed per-seq SSM state does not halve) | 350k > 185k → **infeasible** | **infeasible** |
| kv4 / TetraAttention (4-bit, sly opt-in) | ≈ 575,000–649,000 | INFERRED (sly's MEASURED 1.55×–1.70× pool ratios applied to the 370,702 anchor; their absolute measured values 528,722 / 747,492 were different boots) | 350k prompt = 54–61% of pool; **350k + 55k output = 405k fits at 62–70%** (INFERRED) | 700k > 649k upper bound → **infeasible** |

**VRAM per option** (iron rule 7: these are INFERRED calcs for pre-flight planning, not measured
usage — a 350k boot must sample VRAM with `vram_sampler.py` before any number is reported):

| Option | KV bytes (INFERRED) | + weights/activations/drafter | Expected device peak |
|---|---|---|---|
| fp8, 1×350k | ≈ 11.9 GiB pool (370,702 × 32 KiB) | MXFP4 27B ≈ 14–15 GiB (INFERRED from bpw) + DFlash2 drafter ≈ +1.2 GiB (MEASURED, settings.md) + activations | ≈ 30–31 GiB — inside the 0.93 util pool by construction (the pool IS the remainder); watch the headroom issue (HEADROOM_MIB 596, live) |
| kv4, 1×350k | ≈ 5.9 GiB pool (370,702 × 16 KiB) | same weights | lower peak, more headroom |
| f16, any 350k | ≈ 23.7 GiB pool | — | **does not fit the card** (31.86 GiB usable minus weights) |

**Conclusion:** 2×350k is infeasible on one 32 GB card at every available KV dtype. 1×350k is
feasible at fp8 (tight: output budget ≤~20k) or comfortable at 4-bit kv4 (opt-in, boot-untested on
1.9.1). The only lever that would create 2×350k headroom is raising the pool itself
(`GPU_UTIL` 0.93→0.95 ≈ +0.02×8.9k tok/0.01 ≈ +18k tok, INFERRED per settings.md — not close to
the ~50k gap, and it re-opens the desktop headroom issue).

## 5. Session-4 memo skeleton

### 5.1 RoPE risk level at 350k: **LOW** (RoPE mechanism) — **MED** (end-to-end task quality at 350k span)

- **Scaling currently in effect (stated explicitly): NONE.** Every local artifact ships
  `rope_type "default"` (no `factor`, no `original_max_position_embeddings`, no `attention_scale`);
  today's 260,000 serves at 99.2% of the native 262,144 with zero extrapolation.
- **At 350,000** the two candidate scalings are: (i) **no scaling** — pure 1.335× positional
  extrapolation (both engines accept it; vLLM needs only the env var, radiance only warns), or
  (ii) **static YaRN factor 1.34** (vendor recipe on both engines; covers 351,273 positions).
- **Why LOW (mechanism):** 1.335× sits strictly inside the vendor-endorsed band (Qwen family: 1.25×
  shipped unscaled, 2× recommended, 4× validated — r1 §1, Tier-1) and inside this card's own
  documented envelope ("natively 262,144, extensible up to 1,000,000", YaRN recommended past
  262,144, Tier-1); the engine vendor MEASURED static YaRN at factor 2 (1.54× our ratio) on the
  Qwen3.8-27B container with retrieval at ~500K (350k is 1.43× inside that depth) and PPL within
  ±1% of unscaled (radiance `docs/YARN.md`, Tier-1); YaRN@1.34 on the real geometry is a mild
  perturbation (§2: two-thirds of an already-quarter-width rotary interpolated, 2.9% logit rescale);
  structural mitigants (hybrid 16/64 full-attn layers, 64/256 rotary dims, §2) confine the OOD
  exposure. **No quantitative cliff threshold exists in 1.25×–2×** (r1 §5) — "1.335× is empirically
  safe" would be INFERRED from the vendor band, not a measurement; say so if quoting it.
- **Why MED (task quality at 350k span):** the binding risk is span-length degradation, not RoPE —
  LoMT U-shape and RULER (multi-needle/multi-hop/aggregation degrade as span grows while NIAH
  saturates) apply at any length and grow with it (r1 §2); nothing in round 1/2 measures this model
  at 260k→350k span on our workload. Secondary: static-YaRN short-text regression (vendor warning —
  the same server also serves ~20k prompts), drafter OOD (acceptance), and the MEASURED 2026-10-22
  deep-ctx MXFP4 a-tiled-kernel fault history (2 faults at ~156k).

### 5.2 Required config table

| Opt | Engine | KV dtype | Seqs | Engine flags (delta from today's 27b.conf boot) | max-model-len | RoPE in effect |
|---|---|---|---|---|---|---|
| A | sly/vLLM 1.9.1 (redhat-mxfp4-dflash) | fp8 | **1** | `VLLM_ALLOW_LONG_MAX_MODEL_LEN=1`; `--hf-overrides '{"text_config":{"rope_parameters":{"mrope_interleaved":true,"mrope_section":[11,11,10],"rope_type":"yarn","rope_theta":10000000,"partial_rotary_factor":0.25,"factor":1.34,"original_max_position_embeddings":262144}}}'`; `MAXSEQS=1`; settings `CLAUDE_CODE_MAX_CONTEXT_TOKENS=350000` (raise `AUTO_COMPACT_WINDOW` to match the campaign) | 350000 | static YaRN f=1.34 (vendor recipe) |
| B | sly/vLLM 1.9.1 | fp8 | **1** | same as A **minus** the hf-overrides (env var only) | 350000 | none (pure 1.335× extrapolation) |
| C | sly/vLLM 1.9.1 | kv4 (opt-in, `KVCACHE_DTYPE=kv4` → `--kv-cache-dtype int4_per_token_head --attention-backend TETRA`, since 1.5.0 — verify flag presence in the 1.9.1 image at boot) | 1 | A or B + kv4 flags (A+B×kv4 = 4 combos; A×kv4 is the recommended full-headroom arm) | 350000 | per A/B |
| D | radiance 1.17.0 (IQ4R-L-V4 .rad) | fp8 | **1** | `--max-model-len 350000 --rope-scaling yarn:1.34` (ORIG defaults to the container's trained length) | 350000 | static YaRN f=1.34 |
| E | radiance 1.17.0 | fp8 | **1** | `--max-model-len 350000` (no scaling → engine logs the extrapolation warning at startup) | 350000 | none |
| X | any | any | 2 | — | 350000 | — | **NO-GO** (700k tok > every available pool, §4) |

All options: `MAXSEQS=1`, keep `HEADROOM_MIB=596` (or raise for kv4), keep DFlash2/SPEC_K=7 (drafter
acceptance at depth is a measurement, not a config decision). All five are **boot-untested**.

### 5.3 VRAM budget per option

See §4's VRAM table (INFERRED, planning only): fp8 1×350k ≈ 11.9 GiB KV pool (fits the 0.93 pool by
construction; MEASURED anchor 370,702 tok); kv4 ≈ 5.9 GiB; f16 infeasible (≈23.7 GiB pool). The
94.4% fp8 occupancy is a calc — a 350k boot must MEASURE `kv_cache_usage_perc` + device VRAM at the
350k point (iron rules 7 and 15: on this stack, deep-ctx contention/faults have surfaced as kernel
faults and paging, not clean OOMs).

### 5.4 Go/no-go

- **GO (conditional): 1×350k**, options A (preferred sly arm) / D (preferred radiance arm), with B/E
  as unscaled A/B counterparts. Conditions: boot confirms the flags on our images; short-context
  regression arm passes (below); KV occupancy MEASURED ≤ ~95% with the planned output budget.
- **NO-GO: 2×350k on one card** at any available KV dtype (§4). If 2-seq 350k becomes a requirement,
  the options are multi-GPU or a smaller model — out of scope for this memo.
- **Do NOT** present the brief's "q8_0 → 740k → 2×350k fits" in session 4 — it was corrected in §4
  (we are already 8-bit; q8_0 is not a vLLM/radiance KV dtype and buys nothing here).

### 5.5 What a future 350k campaign must measure to de-risk

1. **The honest 350k probe (iron rule 17):** a **multi-turn incremental-growth conversation over the
   repo corpus** — turns of 1–20k, prior turns prefix-cached, growing the total from ~260k to
   350k — with retrieval tasks spanning the growth (find symbol X defined in turn k, use it in turn
   k+n). **Not** a one-shot cold 350k prefill (that measures a request shape that never occurs and
   misses prefix reuse). Same growth protocol at the 260k baseline for the A/B.
2. **Span-length retrieval (r1 RULER finding):** multi-needle, multi-hop tracing, and aggregation
   probes at 260k vs 350k — single-needle NIAH alone would overstate fitness.
3. **Lost-in-the-middle position sweep:** answer-relevant content at start / middle / end at both
   depths (U-shape check).
4. **Short-context regression arm (mandatory for YaRN options A/D):** our ~20k-task suite at the
   scaled vs unscaled setting — the vendor's static-YaRN-at-short-ctx warning, and the same server
   serves 20k and 350k prompts.
5. **Depth curve (iron rule 16):** ≥4 depths per option, log-log fit, quote prefill/decode exponents
   + R² beside rates; include DFlash2 **acceptance rate at depth** (drafter OOD, §2).
6. **Residency & reliability (iron rules 7, 15):** `kv_cache_usage_perc` and device VRAM
   MEASURED at the 350k point (vram_sampler.py); poll `serve.log` for `Memory Fault` while requests
   are in flight; watch `radiance_mxfp4_fp8_gemm_atiled` (2 MEASURED faults at ~156k, 2026-10-22) —
   on the radiance/IQ4R arm, check daemon residency against the expected working set before trusting
   any number.

## Could not determine / flagged

- **radiance container metadata** (the IQ4R `.rad`'s own `n_ctx_train` / rope keys): not read in
  round 2 (needs `rad-info --meta`, Tier-1 per `docs/YARN.md`). Base-model inference (262144,
  default rope) is tagged INFERRED in §1.1.
- **vLLM core behavior on our exact image:** the validation code is from `vllm/config/model.py`
  `main` (fetched 2026-11-10); running images are sly 1.9.1/1.8.1 (no local vLLM core source). The
  `VLLM_ALLOW_LONG_MAX_MODEL_LEN` gate is long-standing upstream behavior, but the 350k boot itself
  is untested on our stack — every 350k flag path in §5.2 is boot-untested.
- **kv4 on 1.9.1:** shipped opt-in since 1.5.0 (PR #151) per sly `NOT-ADOPTED.md`; presence of the
  exact `KVCACHE_DTYPE=kv4`/`TETRA` path in the 1.9.1 image not verified locally (no 1.9.1 source
  checkout) — verify at boot.
- **The "Highlight-Then-Summarize" Qwen3.8-27B lead** (r1 §5, arXiv:2609.31382): still unfetched,
  not cited.
- **Drafter acceptance at 350k positions:** unmeasured anywhere; flagged for campaign item 5.

## Sources (tiered)

**Tier-1 local (MEASURED / bounded reads, 2026-11-10):**
1. `/mnt/Lin1/work/vllm/sly-radiance/models/RedHatAI__Qwen3.8-27B-MXFP4@16a86728/config.json` (`text_config` fields, §1.1)
2. `/mnt/Lin1/work/vllm/sly-radiance/models/Qwen__Qwen3.8-27B-FP8@017b9c7a/config.json` (same fields) + `generation_config.json` + `README.md` (model card: context-length + YaRN sections, lines 21/53/58/509–560 — the vendor recipe quoted in §3.1)
3. `/mnt/Lin1/work/vllm/sly-radiance/models/slybase__Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ@3bb379dc/config.json` (same fields)
4. `/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef/SOURCE.txt` (repo/revision/size)
5. `/home/dev/models/gguf/unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf` (GGUF v3 header, first 1 MiB: `qwen35.*` keys, §1.1) + `bench/core/gguf_kv.py` run output (HYBRID line, 64 KiB f16 / 33.9 KiB q8_0 per tok)
6. `/mnt/Lin1/work/vllm/sly-radiance/models/syvai__Qwen3.8-27B-DFlash2-W4A16@4d30ec73/config.json` (drafter: 5 layers, 262144, default rope)
7. `stack/serve/27b.conf` (260000/2, SPEC_K 7, HEADROOM 596; "MEASURED 2026-10-30: KV cache 370,702 tokens at 262000, GPU_UTIL 0.93")
8. `stack/serve/vllm/serve_vllm.sh:244` + `stack/serve/vllm/start_redhat_27b.sh` + `stack/serve/vllm/profiles/sly-redhat/*.env` (flag construction, KV_DTYPE=fp8, GPU_UTIL 0.93, DFlash2 args)
9. `stack/serve/radiance/serve_radiance.sh:105` + `stack/serve/radiance/start_qwen38_27b_iq4r-l-v4_rad.sh` (radiance flag construction, IMAGE 1.17.0)
10. `docs/guides/vllm/settings.md` (fp8 KV section: "MEASURED exact null … standard path"; DFlash2 "KV pool −20% … +1.2 GiB"; "each 0.01 util ≈ 326 MiB ≈ 8.9k tokens (INFERRED)")
11. `docs/findings/vllm/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md` (MEASURED: KV pool 332,822 tok / 11.84 GiB @170k; a-tiled-kernel faults at ~156k)
12. `/mnt/Lin1/work/radiance/src/1.17.0/` — `docs/YARN.md` (full), `core/engine_bringup.cpp:935–985` (`apply_rope_scaling`), `core/config.cpp:86` (`--max-model-len` definition)
13. `/mnt/Lin1/work/vllm/sly-radiance/src/1.10.0/` — `docs/NOT-ADOPTED.md` (KV4/TetraAttention: MEASURED pools 747,492 vs 439,031; GSM8K/KL/NLL numbers), `docs/BENCHMARKS.md:126` (528,722 vs 340,723), `serve-mxfp4.sh:105,842–860` (`KVCACHE_DTYPE=kv4` → `int4_per_token_head` + `TETRA`)
14. `~/.config/claude/local_vllm_direct/settings-redhat.json` (CLAUDE_CODE_MAX_CONTEXT_TOKENS 260000, MAX_OUTPUT 55000, AUTO_COMPACT 205000)

**Tier-1 web (fetched 2026-11-10):**
15. vLLM core source `vllm/config/model.py` (main) — `_get_and_verify_max_len` (lines 2601–2745): the `VLLM_ALLOW_LONG_MAX_MODEL_LEN` gate, the ValueError/warning text, the no-factor-multiplication-for-yarn rule — https://github.com/vllm-project/vllm/blob/main/vllm/config/model.py

**Carried from round 1 (not re-fetched):** r1's Tier-1/Tier-2 list (Qwen3 card + configs, YaRN
arXiv:2309.00071, PIP arXiv:2306.15595, LoMT arXiv:2307.03172, RULER arXiv:2404.06654,
StreamingLLM arXiv:2309.17453, survey arXiv:2608.10021, Qwen3 TR arXiv:2505.09388, HF forum
#78552/#178739, vLLM #55116). Per r1 §5: 2306.15595 is PIP (not dynamic NTK); the Qwen3 tech report
carries no RoPE numbers.
