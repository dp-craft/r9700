<!-- meta
date: 2026-07-13 17:12
takeaway: To make the 27B quality eval DISCRIMINATE, stop chasing pass@1 and stack three orthogonal signals — vitest-pass × tsc-strict × eslint-clean (COMPASS/"Beyond Pass Rate" show compound grading widens model spread and even flips rankings) — on top of a long-context "find+reuse a planted util while obeying top-of-prompt rules" probe. ADOPT the runnable, MIT, jest/vitest test-suites (Exercism-TS 106 + type-challenges 190 tsc-only) for the base tasks; AUTHOR only the ~10-15 constraint-stacked long-context tasks (no existing repo tests retrieval-at-depth × instruction-retention together). Qwen3.6 is native 262K but NO official RULER/needle curve exists — treat effective depth as unknown and measure it ourselves.
-->

# Research: Designing a HARD, auto-gradable TypeScript quality benchmark that separates serving configs

- **Date:** 2026-07-13 17:12   · **Question:** What existing components + methods make a 27B TS coding eval hard enough (mid-pass ~40–70%) to separate temperature / thinking-budget configs at 64–128K context, on a small offline harness — and should we adopt or author the TDD task set?
- **Confidence:** medium   · **Sources:** 30+ (Tier-1: majority official repos/papers; Tier-2: a few gists/blogs, flagged)
- **Web access:** yes — searched live (fan-out to haiku subagents against Tier-1 repos/papers). A handful of numbers below are third-party or subagent-estimated and are flagged `low-confidence — VERIFY`.

## Summary

