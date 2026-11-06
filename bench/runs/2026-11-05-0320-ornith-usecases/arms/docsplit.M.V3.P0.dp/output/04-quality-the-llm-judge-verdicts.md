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

