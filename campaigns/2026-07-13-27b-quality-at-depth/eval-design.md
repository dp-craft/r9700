# Eval design & test-data quality — 27B quality-at-depth campaign

*Companion to `README.md` (the runbook). This document explains, for a reader who did not build it:
what the eval measures, every task in detail, how grading works, and — with real measurements — how
good the test data is at telling configurations apart. All numbers here are MEASURED on this repo's
harness (`score_typescript.py` running real `tsc`/`eslint`/`vitest`); the calibration rows are in
`calibration.jsonl`.*

---

## 1. What this campaign is trying to answer
Campaign 2 tuned Qwen3.6-27B's `--reasoning-budget` on toy-length prompts where accuracy saturated at
100%, so temperature and reasoning-effort could not be distinguished. This campaign fixes that on two
axes at once:

1. **Real operating depth** — tasks run inside **64–128k tokens of real TypeScript** (the user's own
   codebase, vendored + sanitized), not short padded prompts. Questions: does the best reasoning-budget
   shift with depth? does rule-following survive lost-in-the-middle? does KV `q8_0` cost quality at 128k?
2. **A hard, multi-objective eval** calibrated so that a weak model fails and a strong one clears it —
   giving the resolution to separate configs.

The output is a deployable per-model config: `{sampling, reasoning-budget, KV}` that holds up at depth
for heavy agentic TypeScript work.

## 2. The task shape (why it looks like real work)
Every task is one **integrated TypeScript TDD task**, not a bag of separate micro-tests, because real
work combines everything: you write code that must be correct, strictly typed, lint-clean, reuse
existing utilities, and be tested — all together. Each task gives the model:

- a **spec** (`spec.md`) with an exact function contract,
- **rules** (`rules.md`) distilled from the user's real `code-logic-writer.md` (explicit return types,
  `readonly`, no `any`/`!`, functions `<20` lines, reuse-don't-reinvent, vitest-only BDD tests),
- a **planted utility** it must find in the surrounding code and reuse (`reuse.json` names it),
- and, held back by the grader, a **hidden edge-case suite** (`hidden.test.ts`).

The model outputs two files (`// FILE: impl.ts`, `// FILE: impl.test.ts`). It writes **both the
implementation and its own tests** (TDD) — so weak configs are caught either by writing wrong code or by
writing tests too shallow to expose their own bugs.

## 3. How grading works — 7 objectives a weak config fails independently
`score_typescript.py` stages the candidate into `ts-harness/` and runs the **real toolchain** plus static
checks. Deps auto-install on first run (`npm install`; `package-lock.json` pinned for reproducibility).

| objective | weight | how it's measured | rule source |
|-----------|:---:|-------------------|-------------|
| `types` | 1.0 | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) exits clean | no implicit any / unknown+guard |
| `lint` | 1.0 | `eslint` (minimal-strict: typescript-eslint strictTypeChecked + explicit-return-type, no-`any`, no-`!`, `<20`-line fns, no-magic-numbers) exits clean | code-logic-writer.md |
| `tests` | 1.5 | fraction of the candidate's **own** vitest tests that pass | TDD green |
| `edge` | 1.5 | fraction of the grader's **hidden** edge tests that pass | correctness under edge cases |
| `reuse` | 1.0 | impl imports+uses the planted util named in `reuse.json` | "reuse an existing utility, don't reinvent" |
| `bdd` | 0.5 | fraction of test titles matching `should <behavior> when <condition>` | test-naming discipline |
| `novj` | 0.5 | no `jest.*` (vitest only) | test-framework discipline |

`score` = weighted mean of the applicable objectives (reuse/edge dropped when a task doesn't declare
them). `hard_pass` = **all** gate objectives (types, lint, tests, reuse, edge) at 1.0 — a single strict
gate on top of the smooth score.

## 4. The tasks in detail

### 4.1 `count-words` — easy control (smoke test, NOT a discriminator)
- **Contract:** `countWords(text: string): ReadonlyMap<string, number>` — split on whitespace, normalize
  each token via the planted `normalizeToken` (`lib/tokenize`), drop empties, count.
- **Reuse target:** `normalizeToken` from `lib/tokenize`.
- **Hidden edge:** punctuation-only tokens drop out; case-insensitive merge.
- **Why it exists:** a floor reference. Both weak and strong models solve it → it proves the *harness*
  works but cannot separate configs. Kept only as a smoke test.

### 4.2 `lru-cache` — hard (generics + time + eviction)
- **Contract:** `createLruCache<K, V>(capacity, ttlMs, clock: Clock): LruCache<K, V>` with
  `get`/`set`/`has`/`readonly size`. LRU eviction at capacity; per-entry TTL expiry; a live `get`
  refreshes recency; expired entries never count toward `size`, are never returned, never block eviction.
