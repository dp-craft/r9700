# WS8 research brief — ctx-350k feasibility (RESEARCH-ONLY, two-round)

**Context.** The 27B (Qwen3.8-27B) currently serves at ctx 260000 / 2 seqs / fp8 KV (27b.conf; the model's
native window is 262144). The user's question: **how can ctx be raised to 350k without losing RoPE
quality?** This is research-only in this plan — the deliverable is a session-4 feasibility memo; any
actual 350k boot + quality measurement is a FUTURE campaign.

**Already settled by the plan (do not re-derive, just use as inputs, tag MEASURED/INFERRED as given):**
KV budget is MEASURED 370,702 tokens at 262000/2/fp8 (≈368k at 260000). So: 350k × 2 seqs = 700k tokens →
infeasible at fp8; 1 seq ≈ 360k ≈ 97% of budget → infeasible (no headroom); **q8_0 KV halves the budget
(≈740k tokens) → 2×350k fits with margin** (documented q8_0 precedent: the Gemma deep-ctx fix in
CLAUDE.md — KV q8_0 at deep ctx when f16/fp8 doesn't fit).

**Repo rules:** provenance tags, Tier-1 first (model's own config, paper preprints, official docs),
English, tables first. NO `strings` on the multi-GB checkpoint files — bounded header reads only
(`head -c` / config.json / gguf KV parse). Result files in this same `research/` dir.

## Round 1 — holistic → write `research/ws8-ctx350k-r1.md`

RoPE extrapolation quality at extreme lengths:
- The method family: YaRN (attention scaling + temperature/interpolation scaling; arXiv 2309.00071),
  dynamic NTK, position interpolation (PIP), and what the Qwen3 family ships natively
  (`rope_scaling` in its config — check the official Qwen3 model cards/technical report for the
  native trained length and any shipped scaling for 256k+).
- Long-context quality-degradation literature at/near the limit: attention spread, lost-in-the-middle
  (Liu et al. 2307.03172), position-embedding extrapolation failure modes; what the degradation looks
  like for CODING tasks specifically (retrieval over long context) vs needle-in-haystack.
- Practitioner reports: YaRN at 1.25–2× native with quality notes; when people report "quality cliff"
  and what they measured.

Seed URLs: https://arxiv.org/abs/2309.00071 (YaRN), https://arxiv.org/abs/2307.03172 (LoMT),
https://arxiv.org/abs/2306.15595 (dynamic NTK), https://arxiv.org/abs/2312.15842 (Qwen2 technical
report — RoPE setup reference), https://huggingface.co/Qwen/Qwen3-235B-A22B (config example — rope_scaling
block), Semantic Scholar: https://api.semanticscholar.org/graph/v1/paper/search?query=long+context+RoPE+extrapolation+quality

## Round 2 — drill down (OURS) → write `research/ws8-ctx350k-r2.md`

Local Tier-1 (CPU reads only):
1. **The model's own config:** find the local Qwen3.8-27B checkpoints and read their `config.json`
   (CPU): `/mnt/Lin1/work/vllm/sly-radiance/models/` (RedHatAI__Qwen3.8-27B-MXFP4@16a86728,
   Qwen__Qwen3.8-27B-FP8@017b9c7a, slybase__Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ@3bb379dc),
   `/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef` (read the .rad's
   companion metadata if any, else its SOURCE.txt), and the gguf if present under /home/dev/models
   (bounded header parse via `python3 -c` with gguf, or the repo's `bench/core/gguf_kv.py` — NEVER
   scan the whole file). Extract: `max_position_embeddings`, `rope_theta`, `rope_scaling` (is any
   scaling SHIPPED — type, factor, original_max_len, attention_scale?), and the native trained ctx.
2. **What is in effect at today's 260k:** given the shipped config, are we already extrapolating at
   260000? By how much past the trained/scaling range? (e.g. if native is 262144 with no scaling,
   260000 is inside; 350000 is ~33% past → what does the literature say at that ratio?)
3. **Engine side:** radiance `--max-model-len` 350k support (untested → note that a boot is required;
   check radiance docs/spec for any documented max), sly/vLLM `--max-model-len 350000` (vLLM accepts
   arbitrary max-model-len ≤ the config's max_position_embeddings, or with rope_scaling override —
   check local vLLM src for how max_model_len is validated vs config).
4. **KV math** (use the plan's numbers above; re-derive the per-dtype budget table: fp8 vs q8_0 vs f16
   × seq count, with the MEASURED 370,702 anchor and the INFERRED scaling).

Deliverable in `research/ws8-ctx350k-r2.md` (this becomes the session-4 memo skeleton):
- RoPE risk level at 350k (LOW/MED/HIGH + why), with the scaling currently in effect stated explicitly;
- the required config table (KV dtype, seq count, engine flag, max-model-len);
- VRAM budget per option (MEASURED vs INFERRED tagged — never present the calc as a measurement);
- go/no-go recommendation + what a future 350k campaign would have to measure to de-risk (quality
  probe design: long-context retrieval over the repo corpus, not a cold 350k prefill — rule 17).
