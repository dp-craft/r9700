# The Free Lunch Hiding in Every Reasoning Model's Default Settings

Reasoning models think by default, and most of that thinking is waste. On Qwen3.6-27B we
capped the thinking budget and cut tokens and latency **40-55%** with **zero loss in verified
accuracy** — and runaway generations (the model thinking forever and never answering) dropped
from 7.1% to **0%**. If you're running a Qwen3/DeepSeek-style thinking model and haven't touched
`--reasoning-budget`, you're paying for tokens nobody reads.

## Why this isn't AMD-specific

We measured this on an AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB) running llama.cpp's
Vulkan backend (build b9950), because that's the box we have. But nothing about the finding is
hardware-specific — it's a property of how thinking-mode sampling works: the model generates a
chain-of-thought block, and by default nothing tells it when to stop except the model's own
judgment (or the context window). `--reasoning-budget` is llama.cpp's hard cap on that block —
once the budget is hit, the model is forced to answer. Any Qwen3.6-class or DeepSeek-style
reasoning model exposing this knob should show the same shape of curve.

The full setup: Qwen3.6-27B (dense, Q4_K_M), two GGUF builds — one with MTP (multi-token
prediction / speculative decode) on, one off — CTX 32768, KV cache f16, single-stream. 14 hard
agentic-coding tasks (11 deterministic auto-graded, 3 open-ended scored by a blind LLM judge,
seed 42, reps=1). Sampling per the Qwen3.6 model card: temperature 0.6, top_p 0.95, top_k 20,
min_p 0 (**CLAIMED**, not measured).

## The finding

Deterministic accuracy sits at **100%** at every capped budget we tested (512, 1024, 2048),
on both model builds. Capping the budget costs nothing on the tasks that have a verifiable
answer. What it buys back is tokens, latency, and — critically — an end to runaway generations.

| Config | budget | think tok | decode tok/s | ttfa (s) | det % | judge /5 | runaway % |
|---|---:|---:|---:|---:|---:|---:|---:|
| un-rb512 | 512 | 511 | 69.8 | 8.1 | 100 | 4.17 | 0 |
| un-rb1024 | 1024 | 1023 | 70.3 | 15.5 | 100 | **4.83** | 0 |
| un-rb2048 | 2048 | 1872 | 69.9 | 27.9 | 100 | 4.67 | 0 |
| jr-rb0 (uncapped) | ∞ | 1736 | 30.9 | 56.9 | 100 | 4.61 | 0 |
| un-nmax5 (uncapped) | ∞ | 2957 | 71.3 | 38.1 | 91 | 4.33 | **7.1** |
| un-pmin075 (uncapped) | ∞ | 3690 | 60.7 | 58.0 | 91 | 4.00 | **7.1** |

(`un-*` = unsloth build, MTP on; `jr-*` = jackrong build, MTP off. Full 10-row table in the
source campaign.)

Two things jump out. First, the open-ended judge score isn't a slope, it's a plateau: it rises
from 512 to 1024, then flattens and dips from 1024 through 2048 and uncapped. The best
open-ended score we measured, **4.83/5**, came from the *cheapest* capped budget that clears the
plateau (1024), not the most generous one. Second — and this is the counter-intuitive part —
**every uncapped config carries a 7.1% runaway rate** (1 of 14 tasks burns through the 8192-token
generation cap still thinking, never emits an answer). Every capped config, including the
smallest cap we tried, shows **0%**. The runaway isn't a model-quality problem you tune away with
better speculative-decode settings — it's a direct consequence of not having a cap at all.

Which leads to the gotcha worth flagging before anyone reaches for `--reasoning-budget 0`
expecting "no thinking mode": on this build, `0` doesn't mean off, it means *uncapped*. The
jackrong build's `rb0` run produced **1736** thinking tokens — more than its own `rb2048` run
(1262 tokens). The budget values that actually cap generation are monotone and well-behaved
(512 → 1024 → 2048), but `0` isn't a smaller cap, it's the absence of one. If you want a model
to skip thinking entirely, that's a different control — a chat-template `/no_think` switch or a
small nonzero cap — not `--reasoning-budget 0`.

<!-- Hero chart embed below; LinkedIn does not render SVG, export to PNG before posting there. -->
![Reasoning budget sweep: judge quality flattens while cost and latency keep climbing with the cap](../../campaigns/2026-07-13-27b-quality-tuning/charts/reasoning_budget_sweep.svg)

## How to apply it

```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
CTX=32768 NP=1 UB=2048 B=4096 FA=on KV=f16 MTP=1 \
EXTRA_ARGS="--reasoning-budget 1024" bash bench/engine-bench/serve_llamacpp.sh start
# client sampling: temperature 0.6, top_p 0.95, top_k 20, min_p 0
```

On these (shallow-prompt) tasks, **1024** is the cheapest point on the safe plateau: 100%
deterministic accuracy, top-band judge quality, 0% runaway, ~70 tok/s decode, ttfa ~15 s. If
you're deploying against real 10-50K-token agentic context rather than our ~50-100-token test
prompts, use **2048** as the depth-safe default — still fully capped, still 0% runaway in our
data, with more headroom for tasks that genuinely need to reason longer. Drop to 1024 only once
a depth-matched follow-up confirms it still holds.

## What we haven't proven yet

This is reps=1 data, so the fine ranking inside the plateau (1024 vs 2048, a judge-score gap of
a few tenths) is within noise — don't read this as "1024 is the proven quality peak." What *is*
robust across the data: 100% deterministic accuracy holds across the entire capped plateau (an
11-task signal, not a fluke), the drop at 512 is real (~0.6 judge points down on both builds),
and the uncapped runaway rate is consistent across all three uncapped cells we ran.

The bigger gap: every task in this campaign used a ~50-100 token prompt. The real target for
agentic coding is 10-50K tokens of context (system rules, file contents, prior turns), and the
optimal budget, instruction-following behavior, and KV-cache-quantization tradeoffs are all
untested at that depth. That's the next phase, not a settled question.

## Close

If your reasoning model's default is "let it think as long as it wants," you're leaving latency
and runaway risk on the table for free. Cap it, watch accuracy hold, and move on to the questions
that actually need more testing — like what happens at real context depth.

---
*Provenance: all performance/quality numbers are MEASURED on the R9700 (RDNA4, gfx1201) with
llama.cpp Vulkan b9950. Recommended sampling values are CLAIMED from the Qwen3.6 model card.
reps=1; blind LLM-judge on the open-ended tasks.*
