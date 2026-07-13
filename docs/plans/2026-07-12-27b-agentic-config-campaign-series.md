# Plan: 27B agentic-coding config — campaign series (R9700)

- **Date:** 2026-07-12 · **Goal:** a **stable, well-tuned llama.cpp config for heavy agentic
  coding** (10–50K context of system rules + code, many simultaneous constraints, tool use) on the
  R9700, for **jackrong-qwopus** and **unsloth-Qwen3.6-27B-MTP**.
- **Why a series, not one campaign:** the knobs split cleanly into **quality-independent** (perf/
  latency — measure fast, objectively, no judge) and **quality-coupled** (need a *hard* eval + a
  judge). Measuring them together wastes GPU time and confounds results. We fix the cheap perf
  substrate first, then tune quality *on top of the winning substrate*. This doc is the map; each
  campaign has its own runnable dir.
- **Companion research:** `docs/research/2026-07-12-2310-qwen36-sampling-llamacpp-serving-knobs.md`
  (sampling + knob reference) and `docs/research/2026-07-12-2300-rdna4-vllm-aiter-fp8-status.md`
  (why the vLLM/AITER path is a dead end today).

## Where the last campaign left us (inputs)
From `campaigns/2026-07-12-27b-finetune-quality/analysis.md`: jackrong = best quality-per-token
(100% det, judge 4.67, ~960 think tok); unsloth-MTP = fastest decode (MTP 2.2×) but had one runaway
regression; hauhau ran away twice; rico fabricated + leaked thinking. **All at temp 1.0.**

## Five things I'm challenging (you asked me to)

1. **temp 1.0 was almost certainly the bug, not the models.** Qwen3.6 thinking mode wants **temp
   0.6** / top_p 0.95 / top_k 20 / min_p 0, and *never greedy*. Over-temperature explains every
   pathology we saw (empty-answer runaways, markdown leakage, MTP divergence). **Re-baseline at 0.6
   before tuning anything exotic** — half the "problems" may evaporate. (Campaign 2, step B0.)
2. **"Does thinking mode help?" is under-specified for a distilled model.** Our own data was
   non-monotonic: least-thinking (rico) failed on *format*, most-thinking (hauhau) *ran away*. The
   real question is **"what `--reasoning-budget` maximizes verified-quality-per-latency on HARD
   tasks."** Which means…
3. **…the eval is too easy.** Primes/clock puzzles saturate and can't discriminate thinking configs.
   The eval must be **agentic-shaped and hard**: 8–12 simultaneous *verifiable* constraints + a
   strict tool-call schema + 10–50K real-code context + a few multi-turn cases — borrowed from
   IFEval/AgentIF, kept auto-gradable. **Building this eval is a prerequisite for Campaign 2**, not
   an afterthought.
4. **MTP can't be isolated from sampling.** MTP's divergence/runaway is temperature-coupled, so MTP
   draft-param tuning (`--spec-draft-p-min/-n-max`) must happen **after** sampling is fixed — else
   you chase a moving target. This forces the ordering below.
5. **Your vLLM/AITER env-vars are non-viable on gfx1201 today** (AITER C++/ASM disabled on RDNA4;
   FP8→FP32 silent fallback). We'll still spike it since you asked, but behind a hard load-gate — see
   Campaign 3.

## Knob dependency map (the reason for the split)

| Knob | Affects | Independent? | Where |
|------|---------|--------------|-------|
| Backend (Vulkan vs HIP) | prefill/decode/launch floor | yes (perf) | C1 |
| Prefill depth (real curve) | prefill tok/s vs depth | yes (perf) | C1 |
| KV f16 vs q8_0 | decode/VRAM (+ tiny quality) | mostly (perf; quality spot-check in C2) | C1 |
| Prompt-cache reuse (`--cache-reuse`/`--cache-ram`) | prefill amortization across turns | yes (perf) | C1 |
| MTP **decode speed** | tok/s + acceptance | yes (perf) | C1 |
| **Sampling** (temp/top_p/top_k/min_p/presence) | quality + thinking length | **couples to MTP** | C2 |
| **Thinking budget** (`--reasoning-budget`) | quality/latency/economy | couples to task difficulty | C2 |
| MTP **quality** (`-p-min`/`-n-max`) | correctness/runaway | **couples to sampling** | C2 |
| vLLM + AITER/Triton/unified-attn | whole engine swap | orthogonal, high-risk | C3 |

