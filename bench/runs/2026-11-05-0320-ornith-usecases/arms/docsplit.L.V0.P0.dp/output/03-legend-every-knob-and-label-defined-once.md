## Legend — every knob and label, defined once

Short definitions, in place. Skip if these are familiar.

| Term | What it is | What it does here |
|------|------------|-------------------|
| **quantisation** (`Q4_K_M`, `Q5_K_M`, `Q6_K`) | storing model weights at reduced bit-depth (~4.8 / ~5.7 / ~6.6 bits per weight) to fit VRAM; higher = more faithful, bigger, slower | the primary axis: 16.1 / 18.5 / 21.3 GiB of weights, 46.1 → 32.6 decode t/s |
| **`UD-Q4_K_XL`** ("UD" = Unsloth **Dynamic**) | a mixed-precision recipe: Unsloth keeps sensitive tensors at higher precision instead of quantising every tensor uniformly | 16.7 GiB — scored *lowest* of the ladder (69.8), but not significantly |
| **MoE vs dense** | the 35B-A3B is a **M**ixture-**o**f-**E**xperts: 35B total parameters but only **~3B active** per token, so it decodes like a small model and stores like a big one | 21.1 GiB of weights, **~120 t/s** vs the dense 27B's ~43–46 |
| **KV cache `f16` vs `q8_0`** | the per-token attention key/value memory, at 16-bit vs 8-bit block-quantised. Halving it buys context; it may cost fidelity | the 27B is hybrid-attention (16 of 65 blocks carry KV): f16 = 64 KiB/tok, q8_0 = 34. **Measured here as a null** |
| **MTP** (multi-token prediction) | speculative decoding using a draft layer embedded in the GGUF: the draft proposes several tokens, the model verifies them in one pass. Accepted tokens are nearly free speed | on in every cell; the 35B's ~120 t/s depends on it — and `presence_penalty` appears to break it |
| **reasoning budget** (`--reasoning-budget N`) | a hard cap on *thinking* tokens before the answer. At the cap, llama.cpp force-closes the thinking block and the model must answer mid-reasoning | axis 2: 4096 / 16384 / −1 (unlimited). A think count of 4093–4095 = forced stop; anything lower = the model stopped on its own |
| **temperature** | flattens (high) or sharpens (low) the sampling distribution. High = more diverse; low = more repetitive/greedy | axis 3: 0.3 / 0.6 / 1.0 on the 35B. Qwen documents **0.6** for precise coding |
| **top_p / top_k / min_p** | truncation filters: keep the smallest set of tokens whose probability sums to `top_p` / the `top_k` most likely / anything above `min_p` of the peak | pinned at Qwen's coding recipe (0.95 / 20 / 0) except in the vendor-preset cells. ⚠ llama.cpp's own default is `min_p=0.05`, so 0 must be sent explicitly |
| **presence_penalty** | subtracts a fixed amount from the logit of any token that already appeared, to break repetition loops | Qwen sets it to **0.0** for coding and 1.5 for general thinking. The two cells with pp > 0 are this campaign's two worst |
| **prefill vs decode** | prefill = ingesting the prompt (parallel, compute-bound); decode = emitting tokens one at a time (serial, memory-bandwidth-bound) | at ~132.9k tokens prefill dominates time-to-first-answer (ttfa 47.7–197.3 s); decode sets the rest |
| **GTT spill** | Graphics Translation Table — GPU-addressable *host* RAM. Traffic here means the working set left VRAM and is crossing PCIe | 1551–2841 MiB in every cell on a 31 GB no-swap host — freeze risk |
| **`TS %`** | the deterministic TypeScript score: a weighted blend of the objectives below, per reply | the headline quality number, averaged over 5 tasks × 3 reps = 15 |
| **`hard_pass`** vs **partial score** | `hard_pass` = *every* gate objective strictly 1.0 (a binary "would you merge it"). Partial score = weighted credit | brutally different questions: one reply scoring **94 hard-passed** while its **95**-scoring sibling did not |
| **`lint` / `types`** (fractional) | `1 − min(1, errors/K)` (K=5 / K=3) — error-count based, not binary. 1 lint error = 0.80 | add-on A of this campaign — it is what makes "the wall" visible |
| **`tests` / `edge` / `reuse`** | vitest pass fraction / edge-case coverage / reuses the provided abstractions | 0.84 / 0.87 / 0.99 — the logic is largely right |
| **`tier`** | **a difficulty class, NOT a score band** — the weakest *reference* tier that produces a strictly-clean hard_pass | 2 of 5 labels confirmed, 2 contradicted, 1 a ceiling. See Tier semantics |
| **rep sd** | mean within-(cell,task) standard deviation — how much the same cell swings on the same prompt | **9.8 pts** overall; per-cell 4.8 → 16.3 |
| **best-of-N / `hard@R`** | take the best of R reps per task. `hard@R` = share of tasks where *any* rep is strictly clean | a real strategy, not an oracle: tsc/eslint/vitest pick the winner without a human |
| **paired t-test** | compares two cells task-by-task, cancelling task difficulty — the right test when tasks differ more than cells do | n=5 tasks → threshold \|t\| > 2.776 |

---

