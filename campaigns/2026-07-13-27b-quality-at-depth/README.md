# Qwen3.6-27B quality AT DEPTH — integrated TS TDD+lint eval on 64–128k real-code context (R9700)

*Campaign 3 of the agentic-config series (plan: `docs/plans/2026-07-12-27b-agentic-config-campaign-series.md`).
Status: **harness + grader BUILT & stress-tested** (self-contained, auto-installs); next = vendor the task corpus + depth driver.
Research: `docs/research/2026-07-13-1712-hard-ts-quality-benchmark-design.md`.
**Reader's guide to the eval, every task, and test-data quality: `eval-design.md` (calibration data: `calibration.jsonl`).***

## Proven so far (this scaffold)
- **`ts-harness/`** — self-contained, **auto-installs** (`score_typescript.py` runs `npm install` if `node_modules`
  is absent; `package-lock.json` committed for reproducible versions). Minimal strict config; reuse-target util
  `lib/tokenize.ts` and one sample task `tasks/count-words/` live in-repo — **any user can `python3 score_typescript.py
  selftest` and reproduce**.
- **`score_typescript.py`** — multi-objective grader runs real `tsc`+`eslint`+`vitest` + static rule-checks.
  **Stress test (`selftest`) PASSES**: good=**1.0** (hard-pass) > mediocre=**0.357** (partial: tests/bdd/novj pass;
  types/lint/reuse/edge fail) > bad=**0.0** — proves *smooth ordered discrimination*, not just binary, which is what
  lets temp/reasoning-effort separate.
