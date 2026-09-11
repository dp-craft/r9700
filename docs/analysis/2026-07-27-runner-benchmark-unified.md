<!-- meta
date: 2026-07-27
takeaway: runner-simplify harness change is **outcome-neutral** (119 runs); **between-block variance** outweighs every model/arm difference. Local default: `Brian6145/27B-Q4_K_M` for statement-driven work, `unsloth/35B-A3B-UD-Q4_K_M` for contract-/test-bearing work — complementary, not ranked. `ThinkingCap-27B-Q6_K_L` posted the best attempts/wall yet silently overwrote translations: **gate-green is not a quality proxy**.
-->

# runner-simplify validation + multi-model benchmark

Frozen 2026-07-27. One campaign, three questions: (a) did the three transferred `runner-simplify` commits change anything, (b) how do five local models compare on the same two workloads, and (c) how does any of it compare to the production Claude path.

**119 runner runs**: 10 × phase-1 (9 tasks each = 90) + 9 × T010 (n=3 = 27) + 2 salvaged T010 iterations. Plus **two Claude arms** on the same phase-1 task set (9 tasks each = 18 task-runs).

---

## 1. Reading guide

| Term | Meaning here |
|---|---|
| **σ** (sigma) | Sample standard deviation of the per-iteration wall-clock inside one block. Small σ = the runs took similar time; large σ = the same configuration sometimes takes twice as long. Computed over n=3, so σ is itself a rough estimate |
| **CV** | Coefficient of variation = σ ÷ mean, as a percent. Makes spread comparable between a 200 s model and a 550 s model. CV 5 % = tight and predictable; CV 35 % = a single run tells you little |
| **Within-block variance** | Spread of the 3 iterations inside one n=3 block — same loaded server, same session. This is what σ/CV measure |
| **Between-block variance** | Difference between two separate n=3 blocks of the *same* model — separate model load, separate session. Measured here for the first time, and it is the larger term |
| **true-green** | Verified four ways: runner reports `completed`, target file actually changed, expected symbol present, and an independent re-run of the discriminating test passes |
| **`unverified`** | Phase-1 `impl`-mode success: all gates clean, no red→green test proof exists. **Not a failure** |
| **`failed` / `local-exhausted`** | Real failures. `local-exhausted` = the escalation ladder ran out of attempts |
| **Input tokens** | Cumulative prompt tokens across every attempt and drive — dominated by re-prefill per round, so it measures *round count*, not task size |
| **Generated tokens** | What the model actually emitted. The closest thing to "how much work did it do" |

**Token costs are only comparable within an arm type.** The runner reports input and generated separately; the Claude arms report `subagent_tokens`, a cumulative prompt+completion figure that includes cache reads. Wall-clock and green rate are comparable everywhere.

---

## 2. What was compared

### 2.1 The eight arms

| Arm (short name) | Kind | Model file / model | Size · arch | Executor | Rules seen | Profile |
|---|---|---|---|---|---|---|
| **BASE** | production baseline | Claude **Opus** (CLAUDE.md: coding subagents use opus) | — | `/speckit.implement` → `code-logic-writer`, `ui-writer`, `ts-test-writer` | repo rules (`CLAUDE.md`, `principles/*`) + nav bundle | — |
| **SIM** | runner simulation | Claude **Sonnet** | — | one blank `general-purpose` subagent per task | `agentic-runner-rules/atoms/*` (verbatim runner payload) | — |
| **Brian6145/27B-…-Q4_K_M** | local | `Brian6145/Qwen3.6-27B-Claude-Opus-DeepSeek-Distilled-Imatrix-MTP-GGUF-Q4_K_M.gguf` | 17 GB · dense | agentic-code-runner | `agentic-runner-rules/atoms/*` | `bench-27b-q4` |
| **unsloth/27B-Q4_K_M** | local | `unsloth/Qwen3.6-27B-Q4_K_M.gguf` | 16 GB · dense | agentic-code-runner | same | `bench-27b-unsloth-q4` |
| **mradermacher/27B-A3B-Coder-Q5_K_M** | local | `mradermacher/Qwen3.6-27B-A3B-Coder.Q5_K_M.gguf` | 18 GB · MoE (35B-A3B pruned) | agentic-code-runner | same | `bench-27b-a3b-coder` |
| **unsloth/35B-A3B-UD-Q5_K_M** | local | `unsloth/Qwen3.6-35B-A3B-UD-Q5_K_M.gguf` | 26 GB · MoE | agentic-code-runner | same | `bench-35b-q5` |
| **unsloth/35B-A3B-UD-Q4_K_M** | local | `unsloth/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` | 22 GB · MoE | agentic-code-runner | same | `bench-35b-unsloth-q4` |
| **bartowski/ThinkingCap-27B-Q6_K_L** | local | `bartowski/bottlecapai_ThinkingCap-Qwen3.6-27B-Q6_K_L.gguf` | 23 GB · dense | agentic-code-runner | same | `bench-27b-thinkingcap-q6` |

Short names are `<parent directory>/<abbreviated filename>`. Every local model ran the **same sampling** (temp 0.6 · topP 0.95 · topK 20 · minP 0 · maxTokens 32768 · reasoning on · ctx 153600) and the **same llama-server arguments** (flash-attn, ngl 99, `--spec-type draft-mtp`, `-ub 2048 -b 4096`). Only the weights differ.

**One arm deviates from the shared server arguments, deliberately.** `ThinkingCap-27B-Q6_K_L` is a 23 GB Q6 build; at `f16` KV-cache it does not fit the 32 GB card — 32 049 MiB VRAM plus **5 324 MiB spilled to GTT**. It was therefore run with `cacheTypeK`/`cacheTypeV` = `q8_0` (30 778 MiB VRAM, 1 431 MiB GTT, no spill), and additionally re-run at `f16` as a **paired** arm so the spill's cost is measured rather than assumed. Every other server argument and all sampling parameters are unchanged. Rows carry their cache type; q8 and f16 rows of this model are never pooled.

**One candidate model was excluded before measurement.** `rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-Q4_K_S` fails to load under the shared arguments — `model doesn't contain MTP layers` → `exiting due to model loading error`. Dropping `--spec-type draft-mtp` for that one model would have broken the "same server arguments" invariant, so it was excluded rather than measured on different terms. **An MTP head is a model-selection precondition here, and the filename does not reveal it** — the same-day `ThinkingCap-Q6_K_L` loaded with MTP without incident.

**Results are never pooled across models.** Every local row is a distinct model, including builds that share a base and differ only in provenance or quantisation — `Qwen3.6-27B-…-Q4_K_M` from Brian6145 is not `Qwen3.6-27B-Q4_K_M` from unsloth, and a `UD-Q5_K_M` is not a `UD-Q4_K_M`. No metric here is averaged or ranked across two different files. (`mradermacher/27B-A3B-Coder-Q5_K_M` is a *pruned 35B-A3B*, not a 27B dense build — see §7.2.)

**SIM's payload is not a paraphrase.** It was dumped by calling the runner's own builders (`buildSystemPrompt` → `filterToolCatalog(projectRules(role))`, `buildKickoff(selectCodeKickoff('impl'))`, `buildImplPreloadWithSliceContract`) against the same nav bundle, per task, against the current cumulative tree. Only tool names were adapted (`read`→Read, `edit`→Edit, `verify()`→`tsc`). Confirmation it landed: SIM wrote **English placeholders into `hu.ts`** (the `i18n-keys.md` atom) while BASE wrote real Hungarian — each correct for its own arm. The two Claude arms are **deliberately separate runs**: mixing a production agent context with a runner-payload context inside one run would make neither interpretable.

### 2.2 The harness change under test

Three functional commits of the `runner-simplify` branch, transferred to `047-local-provider-ux` by fast-forward as `1dc121f8` → `b282b32d` → `8d2c3a00` (control tip: `d7532e4f`). The branch's two docs commits (`251bd4bb`, `94917961`) were not transferred.

| Commit | Change | Code path it can affect |
|---|---|---|
| `1dc121f8` | delete dead sampling ladder + LLM-conclusion plumbing (−330 lines) | attempt ≥3 (the 0.6 → 0.8 temperature bump); `RUNNER_LLM_CONCLUSION=1` only |
| `b282b32d` | deterministic per-attempt seed, run-level, pinnable via `RUNNER_SEED` | every llamacpp request (adds a `seed` field); reproduction only when pinned |
| `8d2c3a00` | rank lint after tsc/test in the gate pipeline | only when lint AND tsc/test fail in the same attempt |

