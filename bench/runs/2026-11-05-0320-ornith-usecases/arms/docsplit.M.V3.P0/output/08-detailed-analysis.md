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

