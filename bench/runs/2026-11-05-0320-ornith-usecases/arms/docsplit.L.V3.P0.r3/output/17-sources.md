## Sources

External claims only. Every URL below was fetched and confirmed to contain the cited claim on 2026-07-15.

**Vendor (Tier-1, primary):**

- Qwen model card — `Qwen/Qwen3.6-27B`: https://huggingface.co/Qwen/Qwen3.6-27B — thinking/coding sampling recipes; the 32,768 output-length recommendation (81,920 for highly complex problems); the presence_penalty note.
- Qwen model card — `Qwen/Qwen3.6-35B-A3B`: https://huggingface.co/Qwen/Qwen3.6-35B-A3B — as above, plus the MoE `presence_penalty=1.5` asymmetry in *general* thinking mode.
- Unsloth model card — `unsloth/Qwen3.6-35B-A3B-GGUF`: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF — the source of the Unsloth-only preset (`temp 1.0 / top_p 1.0 / top_k 40 / min_p 0.0 / pp 2.0`), attributed to the Qwen team but **not present on Qwen's own card**.
- Unsloth docs — Qwen3.6: https://unsloth.ai/docs/models/qwen3.6 — confirms `presence_penalty = 0.0` for "precise coding tasks (e.g. WebDev)"; notes that a higher value "may result in slight decrease in performance".

**Engineering (Tier-1, primary):**

- llama.cpp PR **#7412** "CUDA: quantized KV cache demo" (JohannesGaessler, **closed/obsolete**): https://github.com/ggml-org/llama.cpp/pull/7412 — f16 KV PPL 6.232196 / KLD 0.000189 vs V-cache q8_0 6.232771 / 0.000743; "The K cache seems to be much more sensitive to quantization than the V cache." *(CUDA, different model — directional support only.)*
- llama.cpp issue **#23335** "Eval bug: draft-mtp changes deterministic output on Qwen3.6 MTP model" (**closed**, resolution **UNVERIFIED**): https://github.com/ggml-org/llama.cpp/issues/23335 — cited only to record that it is **not** visible in our data.
- vLLM issue **#27433** "[Feature]: Batch Invariant Feature and Performance Optimization" (**open**): https://github.com/vllm-project/vllm/issues/27433 — batch-invariant / deterministic inference is an open engineering problem. *(It does **not** discuss MoE routing; cited only as evidence that no settled Tier-1 quantification exists.)*

**Benchmarks / literature:**

- Artefact2, GGUF quantisation benchmark gist: https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9 — Mistral-7B, imatrix on wiki.train, KLD on wiki.test: Q4_K_M 4.83 bpw / KLD median 0.0075 / q99 0.0885 · Q5_K_M 5.67 / 0.0043 / 0.0368 · Q6_K 6.57 / 0.0032 / 0.0222. *(Not Qwen3.6, and not a coding benchmark.)*
- Iacobacci, Qian, AL-Tam, AL-Qurishi, Souissi — *Increasing the Thinking Budget is Not All You Need*: https://arxiv.org/abs/2512.19585 — "simply increasing the thinking budget is not the most effective use of compute"; self-consistency and self-reflection outperform budget increases.

**Our own prior work (in this repo):**

- `docs/research/2026-07-15-1000-qwen36-sampling-thinking-budget-variance.md` — the sourced sampling/budget/variance report that axes 2 and 3 were designed to test. Its **Finding 3** (truncated thinking drives the wall and the fluctuation) is **refuted** by axis 2 above; its **Findings 1, 7 and 8** (the vendor sampling recipes; the Unsloth-only preset; the temp/pp coupling confound) are **corroborated**.

**Explicitly not used.** Several candidate sources were rejected during verification: a third-party GGUF perplexity repo (not Tier-1, unverifiable provenance); llama.cpp PR #16016 "deterministic inference" (draft, CUDA-only, unverified, and irrelevant to this Vulkan box); and any Unsloth "Dynamic 2.0" accuracy table for Qwen3.6 — **no such table could be located**, and the figures circulating for it are **Gemma 3** numbers.

**No external number is compared against ours as a benchmark.** The haiku/sonnet/opus figures are **our own** measurements (`calibration-reps.jsonl`), not vendor claims.

---