1. **The fix for "everyone passes" is multi-objective grading, not just harder tasks.** No major benchmark combines *tests-pass × lint-clean × type-clean* into one score, but two Tier-1 papers show that adding non-functional objectives **widens the model spread and even flips rankings**: COMPASS (correctness+efficiency+quality) spreads composite 66→92 where correctness alone spreads 72→96, and "Beyond Pass Rate" finds lint-clean and functional-correctness "measure different properties." For us, `tsc --strict` + `eslint` (both trivially auto-graded to a clean/dirty bit) are the cheapest discriminators to bolt onto our existing pyexec/vitest pass/fail. `[CLAIMED]`
2. **ADOPT the base task corpus; AUTHOR only the long-context layer.** Exercism-TypeScript (MIT, Jest, ~106 exercises, clean per-exercise exit codes) and type-challenges (MIT, ~190, `tsc`-only, strict-mode mandatory, great difficulty ladder) are directly vendorable offline and grade to pass/fail. **Caveat: their tests are visible, not hidden** — fine for a *capability* eval (we're comparing configs of one model, not preventing cheating), but it means the discriminating difficulty has to come from strict-typing + long context, not from test secrecy. `[CLAIMED]`
3. **No existing benchmark tests our exact target shape** — "find+reuse a planted util deep in 64–128K tokens of real code *while obeying rules stated at the top*." RULER has no code variant; LongCodeBench/LoCoBench/RepoBench test long-context code but isolate neither retrieval-at-depth nor instruction-retention. This compound probe is **novel-but-plausible and must be hand-authored** (legit per the CLAUDE.md quality-driver exception). `[INFERRED]`
4. **Qwen3.6 is native 262K (YaRN→~1M), but there is NO official long-context quality curve.** No Qwen RULER/needle numbers were published; third-party long-context-code data (LongCodeBench) shows sharp degradation even for frontier models (Claude 3.5 Sonnet 29%→3% short→long). Treat effective usable depth as an **open question we should measure**, and keep the known-good thinking-mode sampling (temp 0.6 / top_p 0.95 / top_k 20 / min_p 0) from our companion doc. `[CLAIMED]`
5. **Instruction-following-at-depth is the proven difficulty lever.** AgentIF (avg **11.9 constraints**/instruction, per-constraint + all-or-nothing scoring) puts mid-tier ~30B models at **~35–45% CSR / ~55% ISR** — squarely in our 40–70% target band. Stacking 8–12 verifiable constraints per task is the single most reliable way to drop pass rates off the ceiling. `[CLAIMED]`

## Key findings

| # | Finding | Provenance | Source | Conf |
|---|---------|-----------|--------|------|
| 1 | Multi-objective (correctness+efficiency+quality) composite spreads models wider than correctness alone AND changes the leaderboard order | CLAIMED | COMPASS arxiv.org/html/2508.13757 | med |
| 2 | Lint-clean vs functional-correctness "measure different properties"; models strong in one are weak in the other | CLAIMED | "Beyond Pass Rate" arxiv.org/pdf/2606.08840 (future-dated 2026 — VERIFY) | low |
| 3 | No single benchmark combines tests+lint+types into ONE compound metric — precedent treats them as orthogonal dims | CLAIMED | survey of BigCodeBench, EvalPlus, SWE-bench, CompiledAI | med |
| 4 | EvalPlus hardens grading by test *density* (HumanEval+ ≈80× tests, MBPP+ ≈35×), not by adding objectives | CLAIMED | github.com/evalplus/evalplus | high |
| 5 | Exercism-TS: MIT, Jest, ~106 exercises, per-exercise clean exit codes, ESLint configured, strict-mode via external preset (unverified); tests VISIBLE | CLAIMED | github.com/exercism/typescript | med |
| 6 | type-challenges: MIT, ~190 challenges, `tsc` type-check only (no runtime), strict mode mandatory, Warm→Extreme ladder | CLAIMED | github.com/type-challenges/type-challenges | high |
| 7 | typescript-exercises (16, strict+eslint) & trekhleb/javascript-algorithms (JS-only, unsuitable) | CLAIMED | github repos below | med |
| 8 | Qwen3.6 native context **262,144** tok, YaRN-extensible to ~1.01M | CLAIMED (official card) | huggingface.co/Qwen/Qwen3.6-27B | high |
| 9 | NO official Qwen3 RULER / needle-in-haystack / lost-in-the-middle curve published | CLAIMED (absence) | Qwen3 tech report arxiv.org/html/2505.09388v1 | med |
| 10 | Long-context CODE degrades hard: Claude 3.5 Sonnet 29%→3%, Qwen2.5 peaks mid-depth then falls | CLAIMED | LongCodeBench arxiv.org/abs/2505.07897 | med |
| 11 | RULER has NO code variant; task types = NIAH/multi-hop/aggregation; multi-hop+aggregation collapse with depth even when NIAH is perfect | CLAIMED | github.com/NVIDIA/RULER, arxiv.org/abs/2404.06654 | high |
| 12 | AgentIF: 707 instrs, avg **11.9** constraints, CSR (per-constraint) + ISR (all-satisfied); ~30B models ≈35–45% CSR / ~55% ISR | CLAIMED | arxiv.org/abs/2505.16944, github.com/THU-KEG/AgentIF | med |
| 13 | IFEval: 540 prompts / 25 verifiable types; strict + loose, prompt-level + instruction-level accuracy | CLAIMED | arxiv.org/abs/2311.07911 | high |
| 14 | Multi-IF: 4501 convos × 3 turns × 8 langs; constraints decay across turns (~15–20% Eng→non-Eng) | CLAIMED | arxiv.org/abs/2410.15553 | med |
| 15 | IFBench: 58 *unseen* constraint types (OOD generalization vs IFEval's 25); no mid-model numbers published | CLAIMED | arxiv.org/abs/2507.02833 | med |

## Detail

### 1. TS test-suites to ADOPT (offline-vendorable)

| Repo | License | Runner | Count | Difficulty | Hidden tests? | Strict-type / lint stress | Offline? |
|------|---------|--------|------:|-----------|---------------|---------------------------|----------|
| [exercism/typescript](https://github.com/exercism/typescript) | MIT | **Jest** | ~106 | core+practice, unlabeled | No (contract-visible) | ESLint yes; `strict` via `@tsconfig/*` preset (unverified) | Yes (yarn) |
| [type-challenges](https://github.com/type-challenges/type-challenges) | MIT | **tsc** (type-only) | ~190 | Warm/Easy/Med/Hard/Extreme | N/A (type asserts) | **Strict mandatory** — pure type rigor, no runtime | Yes (pnpm) |
| [typescript-exercises](https://github.com/typescript-exercises/typescript-exercises) | MIT | none (type+lint, Monaco browser) | 16 | progressive | No | strict + "avoid `any`" | Partial (React app; no `npm test`) |
| [cesalberca/katas](https://github.com/cesalberca/katas) | MIT | Jest | 18 | beginner→adv | No (TDD-visible) | unclear | Yes |
| trekhleb/javascript-algorithms | MIT | Jest | 50+ | B/A | No | **JS-only → unsuitable** | Yes |

- **Grading mechanics:** Exercism and cesalberca run `npm/yarn test` per exercise → Jest exit code = pass/fail, trivially machine-read. type-challenges is `tsc` compile-or-fail (no runtime paths, no I/O) — best used as a **separate "type-puzzle" track**, not for algorithmic correctness.
- **Hidden-tests reality:** none of these ship a *hidden* suite; tests are the visible contract. For our use (comparing sampling/thinking configs of ONE model) that's acceptable — but it means we get difficulty from **strict typing + long context + stacked constraints**, not from test secrecy. If we ever need hidden tests, the pattern is trivial to add: keep the stub, move `*.test.ts` out of the model's prompt, run it only at grade time (our `capture.py` already separates prompt from grader).
- **Vitest vs Jest:** all are Jest/Mocha; vitest is drop-in for these (same `describe/it/expect`). Vendoring = `git clone` once, `npm i` offline, done.

### 3. Multi-objective grading as the discriminator (the key lever)

- **Precedent is thin but pointed.** BigCodeBench, EvalPlus, SWE-bench all grade *functional correctness only* (EvalPlus just adds *more* tests; SWE-bench = patch-applies + FAIL_TO_PASS/PASS_TO_PASS). None fold in lint/types.
- **COMPASS** (`arxiv.org/html/2508.13757`, Tier-1) is the direct precedent: equal-weight correctness+efficiency+quality (CodeScene complexity/maintainability). **Composite 66.1–92.3 vs correctness-only 72.2–95.6, with leader inversion** (Claude Opus 95.6% correct → 66.1 composite as efficiency collapsed). i.e. compound grading both **widens spread and re-orders** — exactly the discrimination we lack.
- **"Beyond Pass Rate"** (future-dated 2026 arxiv — `VERIFY`): lint-pass and functional-correctness are near-orthogonal; Gemma-27B strong on lint, weaker on correctness.
- **Implication for us:** score each task as `pass = vitest_green AND tsc_strict_clean AND eslint_clean` (hard AND), plus keep the three bits separately for partial-credit charts. The AND-gate alone will drop a model that "passes the test but writes `any` everywhere and trips 3 lint rules" from 100%→mid-band. This is a pure extension of `score_deterministic.py` (add `tsc`/`eslint` graders) — no new tool.

### 4. Long-context "needle in code" (must AUTHOR)

- **RULER** (`github.com/NVIDIA/RULER`): NIAH + multi-hop + aggregation, general-domain, **no code variant**. Useful design lesson: models keep perfect vanilla-NIAH while multi-hop/aggregation collapse with depth — so plant tasks that require **using** the needle (multi-hop), not just quoting it.
- **LongCodeBench** (`arxiv.org/abs/2505.07897`): LongCodeQA + LongSWE (bug-fix) to 1M tok; steep degradation (Claude 3.5 29%→3%). **LoCoBench** (`github.com/SalesforceAIResearch/LoCoBench`): 8 code task types, 10K–1M, introduces a multi-session memory-retention metric — closest published cousin to "rule retention," worth mining for task ideas.
- **Our target shape is novel:** plant a util/bug at depth D in 64–128K of real TS corpus (we already have `bench/workloads/corpus/` ~565K tok), require the model to (a) locate + correctly reuse/fix it, AND (b) obey ~5 rules stated at the very top (output format, forbidden APIs, must-cite line numbers). Grade retrieval (did it call the planted symbol?) and rule-compliance separately → two more discriminating bits. No repo does this combo; authoring it is the CLAUDE.md-sanctioned quality-driver exception.

### 5. Instruction-following at depth (the difficulty dial)

| Benchmark | Count | Scoring | Mid-model (~20–35B) | Source |
|-----------|-------|---------|---------------------|--------|
| **IFEval** | 540 prompts / 25 types | binary strict + loose; prompt- & instr-level | subagent-estimated Qwen-class ~90%+ — `low-conf, VERIFY` | arxiv.org/abs/2311.07911 |
| **AgentIF** | 707 instr / avg **11.9** constraints | CSR (per-constraint) + ISR (all-or-nothing) | **~35–45% CSR / ~55% ISR** ← our sweet spot | arxiv.org/abs/2505.16944 |
| **Multi-IF** | 4501 conv × 3 turns | per-instr strict/loose, conv-level, averaged | Llama-70B ~0.67 avg; drops across turns | arxiv.org/abs/2410.15553 |
| **IFBench** | 58 unseen types | strict+loose, Python verifiers | not published for mid-tier | arxiv.org/abs/2507.02833 |

- **Design takeaway:** IFEval-style single constraints saturate (mid-models ~90%). **AgentIF-style stacking (8–12 verifiable constraints)** is what pushes into the 40–70% band. Score per-constraint (partial credit) for smooth charts AND all-or-nothing (ISR) for the headline discriminator — ISR "heavily penalizes any single failure," which is exactly the separation we want between a temp-0.6 and a temp-1.0 config.

## Conflicts & unknowns

- **Qwen3.6-27B coding scores are unverified.** A subagent reported SWE-bench Verified 77.2% and "27B dense > 35B-A3B by 4–20 pts," but the corroboration was a third-party gist, not the official card. **Do not cite these numbers as fact — verify against the actual `huggingface.co/Qwen/Qwen3.6-27B` card before use.** `low-confidence`
- **No official Qwen long-context quality curve exists** (effective depth before lost-in-the-middle is unpublished). This is a measurement gap we can fill on the R9700.
- **Two arxiv IDs are future-dated (2026: `2606.08840`, `2602.16069`)** — plausibly real given today is 2026-07, but treat as `unverified` until fetched.
- **IFEval mid-model score (~90%+ for Qwen-class)** was a subagent estimate, not read from a table — verify.

## Actionable for this repo

1. **Extend `campaigns/2026-07-12-27b-finetune-quality/graders/score_deterministic.py`** with two graders: `tsc_strict` (run `tsc --noEmit --strict`, clean=1) and `eslint_clean` (run eslint, 0 errors=1). Compound task score = `AND` of {vitest, tsc, eslint}; keep the three bits for the appendix charts. This is the highest-leverage, lowest-effort discriminator.
2. **Vendor the base corpus:** `git clone` Exercism-TS (MIT, ~106 Jest) + type-challenges (MIT, ~190 tsc) into `bench/workloads/` offline; wire a subset (~20 medium/hard) through `capture.py`. Convert Jest→vitest if the harness prefers vitest (drop-in).
3. **AUTHOR ~10–15 constraint-stacked long-context tasks** (AgentIF shape: 8–12 verifiable rules each) over 64–128K of `bench/workloads/corpus/` TS, including 3–4 **plant-a-util-at-depth + obey-top-rules** probes. Grade retrieval, rule-compliance, and correctness as separate bits.
4. **Fix sampling first** (temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 per the companion doc) so config differences reflect real quality, not over-temperature noise; then sweep `--reasoning-budget {−1,2048,1024,0}` × temp {0.6,0.7} against the new hard set.
5. **Measure the effective-context curve ourselves** (plant needle at 8K/32K/64K/128K depth) — no official Qwen number exists, so this is original data for our INDEX.
6. **ADOPT-vs-AUTHOR verdict:** **ADOPT** for the base runnable TDD set (Exercism-TS + type-challenges — MIT, offline, machine-graded, zero authoring risk). **AUTHOR** only the long-context constraint-stacked layer, because no repo tests retrieval-at-depth × instruction-retention together (CLAUDE.md-sanctioned quality-driver exception).

## Sources

- Exercism TypeScript — https://github.com/exercism/typescript — accessed 2026-07-13 — Tier-1 — base task corpus, Jest, MIT
- type-challenges — https://github.com/type-challenges/type-challenges — 2026-07-13 — Tier-1 — strict-type puzzle track, MIT
- typescript-exercises — https://github.com/typescript-exercises/typescript-exercises — 2026-07-13 — Tier-1 — strict+eslint, browser-graded (harder to automate)
- cesalberca/katas — https://github.com/cesalberca/katas — 2026-07-13 — Tier-1 — small Jest TDD kata set, MIT
- BigCodeBench — https://github.com/bigcode-project/bigcodebench , https://arxiv.org/html/2406.15877v2 — 2026-07-13 — Tier-1 — functional-only grading precedent
- EvalPlus — https://github.com/evalplus/evalplus — 2026-07-13 — Tier-1 — harden-by-test-density precedent (note: subagent gave a wrong org; canonical is evalplus/evalplus)
- SWE-bench (test-weakness critique) — https://arxiv.org/abs/2503.15223 — 2026-07-13 — Tier-1 — patch+hidden-test grading, ~1/5 false-solves
- COMPASS — https://arxiv.org/html/2508.13757 — 2026-07-13 — Tier-1 — **multi-objective widens spread + flips ranking** (key precedent)
- "Beyond Pass Rate" — https://arxiv.org/pdf/2606.08840 — 2026-07-13 — Tier-1 (future-dated, VERIFY) — lint vs correctness orthogonality
- Static-analysis+testing feedback — https://arxiv.org/html/2412.14841v1 — 2026-07-13 — Tier-1 — orthogonal safety vs correctness dims
- RULER — https://github.com/NVIDIA/RULER , https://arxiv.org/abs/2404.06654 — 2026-07-13 — Tier-1 — NIAH/multi-hop/aggregation, no code variant
- LongCodeBench — https://arxiv.org/abs/2505.07897 — 2026-07-13 — Tier-1 — long-context code degradation numbers
- LoCoBench — https://github.com/SalesforceAIResearch/LoCoBench , https://arxiv.org/abs/2509.09614 — 2026-07-13 — Tier-1 — 8 code task types + memory-retention metric
- RepoBench — https://arxiv.org/abs/2306.03091 — 2026-07-13 — Tier-1 — repo-level retrieval/completion
- Bug-fix long-context limits — https://arxiv.org/pdf/2602.16069 — 2026-07-13 — Tier-1 (future-dated, VERIFY) — planted-bug-at-depth methodology
- IFEval — https://arxiv.org/abs/2311.07911 , https://github.com/google-research/google-research/tree/master/instruction_following_eval — 2026-07-13 — Tier-1 — 540 prompts/25 verifiable types
- AgentIF — https://arxiv.org/abs/2505.16944 , https://github.com/THU-KEG/AgentIF — 2026-07-13 — Tier-1 — 11.9 constraints, CSR/ISR, mid-model band
- Multi-IF — https://arxiv.org/abs/2410.15553 , https://github.com/facebookresearch/Multi-IF — 2026-07-13 — Tier-1 — multi-turn constraint decay
- IFBench — https://arxiv.org/abs/2507.02833 — 2026-07-13 — Tier-1 — 58 unseen constraint types
- Qwen3.6-27B card — https://huggingface.co/Qwen/Qwen3.6-27B — 2026-07-13 — Tier-1 — 262K native context (coding scores VERIFY on card)
- Qwen3 technical report — https://arxiv.org/html/2505.09388v1 — 2026-07-13 — Tier-1 — DCA/YaRN long-context training; no depth-quality curve
- Companion (our) sampling/knobs doc — docs/research/2026-07-12-2310-qwen36-sampling-llamacpp-serving-knobs.md — Tier-1 (ours) — thinking-mode sampling + reasoning-budget levers