- **Reuse target:** the injectable `Clock` from `lib/clock` (no direct `Date.now()`).
- **Hidden edge:** correct **LRU eviction order** after a recency-refresh; **TTL expiry** removes an entry
  and drops `size` — both driven by a deterministic fake clock.
- **Why it's hard:** three interacting concerns (recency + capacity + expiry) under strict generics, with
  the `<20`-line rule forcing the logic to be split into helpers. Easy to get subtly wrong.

### 4.3 `rate-limiter` — hard (lazy refill, the C2 pain point)
- **Contract:** `createRateLimiter(capacity, refillPerSec, clock: Clock): RateLimiter` with
  `tryAcquire(key, tokens?)`. Per-key buckets start full; **lazy** refill computed from elapsed time
  (`elapsedSeconds * refillPerSec`, capped at capacity) — never a background timer; deduct only on success.
- **Reuse target:** `Clock` from `lib/clock`.
- **Hidden edge:** first-burst up to capacity; lazy refill after time advances; per-key isolation.
- **Why it's hard:** lazy time-based refill + first-request semantics is exactly the pattern models got
  wrong in Campaign 2's rate-limiter *design* task — now measured as *working code*.

### 4.4 `store-remove` — hard, multi-file (indirect coupling / derived state)
- **Contract:** a class-based `Store` (entries + a cached per-key `total`, kept in sync by `add`); the task
  adds `remove(key)` deleting all entries for a key AND keeping the cached totals consistent (no-op for a
  missing key). Provided as `base/store.ts` + `base/store.test.ts` (green); the model edits + adds tests.
- **Hidden edge:** after `remove`, `total(key)` is 0, other keys unchanged, `all()` no longer contains the key.
- **Why it's hard:** it **compiles either way** — a naive `remove` that only touches the entry list leaves
  the cache stale. No compiler guidance; the coupling is caught only by hidden tests on `total()`. (Tier: Sonnet.)

### 4.5 `shape-variant` — REJECTED (too easy; kept as an easy multi-file control)
- **Contract:** add a `triangle` variant to a `Shape` discriminated union used across `area`/`format`/`scale`
  (each with `assertNever` exhaustiveness) + a cross-cutting negative-`scale` rule.
- **Why rejected:** all three tiers score 1.0. TypeScript exhaustiveness makes `tsc` enumerate every site to
  edit — a checklist even haiku follows. **Lesson: compiler-guided refactors don't discriminate.**

### 4.6 `async-memo` — Opus-only (async concurrency + a strict-lint trap), single-file
- **Contract:** fix a buggy async memoizer so concurrent calls dedup to one in-flight computation, a REJECTED
  computation is not cached (later call retries), and a resolved value is cached.
- **Hidden edge:** fn called once under 3 concurrent calls; retry after a first-call rejection; cache-hit after success.
- **Why it's hard:** the correct cleanup (`void pending.catch(...)` to delete on rejection) is subtle, and the
  naive delete-and-rethrow trips the strict `only-throw-error` lint rule. All tiers get the logic (edge=1.0);
  only Opus produces strictly clean types+lint. (Tier: Opus-only.)

### 4.7 `expr-eval` — Opus-tier ceiling (recursive-descent parser), single-file
- **Contract:** `evaluate(expr): Result` for integer `+ - * /` with precedence, LEFT associativity, parens,
  and **no-throw** error handling (returns `{ok:false,error}` on div-by-zero / unbalanced parens / bad token).
- **Hidden edge:** precedence (`2+3*4=14`), left-assoc (`10-3-2=5`, `8/2/2=2`), parens, and three error cases.
- **Why it's the ceiling:** recursion + precedence + the `<20`-line rule (forces tokenize/expr/term/factor
  split) + strict lint. Everyone gets the logic (edge=1.0) but **even Opus fails strict lint one-shot**
  (`restrict-template-expressions`, `prefer-optional-chain`, `no-unnecessary-boolean-literal-compare`); the
  reference is clean, so it's fair. Best resolution at the very top.

### 4.8 `deep-equal` — Sonnet-tier (structural recursion over `unknown`), single-file
- **Contract:** `deepEqual(a: unknown, b: unknown): boolean` — value-equal primitives (NaN equals NaN),
  recursive objects/arrays (same keys/length), array ≠ plain object, `null` ≠ `{}`.
