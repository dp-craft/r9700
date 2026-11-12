You are finishing the "Ornith-1.0-35B vs Gemma-4-31B-it-qat at 128k" benchmark in this repo. Follow the
repo's benchmark-results skill (read .claude/skills/benchmark-results/SKILL.md) and write the analysis to
docs/findings/quality/2026-07-19-0000-ornith-vs-gemma.md.

ALL the numbers are ALREADY aggregated deterministically — read ONLY:
  - campaigns/quality/2026-07-19-0000-ornith-vs-gemma/results/summary.md        (per-cell table + PER-REP detail + findings)
  - campaigns/quality/2026-07-19-0000-ornith-vs-gemma/results/appendix.md    (cell-level charts + data table)
  - campaigns/quality/2026-07-19-0000-ornith-vs-gemma/results/appendix-detailed.md  (per-task charts, if present)
DO NOT read outputs.jsonl / scores_*.jsonl — large per-reply logs; everything you need is in summary.md.
For design context you may skim campaigns/quality/2026-07-19-0000-ornith-vs-gemma/README.md, campaigns/quality/2026-07-19-0000-ornith-vs-gemma/eval-design.md, and docs/research/models-sampling/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md.

Write it to the skill's contract: TL;DR + results TABLE FIRST (a memory column is MANDATORY),
then detail. Every number comes from summary.md/appendix.md — tag MEASURED, mark reasoning INFERRED,
invent nothing. Read the cell matrix from configs.jsonl / summary.md, never from this prompt.

This is a TWO-MODEL comparison at ONE substrate (Vulkan · f16 KV · ub2048/b4096/fa on · ctx 163840 ·
depth ~120k · reasoning-budget 4096 · MTP OFF both). The two cells differ in model AND sampler (Ornith =
Qwen coding temp 0.6/top_k 20; Gemma = temp 1.0/top_k 64 — the vendor-recommended recipe for each, so the
comparison is "each model at its own recommended sampler", NOT a controlled sampler test — say so). Answer:
(a) quality per task on the TS-TDD suite (tsc + eslint + vitest; lint/types are FRACTIONAL error-count based),
(b) each local model vs the haiku/sonnet/opus reference ladder (per-task tier), (c) speed vs quality
(prefill/decode tok/s, think tokens, time-to-answer), (d) memory: VRAM/GTT at ctx 163840 — Gemma is UNGUARDED
(gguf_kv can't size gemma4), so its MEASURED VRAM is a first-class result; if summary.md's Health flags GTT
spill or grade_error/HARNESS rows or runaways, surface them prominently.

GEMMA CAVEAT (MANDATORY to check + report): Gemma's thinking format is <|channel>thought…<channel|>, NOT
<think>…</think>. capture.py splits on <think>, so Gemma's think/answer split (and think_tokens) may be WRONG.
State explicitly whether the split looked correct for Gemma (inspect a sample in outputs.jsonl if unsure) and
caveat any Gemma think-token/ttfa number accordingly.

UNCERTAINTY (MANDATORY — n=3 reps, 2 cells, ~9 tasks is UNDERPOWERED): read the "Uncertainty" section of
summary.md and quote sd/SE/CI and any paired test verbatim. Do NOT call a model "better"/"worse" unless a
paired Δ clears the significance threshold PRINTED in the table; report every comparison's verdict plainly,
name underpowering as the top limitation, recommend more tasks over more reps.

REFERENCE COMPARABILITY: the haiku/sonnet/opus references are one-shot on ~550-620 token prompts vs the local
cells' ~120k tokens (~200x deeper) — never state a bare local-vs-reference Δ as a like-for-like capability gap;
name both sides.

PER-REP DETAIL (MANDATORY): summary.md ends with per-task tables listing EVERY local rep + the reference
ladder — INLINE them verbatim under a "Per-rep results" section; do not collapse to means.

Include a <!-- meta --> block so docs/reindex.py can register it. This task is complete once the write-up
is written; your final answer is a one-line confirmation, e.g. "write-up written (2 cells)".
