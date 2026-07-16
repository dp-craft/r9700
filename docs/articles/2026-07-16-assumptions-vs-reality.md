# Four Things We Were Wrong About Before We Ran the Benchmark

We tuned reasoning-budget and speculative-decode settings for Qwen3.6-27B on an
AMD R9700, and the most useful output wasn't the tuning recommendation. It was watching four
assumptions we walked in with get disproven, one at a time, by the numbers. Here's what we
believed, what the box actually showed, and the one assumption that survived.

## The setup, briefly

Qwen3.6-27B (Q4_K_M, dense), llama.cpp on Vulkan (build b9950), on an AMD Radeon AI PRO R9700
(RDNA4, gfx1201, 32 GB). Two GGUF builds: one with MTP (multi-token / speculative decode) on,
one with it off. 14 hard agentic-coding tasks, seed 42, `max_tokens 8192`, reps=1 — 11
deterministic auto-graded tasks plus 3 open-ended tasks scored by a blind LLM judge (anonymized,
shuffled, three independent judges, no judge saw config identity). The lever under test:
`--reasoning-budget`, a hard cap on thinking tokens before the model has to answer.

Four things we assumed going in didn't survive contact with the data.

## Assumption 1: "budget 0 means no thinking"

**Reality: 0 means uncapped, and uncapped produced the *most* thinking of any config we ran.**

`--reasoning-budget 0` reads like "off." It isn't. On the jackrong (MTP-off) build, `rb0`
emitted **1,736 thinking tokens** — more than its own `rb2048` config (1,262 tokens), and more
than the entire 2048-token cap we thought was generous. The 512/1024/2048 caps behave exactly as
you'd expect (monotone, obeyed). Zero does not join that ladder — it removes it. If you want a
model that doesn't think, `--reasoning-budget 0` is not the knob; you need a different control
(chat-template `/no_think` or a small nonzero cap). Practical takeaway: never reach for `0`
expecting speed.

## Assumption 2: "MTP draft tuning caused the runaway replies"

**Reality: no. Every uncapped config ran away at the same rate, regardless of draft settings.**

This is the one we got wrong in print first and had to correct. Three uncapped configs — varying
`--spec-draft-n-max` and `--spec-draft-p-min` (parameters that govern how deep/aggressive the
speculative-decode draft head gets before falling back to the base model) — all showed the same
**7.1% runaway rate**: 1 of 14 tasks thinks straight through to the 8192-token cap and never
produces an answer. Every capped config, across both builds and all three budget levels, showed
**0%**.

Our first read was that the draft-acceptance parameters were "backfiring" — tuning them to be
more aggressive was correlated with the runaways, so we called it causal. A follow-up test
(`bench/runs/2026-07-16-1111-spec-draft-pmin-mtp/`) refuted that story: those draft parameters
are live — they measurably change decode behavior — but what they gate is draft *depth and
speed*, not reasoning *length*. There's no mechanism by which they'd push a model into thinking
to the token cap. The one variable that actually predicts a runaway is whether the thinking
budget is capped at all. The 91% deterministic scores on two of the draft-tuned cells turned out
to be an n=1 reshuffle artifact — RNG realignment changing which single reply a seed lands on,
not a quality effect of the draft settings. The fix for runaways is the budget cap. It was never
the draft knobs.

## Assumption 3: "the built-in runaway flag will catch this"

**Reality: it under-counted to zero, on the exact cells where runaways were happening.**

llama.cpp reports a `truncated_thinking` flag. On the three uncapped cells that our own signal
flagged at 7.1%, the built-in flag reported **0%**. We now grade runaways explicitly:
`finish_reason=length ∧ ¬has_answer` — the model hit the token ceiling and never got to a
verifiable answer. That's the signal that caught what the built-in flag missed. If you're
relying on the framework's own truncation flag to tell you when a reasoning model is spinning,
check it against an explicit answer-presence signal before you trust the zero.

## Assumption 4 (the strawman): "we should re-test temperature 1.0"

**Reality: already answered, and the correct-temperature finding closes the question.**

Before this test we half-suspected sampling temperature was implicated in the runaway behavior —
maybe a higher temperature was letting the model wander. We didn't need to burn a run on temp
1.0 to check: the causal finding above already answers it. Runaways happen at **temperature
0.6** — the model card's recommended, "correct" setting — whenever the budget is uncapped. The
pathology isn't a sampling-temperature problem waiting to be confirmed at a worse temperature; it
already reproduces at the sane one. We left the temp-1.0 run un-run as a known-bad strawman
rather than spend GPU time confirming something the data already ruled out.

## What still holds, and what to do with it

None of this changes the headline result: capping `--reasoning-budget` is close to a free lunch.
Deterministic accuracy holds at **100%** across every capped budget ≥512 on both builds, tokens
and latency drop **40–55%** as you cut the cap, and runaways go to **0%** the moment a cap
exists. The plateau is real — accuracy doesn't move, judge quality just flattens after ~1024 —
the assumptions that turned out to be wrong were about *why* things were failing, not about
whether the fix works.

Recommended config:

```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
CTX=32768 NP=1 UB=2048 B=4096 FA=on KV=f16 MTP=1 \
EXTRA_ARGS="--reasoning-budget 1024" bash bench/engine-bench/serve_llamacpp.sh start
# client sampling: temperature 0.6, top_p 0.95, top_k 20, min_p 0
```

`1024` is the cheapest point on the safe plateau for these (shallow) tasks. For real 10-50K
agentic context, use `--reasoning-budget 2048` as the depth-safe default until a depth follow-up
confirms 1024 holds further out.

![Reasoning-budget sweep: quality flat, cost and latency scale with the cap](../../campaigns/2026-07-13-27b-quality-tuning/charts/reasoning_budget_sweep.svg)
<!-- LinkedIn does not render SVG inline; export this chart to PNG before posting. -->

## What we haven't proven

- **reps=1.** The fine ranking within the plateau (1024 vs 2048 judge deltas of roughly 0.3) is
  within noise for a single repetition. What *is* robust across the data: 100% deterministic
  accuracy across the whole capped plateau (an 11-task signal), the quality drop at 512
  (~0.6 points), and the uncapped runaway rate (consistent across all three uncapped cells). The
  1024 recommendation rests on economy on a safe plateau, not on a proven quality peak.
- **Shallow prompts only.** Every task here runs on roughly 50-100 prompt tokens. The real target
  is 10-50K of agentic context (system rules plus code). Whether the optimal budget,
  instruction-following at depth, and KV-cache quantization tradeoffs hold at that scale is
  untested — it's the single biggest open gap in this result.
- **10 of 13 planned configs ran.** Three were skipped deliberately (a temp-1.0 strawman,
  temp-0.7, a KV-q8 spot-check) because the causal picture above already answered what they'd
  have shown, or the payoff was marginal.

The point of running a benchmark isn't just to confirm the thing you expected. It's to find the
assumption that's wrong before it ships in a config file. We tag every number here MEASURED (our
box), CLAIMED (the model card's sampling recommendation), or INFERRED (reasoned, stated as such)
for exactly this reason — provenance is what lets a wrong causal story get caught and corrected
in public instead of quietly compounding.

---

*Provenance: all performance/quality numbers are MEASURED on the R9700 (RDNA4, gfx1201) with
llama.cpp Vulkan b9950. The recommended sampling values are CLAIMED from the Qwen3.6 model card.
reps=1; blind LLM-judge on the open-ended tasks.*