## Campaign 1 — Serving substrate  *(DONE — see analysis.md; substrate frozen)*
`campaigns/2026-07-12-27b-serving-substrate/` · **quality-independent, no judge.**
**Result:** real prefill 666–831 tok/s (the "slow prefill" was a 75-tok artifact); prefix reuse cuts
32K ttft 42.7→3.1 s (13.7×, built-in — explicit cache flags add nothing); KV q8_0 rejected
(−12/−19% prefill); MTP +99% decode for −5% prefill; **ROCm/HIP ~92× slower prefill than Vulkan**.
**Frozen substrate → C2: Vulkan · KV f16 · MTP-on · rely on prefix reuse.**
- Answers **"why was prefill slow"**: the previous prompts were 51–99 tokens, so `prefill_tps` (~200)
  was a **fixed-overhead artifact** (~255 ms/req launch floor + ~1260 tok/s marginal, MEASURED). The
  depth sweep (8/32/64K) measures real prefill at your operating point.
- Axes: prefill depth · KV f16 vs q8_0 (≤5% rule) · MTP decode speed + acceptance · prompt-cache
  reuse (cold vs warm; `--cache-reuse` KV-shift variant) · **Vulkan vs HIP** spot-check @32K.
- Runs on the **unsloth-MTP** build (it uniquely carries MTP; the substrate is arch+quant-determined
  and transfers to jackrong — re-confirmed in C2 B0). ~15–20 min + the two documented extra passes.
- **Output → C2 input:** a frozen substrate = `{backend, kv, ub/b, cache flags, MTP-for-speed?}`.

## Campaign 2 — Sampling + thinking + MTP-quality on HARD tasks  *(DONE — partial; see analysis.md)*
`campaigns/2026-07-13-27b-quality-tuning/` · runs on **C1's frozen substrate**, both models.
**Result (10/13 configs, temp 0.6):** `--reasoning-budget` is the master economy knob — capping costs **0%** deterministic
accuracy and gives **0% runaway** while cutting tokens/latency 40–55%; optimum plateau **1024–2048** (`512` starves
design tasks). **`--reasoning-budget 0` = uncapped, not no-think.** **MTP-draft tuning backfired** (uncapped → 7.1%
runaway, 91% det); keep defaults. **unsloth-MTP** is the better substrate (2.25× decode + top quality). **The 3 skipped
configs (temp-1.0, temp-0.7, KV-q8) were re-judged low-value and dropped** (temp 1.0 = known-bad strawman → challenge #1
answered by inference: runaway is uncapped-thinking, not temperature; jackrong-uncapped = `jr-rb0`, already have; q8 already
rejected in C1). **Real remaining gaps → C3/C4 below.**
**Scaffold:** `configs.jsonl` (13 server configs × 17 sampling points), `tasks/tasks.jsonl` (14 hard
tasks — deterministic answers verified), `run_capture.sh` (config-sweep driver reusing
finetune-quality's `capture.py`+`graders`). Custom driver, not `gen_campaign.py` (that emits
throughput probes, not the quality/judge flow — see the campaign README).
- **Prereq:** build the hard agentic eval (~10–15 tasks, 8–12 verifiable constraints each + tool-call
  schema + 10–50K code context + multi-turn), extending
  `campaigns/2026-07-12-27b-finetune-quality/graders/`. Reuse its `capture.py` (tokens/ttfa/flags)
  and add the runaway signal `finish_reason=length ∧ ¬has_answer` (the built-in `truncated_thinking`
  flag under-counts — see the finetune-quality analysis).
