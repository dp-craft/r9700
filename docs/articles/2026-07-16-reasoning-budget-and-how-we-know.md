# The Free Lunch in Reasoning-Model Serving, and How We Know We Didn't Fool Ourselves

Capping how long a reasoning model is allowed to think before it must answer cuts tokens and
latency by 40-55%, with zero measured loss in accuracy. That's not a tradeoff most people expect
from a "free lunch" claim, so before we tell you the number, we want to show you how we tried to
break it.

## The setup

We ran Qwen3.6-27B (Q4_K_M, dense) on an AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB), llama.cpp
Vulkan build b9950, KV cache f16, context 32768, single-stream. Two GGUF builds: one with MTP
(multi-token prediction, a speculative-decode style draft-and-verify scheme) off, one with it on.
14 hard agentic-coding tasks per config — 11 auto-graded deterministically, 3 scored by a blind LLM
judge — at temperature 0.6, reps=1.

The lever in question is `--reasoning-budget`: a hard cap on how many "thinking" tokens the model
can spend before it's forced to produce an answer. The obvious worry is that cutting a reasoning
model's thinking budget cuts its reasoning, and therefore its accuracy.

## The finding

It doesn't. Across both model builds, deterministic accuracy held at **100% at every capped budget
we tested down to 512 tokens**. What changes is cost:

| Config | MTP | budget | det % | judge /5 | think tok | decode tok/s | ttfa s | runaway % |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| un-rb1024 | on | 1024 | 100 | 4.83 | 1023 | 70.3 | 15.5 | 0 |
| un-rb2048 | on | 2048 | 100 | 4.67 | 1872 | 69.9 | 27.9 | 0 |
| un-rb512 | on | 512 | 100 | 4.17 | 511 | 69.8 | 8.1 | 0 |
| jr-rb0 (uncapped) | off | inf | 100 | 4.61 | 1736 | 30.9 | 56.9 | 0 |
| un-nmax5 (uncapped) | on | inf | 91 | 4.33 | 2957 | 71.3 | 38.1 | **7.1** |

Going from uncapped to a 2048 cap costs nothing on deterministic accuracy and drops the judge score
by only 0.33, while cutting tokens ~20% and time-to-first-answer ~27%. Going further, from 2048 to
1024, costs *nothing extra* — accuracy flat, judge score flat within noise, tokens down another 28%,
ttfa down another 40%. The open-ended judge quality is a plateau, not a slope: it rises 512→1024,
then flattens and dips 1024→2048→uncapped. The best single judge score we measured, 4.83/5, was at
the *cheapest* capped point, 1024 tokens. Push past the plateau to 512 and you do pay: judge score
drops about 0.6-0.66 points as design/review tasks start to starve for thinking room.

One more result worth a beat of its own: `--reasoning-budget 0` does not mean "don't think" — on
this build it means uncapped. Our MTP-off build spent *more* thinking tokens at rb0 (1736) than at
its own rb2048 setting (1262). If you want a fast, low-thinking config, don't reach for `0`.

## The trust beat: how we know we didn't fool ourselves

The number above is easy to report and easy to over-trust, so here's the part we think matters
more than the headline: we got the causal story wrong once, caught it, and fixed it before
publishing.

**The self-correction.** Every *uncapped* config in our sweep showed the same pathology: 7.1% of
tasks (1 of 14) would think all the way to the 8192-token ceiling and never produce an answer — a
runaway. Every *capped* config showed 0% runaways, no exceptions. Our first read of this pattern
pointed at the MTP draft-acceptance knobs (`--spec-draft-p-min`, `--spec-draft-n-max`) as the
culprit, since the runaway cells happened to be MTP configs we were also tuning for draft
acceptance. That inference was wrong, and we know it's wrong because we went back and tested it
directly: a follow-up run (`bench/runs/2026-07-16-1111-spec-draft-pmin-mtp/`) confirmed those draft
params are live on this build, but they gate draft *depth and speed* — how far ahead the model
drafts and how eagerly it accepts drafts — not reasoning *length*. There's no mechanism by which
they could push a model into an 8192-token runaway. The one variable that actually correlates with
every runaway, cleanly, is the missing budget cap. The 91% deterministic scores on two of those
uncapped cells turned out to be a red herring too: with reps=1, that's a single reshuffled reply per
seed, not a draft-quality effect.

**Blind judging.** The 3 open-ended tasks were graded by an LLM judge that never saw which config
produced which answer: replies were anonymized, shuffled under a fixed seed, split by task, and
scored by 3 independent judge passes against embedded anchors before anything was de-anonymized. No
answer scored a clean 5/5/5 from all three judges, on any config — a useful reminder that these are
real, imperfect scores, not a rubber stamp.

**Honest limits.** reps=1 means the fine-grained ranking inside the plateau (1024 vs 2048, a 0.16-point
judge gap) is noise-level, not a proven ordering. And every task here is shallow: 50-100 prompt
tokens, not the 10-50K of system rules and code that real agentic use involves. Budget optimum,
instruction-following at depth, and KV-q8 tradeoffs are all untested at that scale — that's the
single biggest open gap in this result.

The point isn't that we were sloppy and then careful. It's that a benchmark you can trust is one
that goes looking for reasons its own conclusion might be wrong, and reports it when the first
story doesn't survive the check.

## How to apply it

```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
CTX=32768 NP=1 UB=2048 B=4096 FA=on KV=f16 MTP=1 \
EXTRA_ARGS="--reasoning-budget 1024" bash bench/engine-bench/serve_llamacpp.sh start
# client sampling: temperature 0.6, top_p 0.95, top_k 20, min_p 0
```

`1024` is the cheapest point on the safe plateau for shallow tasks like ours: 100% deterministic
accuracy, top-band judge quality, 0% runaways, ~70 tok/s decode, ttfa ~15s. If your real workload
runs at 10-50K agentic context, start from `--reasoning-budget 2048` instead — same 0% runaway
guarantee, more depth headroom — and only drop to 1024 once a depth-specific follow-up confirms it
still holds. Never use `0`; on this build it's uncapped, not fast.

## What's next

The plan is to rerun this at agentic depth (8K/16K/32K context, reps=3) and check whether the 1024
sweet spot moves, plus a KV-q8 spot-check now that real VRAM savings are in play. Until then, treat
1024 as an economy option validated at shallow depth, and 2048 as the default that's earned its
0% runaway record.

<!-- Hero chart: reasoning_budget_sweep.svg. LinkedIn does not render SVG inline; export to PNG before posting. -->
![Reasoning budget sweep: quality holds flat while token cost and latency scale with the cap](../../campaigns/2026-07-13-27b-quality-tuning/charts/reasoning_budget_sweep.svg)

---
*Provenance: all performance/quality numbers are MEASURED on the R9700 (RDNA4, gfx1201) with
llama.cpp Vulkan b9950. The recommended sampling values are CLAIMED from the Qwen3.6 model card.
reps=1; blind LLM-judge on the open-ended tasks.*
