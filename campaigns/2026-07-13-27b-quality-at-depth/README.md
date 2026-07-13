# Campaign 3 — Qwen3.6-27B **quality + parameter-effects at agentic depth** (R9700)

*Part of the agentic-config series (`docs/plans/2026-07-12-27b-agentic-config-campaign-series.md`).*
**Status: READY TO RUN** — harness, 8-task eval, corpus, driver, and charts are all built and
validated offline. One command runs it: `bash run_capture.sh`.

This campaign gives a **round, comprehensive picture** of what the local 27B can do *and* how each
serving knob moves the result — on realistic work (64–128k of actual TypeScript in context), not toy
prompts. It is written to be **reusable with any other model** (see `REUSE.md`).

---

## 1. What this measures (two questions, one matrix)

1. **Capability** — how good is the local 27B on a hard, auto-graded coding eval, placed on a
   calibrated difficulty ladder (`haiku` floor → `Sonnet` → `Opus` ceiling)? The calibration scores
   are drawn as reference lines on every quality chart, so "how far below Opus are we" is visible.
   A **blind LLM judge** adds the subjective axes (design / clarity / robustness) the toolchain can't
   grade, so capability is read on both objective *and* human-style-quality terms.
2. **Parameter effects** — how do the serving knobs move quality, latency, and token cost:
   **reasoning-budget** (the thinking-token cap), **context depth** (64k vs 128k), and **KV precision**
   (f16 vs q8_0)? Sampling is held fixed (see §4) so these axes are read cleanly.

The model's job each task: given a spec + a slice of a real codebase in context, write **vitest tests
+ a strict-typed implementation** (TDD), obeying the project coding rules and reusing a util planted
in the deep context. The **grader** runs the real toolchain (`tsc`+`eslint`+`vitest`) — the model
just produces code; the toolchain judges it.

---

## 2. Glossary (plain-English, for programmers new to LLM serving)

| Term | What it means here |
|------|--------------------|
| **token** | ~¾ of a word; the unit models read/write. "128k context" ≈ 128 000 tokens of code in the prompt. |
| **context depth** | how much text is in the prompt. We test **64k** and **128k** tokens of real TS source. |
| **prefill** | the model reading the prompt before it answers. Deep prompts prefill slowly (~3 min at 128k). |
| **prefix cache** | llama.cpp reuses the prefill of an identical prompt-prefix. Our corpus is a shared prefix, so only the *first* task per server pays the deep prefill (C1 measured a 13.7× time-to-first-token win). |
| **decode** | generating the answer, token by token. Measured in tok/s. |
| **thinking / reasoning** | Qwen3.6 emits hidden `<think>…</think>` reasoning before the answer. Good for hard tasks, but it costs tokens + latency. |
| **reasoning-budget** | a cap on thinking tokens (`--reasoning-budget N`). C2 found it's the master *economy* knob: capping costs ~0% accuracy while cutting tokens/latency 40–55%. **This is our primary axis.** `0` = uncapped, not "no thinking". |
| **KV-cache** | per-token memory the model keeps while generating. **f16** = 16-bit (full precision), **q8_0** = 8-bit (half the VRAM, maybe slightly lower quality). We A/B them at 128k. |
| **MTP** | Multi-Token Prediction — a speculative-decode mode the unsloth build carries; ~2.25× decode. |
| **sampling** | how the next token is picked: **temperature** (randomness), **top_p / top_k / min_p** (candidate filters). Qwen3.6-thinking's recommended values are fixed here. |
| **ttft / ttfa** | time-to-first-token / time-to-first-**answer**-token (after thinking). The gap = time spent thinking. |
| **hard-pass** | a task where the model passed **all** gate objectives (types + lint + tests + reuse + edge) at once — the strict bar. |
| **LLM judge** | a separate strong model that scores the *subjective* quality (design / clarity / robustness) the toolchain can't measure — **blind** (never shown which config produced the code). Complements, not replaces, the deterministic grade. |
| **substrate** | the fixed serving config inherited from Campaign 1: llama.cpp **Vulkan**, `-ub 2048 -b 4096 -fa on`, MTP-on, prefix cache. |