**Which repo state each run used** — verified, not assumed. The `dp-test-llm` reports record `Repo HEAD` and `runner-src` per block; phase-1 worktrees were created at an explicit SHA and the surviving ones were re-checked.

| Runner state | Runs |
|---|---|
| `d7532e4f` · runner-src `60fdd793` (**arm A**, pre-merge) | 1 phase-1 sample + 1 T010 block (+2 salvaged iterations) — all `Brian6145/27B-…-Q4_K_M` |
| `8d2c3a00` · runner-src `8d2c3a00` (**arm B**, post-merge) | **every other run in this document**, all models, plus BASE and SIM |

Exactly one deliberate split (arm A vs arm B) and **no accidental mixing within any model**. Caveat for completeness: three later commits (`9b99b788`, `40b824a6`, `dca8a6a9`) added profiles to `runner.config.json`, and those newer configs were copied into the later worktrees. The additions are purely additive — the profiles and server blocks actually used (`bench-27b-q4`, `bench-35b-q5`, `bench-27b`, `bench-35b`) were verified byte-identical to their `8d2c3a00` versions. Runner *source* is identical across all arm-B runs.

### 2.3 The two workloads

| Workload | Task set | Shape |
|---|---|---|
| **A — 047 phase-1** | 9 tasks (T001–T004, T014, T021, T022, T030, T031) | Cumulative: each task starts from the tree the previous one left. `impl` mode. Per-task nav re-resolved against the current tree; patches pinned with `git write-tree` |
| **B — 045 T010** | `usePromptTesterStore.ts` (2035 lines) | n=3 per block, `dp-test-llm` harness, red fixture restored before every iteration |

---

## 3. Measurements

### 3.1 Workload A — phase-1, every arm

| Arm | Sample | Runner | Green | Attempts | Tool calls | Token cost (unit differs) | Wall | Tests shipped |
|---|---|---|---|---|---|---|---|---|
| **BASE** (Opus, production) | 1 | arm B | **9/9** | n/a | n/a | 776 k subagent (588 k impl + 188 k gates) | 1451 s (1019 impl + 432 gates) | **24 cases** / 3 files |
| **SIM** (Sonnet, runner payload) | 1 | arm B | **9/9** | n/a | n/a | 822 k subagent | 1382 s | 0 |
| Brian6145/27B-…-Q4_K_M | 1 | **arm A** | **9/9** | 9 | 101 | 2 001 111 in · 16 245 gen | 1555 s | 0 |
| Brian6145/27B-…-Q4_K_M | 2 | arm B | **9/9** | 9 | 113 | 1 632 911 in · 20 745 gen | 1549 s | 0 |
| Brian6145/27B-…-Q4_K_M | 3 | arm B | **9/9** | 11 | n/a | 2 029 009 in · 21 346 gen | 1830 s | 0 |
| unsloth/27B-Q4_K_M | 1 | arm B | **9/9** | 10 | n/a | 2 248 736 in · 20 217 gen | 1681 s | 0 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 1 | arm B | **7/9** | 14 | n/a | 4 817 037 in · 107 241 gen | 2059 s | 0 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 2 | arm B | **9/9** | 9 | n/a | 3 411 151 in · 29 312 gen | 1371 s | 0 |
| unsloth/35B-A3B-UD-Q5_K_M | 1 | arm B | **8/9** | 11 | n/a | 3 770 117 in · 67 638 gen | 1791 s | 0 |
| unsloth/35B-A3B-UD-Q5_K_M | 2 | arm B | **9/9** | 11 | 165 | 2 246 265 in · 41 630 gen | 1405 s | 0 |
| unsloth/35B-A3B-UD-Q4_K_M | 1 | arm B | **7/9** | 16 | 357 | 6 782 581 in · 181 545 gen | 3072 s | 0 |
| unsloth/35B-A3B-UD-Q4_K_M | 2 | arm B | **9/9** | 10 | 163 | 2 523 283 in · 39 801 gen | 1361 s | 0 |
| ThinkingCap-27B-Q6_K_L · **q8_0** | 1 | arm B | **9/9** | **9** | n/a | 1 144 471 in · 17 406 gen | **1456 s** | 0 |
| ThinkingCap-27B-Q6_K_L · **q8_0** | 2 | arm B | **9/9** | 11 | n/a | 1 198 756 in · 16 027 gen | 1554 s | 0 |
| ThinkingCap-27B-Q6_K_L · **q8_0** | 3 | arm B | 8/8 ⁵ | 9 ⁵ | n/a | 889 544 in · 9 965 gen ⁵ | 1340 s ⁵ | 0 |
| ThinkingCap-27B-Q6_K_L · **f16** | 1 | arm B | **9/9** | 10 | n/a | 920 834 in · 12 715 gen | 3754 s | 0 |
| ThinkingCap-27B-Q6_K_L · **f16** | 2 | arm B | **9/9** | 10 | n/a | 1 008 583 in · 13 550 gen | 4197 s | 0 |

⁵ Sample 3's T022 yields **no metric** and is excluded from every figure in its row: the benchmark's own thermal watchdog (95 °C junction threshold) stopped `llama-server` mid-attempt, so the task died with `failureClass: connectivity`, 0 tokens, `ECONNREFUSED 127.0.0.1:8097`. Per the rules of evidence a crashed tool is not a red. The threshold was wrong, not the run — this workload reaches 97 °C at 194–215 W against a hardware `crit` of 110 °C; the guard was raised to 105 °C afterwards.

Tool-call totals are missing where the worktree was cleaned up before the per-task JSON was harvested — a collection gap, not a measurement failure. Only local arms have attempts/tool-call telemetry; only BASE was required to produce tests.

### 3.2 Workload B — T010 (local models only)

| Model | Block | Runner | True green | Attempts (mean · range) | Wall mean · σ · CV | Per-iteration wall | Tool calls | chars/s |
|---|---|---|---|---|---|---|---|---|
| Brian6145/27B-…-Q4_K_M | 1 | **arm A** | **3/3** | 2.33 · 1–4 | 542.1 s · 163.5 · 30 % | 363.0 / 505.0 / 758.2 | 254 | 6.84 |
| Brian6145/27B-…-Q4_K_M | 1 | arm B | **3/3** | 1.33 · 1–2 | 318.3 s · 118.3 · 37 % | 224.3 / 485.2 / 245.3 | 131 | 8.62 |
| Brian6145/27B-…-Q4_K_M | 2 | arm B | **2/3** | 2.67 · 1–4 | 566.5 s · 222.8 · 39 % | 252.7 / 699.4 / 747.5✗ | 292 | 4.89 |
| unsloth/27B-Q4_K_M | 1 | arm B | **3/3** | 2.00 · 2–2 | 365.8 s · 71.6 · 20 % | 275.2 / 371.7 / 450.5 | 183 | 9.79 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 1 | arm B | **3/3** | 1.33 · 1–2 | 213.4 s · 47.8 · 22 % | 182.3 / 176.9 / 281.0 | 123 | 10.97 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 2 | arm B | **3/3** | 1.33 · 1–2 | 237.1 s · 79.3 · 33 % | 185.0 / 349.2 / 177.1 | 150 | 10.22 |
| unsloth/35B-A3B-UD-Q5_K_M | 1 | arm B | **3/3** | 2.00 · 1–3 | 281.2 s · 80.7 · 29 % | 395.2 / 227.4 / 220.9 | 183 | 8.96 |
| unsloth/35B-A3B-UD-Q5_K_M | 2 | arm B | **3/3** | 1.00 · 1–1 | 201.7 s · 36.0 · 18 % | 157.8 / 201.2 / 246.1 | 115 | 9.53 |
| unsloth/35B-A3B-UD-Q4_K_M | 1 | arm B | **3/3** | 2.00 · 2–2 | 257.5 s · 5.8 · **2.3 %** | 260.6 / 249.4 / 262.5 | 209 | **14.35** |

✗ = `local-exhausted`, +0/−0 lines — the file was never changed, so the triple verification failed on "Changed: NO". Zero false greens in all 29 iterations.

### 3.3 Serving-level throughput — MTP, prefill, decode

Extracted from the per-run `llama-server` logs. **All five local models ran with MTP speculative decoding active** (`--spec-type draft-mtp`), and all show healthy draft acceptance — none silently fell back to plain decoding.

