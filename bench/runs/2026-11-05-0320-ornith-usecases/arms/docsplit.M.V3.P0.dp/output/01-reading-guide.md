## 1. Reading guide

| Term | Meaning here |
|---|---|
| **σ** (sigma) | Sample standard deviation of the per-iteration wall-clock inside one block. Small σ = the runs took similar time; large σ = the same configuration sometimes takes twice as long. Computed over n=3, so σ is itself a rough estimate |
| **CV** | Coefficient of variation = σ ÷ mean, as a percent. Makes spread comparable between a 200 s model and a 550 s model. CV 5 % = tight and predictable; CV 35 % = a single run tells you little |
| **Within-block variance** | Spread of the 3 iterations inside one n=3 block — same loaded server, same session. This is what σ/CV measure |
| **Between-block variance** | Difference between two separate n=3 blocks of the *same* model — separate model load, separate session. Measured here for the first time, and it is the larger term |
| **true-green** | Verified four ways: runner reports `completed`, target file actually changed, expected symbol present, and an independent re-run of the discriminating test passes |
| **`unverified`** | Phase-1 `impl`-mode success: all gates clean, no red→green test proof exists. **Not a failure** |
| **`failed` / `local-exhausted`** | Real failures. `local-exhausted` = the escalation ladder ran out of attempts |
| **Input tokens** | Cumulative prompt tokens across every attempt and drive — dominated by re-prefill per round, so it measures *round count*, not task size |
| **Generated tokens** | What the model actually emitted. The closest thing to "how much work did it do" |

**Token costs are only comparable within an arm type.** The runner reports input and generated separately; the Claude arms report `subagent_tokens`, a cumulative prompt+completion figure that includes cache reads. Wall-clock and green rate are comparable everywhere.

---

