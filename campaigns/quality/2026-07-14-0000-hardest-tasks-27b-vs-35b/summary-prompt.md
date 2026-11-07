You are finishing the "hardest-tasks: 27B quant ladder vs 35B-A3B at 128k" benchmark in this repo. Follow the
repo's benchmark-results skill (read .claude/skills/benchmark-results/SKILL.md) and write the analysis to
docs/findings/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b.md.

ALL the numbers are ALREADY aggregated deterministically — read ONLY:
  - campaigns/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b/results/summary.md        (per-cell table + PER-REP detail + findings)
  - campaigns/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b/results/appendix.md    (cell-level charts + data table)
  - campaigns/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b/results/appendix-detailed.md  (per-task charts, if present)
DO NOT read outputs.jsonl / scores_*.jsonl / judge_scores.jsonl — large per-reply logs; everything you
need is in summary.md. For design context/glossary you may skim campaigns/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b/README.md and campaigns/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b/eval-design.md.

Write it to the skill's contract: TL;DR + results TABLE FIRST (a memory column is MANDATORY),
then detail. Every number comes from summary.md/appendix.md — tag MEASURED, mark reasoning INFERRED,
invent nothing. Cover the campaign's questions exactly as summary.md's "Findings" lists them:
(a) the 27B QUANT LADDER Q4_K_M->Q4_K_XL->Q5_K_M->Q6_K on the 4 hardest tasks (does higher precision clear
the strict-lint/types wall, or is the wall real capability? note lint/types are now FRACTIONAL = error-count
based, so cleanliness has resolution), (b) 27B (best quant) vs 35B-A3B (does the bigger MoE clear the wall
that precision does not — capacity vs precision?), (c) capability per task vs the haiku/sonnet/opus ladder,
(d) speed vs quality (generation tokens/time). NOTE KV is NOT uniform: the two ORIGINAL Q5_K_M/Q6_K cells run
q8_0 KV, the others f16 — so treat a q8_0-vs-f16 quant-ladder delta as weight-quant PLUS a small KV effect
(f16-vs-q8 is within the prior ≤5% rule). The 2026-07-15 extension ADDED a Q5_K_M f16 cell precisely to remove
that confound: Q5_K_M at f16 @ctx 163840 was MEASURED to fit, so the old "their weights are too heavy for f16"
claim is DEAD — prefer the f16-vs-f16 comparison where one exists, and say which pairing you used. If
summary.md's Health flags GTT spill, surface it.
SCOPE — all THREE axes are in scope and must be analyzed: (1) the quant ladder, (2) the REASONING-BUDGET axis
(4096 / 16384 / -1 unlimited), (3) the 35B SAMPLING sweep (temp 0.3 / 0.6 / 1.0 plus two vendor presets).
An earlier version of this prompt said "all cells share reasoning-budget 4096 (the budget sweep is a separate
follow-up campaign — do NOT analyze it)" — that is OBSOLETE and would silently drop most of the matrix; the
cells are in configs.jsonl and summary.md. Read the matrix from the data, never from this prompt.
NOTE the grader FIX: this run used single-process vitest + a fail-loud grader + a pre-grade self-check,
so tests/edge are trustworthy (the previous run's tests/edge=0 was a harness bug). If summary.md's Health
line flags grade_error/HARNESS rows, runaways, or GTT spill, surface them prominently.

UNCERTAINTY (MANDATORY — this design is UNDERPOWERED; do not present noise as shape): summary.md has an
"Uncertainty" section with per-cell sd/SE/95% CI, the rep noise, and a PAIRED-by-task t-test vs Q4_K_M.
READ EVERY NUMBER FROM THAT SECTION. Do NOT copy a Δ, t, sd, CI, resolution or task-count out of this
prompt: they go stale the moment the matrix grows, and they HAVE — this paragraph kept asserting the
4-task/5-cell era ("35B-A3B -7.4 t=-3.11 is the ONLY near-significant signal") long after the matrix reached
5 tasks / 14 cells, which the current data contradicts outright. Rules, not numbers:
(1) do NOT rank the quants or call any cell "best"/"worst" unless its paired Δ clears the significance
threshold PRINTED in the table; (2) state (a) as a BOUNDED NULL RESULT — "no detectable precision effect;
any effect is smaller than our resolution" (quote the resolution from the Power line) — and note that a
non-monotonic ordering is exactly what noise looks like: it does not prove precision is useless, it fails to
detect an effect; (3) report EVERY comparison whose verdict is SIGNIFICANT, and say plainly which are not —
do not inherit yesterday's "only signal" from this prompt; (4) quote every Δ with its verdict; (5) name
underpowering as the top limitation and recommend MORE TASKS (per the Power line), not more reps
(task-to-task variance dominates).

TIER + REFERENCE COMPARABILITY (MANDATORY): TIER is a DIFFICULTY CLASS = the weakest REFERENCE tier that
yields a strictly-clean hard_pass. It is NOT a score band — a task can be tier opus while everyone scores
60-90% on partial credit. EXPLAIN this where the ladder is discussed.
DERIVE every tier claim from the MEASURED per-task evidence in summary.md (references now carry 3 reps, so
hard_pass is reported as k/n). Do NOT assert a pre-baked tier conclusion from this prompt, from tasks.jsonl's
label, or from an older draft. This paragraph USED to hardcode conclusions from the n=1 ladder and the 3-rep
ladder (2026-07-15, run_refs.sh) OVERTURNED them: on async-memo opus now hard-passes 0/3 while sonnet passes
1/3 (the old single opus 100% was one lucky roll), and lru-cache is NOT a ceiling task (sonnet passes 1/3).
Treat that as the standing warning: a single sample decided a "tier" and was wrong. Where a tasks.jsonl label
disagrees with the measured k/n, report the disagreement and flag the label — in either direction.
The references are still NOT depth-matched: one-shot on a ~550-620 token prompt vs the local cells' ~132.9k
tokens (~213x deeper). Reps fixed the sampling noise, NOT this asymmetry. So for (c)/(d): never state a bare
local-vs-reference Δ as a like-for-like capability gap. The defensible reading names both sides, e.g. "level
with haiku within noise, while carrying ~213x more context" — which if anything favours the 27B. The
binary->fractional re-grade correction REMAINS VALID (the old ladder's "27B beats sonnet" reading is dead).

PER-REP DETAIL (MANDATORY — the user wants to see all reps, not just means): summary.md ends with a
"Per-rep detail" section — one table per hardest task listing EVERY local rep (rep 0/1/2, full objective
vector), a mean row, and the haiku/sonnet/opus one-shot references in the same columns. INLINE these
per-task tables VERBATIM in the write-up under a "Per-rep results (all 3 reps + reference ladder)" section —
do NOT collapse them to means. Call out rep-to-rep spread where reps disagree, and note any `— (no calib)`
reference gaps (e.g. opus on lru-cache/rate-limiter, README add-on D).

JUDGE DETAIL: appendix.md ends with the full blind-judge verdict table + "Judge mean by task". Add a
"Judge verdicts" section: (1) per-cell judge d.c.r means from summary.md, (2) quote 3-5 most informative
notes VERBATIM (worst + best), (3) the "Judge mean by task" line, (4) link to appendix for the full table.

Include a <!-- meta --> block so docs/reindex.py can register it. This task is complete once the write-up
is written; your final answer is a one-line confirmation, e.g. "write-up written (N cells)".
