# WS8 round 1 — holistic: RoPE extrapolation quality at ~1.33× native (ctx 260k → 350k)

Research for the ctx-350k feasibility question (brief: `brief-ws8-ctx350k.md`). Round 1 = holistic
literature + method-family survey (web, vendor docs); round 2 (`ws8-ctx350k-r2.md`) drills into our
local model configs and engine flags. Provenance tags on every claim (MEASURED = our runs,
CLAIMED = external source, INFERRED = reasoned, UNREACHABLE = source not fetchable). No MEASURED
numbers in this round — every finding is external.

**Question served.** The 27B (Qwen3.8-27B) serves at ctx 260000 / 2 seqs / fp8 KV; the native window
is 262144 (brief context, taken as given). Raising ctx to 350000 = **1.335× native**
(350000/262144; vs the current 260000 serving point it is 1.346× — same band). What does the
literature say about RoPE quality at that ratio, and which method is defensible there? KV budget
(brief, use as given): 370,702 tokens MEASURED at 262000/2/fp8 → 2×350k infeasible at fp8; q8_0 KV
halves the per-token KV cost so 2×350k fits with margin (INFERRED per brief).

## Summary table

| # | Topic | Finding | Source | Provenance |
|---|---|---|---|---|
| 1 | YaRN mechanics | Three components: (a) by-parts **interpolation scaling** h(θd) = (1−γ(r))·θd/s + γ(r)·θd with a linear ramp γ over r ∈ [α,β] (α=1, β=32 for Llama), r = L·θd/2π = "rotations within the trained window"; (b) **attention scaling** — all attention logits divided by an extra factor t (≡ rescale q,k by 1/√t); (c) **temperature scaling** 1/√t = 0.1·ln(s) + 1 (LLaMA/Llama-2 fit) | arXiv:2309.00071 (Peng et al., ICLR 2024), body via ar5iv | CLAIMED |
| 2 | YaRN quality evidence | Llama-2 7B/13B at s=16 (64k) and s=32 (128k): 128k passkey retrieval 99.4%; 13B s=32 standard suite 58.0/82.2/51.9/37.3 (ARC/Hella/MMLU/TruthfulQA) vs 32k baseline 59.4/82.1/55.8/37.4 — small MMLU dip; 128k windowed PPL 2.23–2.24 vs Code-Llama-NTK 2.54; 8k-extension PPL 6.04 (YaRN) vs 8.07 (PI) vs 6.24 (NTK). Caution: the paper's numbers include ~400 fine-tuning steps on ~0.1% of the pretraining corpus — not pure training-free | arXiv:2309.00071 | CLAIMED |
| 3 | PIP (brief seed 2306.15595) | The brief's "dynamic NTK (2306.15595)" seed is actually **Position Interpolation** (Chen, Wong, Chen, Tian 2023). Mechanism: m′ = m/s, equivalently all frequencies θ′ = θ/s. Failure mode: adjacent-token phase difference θd → θd/s, so **local resolution decreases**; the original 2K→32K study acknowledged "a certain performance loss within the original length" even after short-range fine-tuning | arXiv:abs/2306.15595; mechanics/failure mode via survey arXiv:2608.10021 §6.3 | CLAIMED |
| 4 | Dynamic NTK | s(ℓ) = max(1, ℓ/L0) — the factor is **dynamic in current length**; b′ = b·s^(dh/(dh−2)), θ′r = θr·s^(−2r/(dh−2)) (acts on frequencies via the rotation base; highest frequency r=0 unchanged). Key serving caveat: "when s(ℓ) changes, the rotation angle of the same historical token also changes" → already-rotated KV-cache entries become inconsistent — a problem for incremental/prefix-cached serving. The original 2023 paper was NOT found on arXiv in this environment | survey arXiv:2608.10021 §6.5 | CLAIMED (mechanism); original paper UNREACHABLE here |
| 5 | Qwen3 family ships natively | Trained at **32,768**; vendor "validated" **131,072 with YaRN** (rope_type yarn, factor 4.0, original_max_position_embeddings 32768 — an opt-in block the card tells users to ADD). Shipped configs (235B-A22B and 32B, both fetched): max_position_embeddings = **40960 = 1.25× trained**, rope_theta = **1,000,000**, rope_scaling = **null**. Card: "If the average context length does not exceed 32,768 tokens, we do not recommend enabling YaRN" (static YaRN "potentially impacting performance on shorter texts"); for typical 65,536 → **factor 2.0**; Alibaba's endpoint "supports dynamic YaRN by default" | HF model card Qwen3-235B-A22B + config.json (×2 models) | CLAIMED (Tier-1 vendor) |
| 6 | Lost in the middle | Performance is "often highest when relevant information occurs at the beginning or end"; "significantly degrades when models must access relevant information in the middle of long contexts"; "current language models do not robustly make use of information in long input contexts" (U-shape) | arXiv:abs/2307.03172 (Liu et al. 2023) | CLAIMED |
| 7 | RULER (NIAH ≠ competence) | NIAH is "a superficial form of long-context understanding"; 17 systems × 13 tasks (diverse needle counts, multi-hop tracing, aggregation); many systems show "nearly perfect accuracy in the vanilla NIAH test" yet "degrade sharply as input span grows"; despite advertised 32k+, "**only half of them can maintain satisfactory performance at the length of 32K**" | arXiv:abs/2404.06654 (Hsieh et al., v1 2024-04-09) | CLAIMED |
| 8 | Attention spread / sinks | LLMs concentrate attention on initial tokens ("attention sink"); keeping the initial-token KV largely recovers windowed-attention performance — position in context is a first-order quality variable, independent of the RoPE method | arXiv:abs/2309.17453 (StreamingLLM, Xiao et al., ICLR 2024); cf. 2504.02732 (mechanistic, 2025) | CLAIMED |
| 9 | RoPE OOD mechanism | Extrapolation pushes low-frequency dimensions "into an unseen phase interval, causing RoPE OOD"; "expansion and short-range capabilities still conflict"; "interpolation will reduce local resolution". The survey gives **no numeric safe-factor threshold** (no "1.5× is safe, 4× is not") | arXiv:2608.10021 §6.1/§11 (Li, 2026-08-09) | CLAIMED |
| 10 | Coding vs needle-in-haystack | RULER's core point: single-needle retrieval saturates while multi-hop/aggregation degrade with span (i.e. retrieval-over-long-context — the coding task shape — is exactly what NIAH misses). Long-code-specific: "Large language systems have trouble with lengthy source contexts because finite context windows limit what can be processed"; compression studies show a **coverage–fidelity trade-off** (cover more context, lose exact detail) — the relevant failure mode for code retrieval | RULER abstract; arXiv:2602.00746 (Zhong et al., 2026-01-31, LongCodeOCR — VLM-focused with LLM baselines, Tier-2 for the pure-text claim) | CLAIMED |
| 11 | Practitioner: degradation at 16× (anecdote) | "yarn-mistral-7b-128k.Q8_0.gguf response seems out of control" (HF forum, 2024-03-21): community YaRN-128k repack (16× Mistral's 8k native) — verbose answers despite "Do not add extra tokens", unrelated items in output, endless loop with max tokens −1; the non-extended v0.2 file was fine. Caveats: 16× ratio (12× our target), third-party repack, no replies/diagnosis | discuss.huggingface.co/t/78552 | CLAIMED (Tier-2 anecdote) |
| 12 | Practitioner: static YaRN at short ctx | ThoughtDAG thread (2026-08-16): commenter quoting the vendor card — "static YaRN can hurt shorter-text performance" → "probably would not enable YaRN in the first <=32K pilot". Community echo of the vendor's own warning | discuss.huggingface.co/t/178739 | CLAIMED (Tier-2) |
| 13 | Engineering (round-2 relevant) | vLLM issue #55116 "[Bugfix] Correct max_model_len for TeleChat3 YaRN scaling" (closed) — max-model-len vs rope_scaling interaction is a real bug surface in serving engines | vLLM issue search (title from results page; issue not individually fetched) | CLAIMED |
| 14 | S2 seed API | Semantic Scholar search (brief seed) — HTTP 429 rate-limited throughout round 1; not used | — | UNREACHABLE |

## Details

### 1. Method family

**YaRN** (Peng, Quesnelle, Fan, Shippole; arXiv:2309.00071, ICLR 2024 — venue per the survey's
bibliography; all formulas from the paper body).

- *Interpolation scaling.* Frequencies are blended per dimension:
  `h(θd) = (1−γ(r(d)))·θd/s + γ(r(d))·θd`, where `r(d) = L·θd/(2π)` (number of full rotations of
  dimension d inside the trained window L), `θd = b^(−2d/D)` with b = rope base, and γ is 0 for
  r < α, 1 for r > β, linear between (paper recommends α = 1, β = 32 for Llama). Long-wavelength
  (low-frequency) dimensions get the full 1/s interpolation; short-wavelength (high-frequency)
  dimensions are left untouched; the middle ramps between.
- *Attention scaling.* An extra divisor t on all attention logits:
  `softmax(qmᵀkn / (t·√D))` — equivalently rescaling the RoPE-embedded q and k by 1/√t.
- *Temperature scaling.* For LLaMA/Llama-2 the paper fits `1/√t = 0.1·ln(s) + 1`.
- *Evidence (s = 16 and 32, with light fine-tuning).* Llama-2 7B/13B extended to 64k/128k:
  128k passkey retrieval 99.4%; 13B s=32 ARC/Hella/MMLU/TruthfulQA = 58.0/82.2/51.9/37.3 vs 32k
  baseline 59.4/82.1/55.8/37.4 (a small MMLU dip); 128k windowed PPL 2.23–2.24 vs Code-Llama-NTK
  2.54; on the 8k-extension perplexity comparison YaRN 6.04 vs PI 8.07 vs NTK 6.24. The abstract's
  efficiency claim: 10× fewer tokens and 2.5× fewer training steps than prior extension methods.
  **Provenance note:** these are the paper's reported numbers (CLAIMED), and the fine-tuning
  component is real (400 steps, ~0.1% of corpus) — do not read them as training-free results.

**Position Interpolation / PIP** (Chen, Wong, Chen, Tian; arXiv:2306.15595). Uniform compression:
`m′ = m/s`, equivalently `θ′ = θ/s` on every dimension. Per the 2026 survey (§6.3), the failure
mode is loss of local resolution — the adjacent-token phase difference changes from θd to θd/s —
and the original 2K→32K paper acknowledged performance loss **within** the original window even
after short-range fine-tuning. *Brief discrepancy:* the brief labels this seed "dynamic NTK"; it is
the PI paper.

**Dynamic NTK** (mechanism via the 2026 survey, §6.5 — the original 2023 paper could not be located
on arXiv in this environment; see "Could not source"). The extension factor is *dynamic in the
current length*: `s(ℓ) = max(1, ℓ/L0)`, then `b′ = b·s^(dh/(dh−2))`,
`θ′r = θr·s^(−2r/(dh−2))` — i.e. it modifies the rotation base so frequencies are compressed
smoothly, with the highest frequency (r = 0) unchanged. Serving-relevant caveat (survey, verbatim):
"when s(ℓ) changes, the rotation angle of the same historical token also changes" — cached KV
entries were rotated with a different s than the new prompt position expects. For an incremental
agentic workload that grows a conversation while reusing cached prefixes (our rule-17 pattern),
this is a correctness hazard, not just a quality one.

**What the Qwen3 family ships natively** (Tier-1 vendor sources, fetched 2026-11-10):

- Model card (Qwen3-235B-A22B): "Context Length: 32,768 natively and 131,072 tokens with YaRN";
  "We have validated the model's performance on context lengths of up to 131,072 tokens using the
  YaRN method", with the opt-in block `rope_type: yarn, factor: 4.0,
  original_max_position_embeddings: 32768`.
- "The default `max_position_embeddings` in `config.json` is set to 40,960. This allocation
  includes reserving 32,768 tokens for outputs and 8,192 tokens for typical prompts." → the shipped
  default is **1.25× the trained length with no rope_scaling at all**.
- config.json (both Qwen3-235B-A22B and Qwen3-32B, fetched raw):
  `max_position_embeddings: 40960`, `rope_theta: 1000000`, `rope_scaling: null`,
  `sliding_window: null`.
- Vendor guidance: static YaRN is **not recommended when average context ≤ 32,768** ("potentially
  impacting performance on shorter texts"); for a typical 65,536 context they suggest **factor
  2.0**; "The endpoint provided by Alibaba Model Studio supports dynamic YaRN by default and no
  extra configuration is needed."
- Qwen3 Technical Report (arXiv:2505.09388, 2025-05-14, Yang et al.): thinking/non-thinking modes,
  0.6–235B dense+MoE, Apache-2.0 — the abstract carries no context-length or RoPE numbers.
- Qwen2 Technical Report (arXiv:2407.10671, 2024-07): abstract carries no RoPE/context numbers.
  *Brief discrepancy:* the brief's seed 2312.15842 does not resolve to the Qwen2 report in this
  environment (it is an unrelated knowledge-distillation paper); 2407.10671 is the correct ID here.

**Family read-through to our model (INFERRED, to be confirmed against the real config in round 2):**
the Qwen3.8-27B's 262144 native window with no shipped scaling, if it follows the family pattern,
is the same shape as Qwen3's "32k trained / 40960 shipped / YaRN opt-in for the big stretch" —
i.e. the family's own practice at ratios of 1.25× (no scaling) to 2× (factor 2.0) is exactly the
band our 1.335× falls in.

### 2. Long-context quality-degradation literature

- **Position bias / lost-in-the-middle** (arXiv:2307.03172, Liu et al. 2023): the canonical U-shape
  — models use beginning- and end-of-context information best and degrade in the middle; the paper
  concludes current LMs "do not robustly make use of information in long input contexts." This is a
  *span-length* effect: it grows with context length regardless of which RoPE method you used to
  reach that length.
- **RULER** (arXiv:2404.06654, Hsieh et al.): 17 extended-context systems, 13 task types
  (variable number of needles, multi-hop tracing, aggregation). Headline: NIAH overestimates
  capability — "nearly perfect accuracy in the vanilla NIAH test" coexists with "degrade sharply as
  input span grows"; "only half of them can maintain satisfactory performance at the length of 32K"
  despite claiming 32k+. Implication for us: **measuring ctx-350k with a needle-in-haystack probe
  alone would overstate fitness**; multi-hop/aggregation-shaped probes (retrieval over the repo
  corpus) are the honest instrument (feeds the round-2 probe design, consistent with rule 17).
- **Attention sinks** (StreamingLLM, arXiv:2309.17453, ICLR 2024): LLMs concentrate attention on
  initial tokens; keeping that KV restores windowed-attention quality — evidence that *which
  positions* carry the content matters, again independent of RoPE. (Mechanistic follow-up:
  "Why do LLMs attend to the first token?", arXiv:2504.02732, 2025.)
- **RoPE extrapolation failure modes** (survey arXiv:2608.10021, §6.1/§11): extrapolation moves
  low-frequency dimensions "into an unseen phase interval, causing RoPE OOD"; expansion conflicts
  with short-range capability; interpolation reduces local resolution. The survey explicitly gives
  **no numeric safe-factor threshold** — nothing in it partitions "1.25×–2× is safe, beyond is not".
- **Coding vs needle-in-haystack.** RULER is the direct evidence that the single-needle shape is
  the *easy* shape: retrieval with multiple needles, multi-hop and aggregation degrade well before
  single-needle saturates — and retrieval-over-long-context is precisely what coding workloads are.
  Long-code-specific work (arXiv:2602.00746, Zhong et al. 2026) motivates from "finite context
  windows limit what can be processed" for source code and characterizes a **coverage–fidelity
  trade-off** (cover more of the codebase, lose exact detail) — the same shape of risk at 350k:
  more reachable tokens, not automatically better retrieval. (That paper is VLM-centric with LLM
  baselines — Tier-2 for the pure-text LLM claim.)

### 3. Practitioner reports (Tier-2)

- **HF forum #78552 (2024-03-21)** — "yarn-mistral-7b-128k.Q8_0.gguf response seems out of
  control": on a community-built YaRN-128k Mistral-7B GGUF (16× native 8k) the user reports
  verbose answers despite an explicit "Do not add extra tokens" instruction, unrelated items in the
  output ("What is the sum of 10+5?"), and an endless loop with max tokens −1; the non-extended
  mistral-7b-instruct-v0.2 file "was not problematic". No replies/diagnosis in the thread.
  *Use:* a real-world training-free degradation data point — but at 16×, i.e. an order of
  magnitude past our target ratio, on a third-party repack. It argues that "cliffs" appear at
  aggressive factors, not that 1.33× is unsafe.
- **HF forum #178739 (2026-08-16)** — ThoughtDAG show-and-tell; a commenter quoting the vendor card:
  "lists 32,768 tokens natively and describes YaRN for longer inputs"; "static YaRN can hurt
  shorter-text performance" → "probably would not enable YaRN in the first <=32K pilot".
  *Use:* the vendor's static-YaRN-at-short-ctx warning is being acted on by practitioners for
  mixed-length workloads — directly relevant because our agentic workload mixes ~20k and 350k
  prompts under one server.
- **Vendor (Tier-1, restated):** the Qwen3 card is the strongest "practitioner" source available —
  the vendor itself (a) ships 1.25× with no scaling, (b) recommends 2× (factor 2.0) for
  64k-typical deployments, (c) validates 4× (131k) via YaRN, and (d) warns that static YaRN can
  cost short-text quality.
- **vLLM #55116** (closed, "[Bugfix] Correct max_model_len for TeleChat3 YaRN scaling") from the
  issue search page: engines have historically miscalculated max_model_len when rope scaling is
  present — one reason round 2 must check our engine's max-model-len validation against the config
  explicitly (title-only; issue body not fetched this round).

### 4. Application to our 1.335× (all INFERRED from the sourced formulas above)

- **Ratio.** s = 350000/262144 = 1.335 (vs the 260000 serving point: 1.346). Same band either way.
- **YaRN temperature at s = 1.335.** `1/√t = 0.1·ln(1.335) + 1 = 1.0289` → t = 0.945: attention
  logits divided by 0.945·√D — a mild sharpening, a small perturbation. (Formula fit on Llama with
  base 1e4; applying it at base 1e6 is an extrapolation of the fit — flagged as INFERRED.)
- **YaRN by-parts split at Qwen geometry** (rope_theta = 1e6, d = 128, L0 = 262144):
  `r(d) = 262144·θd/(2π)`, `θd = (1e6)^(−2d/128)`. r = 1 at d ≈ 49; r = 32 at d ≈ 33. So
  dimensions d ≳ 49 (roughly half the spectrum — the low-frequency half) receive the full 1/s =
  0.749 interpolation, d ≲ 33 are left untouched, and the middle ramps. Net effect: YaRN@1.335 on
  a 1e6-base model ≈ "PI on half the dimensions, identity on the other half, plus t ≈ 0.945" —
  milder than plain PI (all dimensions × 0.749) and milder than NTK (base × ≈ 1.34).
- **Reading.** At 1.335×, *every* training-free method in this family applies a small geometric
  perturbation; none is exotic. The binding risks are (a) **positional OOD** — the model was never
  trained past 262144, and the low-frequency dimensions' phase range extends beyond what training
  covered (the survey's mechanism, mild at 33%), and (b) **span-length task degradation** (LoMT
  U-shape, RULER) which grows with context length regardless of RoPE method. No source found in
  this round quantifies a quality cliff *inside* the 1.25×–2× band — the survey gives no threshold
  at all, and the only training-free degradation anecdote found is at 16×.
- **Vendor-band argument (INFERRED).** The Qwen family's own practice brackets our target:
  1.25× shipped with zero scaling (40960/32768), 2× recommended as a production configuration
  (factor 2.0), 4× "validated" as the stretch setting. 1.335× sits strictly inside the
  vendor-endorsed 1.25×–2× band.
- **Method ranking at 1.335× (INFERRED recommendation, to be re-grounded on the real config in
  round 2):**
  1. *No RoPE scaling — just raise max-model-len to 350000.* Smallest possible perturbation;
     matches how the Qwen family ships its own 1.25× margin. Risk: pure positional OOD past
     262144 (mild at 1.335× per the above).
  2. *Static YaRN, factor ≈ 1.34.* Vendor-endorsed method; perturbation small at this factor.
     Caveat that matters for us: static scaling also reshapes short-context prompts (vendor warning
     #12) — we serve ~20k and 350k prompts on the same server; the vendor's production answer for
     that is *dynamic* YaRN (their endpoint runs it by default), which our engine may or may not
     support (round 2).
  3. *Dynamic NTK — not recommended for serving:* the s(ℓ) change re-rotates cached KV (survey),
     which conflicts with prefix caching and incremental conversation growth.
  4. *Plain PI — weakest:* acknowledged local-resolution loss even within the trained window.
- **What a future 350k campaign must measure to de-risk (input to the round-2 memo):**
  retrieval over the real repo corpus at grown depths (multi-turn growth with cached prefixes per
  rule 17 — not a cold 350k prefill); a LoMT position sweep (answer-relevant token at start/middle/
  end at 260k vs 350k); RULER-shaped multi-hop/aggregation tasks at both depths; and a
  **short-context regression check** (does enabling static YaRN move our ~20k-task quality?) — the
  vendor warning makes that third probe mandatory for option 2.

### 5. Could not source (flag for round 2 / memo)

- **Original dynamic-NTK paper** (the 2023 training-free extrapolation work): two arXiv searches
  ("dynamic NTK aware positional interpolation training-free extrapolation"; "training-free
  extrapolation NTK") returned no such paper in this environment — only the 2026 survey and
  unrelated entries. The mechanism cited above comes solely from the survey; if the memo needs the
  primary source, re-verify from a different network/tool.
- **A quantitative quality-cliff threshold anywhere in 1.25×–2×:** none found. The 2026 survey
  explicitly provides no safe-factor boundary; no practitioner measurement at 1.25–2× was located
  (the one anecdote is at 16×). Any memo statement like "1.33× is empirically safe" would be
  INFERRED from the vendor-band argument, not a measurement — say so.
- **Qwen2-report RoPE details** (the brief's seed "RoPE setup reference"): the seed URL does not
  resolve to the Qwen2 report here, and the 2407.10671 abstract carries no RoPE numbers (report body
  not fetched this round). The family's rope_theta = 1e6 is sourced directly from the Qwen3 configs.
- **Qwen3-8-specific literature:** no 2026 source found that measures Qwen3.8-27B at extended
  context. *Lead only, unverified:* a truncated search snippet for "Highlight-Then-Summarize"
  (arXiv:2609.31382) reportedly compares H2S-14B (32.60) against "Qwen3.8-27B" (10.17 behind) on a
  ~43.9k-token code context — the paper was NOT fetched; do not cite without a round-2 fetch.
- **Semantic Scholar API** (brief seed URL): HTTP 429 rate-limited for the entire round; all
  lookups were done via arXiv search/fetch and HF instead.

## Sources (tiered)

**Tier-1 (vendor / official model artifacts):**
1. Qwen3-235B-A22B HuggingFace model card — https://huggingface.co/Qwen/Qwen3-235B-A22B (fetched 2026-11-10; context-length section)
2. Qwen3-235B-A22B config.json — https://huggingface.co/Qwen/Qwen3-235B-A22B/raw/main/config.json
3. Qwen3-32B config.json — https://huggingface.co/Qwen/Qwen3-32B/raw/main/config.json
4. YaRN — Peng, Quesnelle, Fan, Shippole, "YaRN: Efficient Context Window Extension of Large Language Models", ICLR 2024 — https://arxiv.org/abs/2309.00071 (body via ar5iv.labs.arxiv.org/html/2309.00071)
5. Position Interpolation — Chen, Wong, Chen, Tian, "Extending Context Window of Large Language Models via Positional Interpolation", 2023 — https://arxiv.org/abs/2306.15595
6. Lost in the Middle — Liu et al., 2023 — https://arxiv.org/abs/2307.03172
7. Qwen3 Technical Report — Yang et al., 2025-05-14 — https://arxiv.org/abs/2505.09388
8. Qwen2 Technical Report — Yang et al., 2024-07 — https://arxiv.org/abs/2407.10671

**Tier-1 (papers, non-vendor):**
9. RULER — Hsieh, Sun, Kriman, Acharya, Rekesh, Jia, Zhang, Ginsburg, 2024 (v1 2024-04-09) — https://arxiv.org/abs/2404.06654
10. StreamingLLM (attention sinks) — Xiao, Tian, Chen, Han, Lewis, ICLR 2024 — https://arxiv.org/abs/2309.17453
11. "Position Encoding in Transformers: … RoPE and Long-Context Scaling" — Li, 2026-08-09 — https://arxiv.org/abs/2608.10021 (sole source for the dynamic-NTK mechanics here)
12. "Can Vision-Language Models Handle Long-Context Code? An Empirical Study on Visual Compression" — Zhong et al., 2026-01-31 — https://arxiv.org/abs/2602.00746 (Tier-2 for the pure-text LLM claim)
13. "Why do LLMs attend to the first token?" — Barbero et al., 2025 — https://arxiv.org/abs/2504.02732

**Tier-2 (practitioner):**
14. HF forum #78552, 2024-03-21, "yarn-mistral-7b-128k.Q8_0.gguf response seems out of control" — https://discuss.huggingface.co/t/78552
15. HF forum #178739, 2026-08-16, ThoughtDAG thread (static-YaRN-at-short-ctx caution) — https://discuss.huggingface.co/t/178739
16. vLLM issue #55116 (max_model_len × YaRN bugfix; title from issue-search results page, body not fetched) — https://github.com/vllm-project/vllm/issues/55116

**Unreachable this round:** Semantic Scholar API (HTTP 429 throughout); the original dynamic-NTK
2023 paper (not indexed on this environment's arXiv).
