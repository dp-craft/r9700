# A 27B coding model, one AMD card, and the setting that gives you 2.25x for free

Local inference on a dense 27B coding model doesn't require an NVIDIA card or a
multi-GPU rig. On a single 32 GB AMD Radeon AI PRO R9700 (RDNA4) we ran Qwen3.6-27B
(Q4_K_M) through llama.cpp's Vulkan backend and found a build combination that
delivers 70 tok/s decode at 100% task accuracy, with more than half the card's VRAM
still free. The lever that gets you there costs nothing: it's a build choice (MTP),
not a quality trade-off.

## The box

- GPU: AMD Radeon AI PRO R9700 -- RDNA4, gfx1201, 32 GB (~31.86 GiB usable)
- Stack: ROCm 7.x, `HSA_OVERRIDE_GFX_VERSION=12.0.1`, Ubuntu 24.04, kernel 6.17
- Runtime: llama.cpp, Vulkan backend, build b9950
- Model: Qwen3.6-27B, Q4_K_M (dense, not MoE)
- Substrate: KV cache f16, `-ub 2048 -b 4096 -fa on`, context 32768, single-stream

Nothing exotic. This is a single consumer/workstation-class AMD card with a stock
ROCm 7.x install, running a real dense 27B coding model at usable throughput. The
"AMD can't do local LLM inference seriously" assumption doesn't hold up here.

## The finding: MTP is a pure win, not a trade-off

We tested two GGUF builds of the same model at the same quant, same context, same
sampling: one with MTP (multi-token prediction -- llama.cpp's on-board speculative
decode, draft tokens generated and verified in the same pass) off, one with it on.
Everything else in the substrate was held fixed.

| Build | MTP | reasoning-budget | decode tok/s | det. accuracy | judge score /5 |
|---|---|---:|---:|---:|---:|
| jackrong | off | 1024 | 31.1 | 100% | 4.56 |
| unsloth  | on  | 1024 | **70.3** | 100% | **4.83** |

Same accuracy. Same budget. The MTP build decodes at **2.25x** the speed (70 vs 31
tok/s) and posted the single best judge score across the entire sweep. Across the
matched-budget comparison, MTP on vs off cost zero accuracy, added +0.1 to +0.2 to
the judge score, and added essentially nothing to token count. There is no quality
tax for the speed. That combination -- more speed, equal or better quality, on the
same 27 GiB-class card -- is rare enough to call out on its own.

The cost of turning MTP on: about 1.6 GiB more VRAM for the draft layer and buffers,
and roughly double the GTT host-staging traffic. Against a 32 GB card, both are
trivial. VRAM peaked at 18.7 GiB (MTP off) and 20.7 GiB (MTP on) -- more than 11 GiB
free throughout, no spill to system memory, no thermal throttling (average power
294-299 W across the runs).

![Reasoning-budget sweep: quality holds flat while cost and latency scale with the cap](../../campaigns/2026-07-13-27b-quality-tuning/charts/reasoning_budget_sweep.svg)
<!-- LinkedIn does not render inline SVG. Export reasoning_budget_sweep.svg to PNG before posting. -->

## The tuning payoff: cap the thinking budget

MTP buys you speed. `--reasoning-budget` (a hard cap on how many thinking tokens the
model can spend before it must answer) buys you economy, and on this box it was
close to a free lunch: deterministic accuracy stayed at 100% at every capped budget
we tested (512 and up), on both builds. Cutting the budget cut tokens and latency by
40-55% with zero accuracy loss. Uncapped runs, by contrast, showed a 7.1% runaway
rate -- one task in fourteen thinks straight through the 8192-token ceiling and never
answers. Every capped configuration we ran showed 0% runaways.

Quality across the capped range is a plateau, not a slope: it rises from 512 to
1024, then flattens and dips slightly from 1024 through 2048 to uncapped. The best
judge score we measured was at ~1024 tokens (4.83, MTP on).

## How to apply it

```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
CTX=32768 NP=1 UB=2048 B=4096 FA=on KV=f16 MTP=1 \
EXTRA_ARGS="--reasoning-budget 1024" bash bench/engine-bench/serve_llamacpp.sh start
# client sampling: temperature 0.6, top_p 0.95, top_k 20, min_p 0
```

`1024` is the cheapest point on the safe plateau for the shallow tasks we tested:
100% deterministic accuracy, top-band judge quality, 0% runaway, ~70 tok/s decode,
time-to-first-answer ~15 s, ~20.3 GiB VRAM. For real agentic work with 10-50K tokens
of context (system rules, pulled-in code, longer tool chains), use `--reasoning-budget
2048` as the default -- it keeps the same 0% runaway floor with more depth headroom
-- and drop to 1024 only once a depth-specific follow-up confirms the plateau still
holds at that context length.

## What we haven't proven yet

Three honest gaps, worth stating plainly rather than glossing over:

- **reps=1.** The fine-grained ranking inside the plateau (1024 vs 2048, a judge
  delta of a few tenths) is within noise at one repetition per config. What *is*
  robust across the run: 100% deterministic accuracy across the whole capped
  plateau (an 11-task signal), the quality drop at 512, and the uncapped runaway
  rate, which was consistent across all three uncapped cells.
- **Shallow prompts only.** Every task in this sweep used roughly 50-100 prompt
  tokens. The real target -- 10-50K tokens of agentic context -- is untested, and
  the optimal budget, instruction-following at depth, and whether KV-cache q8_0
  becomes worth the accuracy trade all likely shift once context gets long. This is
  the single biggest open question from this round.
- **10 of 13 planned configs ran.** The three skipped (a temp-1.0 strawman, a
  temp-0.7 cell, and a KV-q8 spot-check) were judged low-value for this pass and
  deliberately left out rather than run for completeness.

## Close

If you've been assuming serious local coding-model inference means an NVIDIA card,
this is a data point against that: a dense 27B model, one 32 GB AMD RDNA4 card, 70
tok/s decode, 100% accuracy on the deterministic suite, and over 11 GiB of VRAM to
spare. The MTP build is the free half of that result. The reasoning-budget cap is
the half you have to choose to take.

---
*Provenance: all performance/quality numbers are MEASURED on the R9700 (RDNA4,
gfx1201) with llama.cpp Vulkan b9950. The recommended sampling values are CLAIMED
from the Qwen3.6 model card. reps=1; open-ended tasks scored by a blind LLM judge.*
