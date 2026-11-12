# WS3 Round 1 — how the field measures quantization-fidelity KLD

Scope: big picture, no tool selection. Provenance: MEASURED = from this repo's campaigns; CLAIMED =
external (cited); INFERRED = reasoned (flagged). Local Tier-1 (the sly/radiance trees) appears in the
table because it defines OUR reporting convention; it is external to the paper literature.

## Standard practice (summary first)

"KL" appears in quantization work in two distinct roles:

1. **Objective inside the quantizer (forward direction, reference in the data slot).** GPTQ (arXiv
   2210.17323) minimizes the per-layer reconstruction error ‖WX−ŴX‖² (Eq. 1) with Hessian
   H = 2XXᵀ, solved row-by-row with error compensation (Eqs. 2–5). CLAIMED: the paper contains **no
   explicit KL formula and reports no per-layer KL numbers** (verified on the arXiv HTML full text —
   zero occurrences of "KL"/"divergence"/"cross-entropy"); the squared output error is the quadratic
   (second-order) surrogate for the change in the layer's output-distribution cross-entropy. The
   expectation is over calibration activations **produced by the full-precision model**, so the
   reference sits in the data slot — the "forward" orientation (quantized must cover where the
   reference puts mass). Calibration norm: 128 × 2048-token segments of C4. GPTQModel's console
   number is this same objective, "token-normalized GPTQ loss" (added in 7.7.0) — a **unitless MSE
   loss, not KL in nats** (CLAIMED, GPTQModel release notes; the repo's "teacher-KL" is a
   distillation mode, not a fidelity report).
2. **Reported fidelity metric = perplexity, not divergence.** SpQR (2306.03078): <1 % relative
   perplexity loss vs 16-bit. QuIP (2307.13304) / QuIP# (2402.04396): incoherence processing
   (random orthogonal / Hadamard transforms) + lattice coding, quality via perplexity. AWQ
   (2306.00978): activation-aware salient-channel scaling, quality via language-modeling +
   coding/math benchmarks. LLM.int8() (arXiv 2208.07339) and AQLM (De et al., ICML 2024; arXiv ID
   not verified in this run — lookup was rate-limited, treat the ID as absent, not as 2402.02740
   which is an unrelated paper): perplexity. None of the papers reports a nats/token divergence
   between full- and low-precision models (INFERRED from the fetched abstracts; SpQR/QuIP/QuIP#/
   AWQ/SqueezeLLM abstracts directly verified above).
3. **Engine/kernel QA — where the "KL in nats/tok" report actually lives.** StillDeadCode model
   cards and sly's fidelity gate report KL between a reference and a modified-precision engine,
   e.g. the IQR-V4 card: "source KL 0.00297 vs bf16 — 24 % below the official FP8 checkpoint's KL at
   55 % of its size" (CLAIMED, model card quoted in
   `stack/serve/radiance/start_qwen38_27b_iq4r-l-v4_rad.sh`). This is the convention our campaign
   adopts. The exact method of sly's two local tools is in Round 2.

**Direction.** Every convention found puts the **reference first: KL(ref ‖ quant)**. Forward (mass-
covering) KL penalizes the quantized model for dropping mass the reference has; reverse KL(quant ‖
ref) is mode-seeking — a quantized model can shrink to a subset of the reference's modes and score
well — so it is the distillation choice, not the fidelity choice (INFERRED; standard KL properties).

