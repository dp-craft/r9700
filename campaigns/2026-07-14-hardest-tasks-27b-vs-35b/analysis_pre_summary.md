**Done — 210/210 replies captured, graded, judged, charted. `analysis.md` auto-written.** Nothing failed (`fails 0` across all 14 cells).

## The headline results

**The vendor presets are the worst settings we tested.** This is the most actionable finding and it's the one I'd least have predicted:

| cell | TS % | paired Δ vs Q4_K_M | verdict |
|---|--:|--:|---|
| `qwen-gen` (temp 1.0 / pp 1.5) | 62 | **−16.2** | **SIGNIFICANT** |
| `unsloth-reason` (temp 1.0 / top_p 1.0 / top_k 40 / pp 2.0) | 63 | −15.3 | not significant |
| `t03` (temp 0.3) | 70 | **−8.3** | **SIGNIFICANT** |

Only **two** of thirteen paired comparisons cleared significance, and both say the same thing: **deviating from temp 0.6 hurts.** Qwen's own documented "thinking mode for general tasks" preset costs ~16 points on hard coding work. The presence penalty is the likely culprit — both preset cells also collapse decode throughput (78 and 73 t/s vs ~120 for the same model at pp 0).

And temp 0.3 — the folklore setting you asked me to probe precisely *because* it's unsourced — is **significantly worse**, not better. The folklore is wrong.

**The budget axis moved almost nothing.** `un-rb16384` vs `un-rb4096` is Δ **+0.3** (per-task: −2, 0, 0, +1, +3 — the tightest, most boring result in the table). So yes, 4096 was truncating real reasoning (12/12 saturated), and yes, 16384 lets the model finish (~6.8k used) — **but finishing the thought doesn't improve the code.** It just costs 60s more per reply.

**The quant ladder is unresolvable at this power.** Q6_K 81% > Q4_K_M 78% > Q5_K_M 77% > Q4_K_XL 70%, but **not one** ladder comparison is significant. The digest is blunt about why: rep noise is 9.8 pts, and with 5 tasks the design resolves only ≳12 pts. Δ=10 needs ~15 tasks; Δ=5 needs ~60. **Reps don't help — task variance dominates.**

**Your instinct about 35B fluctuation was right, and rerunning does pay.** 35B rep sd **15.7** vs 27B **4.9** (3.2× noisier), range **11→95**. But that noise is harvestable: Δ rerun **+12.3**, and hard@R 20% vs hard@1 7%. The toolchain picks the winner, so it's a real strategy.

## Two things I must flag

**GTT spill in all 14 cells** — freeze risk, including the new f16 cells (Q5 f16 peaks 31.4 GB VRAM + 2.8 GB GTT, the worst of the set). Expected given the 95.9% load reading, but it's now measured everywhere.

**The `rbmax` finding contradicts my own earlier claim** — I said 4/5 tasks would be wasted. Wrong. Given unlimited budget the model chooses ~9.5k tokens; only one rep reached the wall. Running it as configured was correct.

## What's left

1. **Reference reps ×3 — still not collected** (45 answers). The digest currently cites haiku 83 / sonnet 87 / opus 92 from single reps, so those Δs have no error bars while every local cell does. This is the last data gap.
2. **`analysis.md` review + restructure** — it's auto-written; the budget-axis "out of scope" text needs rewriting, and the presets finding deserves to lead.
3. Nothing is committed yet — run data and analysis are unreviewed in the working tree.

Want me to collect the reference reps next, or review `analysis.md` first?
