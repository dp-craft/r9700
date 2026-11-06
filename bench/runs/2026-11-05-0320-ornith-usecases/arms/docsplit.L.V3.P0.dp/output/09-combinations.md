## Combinations across the three axes — what interacts and what does not

Systematically, from the cells we actually have:

| Combination | Have it? | Result |
|---|---|---|
| **quant × budget** | Yes — Q4_K_M and Q5_K_M f16 each at 4096 and 16384 | **No interaction.** The budget null replicates on both quants (+0.3 and +3.2 raw, both unresolved). The budget conclusion is not a Q4_K_M artifact |
| **quant × KV** | Yes — Q5_K_M at f16 and q8_0, same budget | **No interaction.** 74.3 vs 76.5; the README's flagged confound is bounded below the noise floor |
| **model × budget** | Yes — 27B and 35B each at 4096 and 16384 | ⚠ **RESOLVED 2026-07-16 — the asymmetry is real.** Was "possibly asymmetric, unresolved (no test)". The paired test existed all along, it was just never run against the right baseline: **35B rb4096 vs rb16384 = −4.3, t=−5.45, SIGNIFICANT** (`--baseline a3b-d128-f16-rb16384`), while the **27B is a tight null** (+0.3, sd 1.8). **The MoE genuinely benefits from a bigger thinking budget and the dense 27B does not** — it thinks more when freed (8541 vs 6834 mean tokens). Saturating: rbmax vs rb16384 = −2.1, ns. ⚠ One of 13 printed comparisons (p≈0.005; survives a Bonferroni look at 0.065, marginal) |
| **budget × fluctuation** | Yes | **27B: no change** (4.9 → 5.2). **35B: 15.7 → 11.1 → 12.6**, directionally lower, untested. The 35B is noisier than the 27B at *every* budget — capacity/MoE, not budget, drives its variance |
| **temperature × budget** | **NO** | ⚠ **A gap.** All five sampling cells run at budget 16384 only. We cannot say whether temp 0.3 or temp 1.0 behaves differently at 4096 |
| **sampling × model** | **NO** | ⚠ **A gap, and a confound.** *Every* sampling cell is the 35B-A3B. The temperature and presence_penalty *quality* findings are **not established for the dense 27B**. (The *decode*-tax mechanism now **is** — it reproduces on the 27B, see the refutation above.) |
| **presence_penalty × MTP** | ⚠ **SETTLED — no interaction** | ⚠ **REFUTED 2026-07-16.** Was "the best hypothesis in the campaign — one cheap run from being settled". It is settled, and there is **no interaction**: the pp decode cost is a **fixed ~2 ms/tok host tax** (Amdahl), reproduces with MTP **off** and on the dense 27B, and leaves draft acceptance untouched. See the refutation above + `docs/analysis/2026-07-16-0927-mtp-sampler-tax.md` |
| **quant × sampling** | **NO** | Untested. If sampling hygiene dominates quant choice (as the effect sizes suggest), this is the more valuable of the two axes to extend |

**The connective insight (INFERRED):** the three axes are not equal citizens. **The full sampling *preset* moved quality by ~15 pts (temp+pp jointly, only the joint move is resolvable); the entire quant ladder moved it by 11 pts and could not be resolved; the budget moved it by ~0 on the dense 27B but a resolvable −4.3 on the MoE.** Effort spent shopping for quants would have been better spent checking that the sampler matches the vendor's *task-specific* recipe — and that conclusion transfers off this box.

---