**Support.** Quantizer objectives act on the full distribution implicitly; HTTP probes can only see
top-k logprobs (vLLM: `top_logprobs`/`prompt_logprobs` capped by engine `max_logprobs`, default 20,
−1 = uncapped; radiance: fixed geometry k=21 = OpenAI's 20 + 1, per `docs/OPS.md`). So served-model
KL is always **top-k supported + tail treatment**: sly floors missing tokens at the arm's worst
top-k logprob (exact lower bound for those terms) and `kl_compare.py` additionally adds one lumped
tail bucket `rt·log(rt/at)` (convexity ⇒ still a lower bound on the full-vocab KL).

**Units & CIs.** Nats/token (per-token mean). Papers report perplexity (exp of mean NLL) with no CI;
quantizers report unitless token-normalized loss with no CI. The only CI convention found is sly's:
paired per-token differences, 95 % = 1.96·SD/√n with tokens as the unit (n≈14k ⇒ claimed ~0.01 nats
resolution — CLAIMED, `bench_fidelity.py` docstring). No paper in this space publishes CIs on
perplexity gaps; the norm is a single point estimate.

## Source table

| Source (tier) | Metric | Reference | Support | Units | Direction |
|---|---|---|---|---|---|
| GPTQ, arXiv 2210.17323 (Tier-1) | per-layer ‖WX−ŴX‖², H=2XXᵀ (Eqs 1–5); quality: PPL (WikiText2/PTB/C4) + zero-shot (LAMBADA/ARC/PIQA/StoryCloze) | full-precision layer | implicit full (quadratic surrogate) | unitless loss; PPL | expectation over ref calibration activations (128×2048 C4) — forward |
| SpQR, arXiv 2306.03078 (Tier-1) | PPL, <1 % relative loss | 16-bit | — | PPL | — |
| QuIP, arXiv 2307.13304 / QuIP#, 2402.04396 (Tier-1) | quadratic proxy obj.; incoherence + (E8) lattice coding; quality via PPL | unquantized | implicit full | PPL | — |
| AWQ, arXiv 2306.00978 (Tier-1) | activation-aware channel scaling; PPL + coding/math benchmarks | FP16 | — | PPL | — |
| SqueezeLLM, arXiv 2306.07629 (Tier-1; the brief's "QuIP#" seed URL) | dense-and-sparse 3-bit; PPL gap vs FP16 | FP16 | — | PPL | — |
| GPTQModel (Tier-2, github.com/ModelCloud/GPTQModel) | "token-normalized GPTQ loss" (MSE obj., 7.7.0); quality via Evalution task suites | fp16/bf16 model | implicit full | unitless loss | forward |
| vLLM v0.32.0 (Tier-1 source, sly's base) | API input side: `logprobs`/`top_logprobs`/`prompt_logprobs`; `logprobs_mode="raw_logprobs"` default (raw = before logit processors; **prompt logprobs never pass sampling processors ⇒ temperature-independent**); `max_logprobs` default 20 | — | top-k | nats (log-probabilities) | — |
| sly `check_fidelity.py` (local Tier-1) | **KL(ref‖arm)** top-K, missing token ⇒ arm's min top-K logprob (lower bound); paired dNLL; top-1 agreement | ref arm, same tokens | top-20, no tail term | nats/token | KL(ref‖arm), forward |
| sly `kl_compare.py` (local Tier-1) | KL(ref‖arm) top-K + **lumped tail bucket** `rt·log(rt/at)` (lower bound); dNLL; top-1; per-context bins | bf16 arm | top-K + 1 tail bucket | nats/token | KL(ref‖arm), forward |
| IQR-V4 model card (CLAIMED, via starter comment) | "source KL 0.00297 vs bf16" | bf16 | unstated (tool-internal) | nats/token (implied) | vs reference, forward |

## Limitations for comparing SERVED models (HTTP API only)

1. **Truncated support.** No weight/logit access ⇒ top-k only (20 on both engines). KL is a
   **lower bound**; the gap = uncounted tail. Must measure and report top-k mass per position
   (typ. ≥99 % at deterministic positions). Full-vocab KL is not attainable over HTTP.
2. **Engine-pair noise floor ≠ 0.** Different engines/backends (radiance vs sly; radiance 1.11.0 vs
   1.17.0) change logits even for the *same* checkpoint. Both families expose **raw**
   (pre-sampler) logprobs, so scale is comparable (vLLM `raw_logprobs` default; radiance OPS.md:
   "runs on the raw logits, before any stage has touched them"), but numerics are not bit-identical.
   A same-model pair (here: arm A vs B = same .rad on 1.11.0 vs 1.17.0) **is** the engine-version
   noise floor and must be reported next to the quantization deltas; a reference re-run on the same
   server bounds the self-noise (sly: ~0.01 nats on ~14k tokens, CLAIMED docstring).
3. **Sampling drift if you generate.** Greedy (temp 0) outputs can still diverge: an argmax flip
   cascades, after which position-pairing compares *different contexts*. Mitigations: score a fixed
   corpus via `prompt_logprobs` (sly only — radiance does **not** return prompt logprobs, `oai.cpp`:
   "logprobs for the prompt are not returned; never leave the card"), or pair only the shared prefix
   and report top-1 agreement + first divergence. Decided in Round 2.
4. **Chat templates break pairing.** The two engine families render chat templates differently
   (arm D is served with a dp-sharp Jinja template; radiance uses its own), and reasoning models
   insert thinking tokens into the *generated* stream. Only raw text via `/v1/completions` (same
   Qwen tokenizer on both sides ⇒ identical prompt token ids) is pairing-safe.
5. **Calibration-set dependence.** Corpus-conditional number; domain mix must match the population
   (coding model ⇒ code-dominated; sly's gate defaults are stdlib python + GPL-3 prose). Size norm:
   128×2048 calibration tokens (quantizers) vs ~14k paired tokens (sly gate).
6. **CIs are the field's weak spot.** No paper or OSS quantizer reports a CI on the fidelity gap;
   tokens within a text are correlated, so a pooled 1.96·SD/√n is mildly optimistic — cluster
   (block) bootstrap by text is the honest variant (Round 2).
7. **Reporting convention for this campaign** (follows sly): per-token mean KL(ref‖arm) in
   nats/token, top-20 support + floor + tail bucket (lower bound, stated), paired dNLL as
   complement, top-1 agreement, and the noise-floor pair reported alongside.