| Model | Prefill (median) | Decode (median) | Draft acceptance (mean) | Mean draft length |
|---|---|---|---|---|
| Brian6145/27B-…-Q4_K_M | 558 t/s | **68.7 t/s** | 0.852 | 3.56 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 1605 t/s | 155.7 t/s | 0.826 | 3.48 |
| unsloth/35B-A3B-UD-Q5_K_M | 1366–1465 t/s | 149.3–154.1 t/s | 0.787–0.834 | 3.36–3.50 |
| unsloth/35B-A3B-UD-Q4_K_M | 1909–1928 t/s | 151.1–151.8 t/s | 0.766–0.785 | 3.30–3.35 |
| unsloth/27B-Q4_K_M | not captured | not captured | not captured | — |

**The campaign's cleanest structural result.** The dense build decodes at **68.7 t/s** while every A3B (3B-active MoE) build decodes at ~150 t/s — a **2.2× gap** — and its prefill is 2.5–3.5× slower. The MoE builds are hardware-cheaper per token by a wide margin. That they do *not* dominate the wall-clock results is the whole story: they spend the advantage on emitting far more tokens. `unsloth/27B-Q4_K_M` has no serving metrics — its worktree was removed before the logs were preserved. Not re-run (deliberate).

### 3.4 Variance — two layers, and the second is bigger

**Layer 1 — within a block** (3 iterations, one loaded server): CV ranges from 2.3 % to 39 % (§3.2). On its own this would suggest some models are far more predictable than others.

**Layer 2 — between blocks / between samples** of the same model on the same runner. This layer was not measured before this campaign, and it dominates:

| Model | T010 block 1 | T010 block 2 | Between-block shift |
|---|---|---|---|
| Brian6145/27B-…-Q4_K_M (arm B) | 3/3 · 318.3 s | **2/3** · 566.5 s | **+78 %**, and reliability dropped |
| mradermacher/27B-A3B-Coder-Q5_K_M | 3/3 · 213.4 s | 3/3 · 237.1 s | **+11 %** |
| unsloth/35B-A3B-UD-Q5_K_M | 3/3 · 281.2 s | 3/3 · 201.7 s | −28 % |

| Model | Phase-1 green | Generated tokens | Wall |
|---|---|---|---|
| Brian6145/27B-…-Q4_K_M (arm B, s2→s3) | 9/9 → 9/9 | 20 745 → 21 346 (+3 %) | 1549 → 1830 s (+18 %) |
| mradermacher/27B-A3B-Coder-Q5_K_M | **7/9 → 9/9** | 107 241 → 29 312 (**−73 %**) | 2059 → 1371 s (−33 %) |
| unsloth/35B-A3B-UD-Q5_K_M | **8/9 → 9/9** | 67 638 → 41 630 (−38 %) | 1791 → 1405 s (−22 %) |
| unsloth/35B-A3B-UD-Q4_K_M | **7/9 → 9/9** | 181 545 → 39 801 (**−78 %**) | 3072 → 1361 s (−56 %) |
| ThinkingCap-27B-Q6_K_L · q8_0 (s1→s2) | 9/9 → 9/9 | 17 406 → 16 027 (−8 %) | 1456 → 1554 s (+7 %) |

**ThinkingCap is the first arm whose sample-to-sample spread is small.** ±8 % on generated tokens and ±7 % on wall, against −38 % to −78 % token swings for every MoE arm. Its instability sits elsewhere entirely — not in cost, but in *whether the `hu.ts` regression fires* (4 of 5 samples). Cost predictability and behavioural predictability are independent properties, and this arm has the first without the second.

**Consequence.** A single block's tight σ does not mean the model is predictable — `unsloth/35B-A3B-UD-Q4_K_M` produced the campaign's tightest T010 block (CV 2.3 %) *and* its worst phase-1 sample (181 545 generated tokens, 4.6× its own second sample). Any ranking built on one block or one sample is unsafe, in either direction.

### 3.5 The harness change: arm A vs arm B

`Brian6145/27B-…-Q4_K_M` is the only model measured on both. All T010 iterations pooled:

| | Arm A (`d7532e4f`) | Arm B (`8d2c3a00`) |
|---|---|---|
| T010 iterations | 5 | 6 |
| True-green | **5/5** | **5/6** |
| Wall, green runs only | 483.5 s · σ 197.9 | 381.4 s · σ 207.2 |
| Phase-1 samples | 1 × 9/9 | 2 × 9/9 |

Difference in wall = 102.1 s, standard error 128.1 s, **t = 0.80** — not distinguishable. Resolving a gap this size at 80 % power would take **~61 iterations per arm** (~10 h GPU each). Re-running arm A for precision is not worth it; **pinning `RUNNER_SEED` and running a paired comparison** answers the same question at a fraction of the cost, and that capability is exactly what `b282b32d` added.

**One signal deserves a follow-up.** Deep retries are rare — only 2 of 11 T010 iterations reached ≥3 attempts — and the two arms split on them:

| Arm | Deep-retry case | Outcome |
|---|---|---|
| Arm A | 4 attempts, 758.2 s | **converged to true-green** |
| Arm B | 4 attempts, 747.5 s | **`local-exhausted`, +0/−0 lines** |

In arm A the deleted sampling ladder raised temperature 0.6 → 0.8 from attempt 3; in arm B every attempt stays at 0.6 with only a seed offset for diversity. The campaign's single failed T010 iteration is arm B's deep-retry case. This is n=1 vs n=1 — **not evidence of regression** — but it is the first data of any kind touching `1dc121f8`, with a plausible mechanism: temperature escalation may supply escape diversity at depth that seed variation does not. Resolving it needs a workload that reliably reaches attempt ≥3, not more random sampling.

### 3.6 Where the work actually goes — failure and cost concentration

Across **90 phase-1 task-runs** (local arms), there were 5 failures, and they are not spread across the 9 tasks:

| Task | Failures | Shape |
|---|---|---|
| **T031** | **3** | `failed`, `gate-fail`, **0-byte patch** — the run consumed 663 k–1 217 k input tokens and produced no edit at all |
| **T022** | **2** | `local-exhausted` — 5 attempts (Coder-Q5) and **7 attempts** (UD-Q4), 57 k and 147 k generated tokens |
| T001, T002, T003, T004, T014, T021, T030 | **0** | — |

Two tasks account for 100 % of the failures. The cost concentration is even sharper — the worst single task-run in the campaign:

| `unsloth/35B-A3B-UD-Q4_K_M` sample 1, task T022 | Value | Share of that whole 9-task sample |
|---|---|---|
| Attempts | 7 | — |
| Input tokens | 4 335 421 | **64 %** |
| Generated tokens | 147 538 | **81 %** |
| Wall | 1600 s | **52 %** |
| Result | `local-exhausted` at the `lint` stage | wasted |

One task out of nine consumed over half the wall-clock and four fifths of the generated tokens, and produced nothing. The same model's second sample solved T022 in **1 attempt**. Successful T022 patches range from 1 880 to **12 323 bytes** — a 6.5× spread in solution size for one statement.

---

## 4. Quality — the LLM-judge verdicts

### 4.1 Method, and the one caveat that matters

Two judge passes, each using two Opus judges — one on the config/i18n/domain tasks (T001, T002, T004, T030, T031), one on the React UI tasks (T003, T014, T021, T022). Every judge saw **all of its pass's arms side by side on the same task**.

| Pass | Arms judged | Inputs |
|---|---|---|
| **1** — three local models | `Brian6145/27B-…-Q4_K_M` (arm B), `mradermacher/27B-A3B-Coder-Q5_K_M` (sample 2), `unsloth/35B-A3B-UD-Q4_K_M` (sample 2) | each model's **9/9** sample — best form, not its bad day |
| **2** — production vs simulation vs runner | **BASE**, **SIM**, `unsloth/27B-Q4_K_M` (sample 1) | all on runner `8d2c3a00`, same nav bundles |
| **4** — ThinkingCap vs the production bar | **BASE**, `ThinkingCap-27B-Q6_K_L · q8_0` (sample 1) | BASE's preserved working tree vs the q8 sample-1 worktree, same nav bundles |

**Pass 4 is self-calibrating.** It re-judged BASE from scratch, blind to the pass-2 result, and BASE landed on **8 · 1 · 0 again** — the same total, and the same single `partial` on T022. Two independent judge pairs reaching the identical grade on the identical code is the strongest calibration evidence in this document; it means the ThinkingCap column can be read against the pass-2 group rather than only against itself.