- **Difficulty band — haiku (floor) vs Sonnet (ceiling), one-shot no-think.** A task is admitted only if the
  weak model **fails** it and the strong model scores clearly higher (a real band the 27B configs land in):
  | task | haiku (floor) | Sonnet (ceiling) | reads as |
  |------|------------:|------------:|---------|
  | `count-words` (easy) | 0.949 ✅ | — | smoke only (both pass) |
  | `lru-cache` (hard) | 0.679 ❌ | 0.831 ❌ | ordered; even one-shot Sonnet can't hard-pass → deep headroom |
  | `rate-limiter` (hard) | 0.834 ❌ | 0.982 ✅ | clean spread; ceiling hard-passes |
  Both hard tasks are admitted (haiku hard-fails, Sonnet > haiku). `lint` (strict types + `<20`-line + reuse)
  is the gate both struggle with on `lru-cache` — the intended discriminator. **Gate rule: a new task must have
  haiku hard-pass=false AND Sonnet > haiku.** Corpus vendored: 134 sanitized `.ts` (~75k tok), secrets excluded.
  ⚠️ The Sonnet cross-check exposed a grader bug (reuse target was hardcoded to count-words' util) — now
  per-task via `tasks/<t>/reuse.json`; fixed + re-graded.
- **Research verdict (adopt-vs-author):** ADOPT Exercism-TypeScript (MIT) + type-challenges (MIT) as the base TDD/typing
  corpus (vendor offline); AUTHOR only the long-context layer (find+reuse a planted util at 64–128k depth while obeying
  top-of-prompt rules) — no existing benchmark tests that shape. Multi-objective grading (COMPASS precedent) is *the*
  reason configs will finally separate. ⚠️ Qwen3.6-27B coding scores are third-party UNVERIFIED; no official
  effective-context curve exists → our depth sweep fills a real measurement gap.

- **Date:** 2026-07-13 · **Substrate (frozen, C1):** llama.cpp Vulkan b9950 · `-ub 2048 -b 4096 -fa on` · MTP-on · prefix cache.
- **Why this campaign:** Campaign 2 tuned the reasoning-budget knob on *toy-length* prompts where deterministic accuracy
  saturated at 100% → temperature / reasoning-effort could not be discriminated. This campaign fixes **both** gaps the
  user raised: (1) measure at the **real operating point** (64–128k of actual code, not 8–32k padding), and (2) a
  **HARD, integrated eval** calibrated so configs actually separate.

## Decisions locked (from the design Q&A)
- **Depth × KV matrix** (thinking mode ON, context filled with real AiChatney TS source, not padding):
  | point | context | KV | purpose |
  |-------|--------:|----|---------|
  | `D64-f16`  | 64k  | f16  | baseline depth |
  | `D128-f16` | 128k | f16  | depth curve (does quality/rule-adherence hold?) |
  | `D128-q8`  | 128k | q8_0 | **KV-cache-degradation A/B vs D128-f16** (does q8 cost quality at depth?) |
  All fit VRAM (GGUF `context_length=262144`; f16 fits ~220k, q8 the full 256k). Cold prefill ≈ 1.5 min @64k,
  ≈ 3 min @128k → **rely on prefix-cache reuse** (pay once); the run.sh warms the context once per depth then
  reuses it across tasks (Campaign 1 measured 13.7× ttft win).
- **ONE integrated task type**, not separated micro-tests (real work combines everything). Each task is a **TypeScript
  TDD task**: given a spec + a slice of the real codebase in context, the model must (TDD red→green) **write vitest
  tests AND a strict-typed implementation**, obeying the project coding rules, reusing an existing util planted in the
  deep context. Linting/types are run by the **grader** (real `eslint`/`tsc`/`vitest`), NOT by model tool-calls — keeps
  the model's job simple (produce code), the toolchain does the judging.
- **Language: TypeScript, strict.** Rules distilled from the user's real `code-logic-writer.md`
  (`~/work/dippe/AiChatney/.claude/agents/`). A **minimal** strict eslint (typescript-eslint `strictTypeChecked`
  + `@stylistic`) — NOT AiChatney's 16k-line multi-plugin config (too heavy/project-specific).
- **Finalist configs only** (depth runs are expensive): carry the C2 winners — `un-rb2048` (depth-safe default) as the
  primary across all 3 depth/KV points, plus a small **discrimination sweep at D128-f16** (temp {0.4,0.6} × budget
  {1024,2048,4096}) to prove the harder+deeper eval now separates temp/reasoning-effort.
- **LLM judge** at the end for the open-ended slice (code clarity / design quality), blind, as in C2.

## The eval — multi-objective, calibrated to ~50% pass (the discriminator)
Each task's score is the product/weighted-sum of objectives a weak config fails independently:
| objective | tool (grader runs it) | verifiable rule source |
|-----------|----------------------|------------------------|
| tests pass | `vitest run` on the model's test+impl | TDD red→green |
| types clean | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | `code-logic-writer` "no implicit any / unknown+guard" |
| lint clean | `eslint` (minimal strict config) | explicit return types, `readonly`, no-`any`, import-sort |
| rule checks | static checks in `score_typescript.py` | functions <20 lines; BDD test names `should … when …`; vitest-only (no `jest.*`); **reused the planted util** (grep) not reinvented; no barrel unless 4+ exports; no JSDoc-obvious |
| edge cases | hidden vitest cases | "guard empty-default first render → no NaN"; try/finally busy-flag; empty/undefined/0 inputs |
| clarity (open) | blind LLM judge 0–5 | design quality, single-responsibility |

**Calibration step (mandatory before the full run):** pilot 2–3 tasks on the primary config; if pass ≫70% or ≪30%,
adjust task hardness. The whole point is headroom so temp/reasoning-effort move the needle.

## Build steps (next session — after the 2pm limit reset)
1. **TS harness** (`ts-harness/`) — skeleton laid: `package.json` (pinned eslint9 / typescript-eslint8 / vitest4 / tsc5.9),
   `tsconfig.json` (strict), `eslint.config.mjs` (minimal strict). **`npm install`** once (registry reachable, confirmed).
   Add `run_case.mjs`: takes a candidate `{impl.ts, impl.test.ts}` → runs tsc+eslint+vitest → emits `{types,lint,tests,edge}` JSON.
2. **Grader** `graders/score_typescript.py` (extend the graders/ set): extract TS code blocks from `outputs.jsonl`,
   place into the task template, invoke `run_case.mjs`, add the static rule-checks, write `scores_typescript.jsonl`.
3. **Tasks** `ts-harness/tasks/*` (~8–10): each = `spec.md` (feature + which planted util to reuse) + `hidden.test.ts`
   (grader-held edge cases) + `rules.md` (the verifiable subset) + a `context/` manifest (which AiChatney src files to
   embed to reach the target depth). Reuse `build_prompt.py` to assemble the deep-context prompt.
4. **Driver** `run_capture.sh` (adapt C2's): per {config × depth × KV} load a server, warm the context once, run tasks
   via `capture.py`, score via `score_typescript.py`; resumable; VRAM-sampled (with the **SPID sampler-kill fix** from C2).
5. **Analyze** with `benchmark-results`: does quality/rule-adherence sag with depth? does q8 cost quality at 128k? does
   the harder eval finally discriminate temp/reasoning-budget? → the deployable per-model config.

## Open items / to firm up after limit reset
- **Research** (was cut off by the weekly limit): existing GitHub TS test-suite we could adopt instead of hand-writing
  tasks (user prefers this if a good one exists — e.g. a typed-kata / exercise repo with vitest); Qwen3-family *effective*
  vs declared context (lost-in-the-middle onset). Re-run the research subagent after 2pm.
- Confirm the discrimination sweep axes (temp/budget) once the pilot shows the pass-rate band.