---

## 3. The eval (summary — full detail in `eval-design.md`)

Eight TypeScript-TDD tasks on a validated difficulty ladder (calibrated by running `haiku`/`Sonnet`/
`Opus` one-shot; a task is admitted only if the weak model hard-fails and a stronger tier scores
higher — see `calibration.jsonl` + `calibration-hard.jsonl`):

| tier | tasks | reads as |
|------|-------|----------|
| easy (smoke, `SMOKE=1` only) | `count-words`, `shape-variant` | pipeline sanity; both weak+strong pass — excluded from the matrix |
| Sonnet-tier (matrix) | `lru-cache`, `rate-limiter`, `store-remove`, `deep-equal` | ordered spread; even one-shot Sonnet doesn't always hard-pass |
| Opus-tier / ceiling (matrix) | `async-memo`, `expr-eval` | only Opus-high hard-passes; the 27B's headroom lives here |

Each reply is scored on weighted objectives — `types` (tsc), `lint` (eslint strict), `tests`
(the model's own vitest), `edge` (hidden vitest), `reuse` (used the planted util?), `bdd` (test
naming), `novj` (no jest). `score` = weighted mean; `hard_pass` = every gate objective = 1.0.
The grader (`score_typescript.py selftest`) is proven to discriminate smoothly (good **1.0** >
mediocre **0.36** > bad **0.0**), which is what lets budget/depth move the needle.

---

## 4. The locked run matrix

**Fixed sampling (NOT swept)** — Qwen3.6-thinking recommended: `temp 0.6 · top_p 0.95 · top_k 20 ·
min_p 0`. The temperature axis is deliberately dropped (C2 settled 0.6; 0.6-vs-0.7 is within noise).
**Budget is the axis of interest** — it's the knob that actually pays off. `REPS=2`.

| model | reasoning-budget | depth × KV | cells | role |
|-------|------------------|-----------|:-----:|------|
| unsloth-MTP | 1024 · 2048 · 4096 | 64k-f16 · 128k-f16 | 6 | primary budget × depth sweep |
| unsloth-MTP | 2048 | 128k-q8 | 1 | KV **f16-vs-q8 A/B** (matched budget) |
| jackrong | 2048 | 64k-f16 · 128k-f16 · 128k-q8 | 3 | cross-check at the C2 winner |
| unsloth-MTP | 16384 | 128k-f16 | 1 | **opt-in** ceiling (`RUN_OPTIN=1`) |

≈ **10 core cells × 6 discriminating tasks × 2 reps ≈ 120 graded replies (~a few hours GPU)**. Config
source of truth: `configs.jsonl` (one JSON line per cell). **How it was trimmed from 288:** (a) the 2
saturating easy tasks are dropped from the matrix (`SMOKE=1` runs them as a one-off sanity check); (b)
128k-q8 collapses to the single matched budget (the KV A/B only needs one budget vs its f16 twin, not a
sweep); (c) `REPS=2` (engine-bench standard). **Design rationale + scope challenges are in the plan
doc.** In brief: keep 64k as the depth baseline (need two depths for a lost-in-the-middle delta); sweep
the budget rather than fix it; keep 16384 as a single opt-in confirmation, not in the grid (decode-bound).

---

## 5. How to run

```bash
# from this directory (models default to /home/dev/models/gguf):
tmux new-session -d -s claude-run                # ONCE — the judge + summary run claude through tmux
bash run_capture.sh                              # FULL auto: capture → grade → judge → charts → analysis.md
ONLY='un-d64*' REPS=1 bash run_capture.sh        # quick subset (labels glob-matched)
SMOKE=1 bash run_capture.sh                      # also include the 2 easy smoke tasks
RUN_OPTIN=1 bash run_capture.sh                  # also run the 16384-budget ceiling cell
JUDGE_ENGINE=http JUDGE_BASE_URL=https://host/v1 bash run_capture.sh   # judge via a hosted endpoint instead
JUDGE_ENGINE=none SUMMARY=0 bash run_capture.sh  # capture+grade+charts only (no claude, no tmux needed)
MODELS_DIR=/path/to/gguf bash run_capture.sh     # models elsewhere
```

