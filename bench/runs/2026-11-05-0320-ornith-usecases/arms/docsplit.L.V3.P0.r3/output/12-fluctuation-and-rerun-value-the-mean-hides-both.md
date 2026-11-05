## Fluctuation and rerun value — the mean hides both

`rep sd` = how much a cell swings on the *same* prompt. `Δ rerun` = best-of-3 minus mean = what re-rolling buys. `hard@R` = share of tasks where **any** rep is strictly clean — the toolchain (tsc/eslint/vitest) picks the winner, so this is a real strategy, not an oracle.

| cell | mean | worst | best | range | rep sd | best-of-R | **Δ rerun** | hard@1 | **hard@R** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Q4_K_M (f16) | 78.3 | 57 | 96 | 39 | **4.9** | 82.9 | **+4.6** | 0% | 0% |
| Q4_K_XL (f16) | 69.8 | 30 | 92 | 61 | 7.6 | 77.1 | **+7.3** | 0% | 0% |
| Q5_K_M (q8_0) | 76.5 | 59 | 94 | 35 | 7.6 | 84.4 | **+7.9** | 0% | 0% |
| Q6_K (q8_0) | 80.9 | 55 | 100 | 45 | 6.5 | 86.8 | **+5.9** | 7% | **20%** |
| q5-f16-rb4096 | 74.3 | 55 | 94 | 39 | 7.4 | 81.9 | **+7.6** | 0% | 0% |
| q5-f16-rb16384 | 77.5 | 63 | 97 | 34 | **4.8** | 82.4 | **+4.9** | 0% | 0% |
| un-f16-rb16384 | 78.6 | 53 | 91 | 38 | 5.2 | 83.8 | **+5.2** | 0% | 0% |
| 35B-A3B rb4096 | 73.3 | **11** | 95 | **84** | **15.7** | 85.5 | **+12.3** | 7% | **20%** |
| 35B-A3B rb16384 | 77.5 | 19 | 97 | 78 | 11.1 | 85.3 | **+7.8** | 7% | **20%** |
| 35B-A3B rbmax | 75.4 | 19 | 97 | 78 | 12.6 | 85.3 | **+10.0** | 7% | **20%** |
| 35B t03 | 70.0 | 34 | 94 | 61 | 11.2 | 81.2 | **+11.3** | 0% | 0% |
| 35B t10 | 68.4 | 18 | 100 | 82 | 12.1 | 78.7 | **+10.4** | 7% | **20%** |
| 35B qwen-gen | 62.1 | 32 | 84 | 52 | 13.5 | 75.7 | **+13.6** | 0% | 0% |
| 35B unsloth-reason | 63.0 | 36 | 91 | 55 | **16.3** | 80.5 | **+17.5** | 0% | 0% |

- **The dense 27B is markedly steadier than the MoE 35B at every comparable setting** (rep sd 4.8–7.6 vs 11.1–16.3). This is the campaign's most consistent structural difference after speed. **It is not tested for significance** and rep sd from 3 reps is itself noisy — but it is monotone across seven pairings.
  - **CLAIMED / a gap in the literature:** we could find **no Tier-1 source quantifying MoE-vs-dense run-to-run variance**. The known mechanism for inference non-determinism (batch-size-dependent reduction order, floating-point non-associativity) is architecture-agnostic and remains an open engineering problem — see vLLM's [batch-invariance tracking issue #27433](https://github.com/vllm-project/vllm/issues/27433) (**open**; note it does *not* discuss MoE routing). Our own research doc noted the one vendor hint in this direction: Qwen recommends `presence_penalty 1.5` for the **MoE** in general thinking mode but 0.0 for the dense 27B, implying the MoE is more repetition-prone in open-ended use.
  - **Our data rules out engine non-determinism as the cause (MEASURED).** Replies are **identical across cells** wherever the budget did not bind — the engine reproduces exactly at a fixed seed, MTP and all. So the 35B's spread is **sampling variance amplified by the model**, not hardware or batching jitter. That also means llama.cpp issue [#23335](https://github.com/ggml-org/llama.cpp/issues/23335) ("draft-mtp changes deterministic output", **closed**, resolution unverified) is **not** visible in our data as a variance source.
- **Rerunning beats every other lever in this campaign.** Δ rerun is **+4.6 to +17.5 pts** — larger than the whole quant ladder and vastly larger than the budget axis. And the noisiest cells pay the most (+17.5 on the worst cell), which is the correct shape: variance is an asset when a free verifier picks the winner.
- **`hard@R` triples `hard@1`** (7% → 20%) wherever any hard-pass exists at all. The toolchain does the picking; no human, no judge.
- **The floor is the 35B's problem, not its mean.** Worst-of-3: **11** (35B rb4096) vs **57** (Q4_K_M). If a pipeline ships whatever comes out, that floor is the number that matters.

![Rerun value](charts/rerun_value.svg)

> Inline because it is the campaign's most actionable relationship: what re-rolling buys, per cell, against what every other axis bought (≈0). MEASURED, all 14 cells.

---