- **Hidden edge:** NaN, nested arrays, extra-key mismatch, array-vs-object, differing primitive types, null-vs-{}.
- **Why it's hard:** `unknown` inputs force type guards (the no-`any` rule bites), and NaN / array-vs-object are
  easy to miss. haiku fails on lint; Sonnet/Opus pass. (Tier: Sonnet.)

## 5. Test-data quality — the calibration measurements
Method: give each task, one-shot with **no extended reasoning**, to a **weak** model (haiku, the floor)
and a **strong** model (Sonnet, the ceiling). A task is only admitted if **haiku hard-fails it AND
Sonnet scores clearly higher** — that gap is the band the 27B configs will land in. Data: `calibration.jsonl`.

| task | haiku (floor) | Sonnet (ceiling) | band (Δscore) | ceiling hard-pass? | verdict |
|------|------------:|------------:|:---:|:---:|---------|
| `count-words` (easy) | 0.949 ✅ | — (trivially passes) | ~0 | yes | control only — not a discriminator |
| `lru-cache` (hard) | **0.679** ❌ | **0.831** ❌ | **+0.152** | no | admitted; deep headroom (even one-shot Sonnet misses `lint`) |
| `rate-limiter` (hard) | **0.834** ❌ | **0.982** ✅ | **+0.148** | yes | admitted; clean spread, reachable ceiling |

### Per-objective breakdown (where the discrimination actually comes from)
| model · task | types | lint | tests | edge | reuse | bdd | novj |
|--------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| haiku · lru-cache | 1.0 | **0.0** | **0.82** | **0.5** | 1.0 | 0.55 | 1.0 |
| Sonnet · lru-cache | 1.0 | **0.0** | 1.0 | 1.0 | 1.0 | 0.64 | 1.0 |
| haiku · rate-limiter | 1.0 | **0.0** | 1.0 | 1.0 | 1.0 | 0.67 | 1.0 |
| Sonnet · rate-limiter | 1.0 | **1.0** | 1.0 | 1.0 | 1.0 | 0.75 | 1.0 |

**What this tells us about the test data:**
- **The eval discriminates.** On both hard tasks Sonnet > haiku by ~0.15, and the hard-gate correctly
  separates them (Sonnet hard-passes rate-limiter; haiku hard-passes neither). It will therefore register
  differences between 27B configs.