- **B0** substrate transfer check on jackrong (1 point) — confirm C1 carries over.
- **B1** re-baseline: **temp 0.6 vs 1.0** (prove challenge #1).
- **B2** sampling sweep: temp {0.6,0.7} × top_p/top_k per card, min_p 0, presence_penalty {0,0.5}.
- **B3** thinking budget: `--reasoning-budget {−1,4096,2048,1024,0}` at B2-winner → quality-per-
  latency curve (answers challenge #2). `0` = a no-think latency floor for trivial tool calls.
- **B4** MTP quality (unsloth): at fixed sampling, `-p-min {0,0.5,0.75}` × `-n-max {3,5}` — does the
  runaway recur? is correctness preserved? (challenge #4).
- **B5** KV q8_0 quality spot-check at the chosen config.
- **Output:** the quality config = `{sampling, reasoning-budget, MTP-quality settings}` per model.

## Campaign 3 — Quality + parameter-effects at agentic DEPTH  *(READY TO RUN — driver + charts wired)*
`campaigns/2026-07-13-27b-quality-at-depth/` · runs on C1's frozen substrate, both 27B models.
**Why this replaces the earlier "{8K,16K,32K} + score_deterministic multi_constraint" sketch:** that
plan died when the deterministic eval saturated at 100% (couldn't discriminate configs). The built
campaign instead measures at the **real operating point (64k/128k of actual TS source)** with a **hard,
integrated TypeScript-TDD eval** whose multi-objective grader (real `tsc`+`eslint`+`vitest` + static
rule-checks) does not saturate — so temperature/reasoning-budget finally separate.
**Built & validated:** self-contained auto-installing `ts-harness/` + `score_typescript.py`
(single- & multi-file, `batch` mode); **8 tasks** on a full difficulty ladder (2 easy / 4 Sonnet-tier /
2 Opus-tier, 6 problem kinds), each tier-confirmed by a haiku/Sonnet/Opus gradient
(`calibration-hard.jsonl`); ~682k-tok sanitized corpus. **Driver + charts now built too:** `configs.jsonl`
(10 core cells) + `tasks.jsonl` + `run_capture.sh` (reuses `capture.py`+`score_typescript.py`+`vram_sampler.py`,
resumable, VRAM-sampled) + extended `make_charts.py` (TS-score charts + haiku/Sonnet/Opus reference bands +
budget-sweep line charts). See the campaign README + `eval-design.md`.
- **Locked matrix (fixed Qwen3.6-thinking sampling temp 0.6 / top_p 0.95 / top_k 20 / min_p 0; REPS=2;
  ~120 replies, trimmed from 288):** reasoning-budget **{1024,2048,4096}** × depth **{64k-f16, 128k-f16}**
  on unsloth-MTP (6 cells) + a 128k **f16-vs-q8 A/B** at budget 2048 (1 cell) + jackrong cross-check at
  budget 2048 × {64k-f16,128k-f16,128k-q8} (3 cells) + an opt-in **16384** ceiling cell at 128k-f16
  (`RUN_OPTIN=1`). **6 discriminating tasks** in the matrix (the 2 saturating easy tasks are smoke-only,
  `SMOKE=1`). Sampling is **fixed, not swept** (temp axis dropped — C2 settled 0.6; 0.6-vs-0.7 is noise);
  **budget is the primary axis** (C2's master economy knob). The corpus is a **shared cached prefix** →
  one deep prefill per server, all tasks reuse it (C1's 13.7× ttft win).
- **Answers:** (a) does the optimal `--reasoning-budget` rise with depth (budget curve at 64k vs 128k)?
  (b) does rule-adherence / util-reuse survive 64k→128k (lost-in-the-middle)? (c) does KV-q8 cost quality at
  128k (f16-vs-q8 A/B, ≤5% rule)? (d) where does the local 27B sit vs the haiku/Sonnet/Opus capability bands?
- **One fully-automatic script — no human interaction.** `run_capture.sh` does capture → grade → blind
  judge → charts → **auto-writes `analysis.md` via the benchmark-results skill** → reindexes. The two LLM
  steps (judge + summary) run `claude` **through tmux** (`claude_ask.sh`) because headless/background
  claude is restricted here; the script **fails fast** if the `claude-run` tmux session is missing
  (proven end-to-end). Set `JUDGE_ENGINE=none SUMMARY=0` to skip all claude steps.
- **Blind LLM judge — the judge is Claude, not the 27B** (a judge must beat the model under test; the 27B
  is the best *local* model). `judge.py` scores subjective design/clarity/robustness, blind (neutral cwd →
  no repo context), saving both parsed scores and the full prompt+reply for audit; `--engine claude-tmux`
  (default) or a stronger hosted endpoint (`--engine http`). Human-readable rubric + all run modes: the
  campaign's **`JUDGE.md`**. Deterministic correctness stays the toolchain's job; the judge only adds what it can't measure.
- **Reusable across models:** adding a model = one `configs.jsonl` line (local GGUF *or* any OpenAI-compatible
  URL, since `capture.py` speaks plain HTTP); see the campaign's `REUSE.md`.

## Campaign 4 — Multi-turn tool-use validation  *(the acceptance test / deliverable)*
The goal says *tool use*; everything so far is single-turn. Run one realistic **read→edit→test loop**
(5–10 turns, tool results fed back, prefix cache on) with the C3 winner: verify mid-session stability, that
C1's 13.7× prefix-cache win holds across turns, and rule adherence throughout. Passing this = *the* stable
agentic-coding config, per model.

## Campaign 5 (optional, low-priority) — vLLM / AITER feasibility spike
**Skip unless a vLLM-ROCm env already exists** — the research doc already predicts the answer (AITER dead on
gfx1201, FP8→FP32 fallback). If installed, a ~15-min **Gate 0** (loads + emits a token at ≥½ the llama.cpp-Vulkan
decode rate?) is the whole spike; otherwise not worth a build-from-scratch. Revisit when upstream lands gfx1201
in AITER's arch table.

## Execution order (updated)
1. ~~C1 substrate~~ **DONE** (frozen: Vulkan · f16 · MTP-on).
2. ~~C2 quality knobs~~ **DONE** (cap reasoning-budget; unsloth-MTP; keep MTP-draft defaults). Skipped configs dropped as low-value.
3. **C3 quality + parameter-effects at depth** (budget {1024,2048,4096} × {64k-f16,128k-f16} + q8 A/B, REPS=2, ~120 replies, TS-TDD eval + blind judge) — **driver + judge + charts BUILT, ready to run**. ← next: `bash run_capture.sh`
4. **C4 multi-turn tool-use** validation → the deliverable.
5. (Optional) C5 vLLM Gate-0, only if already installed.
