## Axis 2 — the reasoning budget: a no-op above ~4k, and a refuted hypothesis

This axis was designed to test a **sourced** hypothesis from our own research doc (`docs/research/2026-07-15-1000-qwen36-sampling-thinking-budget-variance.md`, Finding 3): that running `--reasoning-budget 4096` — roughly **8× below** Qwen's recommended 32,768 output length (CLAIMED, verified on the [Qwen3.6-27B card](https://huggingface.co/Qwen/Qwen3.6-27B)) — was truncating the models mid-reasoning and plausibly causing both the lint/types wall and the run-to-run fluctuation.

**The data refutes it, on all three of its predictions.**

| | 27B Q4_K_M | 35B-A3B |
|---|---|---|
| budget 4096 → TS % | 78.3 | 73.3 |
| budget 16384 → TS % | **78.6** | **77.5** |
| budget −1 (unlimited) → TS % | — | **75.4** |
| paired Δ vs Q4_K_M @4096 | **+0.3**, sd **1.8**, t=0.37, **ns** | rb16384 −0.8 (ns) · rbmax −2.9 (ns) |
| mean think tokens @4096 → @16384 | 4095 → 6834 | 4063 → 8541 (→ 9522 unlimited) |
| full answer time @4096 → @16384 | 156.9 s → **216.7 s** | 60.9 s → 96.2 s |
| rep sd @4096 → @16384 | 4.9 → 5.2 | 15.7 → 11.1 (→ 12.6) |

- **Prediction 1: more budget → better quality. FALSE — and this is a *tight* null, not an underpowered one.** The 27B's paired Δ is **+0.3 pts with sd 1.8** across the five tasks (−2, +0, +0, +1, +3). That sd is five times tighter than any other comparison in the campaign: quadrupling the thinking budget changed essentially *nothing*, per task, consistently. The 35B's raw +4.2 has no direct significance test printed and its CIs overlap heavily.
- **Prediction 2: more budget → less fluctuation. NOT SUPPORTED.** The 27B's rep sd is unchanged (4.9 → 5.2; the digest itself says a Δ sd within ±1 pt is not a change). The 35B's 15.7 → 11.1 is directionally lower but is an sd estimated from 3 reps with no test attached — suggestive at best.
- **Prediction 3: the budget was binding. TRUE at 4096, FALSE at 16384 — and this is the mechanism.** In the per-rep tables a think count of **4093–4095** is a forced stop; anything lower is the model choosing to stop. At rb4096 the 27B Q4_K_M was forced on **every single reply (4095 × 15)**. At rb16384 both models settle at **~3.6k–11.6k** per reply (cell means 5.7k–9.2k) and the cap almost never fires. The proof is reply identity:
  - **`a3b-d128-f16-rb16384` and `a3b-d128-f16-rbmax` are identical on 14 of 15 replies** — same think tokens, same objective vectors, same TS. They differ on exactly **one**: `rate-limiter` rep 1, where 16384 forced a stop at **16383** (TS **77**) and unlimited ran to **31,093** think tokens (TS **45**, judge row absent, and the campaign's only runaway).
  - The same pattern holds on the 27B Q5_K_M f16 pair: `async-memo` is identical across rb4096 and rb16384 (think 1501 / 4073 / 538 — all under the cap), and the cells diverge only where the 4095 cap fired.

**Consequences, in order of importance:**

1. **Budget 4096 is the right default for the 27B on this workload** — +60 s per reply buys +0.3 pts. **Do not** pay for 16384 unless something else changes.
2. **Unlimited budget is a liability, not an upgrade.** It changed exactly one reply out of fifteen, and that reply ran away to 31k tokens and lost 32 points. The campaign's entire runaway rate (7%) lives in this cell.
3. **The models do not want Qwen's 32,768.** Left free, they choose ~3.6k–11.6k per reply on the hardest tasks we have (cell means 6834–9522). **INFERRED:** Qwen's 32,768 is a *headroom* recommendation (do not truncate), not a target — and at 128k depth we cannot test it anyway (per our research doc, 32,768 does not fit a 163840 window behind a ~132.9k prompt).
4. **The lint/types wall is not a truncation artifact.** It is identical at 4096 and 16384. Whatever causes it, more thinking is not the cure.

> **CLAIMED corroboration.** *Increasing the Thinking Budget is Not All You Need* (Iacobacci, Qian, AL-Tam, AL-Qurishi, Souissi — [arXiv:2512.19585](https://arxiv.org/abs/2512.19585)) reports that "simply increasing the thinking budget is not the most effective use of compute" and that "more accurate responses can instead be achieved through alternative configurations, such as self-consistency and self-reflection." That is our result twice over: our budget axis is a null, and our **rerun value** (best-of-3 = self-consistency, adjudicated by the toolchain) is worth **+4.6 to +17.5 pts** — far more than any budget increase bought.

---