- **The active discriminators are `lint`, `tests`, `edge`, `bdd`.** `types`, `reuse`, `novj` are saturated
  (all 1.0 in this sample) — capable models clear them one-shot, so they pull little weight *here*. They
  are still worth keeping (they'll bite weaker/greedier 27B configs and at depth), but the campaign's
  signal will come mostly from lint-cleanliness, edge-correctness, and test quality.
- **`lint` is the dominant gate** — the strict-typing/`<20`-line bottleneck the user flagged. Even Sonnet
  misses it on `lru-cache`, which means that task has large headroom for the reasoning-budget sweep to
  show lift (more thinking should buy lint/edge correctness there).
- **Difficulty is well-placed:** `rate-limiter` has a reachable ceiling (measures "can a config reach the
  top"), `lru-cache` is harder with no one-shot ceiling (measures "how much does thinking help").

### Honest limitations of the current test data
- **Band is ~0.15 and n=2 hard tasks.** With reps=1 that margin is comparable to run-to-run noise, so the
  real campaign needs **REPS=3** and **more tasks (~8–12)** to aggregate a stable signal. Two tasks prove
  the method, not a verdict.
- **Ceiling is one-shot no-think.** Sonnet-with-reasoning would score higher; the ceiling here is a
  capability *floor for a strong model*, deliberately, to match the no-think haiku floor.
- **Saturated objectives** (types/reuse/novj) add robustness but little resolution at this difficulty.
- **`lint` is binary** (clean / not). A fractional lint (error-count based) would give a smoother signal;
  a possible grader refinement.
- **Depth not yet exercised in calibration.** These grades are logic-only (no 64–128k context). The
  retrieval-at-depth difficulty (finding the planted util in 128k) is expected to *widen* the band — to
  be measured when the driver runs.
- A grader bug (reuse hardcoded to one task's util) was found via the Sonnet cross-check and fixed
  (per-task `reuse.json`); it's why cross-checking with a second model is part of the method.

## 5b. Harder tasks — the 3-model gradient (haiku / Sonnet / Opus-high)
To find tasks that only a strong model *with thinking* clears, two multi/strict tasks were authored and
graded across three capability tiers (data: `calibration-hard.jsonl`):

| task | kind | haiku | Sonnet | Opus-high | tier |
|------|------|:---:|:---:|:---:|---------|
| `shape-variant` | multi-file union refactor + exhaustiveness | 1.0 P | 1.0 P | 1.0 P | **rejected — too easy** |
| `store-remove` | indirect coupling: keep a derived cache consistent | 0.812 F | 1.0 P | 1.0 P | **Sonnet-tier** |
| `deep-equal` | recursive structural equality over `unknown` (type-guards) | 0.792 F | 1.0 P | 0.982 P | **Sonnet-tier** |
| `async-memo` | async dedup + don't-cache-failures + strict lint | 0.667 F | 0.625 F | **1.0 P** | **Opus-only** |
| `expr-eval` | recursive-descent parser + Result error handling | 0.667 F | 0.667 F | **0.833 F** | **Opus-tier** (Opus clearly best; strict-lint wall even Opus doesn't fully clear one-shot) |

This gives a deliberate **difficulty spread** so the 27B configs have somewhere to land at every level:
easy controls (`count-words`, `shape-variant`); **Sonnet-tier** (`lru-cache`, `rate-limiter`, `store-remove`,
`deep-equal`); and two **Opus-tier** ceilings (`async-memo`, `expr-eval`). The hard tasks are also *different
in kind* — time+eviction, indirect cache coupling, async concurrency, recursive parsing, structural recursion
— so a config can't win by being good at one trick. `expr-eval` is the ceiling: even Opus-high fails strict
lint one-shot (legit rules: template-expression typing, optional-chain, boolean-compare — a clean reference
exists), so it has resolution at the very top and is where the reasoning-budget sweep should show the most lift.

Two lessons, both useful for authoring the rest of the set:
1. **Compiler-guided refactors are easy.** Adding a variant to a discriminated union with `assertNever`
   exhaustiveness makes `tsc` enumerate every site that needs editing — a checklist even haiku follows.
   So a *hard* type task must be one that **still compiles but is semantically wrong** (caught by tests,
   not the compiler) — i.e. indirect coupling, not exhaustiveness.
2. **The discriminating axis is strict types + lint, not logic.** On `async-memo` all three tiers got the
   async *logic* right (`edge`=1.0), but only Opus produced code that also passes strict `tsc`+`eslint`
   one-shot. This is the "TDD + linting bottleneck" made measurable, and it means the 27B reasoning-budget
   sweep should show its lift here (more thinking → cleaner types/lint).

Note: authoring these surfaced two **test-file** lint rules that unfairly failed everyone (`require-await`,
`no-empty-function` on mock callbacks) — now relaxed for `*.test.ts` only; strict rules stay on impl files.

## 6. The context corpus (deep-context filler)
- **545 sanitized files, ~682k tokens** (`.ts`/`.tsx`/`.test.ts`), vendored from the user's AiChatney
  `src/` into `ts-harness/corpus/` — enough headroom to build any depth up to the model's 256k RoPE cap.
  Every auth/crypto/secret file was **excluded** and the full corpus was scanned clean of secret patterns
  (this is a shared knowledge-base repo). ~4.3 MB.
- `build_context.py` assembles a prompt: real code up to a target token count, with the **reuse-target
  utils placed deepest** (hardest retrieval), then the rules, then the task. Verified at 64k and **128k**
  (~130k tok).

## 7. Reproduce it yourself
```bash
cd campaigns/2026-07-13-27b-quality-at-depth
python3 score_typescript.py selftest          # auto-installs deps; asserts good=1.0 > mediocre > bad=0.0
python3 build_context.py --task ts-harness/tasks/lru-cache --tokens 64000 --out /tmp/p.txt   # a depth prompt
python3 score_typescript.py fixture --dir ts-harness/fixtures/count-words-good --task ts-harness/tasks/count-words
```
Everything needed lives in-repo (harness, corpus, tasks, reference fixtures, pinned lockfile). No external
checkout required at runtime.

## 8. Status & next
**Built & validated:** the multi-file grader, the difficulty method (3-model gradient), **8 tasks** spanning
a full ladder — 2 easy controls, 4 Sonnet-tier, 2 Opus-tier — across 6 different problem kinds, each with a
reference that scores 1.0 and a haiku/Sonnet/Opus tier confirmed (`calibration-hard.jsonl`). Corpus vendored
to ~682k tokens (self-contained; secrets excluded); 128k assembly verified. `selftest` green; deps auto-install.

**Next — the depth driver (the only remaining build before a run):** wire Phase-3a sampling-lock
(temp {0.4,0.6,0.7} at 64k, freeze the winner) → the real grid `reasoning-budget × {64k-f16, 128k-f16,
128k-q8}`, `REPS=3`, tasks assembled at depth via `build_context.py`, graded by `score_typescript.py`, then
analyzed with the **benchmark-results** skill. See `README.md` and the plan.
