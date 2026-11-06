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

