## The strict-code wall — cleanliness, not logic

**MEASURED, mean fractional objectives across cells:** `lint` **0.36** · `types` **0.47** · `tests` **0.84** · `edge` **0.87** · `reuse` **0.99**.

- The models get the **logic** substantially right (tests 0.84) and reuse the provided abstractions almost perfectly (0.99). They fail on **strict `eslint`/`tsc` cleanliness**.
- **Nothing in this campaign moves the wall.** Not precision (the ladder is a null), not capacity (35B Δ−5.1, ns), not thinking budget (Δ+0.3), not sampling (the best sampling cell still hard-passes 7%).
- **`hard_pass` and partial credit are different questions, and the per-rep tables prove it.** On `async-memo`, the 35B's rep 0 scored **95 ✗** and its rep 2 scored **94 ✓** — a *lower* score that hard-passes and a *higher* score that does not. A 97%-scoring `rate-limiter` reply with judge 4·4·4 missed hard-pass on **one lint error** (lint 0.80).
- **The wall binds the references too — including opus.** Opus's per-task `lint` runs **0.53 / 0.80 / 0.40 / 0.60 / 0.87** and opus hard-passes **1 of 5** tasks (`pricing-deferred`, 1/3). Sonnet, which scores *lower* on partial credit than opus on 3 of 5 tasks, hard-passes **4 of 5**. **INFERRED and consequential: our `hard_pass` gate is dominated by eslint pedantry that does not track model capability monotonically.** It is a good "would you merge this as-is" proxy and a poor capability ruler. Read `hard_pass` as a workflow statistic, not as a ranking.

![Objective breakdown](charts/objective_breakdown.svg)

> Inline because it is the wall itself: lint/types short, tests/edge/reuse tall, in every cell. MEASURED, all 14 cells.

---

