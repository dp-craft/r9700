## Capability vs the reference ladder — and what "tier" actually means

**⚠ Read this before quoting any local-vs-reference number.** The references are **one-shot on ~550–620-token prompts**; every local cell answered the same task carrying **~132.9k tokens (~213× deeper)**. Both sides are now n=3 (the ladder was re-collected at 3 reps — `README` §5c) and the ladder is now **complete**: all three tiers cover all five tasks. But **depth is not matched**, so a bare Δ is not a capability gap. It compares *"can you write this cold?"* against *"can you write this after reading 133k tokens of someone else's codebase?"*

**Reference means (MEASURED, `calibration-reps.jsonl` via the digest, 5 tasks × 3 reps):** haiku **81** · sonnet **91** · opus **94**. **Best local cell: 81** (Q6_K, 80.9).

- The best local configuration lands **level with haiku's one-shot mean** while carrying 213× the context, and **~10 pts below sonnet / ~13 below opus** — but those are answers to different questions and must not be subtracted from each other.
- **The 3-rep ladder overturned the n=1 readings — the strongest argument in this campaign for reps.** The previous analysis, built on single reference samples, reported `lru-cache` as a *ceiling* task (nobody hard-passes) and `async-memo` as *opus-confirmed*. With 3 reps:
  - `lru-cache` is **not** a ceiling task: **sonnet hard-passes 1/3** (96%), while **opus hard-passes 0/3** (93%).
  - `async-memo`: **opus 0/3**, **sonnet 1/3** — the label says `opus`, the data says `sonnet`.
  - An n=1 ladder was reading coin flips as tiers.

**Tier semantics — the label vs the measurement (MEASURED, from the digest headers):**

| task | label | measured weakest hard-pass | haiku | sonnet | opus | verdict |
|---|---|---|---|---|---|---|
| `lru-cache` | `sonnet` | **sonnet** | 83% ✗ 0/3 | 96% ✓ **1/3** | 93% ✗ 0/3 | **confirmed** |
| `rate-limiter` | `sonnet` | **sonnet** | 90% ✗ 0/3 | 97% ✓ **1/3** | 97% ✗ 0/3 | **confirmed** |
| `async-memo` | `opus` | **sonnet** | 82% ✗ 0/3 | 93% ✓ **1/3** | 90% ✗ 0/3 | ⚠ **CONTRADICTED** — label too hard |
| `expr-eval` | `opus` | **NONE (ceiling)** | 65% ✗ 0/3 | 81% ✗ 0/3 | 93% ✗ 0/3 | ⚠ **unconfirmed** — no reference hard-passes it; it is *at least* opus-hard |
| `pricing-deferred` | `opus` | **sonnet** | 85% ✗ 0/3 | 86% ✓ **1/3** | 98% ✓ **1/3** | ⚠ **CONTRADICTED** — label too hard |

- **TIER is a difficulty class, not a score band.** A task can be `tier opus` while every model scores 60–90% on partial credit — the tier names the weakest reference tier that produces a **strictly clean** reply, nothing else.
- **2 of 5 labels are confirmed; 2 are contradicted; 1 is a ceiling.** The two contradicted labels should be corrected to `sonnet` in `tasks.jsonl`; `expr-eval`'s should stay `opus` with an explicit "≥" (nobody clears it).
- **Every single reference hard-pass in this campaign is 1/3.** Not one of the 15 (model, task) reference pairs hard-passes 2/3 or 3/3. **INFERRED:** at the strictness of this gate, even frontier models are *sampling* for a clean run rather than reliably producing one — the same "reruns pay" result we measure locally, seen from the top of the ladder.
- **`expr-eval` is the campaign's true ceiling** (opus 93% but 0/3 clean; local cells 29–67). It is the one task that discriminates at the top, and the one where the 35B produced the campaign's worst reply (11%).

![Capability](charts/capability.svg)

> The dashed reference bands are **one-shot at ~550–620 tokens**; the bars are at ~132.9k. Not a like-for-like comparison — read the bands as orientation, not as a target line. MEASURED.

---