Judging axes, weighted in order: requirement coverage → the rules that arm was actually given (`agentic-runner-rules/atoms/*` for local + SIM; repo rules for BASE) → repo-baked rules (`UI.md`, `TYPESCRIPT.md`, `COMMON.md`, Import Rules) → engineering quality (SRP, SoC, naming, edge cases, logical gaps, consistency).

> **Cross-pass caveat.** No model appears in both passes, so no verdict conflicts. But verdicts are **relative within a pass**: a `pass` in pass 1 was scored against two local models, a `pass` in pass 2 against Claude Opus. Comparing a cell from pass 1 to a cell from pass 2 is indicative, not calibrated. Within a pass, the columns are directly comparable.

### 4.2 Verdict matrix — 9 tasks × 6 arms

Deciding reasons for every non-`pass` cell are in §7.1.

| Task | BASE ² | SIM ² | Brian6145/27B-Q4 ¹ | A3B-Coder-Q5 ¹ | UD-Q4 ¹ | UD-Q5 ³ | unsloth/27B-Q4 ² | ThinkingCap-Q6/q8 ⁴ |
|---|---|---|---|---|---|---|---|---|
| T001 provider-unavailable keys | **pass** | **pass** | **pass** | **fail** | partial | partial | **pass** | partial |
| T002 `LLAMA_SWAP_DEFAULT_BASE_URL` | **pass** | **pass** | **pass** | **pass** | **pass** | partial | partial | **pass** |
| T003 shadcn `Alert` | **pass** | partial | **pass** | **fail** | **pass** | partial | partial | partial |
| T004 `ParallelismMode` widening | **pass** | **pass** | **pass** | **pass** | **pass** | **pass** | **pass** | **pass** |
| T014 RunBar disabled + helper text | **pass** | partial | **pass** | partial | partial | partial | **fail** | partial |
| T021 Settings dialog height | **pass** | partial | **pass** | **pass** | **pass** | **pass** | partial | partial |
| T022 `PromptHistoryFilterBar` | partial | partial | partial | partial | **pass** | partial | **fail** | **pass** |
| T030 scheduling keys | **pass** | **pass** | partial | partial | **pass** | **pass** | partial | **fail** |
| T031 filter keys | **pass** | **pass** | **pass** | partial | partial | partial | **pass** | **fail** |
| **Totals** | **8 · 1 · 0** | **5 · 4 · 0** | **7 · 2 · 0** | **3 · 4 · 2** | **6 · 3 · 0** | **3 · 6 · 0** | **3 · 4 · 2** | **3 · 4 · 2** |

Totals read *pass · partial · fail*. ¹ = judge pass 1, ² = judge pass 2, ³ = judge pass 3 (`UD-Q5` vs `UD-Q4`, paired, sample 2 each — run to answer whether Q5 earns its extra 4 GB), ⁴ = judge pass 4 (`ThinkingCap-Q6` at `q8_0` vs BASE, sample 1 each).

**ThinkingCap's deciding cells.** T030 `fail` — of three named deliverables (mode label, schedule-help tooltip copy, parallel-switch helper) the tooltip copy is absent from both locales. T031 `fail` — the `hu.ts` hunk **deletes four existing Hungarian values and replaces them with English** (`'Minden típus'` → `'All types'`, `'Felhasználói'` → `'User'`, `'Rendszer'` → `'System'`, `'Minden forrás'` → `'All sources'`); a regression on working translations, not a coverage miss. T001 `partial` — keys land in both files but the `hu.ts` values are verbatim English. T014 / T021 `partial` — the statement-named handles `parallel-run-switch` and `settings-dialog-content` are never created. T022 `pass` — the only arm besides `UD-Q4` to earn it, on APG-correct `typeAriaLabel`/`sourceAriaLabel` props where BASE derived the accessible name from the current *value*.

**The regression is reproducible and cache-independent.** Across the five completed ThinkingCap samples the `hu.ts` overwrite appears in **four** (q8 samples 1 and 3, f16 samples 1 and 2); q8 sample 2 is the only clean one. It occurs at both KV-cache settings, so it is model behaviour, not a quantisation artifact.

**Three tasks discriminate nothing.** T002, T004 and T021 came out effectively identical from the local models in pass 1 (T004 byte-identical across all three), and T004 was byte-identical across all three arms of pass 2 as well. Every real difference lives in T001, T003, T014, T022, T030, T031.

### 4.3 Per-axis winners (judge pass 1)

| Axis | Strongest | Note |
|---|---|---|
| Requirement coverage | **Brian6145/27B-Q4** | Only model delivering T014's helper text and T001's `message` key |
| Agentic-rule compliance | **Brian6145/27B-Q4** | English placeholders in `hu.ts` on all three i18n tasks; A3B-Coder violated this three times |
| Plan/contract fidelity | **UD-Q4** | Matched T022's locked 6-prop contract verbatim; Brian6145 rewrote it into 14 props |
| Repo rules (UI.md) | **UD-Q4** | No store import, no renderer state; Brian6145 breached renderer purity, A3B-Coder breached semantic-HTML/a11y |
| Test discipline | **UD-Q4** | Shipped the locked test cases + snapshot, `toBeDisabled()` semantic matcher; Brian6145 shipped zero tests |
| Engineering quality | **Brian6145** on T003, **UD-Q4** elsewhere | Brian6145's Alert is the richer primitive; UD-Q4's is the cleaner one |

### 4.4 Defects the arms share — these indict the tasks, not the models

Where independent arms converge on the same failure, the input is at fault. Items 1, 3 and 4 were reproduced in **both** judge passes, on disjoint model sets — they are two-experiment findings.

| # | Defect | Evidence |
|---|---|---|
| 1 | **The three i18n statements name a concept, never a key**, while `atoms/code/i18n-keys.md` demands "use the exact key names the task names" | Pass 1: `providerUnavailableTitle` vs `gracefulProviderUnavailable.title`; `settings.fullySequential` vs `settings.sequential`; `filter.typeLabel` vs `filter.typeDropdown` vs `filter.type.label`. Pass 2: `parallelDisabledHelp` / `parallelDisabledHint` / `parallelDisabled`. No arm can comply; no consumer task can bind |
| 2 | **No namespace or placement is specified** | T001's keys landed in three different objects — flat `chat`, `chat.header`, and a new `chat.gracefulProviderUnavailable` |
| 3 | **T022's locked contract contradicts the rule set** | `plan.md:224-233` / `:220-236` fixes six props with no label, aria or `className` field, while `atoms/ui/semantic-html.md` mandates "label every interactive element". Six arms, five different wrong answers: invented aria props, none at all, an option label misused as a field label, and (BASE) an accessible name derived from the current *value* |
| 4 | **T014 references a locator that does not exist** and states no source for its helper text | `RunBar.tsx` contains no `parallel-run-switch` testid and the statement never says to create one; T030 supplies the helper-text key but the statement never binds it. Only BASE created the locator |
| 5 | **T021's `settings-dialog-content` locator is named in the statement**, yet only BASE created it | T029's geometry E2E cannot be written against SIM's, unsloth/27B's or the pass-1 models' output |
| 6 | **The llama-swap base URL's shape is unspecified** | Whether the constant carries the `/v1` API prefix (the Ollama sibling is origin-only, paths appended by the provider). All arms guessed identically — a guess that agrees is still a guess |

### 4.5 Gate reality — runner-green and production-green are not the same bar

BASE is the only arm that ran the real gates. Both blockers it hit are **workflow defects, not code defects**:

1. **The commit gate blocks on pre-existing violations.** `export default en;` / `export default hu;` (locale file tails) and `let configCache` (`src/config.ts:37`) all exist at HEAD. The gate lints *changed files*, so every i18n task inherits three errors it did not cause.
2. **depcruise rejects the phase boundary.** `alert.tsx` and `PromptHistoryFilterBar.tsx` are created in phase 1 and consumed in phase 2 (T017, T023) — reported as NOVEL violations. The phase decomposition and the gate contradict each other.