> **One script, no human interaction.** It requires a **tmux session** first (`claude-run`) because
> headless/background `claude` is restricted here — the judge and the final analysis run `claude`
> *through tmux* (a real PTY). If the session is missing, the script **fails fast with the exact
> command to start it**, before the hours-long capture. To run without any claude steps:
> `JUDGE_ENGINE=none SUMMARY=0`.

The driver is **resumable** (per-cell `out/done/<label>` markers — a re-run skips finished cells) and
**continues past a failed cell** (logged to `out/failures.txt`). End to end it: (1) per cell, starts one
llama-server on the frozen substrate with `--reasoning-budget N`, samples VRAM/GTT/power, sends the 6
matrix tasks (built at the cell's depth by `build_context.py`, corpus = shared cached prefix) through
`capture.py`, stops the server; (2) **grades** every reply with the real toolchain
(`score_typescript.py batch`); (3) **judges** subjective quality (`judge.py --engine claude-tmux`, blind,
via `claude_ask.sh`); (4) **charts** (`make_charts.py`); (5) **aggregates every number deterministically
in Python** (`aggregate.py` → `out/summary.md`: per-cell table + the 4 findings computed, not inferred);
(6) **writes `analysis.md`** by driving the **benchmark-results skill** through `claude` (via tmux) — the
LLM reads **only the digest + charts, never the per-reply jsonl** — then reindexes `docs/INDEX.md`.

**Outputs (in `out/`):** `outputs.jsonl` (replies + token/latency/throughput), `scores_typescript.jsonl`
(per-reply objectives + score + hard_pass), `judge_scores.jsonl` + `judge_raw.jsonl` (subjective
design/clarity/robustness + the full judge prompt & reply), `vram.jsonl` + `gpu_*.csv`
(memory/power/thermal), `props_*.json` (per-server provenance), `charts/*.svg` + `charts/appendix.md`,
`summary.md` + `summary.json` (the deterministic digest), and the co-located **`analysis.md`**. Commit the
run data after eyeballing `analysis.md` (the model wrote its prose from the digest — spot-check it against
`summary.md`).

---

## 6. Expected results (hypotheses — confirm/refute at run time)

Tagged `INFERRED` from Campaign 2 + the research doc; the run replaces them with `MEASURED`.

- **reasoning-budget:** quality rises then **plateaus around 1024–2048**; tokens/latency rise
  monotonically → an economy knob. At 128k the optimum may shift **up** (harder to hold context) — that's
  what the 64k-vs-128k budget curves test; if 4096 is still climbing at 128k, run the opt-in 16384 cell.
- **depth 64k→128k:** rule-adherence and especially the **reuse** objective (finding the planted util deep
  in context) should **sag** = the lost-in-the-middle signal.
- **KV q8_0 @128k:** expect **≤5% quality cost** vs f16 for a real VRAM saving → the deploy recommendation
  (q8 buys context/headroom if quality holds).
- **capability:** the local 27B likely lands **around Sonnet-tier**, with `async-memo` / `expr-eval`
  exposing the gap to Opus. The capability chart makes the distance to each reference band literal.

---

## 7. Reuse with another model

The eval + grader + charts are **model-agnostic**. To benchmark a different model — a different local
GGUF *or* any OpenAI-compatible endpoint (llama.cpp, vLLM, or a hosted API) — you change **one line** in
`configs.jsonl`. Step-by-step (add a model, add a knob axis, copy the whole campaign for a new SUT):
**`REUSE.md`**.

---

*Substrate (frozen, C1):* llama.cpp Vulkan b9950 · `-ub 2048 -b 4096 -fa on` · MTP-on · prefix cache.
*Provenance:* `bench/runs/` + this campaign's `out/` = `MEASURED`; external claims = `CLAIMED` (cited);
reasoned = `INFERRED`. Never blended. *Full task detail + calibration:* `eval-design.md`.
