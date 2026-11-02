# Grader prompt (Opus 5.5 subagent, 2026-10-31 18:35 UTC, 3-way: r191-sharp-d0, r191-sharp-d05, anchor redhat-d0-sharp)

Package: `BLIND_SEED=4413 python3 -I make_blind.py pkg r191-sharp-d0=… r191-sharp-d05=… redhat-d0-sharp=…` (labels W/X/Y,
`ref/` copied from blind-grading-d0/pkg/ref, key in key.json). Same text as the 4-way prompt with the label set, the count words and
the package path changed (the 4-way pass was split because the sharp-sly2 arm was still running; the anchor sits in every pass).

---
You are a blind grader. Three anonymous blind code-plan reviews (labels W, X, Y) of the same implementation brief were written by three different local LLM configurations; you do not know which is which and must not try to find out. Grade all three with the SAME rubric against a reference review written by a stronger model (Opus). The reference is the yardstick, not ground truth: a review finding the reference lacks can still be real.

## Package (everything you need is here)
`P=/tmp/claude-1001/-home-dev-work-dp-craft-amd/6f8d6240-352f-45b7-9728-39b26e7c32f7/scratchpad/blind3w/pkg`
- `$P/ref/W2-08.brief.md` — the brief under review (brief W2-08). `<WT>` = the repo worktree root.
- `$P/ref/opus-W2-08.md` — the reference (Opus) review; `$P/ref/findings-W2-08.tsv` — its 19 numbered findings (brief, n, sev, item, problem): 6 high, 7 med, 6 low.
- `$P/{W,X,Y}/review.md` — the three reviews; `$P/{W,X,Y}/probes/` — each review's own probe files (they were at `/tmp/dp-refine/W2-08/` when written; `<WT>` = worktree root). Probe outputs are mostly quoted inside the reviews.
- Code + plan docs: the git repo `/home/dev/work/dippe/dp-forge` at commit `de110510` (the commit every review was written against). Read it with `git -C /home/dev/work/dippe/dp-forge show de110510:<path>` (authoritative; the main checkout may have local changes). Plan docs: `docs/plans/2026-10-28-2239-dpf-tui-f0-f1/{00-plan.md,01-writer-brief.md,02-contracts.md,03-review-protocol.md,04-check-method.md,wave-2-dpf-cli.md}` and `briefs/*.md` at that commit. The brief's stated base is 36ffe5b4; you can check whether a path changed between the two commits with `git -C /home/dev/work/dippe/dp-forge diff --stat 36ffe5b4 de110510 -- <path>`. You may run tsc/eslint/vitest probes yourself in a scratch dir under `/tmp/claude-1001/` (symlink `/home/dev/work/dippe/dp-forge/node_modules` if needed) — never modify dp-forge.

## Hard rules
- Do NOT open anything under `/home/dev/work/dp-craft/amd/bench/runs/`, `/home/dev/work/dp-craft/amd/campaigns/`, `/home/dev/work/dp-craft/amd/docs/`, `~/.claude/projects/`, any other `scratchpad/` directory than `blind3w/pkg`, or any `key.json` — they contain earlier grades and the label key; reading them would break the blinding. Everything needed is in `$P` and dp-forge.
- Same rubric for all three; grade finding-by-finding, quote evidence.

## Rubric
1. **Opus coverage.** For each review, map its findings to the 19 Opus findings. Matching rule: same defect at the same brief item = match; same section but a different defect = no match. Several review findings may map to one Opus finding; one review finding may match two Opus findings only if it explicitly names both defects. Note severity disagreements (review sev vs Opus sev).
2. **Review-only findings** (not among the 19): verdict `real` / `wrong` / `unverifiable`, your severity (high/med/low/trivial), and evidence (file:line at de110510, brief line, or a probe result you re-ran).
3. **False claims**: factual statements in the review (about code, brief, probes) that are wrong even if not framed as a finding — list them; they count against precision.
4. Per review compute: Opus found n/19, high n/6, med n/7, low n/6; severity-weighted Opus coverage (high 3 · med 2 · low 1, max 38); review findings total; matched; real review-only; wrong; unverifiable; precision = (findings that are matched or real) / total findings.
5. 3-5 line qualitative judgement per review (depth of verification, probes actually run vs. claimed, actionable fixes), and a ranking W/X/Y with your confidence and what would change it. Also say explicitly which pairs are too close to separate.

## Output
Write `$P/../grading-blind.md` (English; summary table first, then per-review mapping tables with evidence, then review-only findings, false claims, judgement) and `$P/../grades.json` (`{"W": {"opus_found": [..numbers..], "high": n, "med": n, "low": n, "weighted": n, "findings_total": n, "matched": n, "real_only": n, "wrong": n, "unverifiable": n, "precision": f, "false_claims": n, "map": {"<review #>": [opus #...] or "real"|"wrong"|"unverifiable"}}, "X": …, "Y": …, "ranking": [...], "confidence": "...", "too_close": [...]}`). Report back a compact summary: the summary table, the ranking with confidence, and anything that made grading ambiguous.