3. **All seven runner gates pass a destructive regression.** ThinkingCap's T031 deleted four working Hungarian translations and wrote English in their place, and `tsc`, `test`, `lint`, `decomposition`, `functional-style` and `format` were all green on it. The mechanism is structural: `const en: TranslationStructure` is typed while `const hu = {` is not, so no compiler check binds the two locales, and no test asserts translation content. This is exactly the hole **LEARNED-RULES R-023** describes — the rule exists, the gate implementing it does not. Any arm can land this defect; ThinkingCap is merely the one that did, in 4 of 5 samples.

Neither was fixed or baselined. The runner arms never met either gate: they pin patches with `git write-tree`, which runs no hooks. BASE also ran `[regress]` green (4382 tests) and the visual project, where 9 snapshots failed on T021's *intended* geometry change; baselines were not overwritten.

### 4.6 How much to trust these verdicts

**The matrix moves when the comparison set moves.** `unsloth/35B-A3B-UD-Q4_K_M` sample 2 was judged twice — in pass 1 against two other local models, in pass 3 against its own Q5 sibling. Both passes produced the same **6 · 3 · 0** total, but **two of nine cells flipped**: T022 `pass` → `partial` and T031 `partial` → `pass`. Same code, same sample, different neighbours. Read a single cell as an ordering signal within its own pass, never as an absolute grade.

**Two "contract breach" verdicts were scored against arms that never received the contract.** The archived payloads settle it: T022's system block ends with *"(no Module Placement Map row matched this file — target derived from the task's declared files)"*, and neither the locked `PromptHistoryFilterBarProps` shape nor the `### Surface:` signature appears anywhere in the payload. The statement's `per plan §Surface prompt-history-filter-selects` points at a document the model is never given. The same "no placement row matched" line appears on T001, T030 and T031.

