# Design: `pricing-deferred` — a new opus-hard eval task (85k depth, union + async mine)

- **Date:** 2026-07-15 · **For:** `campaigns/2026-07-14-hardest-tasks-27b-vs-35b` (extension)
- **Status:** design APPROVED by user; task authoring delegated to a `fable` subagent
- **Why:** the campaign is underpowered at 4 tasks (needs ~8+); and no current task admits Qwen's
  documented 32,768-token thinking budget at 128k depth. This task is smaller (85k) and harder.

## Goal

ONE new TypeScript task that is:
1. **~85k-token prompt** → total (85k + up to 32,768 thinking + ~2k answer) ≈ **120k**, fits ctx 163840
   with room for `--reasoning-budget -1` (unlimited) to run **without answer truncation**.
2. **Hard for opus too** — opus must NOT trivially hard-pass, but the task must be **passable**
   (not a ceiling task like `expr-eval`/`lru-cache`, where nobody passes and the label is meaningless).
3. Contains a **hidden mine**: an indirect, non-trivial async defect — hard to find, fix, and test.
4. Requires a **union type extension** forcing aligned edits across **multiple files**.
5. Auto-gradable by the existing `score_typescript.py` objectives.

## The two lessons this design is built on (from `eval-design.md`)

> **§4.5** `shape-variant` — **REJECTED (too easy)**: "all three tiers score 1.0. TypeScript exhaustiveness
> makes `tsc` enumerate every site to edit — a checklist even haiku follows. **Lesson: compiler-guided
> refactors don't discriminate.**"

> **Lesson 1:** "a *hard* type task must be one that **still compiles but is semantically wrong** (caught by
> tests, not the compiler) — i.e. **indirect coupling, not exhaustiveness**."

**Therefore the union extension MUST NOT be compiler-guided.** This is the single most important
constraint in this document. `store-remove` (indirect coupling, multi-file) also failed — it scored **89 %**
and was dropped — because its coupling was *local and in one file*. This design distributes it AND hides it
behind branches `tsc` will not flag.

## Design — `pricing-deferred`

**Contract (spec):** add a `deferred` variant to the `Amount` union and make the pricing pipeline handle it
correctly, end to end.

```ts
type Amount =
  | { kind: 'fixed';    value: number }
  | { kind: 'percent';  pct: number }
  | { kind: 'deferred'; load: () => Promise<number> }   // ← NEW, added by the model
```

**`base/` mini-project (green before the change, ~4 files):**

| file | contains | the trap |
|---|---|---|
| `types.ts` | the `Amount` union | the edit point |
| `pricing.ts` | `if (a.kind === 'fixed') … else …` | **Trap 1 — silent fallthrough.** `deferred` lands in the `else` and is treated as a percent. **Compiles clean. Wrong number.** Caught only by tests. |
| `report.ts` | `Partial<Record<Amount['kind'], Fmt>>` + `?? fallback` | **Trap 2 — non-exhaustive lookup.** ⚠️ **MUST be `Partial<Record<…>>` (or a Map / index-signature), NEVER a plain `Record<Kind, Fmt>`** — a plain `Record` *errors* when the union grows, which re-creates the compiler checklist and re-runs the `shape-variant` failure. Load-bearing detail. |
| `cache.ts` | `if (!cache.has(k)) cache.set(k, await compute(a))` | **Trap 3 — the async race.** Two concurrent calls both miss → `load()` fires twice. Fix = cache the **promise**, not the value (async-memo's lesson, but distributed across files). |
| — | making one variant async | **Trap 4 — async ripple.** `computeTotal` must become `async`; every caller must be aligned. This is the multi-file alignment, driven by **semantics**, not by `tsc` pointing at each site. |

**Why this should land in the opus band:** `async-memo` is the **only** opus-tier task in the current set
that actually discriminates (opus hard-passes; sonnet/haiku do not, despite getting the logic right).
This task reuses that proven mechanism (in-flight dedup + don't-cache-failures) and *adds* a
non-compiler-guided union extension and cross-file retrieval at depth.

**Hidden tests (`hidden/`):**
- `deferred` computes correctly (NOT silently treated as percent) — kills Trap 1
- `load()` called **exactly once** under N concurrent calls for the same key — kills Trap 3
- a **rejected** `load()` is **not** cached — a retry must re-invoke (the async-memo lesson)
- other variants (`fixed`, `percent`) unaffected — no regression
- distinct keys do not interfere
- `deferred` formats correctly — kills Trap 2

## Constraints the author MUST honor

1. 🚨 **DO NOT add a file to `ts-harness/lib/`.** `build_context.py:lib_sources()` globs **all** `lib/*.ts`
   into **every** task's prompt. A new lib file would silently change the prompt of the existing 4 tasks —
   so the new `rb16384` cells would run a **different prompt** than the `rb4096` cells they are compared
   against, **confounding the entire budget axis**. **Reuse the already-planted `Clock`**
   (`reuse.json` → `{"symbol": "Clock", "module": "lib/clock"}`), which is natural for deferred/TTL work.
2. **Multi-file task layout** (copy `store-remove` / `shape-variant`): `base/` (green mini-project the model
   edits) + `hidden/` (hidden tests) + `reuse.json` + `rules.md` + `spec.md`. Single-file tasks embed the
   buggy code in `spec.md` instead — **not** this one.
3. **`base/` must be green** (`tsc` + `eslint` + `vitest` all clean) *before* the model's change.
4. **Per-task `reuse.json` is mandatory** — a past grader bug came from hardcoding one task's util.
5. **Test-file lint** is relaxed for `*.test.ts` (`require-await`, `no-empty-function`); impl files stay strict.
6. **Prompt sizing:** `build_context.py --tokens 85000` (its `CHARS_PER_TOK = 4` is rough; the campaign
   measured **~3.93 chars/tok** on real TS → expect ~334k chars). Verify the REAL token count.
7. **BDD test titles** (`should … when …`) are graded (`bdd`); vitest only (`novj`).

## Risks

| risk | mitigation |
|---|---|
| **Overshoots into a ceiling task** (nobody passes) — how `expr-eval`/`lru-cache` failed | **Calibrate against opus BEFORE any GPU time.** Target: opus hard-passes *sometimes* (not 3/3, not 0/3); sonnet/haiku mostly fail. |
| Undershoots (another `store-remove` at 89 %) | If opus hard-passes 3/3 one-shot, add a trap (e.g. a second non-flagged site) rather than shipping a non-discriminator |
| A plain `Record` sneaks in → compiler-guided → `shape-variant` redux | explicit review gate: `grep` the base for `Record<` and assert `Partial<`/Map/index-signature |
| Depth changes vs the other 4 tasks (85k vs 128k) | **not a confound** — the analysis pairs Δ **by task**; every cell runs this task identically. Must be stated in the write-up. |

## Acceptance

- `base/` green; task graded end-to-end by `score_typescript.py` with a sane objective vector
- opus calibration lands in the **hard-but-passable** band (see risks)
- prompt measures ~85k real tokens
- adding it does **not** alter any existing task's prompt (no `lib/` change) — verify byte-identically