| Consequence | Correction |
|---|---|
| Contract-fidelity verdicts against runner-arm models (SIM, unsloth/27B, and pass 1's models) | Not model defects on that axis — **the contract was never delivered**. `UD-Q4`'s "contract-exact" six props are convergent design, not compliance |
| The `planContext` mechanism | It matches **Module Placement Map** rows by task file path. A contract authored as a `### Surface:` block never reaches the model. This is a **nav-bundle defect**, upstream of both the runner and the models |
| BASE's advantage on T022 | Partly mine: the BASE delegation prompt named "plan placement rows (the locked prop contract)" and the Opus agent can `Read plan.md` directly. SIM's payload carried neither the hint nor the contract. Disclosed rather than corrected — it is the production path's real shape, but it is not an equal-input comparison on this task |

A separate plan-surface nit, independent of delivery: the locked signature is written `export function PromptHistoryFilterBar(props: …): React.ReactElement;` with no import guidance — the exact shape that produces TS2686 in a file with no `react` namespace import. It cannot explain the runner arms' occurrences (they never saw it), but any arm that *does* read `plan.md` inherits it.

---

## 5. Key findings

| # | Finding | Evidence |
|---|---|---|
| 1 | **The harness change is outcome-neutral** | Within the model measured on both arms: phase-1 9/9 on arm A, 9/9 twice on arm B; T010 5/5 vs 5/6 true-green, wall means 102 s apart at t = 0.80. No regression, no improvement |
| 2 | **The seed is the only proven new capability** | Two runs with `RUNNER_SEED=12345` on a clean tree produced **byte-identical output** and identical generated-token counts (4006). Unpinned it is inert |
| 3 | **`8d2c3a00` (lint ranking) remains unvalidated** | It needs lint and tsc/test to fail in the same attempt; across 119 runs, lint failed once |
| 4 | **Between-block variance is the dominant noise term** | Larger than within-block σ and larger than any measured difference between models or arms. Single-block rankings are unsafe |
| 5 | **MoE builds are 2.2× faster per token and spend it all on emitting more tokens** | Decode 149–156 t/s vs the dense build's 68.7 t/s; prefill up to 3.5× faster. Yet generated totals on the same 9 tasks run 16 245 → 181 545. Throughput is not the bottleneck; verbosity is |
| 6 | **Reliability does not separate the local models** | All five reached 3/3 on T010 and 9/9 on phase-1 at least once. Zero false greens in 29 verified T010 iterations |
| 7 | **Two tasks own every failure and most of the waste** | T031 (3 failures, always 0-byte) and T022 (2 exhaustions, up to 7 attempts and 147 k tokens). Both task-side, corroborated by the same model both failing and passing them |
| 8 | **Gate-green is not spec-complete** | Passing runs omitted T014's helper text, mis-keyed i18n against each other, and shipped a T022 patch that does not type-check. This is the failure mode `6bb7869f` targets — upstream of the runner |
| 9 | **The false-green defences work** | Zero false greens in 29 verified iterations; every 0-byte run was reported `failed`, not success — the `443d47cb` / `1d4370c7` D12 fix confirmed on live output |
| 10 | **The gap between local models and the frontier is coverage, not quality** | SIM's code is frequently the cleanest of its pass, yet it lost three named deliverables it never attempted; the local models' failures cluster on judgement-heavy naming and contract work, not on mechanical edits |
| 11 | **Every harness-visible metric can point the wrong way at once** | `ThinkingCap-27B-Q6_K_L` posted the campaign's best attempts/task (1.0), lowest wall (1456 s), lowest input cost and joint-lowest generated tokens — and judged 3 · 4 · 2, bottom tier, while silently overwriting four working `hu.ts` translations in 4 of 5 samples. Gate-pass rate, attempt count and wall are **not** proxies for output quality; only reading the diff separated them |
| 12 | **A gate named in LEARNED-RULES is not a gate that exists** | R-023 demands that a missing/renamed i18n key fail the commit gate. `const en: TranslationStructure` is typed, `const hu = {` is not — so a locale can be silently de-translated with all seven gates green. The rule has been written down for longer than this campaign has run |

---

## 6. Model scorecard

| Arm | Verdict totals | Pros | Cons | Comment |
|---|---|---|---|---|
| **BASE** — Opus via `/speckit.implement` | 8 · 1 · 0 | Only arm reading statements to the end; only arm shipping tests (24 cases); only arm creating the locators later tasks verify against | Follows a bad contract literally into an a11y defect — and freezes it in a test; slowest to a mergeable state because of the gates | The bar to beat. Its advantage is workflow-driven, not capability-driven |
| **SIM** — Sonnet on the runner payload | 5 · 4 · 0 | Cleanest rule execution of its pass, zero scope creep, no fails, wall comparable to BASE (1382 vs 1451 s) | Truncates statements at the first clause — 3 of 4 UI tasks lost a named deliverable; one i18n key it added is dead in its own arm | Proves the payload is not the limiting factor. Its gap is the cheapest one to close: an explicit clause checklist |
| **Brian6145/27B-…-Q4_K_M** | 7 · 2 · 0 | Best requirement coverage and rule compliance of the local models; cheapest generated-token cost in the campaign (16 245); three clean 9/9 samples, no phase-1 failure ever | Slowest decode (68.7 t/s); ignores locked contracts (14 props against 6); breached renderer purity; zero tests; produced the only 2/3 T010 block | The safe local default for statement-driven work |
| **unsloth/35B-A3B-UD-Q4_K_M** | 6 · 3 · 0 | Sole contract-exact T022 implementation; sole model shipping the locked test cases; tightest T010 block ever measured (CV 2.3 %); fastest chars/s (14.35) | Campaign's worst phase-1 sample (181 545 tokens, one task eating 81 %); sloppy a11y edges (`htmlFor` on an id Radix never generates); an identity function dressed as a handler factory | Best at obeying what is locked down. Do not adopt on the T010 number alone |
| **mradermacher/27B-A3B-Coder-Q5_K_M** | 3 · 4 · 2 | Only model whose two T010 blocks agree within 11 %, both 3/3; fastest T010 means; 155.7 t/s decode | Two outright failures; `role="alert"` missing; three `hu.ts` translation breaches; two probable TS errors; a Next.js directive in a Vite app; 107 k tokens in its bad sample | Most consistent on timing, least trustworthy on output. Card documents verbosity levers this campaign never applied |
| **unsloth/27B-Q4_K_M** | 3 · 4 · 2 | On flat tasks (T004, T031, T001) indistinguishable from the frontier arms; 9/9 phase-1; 3/3 T010 at CV 20 % | One patch does not type-check (TS2686); abandons the locked contract for hardcoded enums; wrong shadcn generation; invents a near-duplicate key | Follows explicit instructions well, reasons about surrounding context poorly. Under-measured: 1 sample, 1 block, no serving metrics |
| **bartowski/ThinkingCap-27B-Q6_K_L** (`q8_0` KV) | 3 · 4 · 2 | **Best operational profile in the campaign**: 9/9 on both clean samples at **1.0 and 1.22 attempts/task**, the only arm with a sample needing no retry at all; cheapest input cost measured (1.14 M in) and generated-token cost tied with the campaign leader (16 027–17 406 vs Brian6145's 16 245); fastest wall of any local arm (1456 s); earned T022 on accessible naming where BASE did not | **Destroys existing translations** — overwrote four working `hu.ts` values with English in 4 of 5 samples, invisible to all seven gates; drops whole named clauses (T030's tooltip copy) and every statement-named locator (`parallel-run-switch`, `settings-dialog-content`); i18n key names track neither the union member they label nor the component they belong to; zero tests | **The campaign's clearest warning that gate-green measures nothing about correctness.** Operationally the best local model measured; on output quality it ties the bottom tier (`unsloth/27B-Q4`, `A3B-Coder-Q5`) at 3 · 4 · 2. Do not adopt on the attempt/wall numbers |
| **unsloth/35B-A3B-UD-Q5_K_M** | 3 · 6 · 0 (paired vs Q4) | 9/9 phase-1 (sample 2); 3/3 on both T010 blocks; second block the cleanest of its model (1.00 attempts); correct `aria-label` where Q4 broke the label association; stronger T022 typing (discriminated union vs bare `string`) | Loses 3 · 6 to Q4's 6 · 3 on the same nine tasks; omits both contract-named testids on T022; widens `AppConfig`/`fetchConfig` for a one-constant task; invents orphan keys (`typeNone`, `sourceNone`, `filter.banner`, `filter.retry`); legacy `forwardRef` + a ref/element type mismatch on T003 | **4 GB not justified on these task shapes.** Treat as "no evidence Q5 is better", not "evidence Q4 is better" — n=1 per arm, and Q5's losses are exactly the failure modes that vary run-to-run |

---

## 7. Recommendations

### 7.1 Which arm for which job

| Situation | Choose | Why |
|---|---|---|
| Work that must merge — locked contracts, named locators, multi-clause statements | **BASE** (production `/speckit.implement`) | Sole arm reading statements to the end (8/9), sole arm shipping tests, sole arm creating downstream locators |
| Cost-controlled bulk on well-specified, single-clause tasks | **SIM**-shaped setup (Sonnet on the runner payload) | Cleanest rule execution, zero scope creep, no fails, wall comparable to BASE without the gate overhead |
| Default **local** model for mixed phase work | `Brian6145/27B-…-Q4_K_M` | Best coverage and rule compliance (7 · 2 · 0), cheapest generated tokens, three clean 9/9 samples. Accept that it ignores locked contracts and ships no tests |
| A **local** task with a locked contract or plan-specified prop shape | `unsloth/35B-A3B-UD-Q4_K_M` | Only model matching the six-prop contract verbatim and respecting renderer purity |
| Anything test-bearing (`mode: tdd`, first-test creation) | `unsloth/35B-A3B-UD-Q4_K_M` | Sole local model with real test discipline — semantic matchers, snapshot, locked cases |
| Accessibility- or ARIA-sensitive UI | `Brian6145/27B-…-Q4_K_M` or `UD-Q4` — **not** `A3B-Coder-Q5` | A3B-Coder shipped an Alert with no `role="alert"` and a dead `data-testid` on a Radix Root |
| Throughput-bound bulk on trivial tasks | any local model | T002, T004, T021 came out effectively identical; use the fastest (`UD-Q4`, 151 t/s decode) |
| Contract-, a11y- or generation-sensitive UI | **not** `unsloth/27B-Q4_K_M` | One patch does not type-check, one abandons the contract for hardcoded enums, one uses the wrong shadcn generation |
| Not recommended as a general default | `mradermacher/27B-A3B-Coder-Q5_K_M` | Two outright failures and four rule breaches, despite the best T010 block-to-block consistency |
| Anything touching an **existing translated file** | **not** `ThinkingCap-27B-Q6_K_L` | Overwrote four working `hu.ts` values with English in 4 of 5 samples; no gate catches it |
| Throughput- or attempt-bound bulk where output is **separately reviewed** | `ThinkingCap-27B-Q6_K_L` at `q8_0` | 1.0–1.22 attempts/task, 1456 s wall, ~16–17 k generated tokens — the best cost/attempt profile measured. Only with a human or judge reading the diff |

**ThinkingCap does not change the recommendation, and that is the finding.** It arrived with the best numbers any local arm has posted — fewest attempts, lowest wall, lowest input cost — and still lands at 3 · 4 · 2, tied with the bottom tier. Every metric the harness can measure without an LLM said "adopt this"; the only signal that said otherwise was a judge reading the diff. Selecting a local model on gate-pass rate, attempts or wall would have picked the one model in the campaign that silently deletes working translations.

**The practical reading.** `Brian6145/27B-Q4` and `UD-Q4` are **complementary, not ranked**: the first is better at *doing what the statement says*, the second at *obeying what the plan and the rules lock down*. Routing by task shape — statement-driven tasks to the first, contract-driven and test-bearing tasks to the second — would beat either used alone, and that is a `roleProfiles` change in `runner.config.json`, not a model change. Above them, BASE's edge is likewise structural: the workflow forces tests and locators, which is exactly what every other arm omits.

### 7.2 Which measurements to run next

1. **Pin `RUNNER_SEED` and re-run the arm A / arm B T010 comparison as a paired test.** Highest value per GPU-hour of anything left; converts a question needing ~61 iterations/arm into one needing a handful.
2. **Build a deep-retry fixture** — a task that reliably reaches attempt ≥3 — and run both arms on it. The only way to settle whether deleting the 0.6 → 0.8 temperature rung costs escape diversity.
3. **Second T010 block for `unsloth/35B-A3B-UD-Q4_K_M` and `unsloth/27B-Q4_K_M`.** Both currently rank on a single block; the Q4's 2.3 % CV is the campaign's most load-bearing unreplicated number.
4. **Apply the Coder card's verbosity levers** (repetition penalty, top-8 routing override) and re-measure phase-1.
5. **Re-measure phase-1 after task statements are regenerated under `6bb7869f`.** Today's numbers are the "before" side of that comparison.
6. ~~Judge `unsloth/35B-A3B-UD-Q5_K_M`'s output~~ — **done** (judge pass 3, §4.2 / §6): Q5 loses 3 · 6 to Q4's 6 · 3; the 4 GB is not earned on these task shapes.
7. **Re-run Q5 and Q4 3× on T001, T022 and T031 only.** Those three shapes produced every difference between them; T004 and T021 came out byte-identical, so quantisation is invisible on low-degree-of-freedom tasks. A 3× paired run on the discriminating three costs a fraction of a full phase-1 pass and converts pass 3's n=1 into a rate.
8. **Reproduce a T031 failure with capture enabled** (§8.6) — the surviving evidence narrows the mechanism to two candidates but cannot separate them, because the artifacts lived in worktrees that were deleted.

### 7.3 Which tasks to fix, and how to improve task generation

1. **T031's 0-byte termination — partially executed, see §8.6.** The "wrote nothing" reading is now verified against runner source rather than inferred from a post-run diff. What remains open is *why*: either every edit's anchor missed (a documented silent no-op) or no write tool was ever called. Separating those needs one reproduction with capture enabled.
2. **Deliver the locked contract to the model.** `planContext` matches only Module Placement Map rows by file path, so a contract authored as a `### Surface:` block never reaches the payload (§4.6) — verified on T022, with no placement row at all on T001, T030, T031 either. Until this is fixed, "contract fidelity" is not something any runner arm can be measured on. Fix in the nav builder, not in the statements.
3. **Every i18n statement must name its exact key names.** Not because a deliverable was omitted, but because the statements name no key identifiers at all — and six arms across two experiments produced mutually incompatible sets. This is what `6bb7869f` requires and what `i18n-keys.md` already demands of the model; the task side never satisfies it.
4. **Fix T022's contract.** Add `typeFieldLabel`/`sourceFieldLabel` + `className` to the locked prop list, give the signature an importable return type instead of the bare `React.ReactElement`, and change locked test case 2 to assert the trigger's *text* rather than its accessible name. Then split the renderer creation from its test — its successful patches range 1 880–12 323 bytes, a 6.5× disagreement about what "create the renderer" means. (Fixing the contract only helps once item 2 delivers it.)
5. **Add a per-task cost guard to task generation.** One task consuming 64 % of a phase's input tokens and 81 % of its generated tokens is detectable before the phase ends; a mid-phase abort above, say, 3× the phase median would have saved 1600 s in one run alone.
6. **Treat "wrote nothing" and "attempts ≥5" as task-generation feedback signals**, not just run outcomes. Both occurred exclusively on the two tasks that also under-deliver against their statements.
7. **Decide the phase-boundary policy for the commit gates.** A phase that creates a component consumed in the next phase currently cannot commit (§4.5); either baseline the orphan window or group creator and consumer into one phase.

### 7.4 Using the runner

- **Never rank models or harness versions on a single block or a single phase-1 sample.** Measured between-block shift reaches 78 % in wall and 2 tasks of green; between-sample generated tokens moved 4.6×.
- **Do not compare input-token counts across runs** — they measure round count, not work. Generated tokens are the meaningful cost signal.
- **Read `unverified` as success in `impl` mode**; only `failed` / `local-exhausted` / `discarded` are failures.
- **Preserve the `llama-server` log with the run.** Prefill/decode/draft-acceptance are only recoverable from it, and one model in this campaign lost its serving metrics to worktree cleanup.

---

## 8. Detailed analysis

### 8.1 Per-arm findings

**BASE — Claude Opus via `/speckit.implement`.** The only arm that read every statement to its end: sole deliverer of T014's second clause (helper text *and* `disabled`, plus the `parallel-run-switch` testid and `aria-describedby`), sole creator of T021's `settings-dialog-content` locator, and sole arm with the T003 `warning` variant the locked test case requires. It shipped 24 test cases across three files. Its one real defect is instructive: on T022 it obeyed the locked contract literally and produced `aria-label={labelOf(options, value)}`, so the combobox's accessible name becomes its *state* ("All types", then "System" after selection) instead of its purpose — a WCAG 4.1.2 breach — and then `T022.test.tsx` locked the bug in with `getByRole('combobox', { name: 'All types' })`. That is the characteristic failure of a well-instructed agent with no authority to push back on a bad spec. Minor: `LLAMA_SWAP_DEFAULT_BASE_URL` lacks the `: string` annotation its sibling two lines above carries, and T030 gained a fourth key (`settings.scheduleHelpAria`) beyond the statement's three — defensible under the aria rule, but unasked-for surface no other arm produced.

**SIM — Claude Sonnet on the verbatim runner payload.** The cleanest *rule* execution of its pass: English placeholders in `hu.ts`, doc comments matching file convention, the most sympathetic key placement, `cn()`/`className` on the renderer, decomposed render helpers, and zero scope creep. Given the same locked contract it produced the best-behaving T022 of the three (stable field labels), at the price of breaching five of six contract prop names. Its systematic weakness is coverage: three of four UI tasks lost a named deliverable — the `warning` variant, T014's helper text and testid, T021's locator. It also added `runBar.parallelDisabledHint` in T030 and then rendered no helper string in its own T014, leaving the key dead on arrival in its own arm. BASE is the only arm whose T030 key is consumed by its own downstream renderer.

**Brian6145/27B-…-Q4_K_M** — strongest on *what was asked*, weakest on *what was locked*. On T022 it invented fourteen props (`typeAria`, `typeAllLabel`, `typeUserLabel`, …) against `plan.md:224-233`'s six, hardcoded the option sets in `buildTypeOptions`/`buildSourceOptions` (so adding a filter value means editing the renderer), and imported `import type { PromptSource, PromptType } from '../stores/usePromptHistoryStore'` — a store import inside a renderer, against UI.md Renderer Rules. On T014 it delivered the helper text but evaluated `(props.isParallelSwitchDisabled ?? false)` inline three times with a `cn()` call inside JSX, against `atoms/ui/logicless-templates.md`. Zero tests anywhere.

**mradermacher/27B-A3B-Coder-Q5_K_M** — the only pass-1 model with outright failures. T003's Alert has **no `role="alert"`** (an alert screen readers never announce) and no `variant` prop, leaving the provider-unavailable banner with no styling hook. Both T003 and T022 use `): React.ReactElement` without the namespace `import type * as React`, a probable TS error. T022 places `data-testid="filter-type-select"` on the Radix `<Select>` Root — which renders no DOM — *and* on the trigger; the Root copy is dead and not in `SelectProps`. It also emitted `'use client';`, a Next.js App Router directive meaningless in this Vite app. On i18n it translated `hu.ts` three times against the explicit rule, once ungrammatically (`'Let tiltva — teljes szekvenciális ütemezés választva.'`).

**unsloth/35B-A3B-UD-Q4_K_M** — the most disciplined, with sloppy edges. Sole model to ship T022's locked test cases plus a snapshot, and sole contract-exact implementation. But its `<label htmlFor="filter-type">` targets an id Radix never generates (visually present, programmatically unassociated) and uses `typeOptions[0]?.label` — an *option* label — as the *field* label. It also shipped `function handleTypeChange(onTypeChange) { return onTypeChange; }`, an identity function dressed as a handler factory. On T001 it leaked a T030 scheduling string (`thirdMode: 'Everything sequentially'`) into the banner namespace.

**unsloth/27B-Q4_K_M** — every deliverable of the five logic tasks is present, and T004/T031 are indistinguishable from the frontier arms; it degrades precisely on the judgement-heavy edges. Its T022 does not compile: `): React.ReactElement` with no `react` import, under `jsx: react-jsx` → **TS2686** — and it shipped as a *passed* patch, so that arm's gate did not hold on this file (the same defect class as A3B-Coder's, now confirmed on a second model). The same file hardcodes `'ALL' | 'USER' | 'SYSTEM'` and `'CHAT' | 'LAB'` inside the component, replacing the contract's `typeOptions`/`sourceOptions` with 8 flat label props, so the container can no longer control the option set. Elsewhere: `settings.scheduleHelp` duplicates the concept of the pre-existing `settings.modeHelp` two lines above it (against "reuse its value instead of adding a second key"); `runBar.parallelDisabled` names a sentence-long help string like a boolean prop; `src/config.ts` gained a `VITE_LLAMA_SWAP_URL` env knob documented nowhere (`.env.example` lists only `VITE_OLLAMA_URL`); T003 uses shadcn **v3** markup (absolute-`svg`, `<h5>` title) in a v4 repo and omits return types on all three components, against a rule quoted verbatim in its own prompt.

### 8.2 `mradermacher/27B-A3B-Coder-Q5_K_M` is a pruned 35B-A3B, not a 27B

Its name is misleading: the "27B" is a *post-pruning* parameter count with no relationship to the two 27B dense builds. From the model card ([ManniX-ITA/Qwen3.6-27B-A3B-Coder](https://huggingface.co/ManniX-ITA/Qwen3.6-27B-A3B-Coder)):

| Property | Value |
|---|---|
| Parent | **Qwen3.6-35B-A3B** (256-expert MoE) — the same base as the two `unsloth/35B-A3B-UD-*` builds |
| Method | Expert pruning by competence map: **256 → 184 experts**, ~35B → ~27B params. No fine-tuning, no distillation |
| Selection criteria | LiveCodeBench + MultiPL-E (Rust/Java/JS), code tasks up-weighted 1.5× |
| Routing | `num_experts_per_tok = 10` (base uses 8) — post-prune recovery lever |
| Status | "research checkpoint"; code-specialist prune |
| Card's recommended sampling | temp 0.6 · top-p 0.95 · top-k 20 — **identical to what this campaign used** |
| Card's benchmarks (at Q6_K) | MultiPL-E 0.840 (above the 35B teacher's 0.827) · LiveCodeBench 0.688 · HumanEval 0.970 · IFEval 0.730 vs teacher's 0.960 |
| Card's stated caveat | verbose on open-ended reasoning; pruning *adds* rumination (30 vs 11 runaway cases). Suggests a repetition penalty or top-8 routing override |

Comparing it to `unsloth/35B-A3B-UD-*` compares a prune to its own base family; comparing it to the 27B dense builds compares unrelated architectures that share a digit. The card's verbosity caveat is **independently corroborated** by its 107 k-token phase-1 sample. This campaign ran Q5_K_M with no repetition penalty and the shipped top-10 routing, so the card's verbosity levers were never applied. The card's benchmarks are quoted at Q6_K.

### 8.3 Model fault or task fault — the separation

**T031 is a task/nav fault.** It failed on three different models and passed on all five, including on the *same* model that had failed it. Its failure shape is identical every time: the run ends having written no file at all, after consuming 600 k–1 200 k input tokens. A model that cannot do a task fails by writing something wrong; a run that lands *no write* while burning a million prompt tokens is a task-framing, navigation or tooling problem, not a capability one. §8.6 verifies the "no write" reading against runner source and narrows the mechanism — the model did emit 3–12 k output tokens, so "it never established what edit to make" is too strong.

**T022 is a task-sizing fault.** It never fails cheaply — it fails after 5 and 7 attempts, having generated 57 k and 147 k tokens. It is the only phase-1 task that creates a new renderer from scratch, and in several runs the model also created a companion test file, doubling the surface. The 6.5× spread in successful patch size says different runs disagreed about what the statement asked for.

**The models are not the weak point.** Every local model reached 3/3 true-green on the 2035-line T010 task, and 9/9 on phase-1 in at least one sample. No model failed a task that another model found easy in a systematic way.

### 8.4 The earlier Sonnet reference (superseded)

Before BASE and SIM were run, the only Claude comparison available was the 2026-07-26 `exp047` experiment, whose generated code is no longer on disk. Its documented per-task findings overlapped on four tasks (`docs/analysis/2026-07-26-0928-exp047-arm-r-vs-arm-s-osszehasonlitas.md`):

| Task | Sonnet (documented) | Best pass-1 local model |
|---|---|---|
| T004 | clean — **byte-identical patch** to the runner's | all three byte-identical — parity |
| T014 | clean — helper text present, as a prop | **Brian6145 matches**; A3B-Coder and UD-Q4 omit it |
| T003 | clean — explicit return types, semantic tokens | **UD-Q4 matches** (canonical shadcn, semantic `<h5>`); Brian6145 has element/type mismatches; A3B-Coder fails |
| T022 | clean | **UD-Q4 matches** (contract-exact + tests); the other two partial |

Its conclusion — no local model uniformly at Sonnet's level, but for each individual task at least one reached it — is now confirmed by direct measurement (§4.2) rather than reconstruction. The cost context from that experiment stands: Sonnet completed 13/13 tasks with 866 k tokens in 32 minutes, against the runner's 11/13 attempted and ~5 880 k tokens in 73 minutes.

### 8.5 `unsloth/35B-A3B-UD-Q5_K_M` vs `-Q4_K_M` — the paired VRAM question

Judge pass 3 put the two quantisations of the same base model side by side, sample 2 each, identical payloads. **Q4 wins 6 · 3 · 0 against Q5's 3 · 6 · 0**, and it wins on the two heaviest axes:

| Difference | Q5 | Q4 |
|---|---|---|
| T022 contract-named testids (`filter-type-select`, `filter-source-select`) | **omits both** — the locked selectors are unreachable to container and E2E | emits both |
| T022 field labelling | correct `aria-label` | `<label htmlFor="filter-type">` targets no such id, and its text is `typeOptions[0]?.label` → renders "All types" as the field label, frozen into the committed snapshot |
| T002 scope | also widens `AppConfig` + `fetchConfig` — a runtime-JSON contract change nothing asked for | one line + JSDoc |
| T003 idiom | legacy `forwardRef`, needs an `eslint-disable`, types `AlertDescription`'s ref `HTMLParagraphElement` while rendering a `<div>` | shadcn v4 new-york (`ComponentProps` + `data-slot`) |
| T031 key hygiene | invents `typeNone`, `sourceNone`, and `filter.banner` / `filter.retry` bled from T001 | exactly the asked-for keys |
| T001 | collapses "banner title/message" into one flat string — a named clause missed | splits `title`/`message`/`retryConnection`; leaks one T030 string into the chat namespace |

Both are byte-identical on T004 and T021, and **both miss T014's helper-text clause** — orphaning the `runBar.parallelDisabled*` key each of them added in T030. Clause-splitting is therefore a task-shape problem, not a quantisation one.

**Verdict: the 4 GB is not earned on these task shapes.** The honest form is "no evidence Q5 is better", not "evidence Q4 is better" — this is n=1 per arm, and Q5's specific losses (scope creep, key hallucination) are exactly the failure modes that vary between samples. §7.2 item 7 names the cheap experiment that would settle it.

### 8.6 T031's "wrote nothing" — what the surviving evidence proves, and what it cannot

The recommendation was to read the preserved transcripts. They are gone — the per-task runner JSON and `logs/failed_llm` were written *inside* the bench worktrees, which were removed. What survives is the per-task summary line from the phase-1 driver, for all ten T031 runs:

| Runs | Status | Attempts | Generated tok | Input tok | Patch | `touchedFiles` |
|---|---|---|---|---|---|---|
| 7 passing | `unverified` | **1** | 3 083–5 218 | 334 951–1 155 136 | 987–1 837 B | `hu.ts, en.ts` |
| 3 failing | `failed` · `gate-fail` | **1** | 3 183 · 3 258 · **12 548** | 663 803 · 831 830 · 1 217 161 | **0 B** | **empty** |

Two things this settles, and one it does not.

**Settled — the 0-byte reading is not a measurement artifact.** The runner *does* revert the tree on any status outside `{completed, unverified}`, so a post-run diff of a failed run would show 0 B regardless. But `touchedFiles` comes from `tracker.mutatedPaths()`, and the source is explicit that this set **survives `revert()`** — it answers "was this ever written", while a separate `changedPaths()` answers "does that write still stand". `touchedFiles` is empty on all three failures, so no write ever landed. Corroborating: `preserveIfDiscarded` returns early on an empty mutation set, which is why these runs left nothing in `logs/failed_llm` — there was never an artifact to lose.

**Settled — the model was not idle.** It emitted 3 183, 3 258 and 12 548 output tokens. "The model never established what edit to make" is too strong; it produced substantial content that never reached a file.

**Not settled — which of two mechanisms.** Either (a) every edit call's anchor missed, which the mutation tracker documents as a silent no-op ("an edit whose anchor never matched never enters `touchedFiles`") — plausible on `en.ts`/`hu.ts`, ~900 lines of highly repetitive object literals; or (b) the model never called a write tool at all. Separating them needs one reproduction with `RUNNER_DEBUG=1` and the transcript directory placed **outside** the run's worktree.

One further datum the earlier analysis did not have: **every** T031 run, passing or failing, used exactly **one attempt**. The three failures never escalated. Whatever ends these runs, ends them before the ladder gets a second chance.

### 8.7 Correction log

> **Correction (added after judge pass 1).** An earlier version of this document claimed that every passing T031 run omitted the "option labels" half of its statement. That was wrong. The option labels (`filter.typeAll`, `typeUser`, `typeSystem`, `sourceAll`, `sourceChat`, `sourceLab`) **already exist at `en.ts:861-867`**, and all three judged models correctly declined to add duplicates — the `agentic-runner-rules` instruction "reuse its value instead of adding a second key" was honoured universally. The real T031 statement defect is different and worse: it names no key identifiers at all (§4.4, item 1).

---

## Provenance

Runner source `8d2c3a00` for every run except the arm-A rows (`d7532e4f` · runner-src `60fdd793`). Sampling and server arguments identical for all local models. T010 nav hash `4ba017016a4b`, red baseline `47b920c37b72` (1993 lines, stub-restored before every iteration). Phase-1 tasks T001–T004, T014, T021, T022, T030, T031 in fixed order. Profiles `bench-27b-a3b-coder`, `bench-27b-unsloth-q4`, `bench-35b-unsloth-q4` registered by `9b99b788`, `40b824a6`, `dca8a6a9`.

BASE and SIM ran on `8d2c3a00` (BASE in the main worktree, SIM in a dedicated worktree at that SHA), same nav bundles, same fixed task order. SIM's nine verbatim runner payloads and all arms' per-task patches are preserved with the campaign evidence. BASE's code is uncommitted — both commit gates rejected it for the pre-existing / phase-boundary reasons in §4.5.

Bench reports (schema `runner-bench/1`): `…-armA-head`, `…-armB-simplify`, `…-merged-35b`, `…-a3b-coder`, `…-unsloth-q4`, `…-unsloth-35b-q4`, `…-brian-q4-block2`, `…-coder-q5-block2`, `…-uns35q5-block2`.
