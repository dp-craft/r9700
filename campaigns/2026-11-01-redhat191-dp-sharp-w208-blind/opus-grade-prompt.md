# Opus blind-grade — W2-08 review (label W) — PROMPT-ONLY (no tools)

You are a blind grader. One anonymous blind code-plan review (label **W**) of the W2-08 implementation brief was written by a local LLM configuration; you do not know which and must not try to find out. Grade it with the rubric below against a reference review written by a stronger model (Opus). The reference is the yardstick, not ground truth: a review finding the reference lacks can still be real.

## No tools — read only what is embedded below
This prompt runs **without any tools** (no file reading, no git, no tsc/eslint/vitest). **Everything you need is embedded in §1–§5 below** — the review (W), its probe files, the reference review, the reference's 19 findings, and the brief. There is **no** access to the dp-forge repo. Judge strictly from the embedded content:
- A claim is **verifiable** if the embedded brief / probes / review's own quoted evidence establish it.
- A claim that needs code you cannot see is **unverifiable** (say which file/line you cannot see; do not guess).
- A claim that contradicts the embedded content is **wrong**.

## What is embedded
- **§1** — the review to grade (label W).
- **§2** — the reference (Opus) review.
- **§3** — the reference's **19** numbered findings (brief, n, sev, item, problem): **6 high, 7 med, 6 low**.
- **§4** — the brief under review (W2-08).
- **§5** — W's own probe files (its evidence; their outputs are mostly quoted inside §1). `<WT>` = the repo worktree root (the path prefix inside the probes).

## Rubric
1. **Opus coverage.** Map W's findings to the 19 reference findings. Same defect at the same brief item = match; same section but a different defect = no match. Several W findings may map to one reference finding; one W finding may match two reference findings only if it explicitly names both defects. Note severity disagreements (W sev vs reference sev).
2. **Review-only findings** (not among the 19): verdict `real` / `wrong` / `unverifiable`, your severity (high/med/low/trivial), and evidence (a brief line, a probe result, or the review's quoted evidence — or which file/line you cannot see).
3. **False claims**: factual statements in the review (about code, brief, probes) that are wrong even if not framed as a finding — list them; they count against precision.
4. Compute: reference found n/19, high n/6, med n/7, low n/6; severity-weighted coverage (high 3 · med 2 · low 1, max 38); review findings total; matched; real review-only; wrong; unverifiable; precision = (matched + real review-only) / total findings.
5. 3-5 line qualitative judgement (depth of verification, probes actually present vs. claimed, actionable fixes). State explicitly which reference findings and which review-only findings you could **not** verify (no tools) and why.

## Output (plain text only — this is everything you can produce)
1. **Summary table**: reference found n/19, high/med/low, weighted/38, findings total, matched, real review-only, wrong, unverifiable, precision.
2. **Per-finding mapping table**: each W finding → the reference finding(s) it matches, or `real`/`wrong`/`unverifiable`, with evidence (brief/probe line).
3. **The 19 reference findings, one row each**: Accepted (which W finding) or Rejected (missed).
4. **Review-only findings** with verdict + severity + evidence.
5. **False claims** list.
6. **Qualitative judgement** + the items you could not verify (no tools).

---
---

# EMBEDDED FILES 


## §1 — The review to grade (label W)

````
# W2-08 — 27B REFINE-CHECK

Brief: `briefs/W2-08.md` · base 36ffe5b4 · row `wave-2-dpf-cli.md:58` · contracts C3, C11 (screen: C7, pause record: C8)

## Derived

Part 1 — derived blind from the row, the contracts and the code at base, before reading the brief body (only its head through SITES was read).

M2 surface
- Files (row FILES cell): `tools/dpf/src/screens/resolve-confirm.ts` (new) · `tools/dpf/tests/screens/resolve-confirm.test.ts` (new)
- Exports (C7 module map row 157): `resolveConfirmScreen(input: ResolveConfirmInput): Screen<…, ResolveResult>` · `applyResolve(…)`; C11 Source bullet: `RESOLVE_CONFIRM_SOURCE = 'resolve-confirm'` constant in `screens/resolve-confirm.ts`
- Screen input: the parsed docs — row: "ResolutionDocSchema/GoalsDocSchema read with readIr, tools/shared/ir/io.ts"; readIr is `io.ts:179` (`readIr(kind, file)`), kinds `resolution`/`goals` registered (`tools/shared/ir/registry.ts:49-50` → ResolutionIrSchema/GoalsDocSchema); the flow (W2-13) reads, the screen takes the parsed `ResolutionIr` and `GoalsDoc`
- Also in: the cut lines (row: "the cut lines from residue rows"; C11 item 6: ledger residue rows with this runId + stage spec-a-resolve, anchored at `$.sections.request-docs`, each `entry.text`) · optional `diffLines` (row: "optional diffLines"; C11 item 7: "from the previous correction's snapshot (W2-09), when present") · the pause record (C8: "its record is `<pipeline>/paused/<step>.json` (PausePayload)"; C3 inputs `resolution`/`goals`/`template`, outputs[0] = confirmed.json)
- Result keys (C11 Keys): `a` accept (copy inputs.template → outputs[0], a byte copy per C3) · `g` edit goals · `c` correction · `q` quit
- Edit write (C11 One write): `irSet({ kind: 'goals', file: <inputs.goals>, path: '$.goals', value })` + second call `$.nonGoals` only when changed; replaced entries get `source: RESOLVE_CONFIRM_SOURCE`
- g walk (C11 Per entry): Enter keeps · `r` replaces (the next line is the text) · `d` drops
- Content order (C11 Screen content): 1 shape · 2 mapping (`kind: 'unknown'` first) · 3 drift (`status: 'unclear'` first) · 4 blastRadius · 5 goals then non-goals · 6 cuts · 7 diffLines
- Imports available: `type Screen` from `src/ui/screen.js` (post-W2-01b) · `irSet`/`irValidate` from `src/run/ir.js` (post-W2-05; signatures per briefs/W2-05.md D1: `irSet({cli,kind,file,path,value})` / `irValidate({cli,kind,file})` → `IrResult`) · `type PausePayload` from `spec-pipeline/protocol` (post-W2-01; briefs/W2-01.md D2 re-exports it) · types from `tools/shared/ir/resolution.js`: `GoalEntry:171` `NonGoalEntry:172` `GoalsDoc:174` `ResolutionIr:177`
- Node imports: `cpSync` from `node:fs` (the template copy, C3 "the only plain file write")

M3 readers
- W2-13 (flow): routes the pause (C8 table: `resolve-confirm` → W2-08 screen), reads the two docs with readIr, consumes the result (accept/edit → applyResolve; correction → W2-09; quit → stop)
- W2-13a flow test scenario 1 (`wave-2-dpf-cli.md` W2-13a line): "specify: clarify … → resolve-confirm `a` → boundary" — covers the accept case (D-8 flow-test rule, wave § Execute "Flow tests")
- W2-09 depends on W2-08 (row Depends cell); its snapshot supplies `diffLines` later (C11 item 7)
- This row needs from earlier not-done rows: W2-05's `irSet`/`irValidate` (briefs/W2-05.md D1) · W2-04's fake (`tools/dpf/tests/fixtures/fake-spec-pipeline.mjs`, one plan entry per call, counter file beside the plan — briefs/W2-04.md D2) · W2-01's protocol subpath · W2-01b's `Screen`
- Source safety proof (row risk cell): grep `source ===` under SP/src → only gate/finding sources (`profile/registry.ts:77`, `loop/routing.ts:40`, `loop/run.ts:107,111`) and undefined-checks (`wiring/row-ids.ts:67`, `surface-refs.ts:112`); goal `source` is a free string (`GoalEntrySchema`, resolution.ts:15)

M4 branches
- main: `a` → accept · `g` → walk · `c` → correction · `q` → quit · any other line → contract silent (screen must re-prompt)
- walk (each entry): Enter → keep · `r` → replace-wait · `d` → drop · any other line → re-prompt; end of list → the write decision (C11 "One write")
- replace-wait: the line is the new text (C11: "the next line is the text")
- applyResolve: accept → cpSync · edit → irSet(s) (+irValidate per the W2-05 sibling pattern) · ir result not ok → the error must surface (M4 error class) · correction/quit → no write

M7 resources
- `cpSync` is synchronous — nothing to release · `irSet`/`irValidate` spawn: post-W2-05 resolves on 'close' with 'error' handled and the temp value file deleted in finally (briefs/W2-05.md D1) · the screen is pure (no resources) · test env `FAKE_SP_PLAN`/`FAKE_SP_DIR` set and restored in afterEach (W2-04/W2-05 test pattern)

M8 tests (row test cell, four items)
- "unknown mapping rows print before the others" → unit test on start.out order
- "a cut row prints its text" → unit test on start.out content
- "a → result accept" → covered by W2-13a flow scenario 1 → named and dropped from the unit tests (D-8 flow-test rule)
- "g, r on G-2 with new text, w → one irSet with G-2 resolve-confirm and G-1 unchanged" → unit test: drive the walk, assert the result, then applyResolve against the fake and assert calls.jsonl
- no test for the `RESOLVE_CONFIRM_SOURCE` constant (D-8); the ir-failure branch (error class) of applyResolve must also be testable — not covered by any W2-13a scenario

## Compared

Part 2 — per derived line: the brief line that covers it (`briefs/W2-08.md:N`) or GAP; per D/T id: the derived line or contract clause it serves, or EXTRA.

Derived → brief
- Files: brief:13-14 (package-relative `src/…`/`tests/…` — the row's paths are repo-relative `tools/dpf/…`)
- Exports: D1 brief:42-47 (RESOLVE_CONFIRM_SOURCE + the `source ===` proof) · D2 brief:48-64 (screen + result + state) · D4 brief:88-98 (applyResolve)
- Screen input: D2 brief:52-58 (resolution/goals/cuts/diffLines/record) — matches C11 items 1-7 and C8
- Result keys: D2 brief:70-72 (`a`·`g`·`c`·`q`; other → content again)
- Edit write: D4 brief:93-96 (one irSet `$.goals`, second `$.nonGoals` only when changed by JSON.stringify compare, then irValidate)
- g walk: D3 brief:76-87 (Enter/r/d, replace-wait, walk-summary `w`/`q`)
- Content order: D2 brief:65-69 (the seven items in C11 order, with the exact row texts)
- Imports: D2 brief:49-51 · D4 brief:89-90 — all four sources present (screen post-W2-01b, ir post-W2-05, protocol post-W2-01, shared types)
- Node imports: D4 brief:89 (cpSync, node:fs)
- W2-13 routing: WHY brief:9-10 ("Row W2-13 (not yours) routes the pause to this screen")
- W2-13a accept coverage: brief:144-145 (named: W2-13a scenario 1)
- W2-09 diffLines: D2 brief:56 (optional `diffLines`; content item 7 brief:69)
- Needs from earlier rows: S1 brief:17 (names W2-01b/W2-05 creators); the ir signatures and the fake pattern are NOT quoted in the brief — the writer gets the fake description at brief:134-136 but not `irSet`'s signature (it must trust D4's call shape)
- Source safety proof: D1 brief:44-47 — the six grep hits named there match the code exactly (verified at HEAD)

D/T → derived line
- D1 → C11 Source bullet (RESOLVE_CONFIRM_SOURCE) + row risk cell (the grep proof)
- D2 → M2 surface (exports, input, keys, content order)
- D3 → C11 Per entry (the g walk); the walk-summary `w`/`q` confirmation step is not in C11 — it mirrors the W2-05 clarify summary pattern (w/e/q), a sibling-pair design fill, not a contract violation
- D4 → C11 One write + C3 template copy
- T1 → row test item 1 (unknown-first, unclear-first)
- T2 → row test item 2 (cut row text)
- T3 → row test item 4 (g/r/w → one irSet, G-1 unchanged; no `$.nonGoals` call when unchanged)
- row test item 3 (a → accept) → brief:144-145, deferred to W2-13a (FLOW)
- GAP: the applyResolve ir-failure branch (Derived M4 "ir result not ok → the error must surface"; D4 brief:97 states the throw) has no test — T3 drives only the ok path, and no W2-13a scenario reaches it

## Probes

Probes under `/tmp/dp-refine/W2-08/` (probe tsconfigs add `paths` for the `spec-pipeline/protocol` stub and repo `typeRoots`; stubs marked PROBE-ONLY). tools/dpf is not yet registered in any tsconfig/eslint block (W2-01b is todo), so eslint runs `--stdin-filename tools/scripts/__probe.ts` per 04-check-method M9 limits.

- PB1 PATTERN block (brief:27-39) · `/tmp/dp-refine/W2-08/pattern.ts` (LineIO stubbed, the block omits it) · tsc: `error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'` (line 10: `io.ask(prompt)` with `prompt?: string`) · eslint: 5 warnings (complexity 6 on runScreen; `no-restricted-syntax`: `let turn`, `for (const line of turn.out)` ×2, `for (;;)`); 0 errors
- PB2 D2 import block (brief:49-51) · `/tmp/dp-refine/W2-08/d2-imports.ts` · tsc: none (type-only imports) · eslint: `error simple-import-sort/imports` (relative `../../../shared/…` before external `spec-pipeline/protocol`)
- PB3 D1+D2+D4 module code (brief:42-47, 48-64, 88-98) · `/tmp/dp-refine/W2-08/dpf/src/screens/resolve-confirm.ts` (signatures with PROBE-ONLY bodies; ResolveState declared per D2's prose; screen/ir stubs verbatim from the W2-01b/W2-05 briefs) · tsc: none · eslint: `warning max-params` (applyResolve: 4 params, max 3) + probe artifacts excluded (import-sort of the merged probe block, one probe-only line with 7 statements)
- PB4 TESTS fixture block (brief:101-133) · `/tmp/dp-refine/W2-08/dpf/tests/screens/fixture.ts` · tsc: `error TS2307: Cannot find module '../src/screens/resolve-confirm.js'` (line 33) · corrected import `../../src/screens/resolve-confirm.js` (`fixture-fixed.ts`): tsc none · eslint: 2 probe artifacts (unused `screen`/`applyResolve` — used by T1-T3 in the real file) + `error simple-import-sort/imports` ×2 (same relative-before-external order)

## Findings

| # | Sev | Item (M/S/D/T id) | Problem | Evidence (quoted) | Proposed change |
|---|---|---|---|---|---|
| 1 | high | T3 (D4) | The applyResolve edit path makes TWO subprocess calls (irSet `$.goals` then irValidate), but the fixture gives the fake "a single `{ exit: 0 }` entry": the second call reads `plan[1]` = undefined and the fake throws (`entry.exit` on undefined, W2-04 D2 step 1/6), so irValidate resolves `{ ok: false }` and applyResolve throws — T3 cannot pass. "and a counter" contradicts the W2-04/W2-05 pattern ("no counter file: the fake starts at 0") | brief:134-136 "write a plan file (a single { exit: 0 } entry) and a counter"; D4 brief:93-96 "one irSet … then irValidate of record.inputs.goals"; briefs/W2-04.md D2 step 1 "entry = plan[n]" | T3 fixture: "write a plan file (two `{ exit: 0 }` entries, one per ir call: irSet, irValidate) — no counter file: the fake starts at entry 0"; add `fake = fileURLToPath(new URL('../fixtures/fake-spec-pipeline.mjs', import.meta.url))` so `cli` is fully specified |
| 2 | high | TESTS (T1-T3) | The fixture's src import does not resolve: the test sits in `tools/dpf/tests/screens/`, so `'../src/screens/resolve-confirm.js'` points at `tools/dpf/tests/src/…`; every test fails at import | PB4: `error TS2307: Cannot find module '../src/screens/resolve-confirm.js'`; the corrected `'../../src/…'` compiles clean (fixture-fixed.ts); briefs/W2-05.md "the src imports are '../../src/screens/clarify.js'" | brief:133 → `from '../../src/screens/resolve-confirm.js'` |
| 3 | med | D4 | `applyResolve` takes 4 parameters (result, record, originalGoals, cli); the M9 limit is ≤ 3 params (eslint.config.mjs `max-params` 3; CLAUDE.md Quality Metrics "Parameters 3 max"). `--quiet` hides the warning at STEP 5, but the signature breaks the limit the brief must meet | PB3: `warning Arrow function has too many parameters (4). Maximum allowed is 3`; brief:91 `applyResolve = (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[])` | `applyResolve = (result: ResolveResult, o: { readonly record: PausePayload; readonly originalGoals: GoalsDoc; readonly cli: readonly string[] }): Promise<void>`; update the T3/T4 call sites |
| 4 | med | PATTERN | The block is labelled "src/ui/screen.ts from W2-01b, verbatim" but is not verbatim: it omits `LineIO`, rewrites runScreen with `let turn` + `for (const line of turn.out)` ×2 + `for (;;)` (all no-restricted-syntax), and `prompt?: string` does not typecheck (ask takes `string`). W2-01b's actual code (briefs/W2-01b.md D9) uses writeAll/step recursion, no let/for, `prompt = DEFAULT_PROMPT`; its closing note: "No `let`/`for`: no-restricted-syntax" | PB1: tsc TS2345 + 5 eslint warnings (let, ForOf ×2, ForStatement, complexity 6); briefs/W2-01b.md D9 `export const runScreen = <S, R>(screen: Screen<S, R>, io: LineIO, prompt = DEFAULT_PROMPT): Promise<R | undefined> => {` | Replace the block with W2-01b D9's verbatim slice (Turn/Screen/LineIO interfaces + DEFAULT_PROMPT/Session + writeAll, ≤15 lines) and fix the header to "per W2-01b D9, verbatim (post-W2-01b)" |
| 5 | med | D2 + TESTS imports | Both import blocks list the relative `shared/ir/resolution.js` import before external `spec-pipeline/protocol`; the repo sort (eslint.config.mjs IMPORT_SORT_GROUPS `[['^\u0000'],['^node:'],['^@?\w'],['^\.']]`) makes that an error — STEP 5 fails on a verbatim copy | PB2: `error simple-import-sort/imports`; PB4: same ×2; eslint.config.mjs:160 `'simple-import-sort/imports': ['error', …]` | Order the imports node: → external → relative: D2 block = `spec-pipeline/protocol`, then `../../../shared/ir/resolution.js`, then `../ui/screen.js`; state the merged sorted file block (node:fs, protocol, resolution.js, ../run/ir.js, ../ui/screen.js); test imports the same |
| 6 | med | D4 (T gap) | D4's explicit error branch — "Throw an Error carrying the findings or error when any ir result is not ok" — has no test: T3 drives only ok results, and no W2-13a scenario reaches an ir failure (its scenarios are accept/correction/exit-codes/operator/status) | brief:97; brief:144-145 names W2-13a scenario 1 (accept) only; wave-2-dpf-cli.md W2-13a line scenarios (1)-(5) | Add T4 (D4): plan `[{ exit: 3, stdout: [a findings line] }]` → `await expect(applyResolve(…)).rejects.toThrow('<findings text>')` (M8: rejects when nothing between catches) |
| 7 | med | DO NOT | Line 2 forbids "helpers … that are not in DELIVERABLES" without the template's escape clause ("— unless the lint limits need one: then name it on its D line in the FINAL REPORT"); but `next` must dispatch four phases — one function is commit-gate complexity >5 (4 case clauses + ~10 sub-branches), so per-phase helpers (or a handler table) are required and none is named | brief:163 vs template 01-writer-brief.md "add options, comments or docs that are not in DELIVERABLES, or a helper beyond the ones it names — unless the lint limits need one"; eslint.config.mjs:25-27 COMPLEXITY_HARD 5 "errors at >5" | Restore the template's line 2 verbatim; name the per-phase helpers on D2/D3 (or "the g-walk phase helpers, named in the FINAL REPORT") |
| 8 | low | S8 | S8 range 171-176 and its description name `ResolutionDoc`, but the type the brief imports is `ResolutionIr`, at line 177 — outside the range | brief:24; resolution.ts:177 `export type ResolutionIr = …`; D2 brief:49 imports `ResolutionIr` | S8 → `resolution.ts:171-177` and "the GoalEntry/NonGoalEntry/GoalsDoc/ResolutionIr types the screen takes" |
| 9 | low | state (D2/D3) | `goalsChanged`/`nonGoalsChanged` are set (D3 "mark the matching changed flag true") but never read: D4 compares `result.nonGoals` to `originalGoals.nonGoals` by JSON.stringify and the `edit` result carries no flags — dead state | brief:73-74, 85; brief:95-96 (the comparison is the source of truth) | Drop the two flags from the state and D3's marking clause |
| 10 | low | FILES/S1/TESTS/STEP 2 | Paths are package-relative (`src/…`, `tests/…`) where the row, S2-S8 and every sibling brief use repo-relative (`tools/dpf/…`); REFINE item 2: "Paths repo-relative" | brief:13-14, 17, 101 vs briefs/W2-05.md FILES `tools/dpf/src/run/ir.ts`; brief:151 "Write T1-T4" while TESTS defines T1-T3 (brief:146) | Prefix `tools/dpf/` on FILES, S1, the D headers, "Put them in …"; after adding T6 (finding 6) "T1-T4" stands — align the "T1-T3 all fail" line to the final test list |
| 11 | low | STEP 3 | "one Edit per site" — both FILES are new; the template and W2-04/W2-05 say "one Write per new file" | brief:154; briefs/W2-04.md STEP 3 "one Write per new file" | "Do D1-D4 in this order, one Write per new file." |
| 12 | low | FINAL REPORT | "T2 … T3 (same shape)" must follow the final test list once finding 6's test is added | brief:181 | "T2 … T4 (same shape)" |
````

## §2 — The reference (Opus) review

````
# Opus review — W2-08

Reviewed 2026-10-29 against the brief at base 36ffe5b4, with W2-01 (`spec-pipeline/protocol`), W2-01b (`ui/screen.ts`), W2-02 (`ResidueRow`), W2-04 (the fake) and W2-05 (`run/ir.ts`) as their briefs leave them. tools/dpf is not registered for lint until W2-01b, so every block was linted at `tools/scripts/__probe.ts` / `__probe.test.ts` (04-check-method.md stack profile, M9 lint). The corrected code below ran in a scratch tree: the real tools/shared, the real tsconfig.node.json options, a stub `spec-pipeline/protocol` that re-exports the real `PausePayload`, `EXIT_OK` and `EXIT_STEP_FAILED`, W2-05's `irSet` and W2-04's fake as their briefs describe them. Result: tsc clean, eslint clean, 9 tests green.

| # | Sev | Item | Problem | Evidence | Proposed change |
|---|---|---|---|---|---|
| 1 | high | D3, D4 (C3, C8) | edited goals can never be confirmed from the screen. `w` returns `edit`, and applyResolve writes goals.json but not confirmed.json. The flow resumes, resolve-confirm pauses again (its output is missing), and the C8 re-pause guard sends the person to the operator; a third pause → exit 4 | 02-contracts.md C3: "`confirmed.json` … its existence completes the step"; C8: "If the same step pauses again right after its action, dpf runs the operator"; briefs/W2-08.md:86-87,93-97 | `w` keeps the edits and returns to the main content, which shows the edited goals; `a` returns `accept` carrying the writes; applyResolve runs the writes, then copies the template. The plan owner decides; if an edit should instead re-show the screen without resuming, C8 and W2-13 need that rule |
| 2 | high | D2, D3 | the walk duplicates every goal. The initial state's goals are `input.goals.goals`, and keep/replace append to them, so T3 yields `[G-1, G-2, G-1, G-2']`: T3's exact value fails, and ir refuses the duplicate ids | briefs/W2-08.md:74-75,81,84-85; resolution.ts:32-33 `id "…" is used more than once` | the walk records one decision per entry (kept, replaced or dropped) and builds the lists from them at `w` (corrected code) |
| 3 | high | D4, TESTS | T3 cannot pass. The fake's plan has a single `{ exit: 0 }` entry, but D4 spawns twice (irSet, then irValidate). The second call reads `plan[1]` = undefined → TypeError → exit 1, irValidate is not ok, and applyResolve throws. irValidate is also EXTRA: `ir set` parses the whole document before it writes, and C11 and the row say one irSet | briefs/W2-08.md:96,134-135; W2-04 D2 step 1 `entry = plan[n]`; spec-pipeline/src/ir/command.ts:242-244 `parseIrWith(IR_KINDS[edit.kind], …)` before `writeIr` | no irValidate; one plan entry per write |
| 4 | high | TESTS | T3 asserts G-2's source in calls.jsonl, but irSet passes the value as `--value @<tmp>` and deletes the temp file in a `finally`; the fake records argv only | briefs/W2-08.md:142-143; W2-05 D1:46-48; W2-04 D2 step 4 | the screen test asserts the values in the result; the applyResolve test asserts the argv per write (value `@…`) and the template copy. Residual: an applyResolve that forwards a wrong value still passes — no unit sink sees the temp file |
| 5 | high | TESTS | `'../src/screens/resolve-confirm.js'` from tools/dpf/tests/screens/ resolves to tools/dpf/tests/src/… | briefs/W2-08.md:133 | `'../../src/screens/resolve-confirm.js'` |
| 6 | high | D2, D4 | the import lines fail simple-import-sort (an error): the specifiers are unsorted, and node:fs comes after the relative imports | probe: `1:1 error Run autofix to sort these imports! simple-import-sort/imports` | the import block of the corrected code |
| 7 | med | D2, D3 | the screen is a prose state machine (four phases, two flags, index arithmetic) with no code. M9 cannot run on prose, and #2 hides there | briefs/W2-08.md:65-87 | D2 + D3 = the corrected code below |
| 8 | med | D3 | `r` then Enter replaces the text with `''`. GoalEntrySchema refuses it, ir refuses the write, and applyResolve throws in the middle of the flow | resolution.ts:15 `text: z.string().min(1)` | an empty or blank text asks again (`new text:`) |
| 9 | med | D3 | dropping every goal leaves `goals: []`, which `.min(1)` refuses, so applyResolve throws | resolution.ts:23 `goals: z.array(GoalEntrySchema).min(1)` | `w` with no goal left prints a line and stays; `q` drops the edits |
| 10 | med | D4 | applyResolve has 4 params. That is only a warn, and STEP 5's `--quiet` hides it | probe: `7:138 warning Arrow function has too many parameters (4). Maximum allowed is 3 max-params` | the accept result carries its writes, so the signature is `(result, record, cli)` |
| 11 | med | ResolveConfirmInput (C11 item 6) | nobody turns ledger residue rows into `cuts`. The row gives W2-08 "the cut lines from `residue` rows"; the brief takes `cuts: string[]` from "the flow", and W2-13 does not name it | wave-2-dpf-cli.md:58; 02-contracts.md:239; briefs/W2-08.md:55 | `resolveCuts(rows: readonly ResidueRow[], runId)`: this run, stage `spec-a-resolve`, `anchor.jsonPath === '$.sections.request-docs'`, each `entry.text`; the entry is parsed with `ResidueEntrySchema` (W2-02 types it as `unknown`) |
| 12 | med | TESTS | T1 and T2 assert order and containment only: a missing `blast:` line, a wrong goal line or a dropped diffLines line passes. `a`, `c` and `q` have no unit test, though the row lists "`a` → result accept" | briefs/W2-08.md:137-145; wave-2-dpf-cli.md:58 | exact `toEqual` on `start.out`, and a test of the main keys (below) |
| 13 | med | STEPS | STEPS 2 says "Write T1-T4 … T1-T4 MUST fail", but TESTS defines T1-T3 and the FINAL REPORT lists T1…T3 | briefs/W2-08.md:137-146,151-153,180-181 | the test names of the corrected test file |
| 14 | low | D2 | `ResolveConfirmInput.record` is never read by the screen (EXTRA); applyResolve takes the record itself | briefs/W2-08.md:57,91 | drop it; the screen takes `goals: GoalLists` (a GoalsDoc is assignable) |
| 15 | low | D2, D3 | `goalsChanged` / `nonGoalsChanged` are never read (D4 compares with JSON.stringify), and `d` does not set them | briefs/W2-08.md:74,85,95-96 | drop them; `writesOf` compares before and after |
| 16 | low | D3 | walk-summary `q` → "phase 'main' (abort)" does not say what happens to the partial walk; with #2's state it stays in the lists | briefs/W2-08.md:87 | `q` drops the walk; the lists stay as they were |
| 17 | low | FILES, S1 | the paths are package-relative (`src/screens/…`), but the header says "run every command from the repo root" and STEPS use `tools/dpf/…` | briefs/W2-08.md:2,13-14,152 | repo-relative paths |
| 18 | low | PATTERN | runScreen is the loop, not a screen; the sibling to copy is W2-05's clarifyScreen | briefs/W2-08.md:26-39 | PATTERN = W2-05's clarifyScreen start/next block (post-W2-05) |
| 19 | low | DO NOT | line 2 is the old text, with no lint-forced helper exception | briefs/W2-08.md:163 | the current template line |

`RESOLVE_CONFIRM_SOURCE` (D1) and its `source ===` grep are correct. The fixture's PausePayload fields match pause.ts:15-40, where `validationErrors` and `repairFindings` are optional. `ResolutionIr` is exported (resolution.ts:177).

## Corrected D1–D4 (tools/dpf/src/screens/resolve-confirm.ts)

```ts
import { cpSync } from 'node:fs';

import type { PausePayload } from 'spec-pipeline/protocol';

import { ResidueEntrySchema } from '../../../shared/ir/index.js';
import type { GoalEntry, NonGoalEntry, ResolutionIr } from '../../../shared/ir/resolution.js';
import type { ResidueRow } from '../follow/ledger.js';
import { type IrResult, irSet } from '../run/ir.js';
import type { Screen, Turn } from '../ui/screen.js';

export const RESOLVE_CONFIRM_SOURCE = 'resolve-confirm';

const MAIN_PROMPT = 'a to accept, g to edit goals, c to correct, q to quit';
const TEXT_PROMPT = 'new text:';
const SUMMARY_PROMPT = 'goals updated (w to keep the edits, q to drop them)';
const NO_GOAL = 'every goal was dropped: keep or replace at least one (q to drop the edits)';
const CUT_STAGE = 'spec-a-resolve';
const CUT_ANCHOR = '$.sections.request-docs';

export interface GoalLists {
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
}

export interface ResolveConfirmInput {
  readonly resolution: ResolutionIr;
  readonly goals: GoalLists;
  readonly cuts: readonly string[];
  readonly diffLines: readonly string[] | undefined;
}

export interface GoalWrite {
  readonly path: '$.goals' | '$.nonGoals';
  readonly value: readonly GoalEntry[];
}

export type ResolveResult =
  | { readonly kind: 'accept'; readonly writes: readonly GoalWrite[] }
  | { readonly kind: 'correction' }
  | { readonly kind: 'quit' };

type Phase = 'main' | 'walk' | 'text' | 'summary';

export interface ResolveState {
  readonly phase: Phase;
  readonly lists: GoalLists;
  readonly walked: readonly (GoalEntry | undefined)[];
  readonly writes: readonly GoalWrite[];
}

type ResolveTurn = Turn<ResolveState, ResolveResult>;

/** C11 item 6: this run's request-doc cuts, each residue entry's text. */
export const resolveCuts = (rows: readonly ResidueRow[], runId: string): readonly string[] =>
  rows
    .filter(row => row.runId === runId && row.stage === CUT_STAGE)
    .map(row => ResidueEntrySchema.safeParse(row.entry))
    .flatMap(parsed => (parsed.success && parsed.data.anchor.jsonPath === CUT_ANCHOR ? [parsed.data.text] : []));

const firstWhere = <T>(rows: readonly T[], first: (row: T) => boolean): readonly T[] => [
  ...rows.filter(first),
  ...rows.filter(row => !first(row)),
];

const mainLines = (input: ResolveConfirmInput, lists: GoalLists): readonly string[] => [
  `shape: ${input.resolution.shape}`,
  ...firstWhere(input.resolution.mapping, row => row.kind === 'unknown').map(row =>
    row.path === null ? `${row.noun}: ${row.kind}` : `${row.noun}: ${row.kind} ${row.path}`
  ),
  ...firstWhere(input.resolution.drift, row => row.status === 'unclear').map(row => `${row.id}: ${row.status}`),
  `blast: ${input.resolution.blastRadius.join(', ')}`,
  ...[...lists.goals, ...lists.nonGoals].map(entry => `${entry.id}: ${entry.text}`),
  ...input.cuts.map(cut => `cut: ${cut}`),
  ...(input.diffLines ?? []),
  MAIN_PROMPT,
];

const entriesOf = (lists: GoalLists): readonly GoalEntry[] => [...lists.goals, ...lists.nonGoals];

const walkPrompt = (entry: GoalEntry): string => `${entry.id}: ${entry.text} (Enter keep, r replace, d drop)`;

const changed = (before: readonly GoalEntry[], after: readonly GoalEntry[]): boolean =>
  JSON.stringify(before) !== JSON.stringify(after);

/** C11: `$.goals` is one write; `$.nonGoals` a second only when it changed. */
const writesOf = (before: GoalLists, after: GoalLists): readonly GoalWrite[] => [
  { path: '$.goals', value: after.goals },
  ...(changed(before.nonGoals, after.nonGoals) ? [{ path: '$.nonGoals' as const, value: after.nonGoals }] : []),
];

const listsOf = (lists: GoalLists, walked: readonly (GoalEntry | undefined)[]): GoalLists => ({
  goals: walked.slice(0, lists.goals.length).filter(entry => entry !== undefined),
  nonGoals: walked.slice(lists.goals.length).filter(entry => entry !== undefined),
});

const toMain = (input: ResolveConfirmInput, state: ResolveState): ResolveTurn => ({
  state: { ...state, phase: 'main', walked: [] },
  out: mainLines(input, state.lists),
});

const walkTurn = (state: ResolveState, walked: readonly (GoalEntry | undefined)[]): ResolveTurn => {
  const next = entriesOf(state.lists)[walked.length];
  return next === undefined
    ? { state: { ...state, phase: 'summary', walked }, out: [SUMMARY_PROMPT] }
    : { state: { ...state, phase: 'walk', walked }, out: [walkPrompt(next)] };
};

const advance = (state: ResolveState, decision: GoalEntry | undefined): ResolveTurn =>
  walkTurn(state, [...state.walked, decision]);

const MAIN_RESULTS: Readonly<Record<string, (state: ResolveState) => ResolveResult>> = {
  a: state => ({ kind: 'accept', writes: state.writes }),
  c: () => ({ kind: 'correction' }),
  q: () => ({ kind: 'quit' }),
};

const mainNext = (input: ResolveConfirmInput, state: ResolveState, line: string): ResolveTurn => {
  if (line === 'g') return walkTurn(state, []);
  const result = MAIN_RESULTS[line]?.(state);
  return result === undefined ? toMain(input, state) : { state, out: [], result };
};

const walkNext = (state: ResolveState, line: string): ResolveTurn => {
  const entry = entriesOf(state.lists)[state.walked.length];
  if (line === 'd') return advance(state, undefined);
  if (line === '') return advance(state, entry);
  return line === 'r' ? { state: { ...state, phase: 'text' }, out: [TEXT_PROMPT] } : { state, out: [walkPrompt(entry)] };
};

const textNext = (state: ResolveState, line: string): ResolveTurn => {
  const entry = entriesOf(state.lists)[state.walked.length];
  const text = line.trim();
  return text === ''
    ? { state, out: [TEXT_PROMPT] }
    : advance(state, { id: entry.id, text, source: RESOLVE_CONFIRM_SOURCE });
};

const summaryNext = (input: ResolveConfirmInput, state: ResolveState, line: string): ResolveTurn => {
  const edited = listsOf(state.lists, state.walked);
  if (line === 'q') return toMain(input, state);
  if (line !== 'w') return { state, out: [SUMMARY_PROMPT] };
  if (edited.goals.length === 0) return { state, out: [NO_GOAL] };
  return toMain(input, { ...state, lists: edited, writes: writesOf(input.goals, edited) });
};

export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> => ({
  start: { state: { phase: 'main', lists: input.goals, walked: [], writes: [] }, out: mainLines(input, input.goals) },
  next: (state, line) => {
    const phases: Readonly<Record<Phase, () => ResolveTurn>> = {
      main: () => mainNext(input, state, line),
      walk: () => walkNext(state, line),
      text: () => textNext(state, line),
      summary: () => summaryNext(input, state, line),
    };
    return phases[state.phase]();
  },
});

const assertOk = (result: IrResult): void => {
  if (!result.ok) throw new Error(`ir refused ${result.file}: ${result.findings ?? result.error ?? ''}`);
};

/** C3 + C11: the goal writes in order (one file, never in parallel), then the template copy completes the step. */
export const applyResolve = async (result: ResolveResult, record: PausePayload, cli: readonly string[]): Promise<void> => {
  if (result.kind !== 'accept') return;
  const file = record.inputs.goals;
  await result.writes.reduce<Promise<void>>(
    (previous, write) => previous.then(async () => assertOk(await irSet({ cli, kind: 'goals', file, path: write.path, value: write.value }))),
    Promise.resolve()
  );
  cpSync(record.inputs.template, record.outputs[0]);
};
```

## Tests (probed, green)

tools/dpf/tests/screens/resolve-confirm.test.ts. At base every test fails because the module is missing (a new file: the plan accepts that red). The first describe needs no fs; applyResolve runs the W2-04 fake with one plan entry per spawn.

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PausePayload } from 'spec-pipeline/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ResolutionIr } from '../../../shared/ir/resolution.js';
import {
  applyResolve,
  type ResolveConfirmInput,
  resolveConfirmScreen,
  resolveCuts,
  type ResolveResult,
  type ResolveState
} from '../../src/screens/resolve-confirm.js';
import type { Screen } from '../../src/ui/screen.js';

const FAKE = path.join(import.meta.dirname, '../fixtures/fake-spec-pipeline.mjs');
const MAIN_PROMPT = 'a to accept, g to edit goals, c to correct, q to quit';
const SUMMARY = 'goals updated (w to keep the edits, q to drop them)';

const resolution: ResolutionIr = {
  schemaVersion: 1,
  shape: 'feature',
  mapping: [
    { noun: 'auth', surfaceId: 'S-1', kind: 'module', path: 'src/auth', evidence: 'e' },
    { noun: 'ui', surfaceId: null, kind: 'unknown', path: null, evidence: 'e' },
  ],
  drift: [
    { id: 'D-1', snapshotSays: 's', codeSays: 'c', status: 'matches', notes: null },
    { id: 'D-2', snapshotSays: 's', codeSays: 'c', status: 'unclear', notes: 'n' },
  ],
  blastRadius: ['src/auth', 'src/ui'],
  generatedAt: '2026-01-01T00:00:00.000Z',
  branch: '900-x',
};
const G1 = { id: 'G-1', text: 'store', source: 'resolve' };
const G2 = { id: 'G-2', text: 'old', source: 'resolve' };
const NG1 = { id: 'NG-1', text: 'no sync', source: 'resolve' };
const input: ResolveConfirmInput = { resolution, goals: { goals: [G1, G2], nonGoals: [NG1] }, cuts: ['cut text'], diffLines: ['- G-2: older'] };
const MAIN = [
  'shape: feature',
  'ui: unknown',
  'auth: module src/auth',
  'D-2: unclear',
  'D-1: matches',
  'blast: src/auth, src/ui',
  'G-1: store',
  'G-2: old',
  'NG-1: no sync',
  'cut: cut text',
  '- G-2: older',
  MAIN_PROMPT,
];

const play = (screen: Screen<ResolveState, ResolveResult>, lines: readonly string[]) =>
  lines.reduce((turn, line) => screen.next(turn.state, line), screen.start);

describe('resolveConfirmScreen (C11)', () => {
  it('prints the C11 content: unknown mapping rows and unclear drift rows first', () => {
    expect(resolveConfirmScreen(input).start.out).toEqual(MAIN);
  });

  it('maps a, c and q to their results and re-prints the content on any other line', () => {
    const screen = resolveConfirmScreen(input);
    expect(play(screen, ['a']).result).toEqual({ kind: 'accept', writes: [] });
    expect(play(screen, ['c']).result).toEqual({ kind: 'correction' });
    expect(play(screen, ['q']).result).toEqual({ kind: 'quit' });
    expect(play(screen, ['x']).out).toEqual(MAIN);
  });

  it('walks each goal and non-goal, then accepts with the one $.goals write', () => {
    const screen = resolveConfirmScreen(input);
    expect(play(screen, ['g']).out).toEqual(['G-1: store (Enter keep, r replace, d drop)']);
    expect(play(screen, ['g', '']).out).toEqual(['G-2: old (Enter keep, r replace, d drop)']);
    expect(play(screen, ['g', '', 'r']).out).toEqual(['new text:']);
    expect(play(screen, ['g', '', 'r', '  ']).out).toEqual(['new text:']);
    expect(play(screen, ['g', '', 'r', 'new text']).out).toEqual(['NG-1: no sync (Enter keep, r replace, d drop)']);
    expect(play(screen, ['g', '', 'r', 'new text', '']).out).toEqual([SUMMARY]);
    expect(play(screen, ['g', '', 'r', 'new text', '', 'w']).out).toContain('G-2: new text');
    expect(play(screen, ['g', '', 'r', 'new text', '', 'w', 'a']).result).toEqual({
      kind: 'accept',
      writes: [{ path: '$.goals', value: [G1, { id: 'G-2', text: 'new text', source: 'resolve-confirm' }] }],
    });
  });

  it('writes $.nonGoals only when a non-goal changed', () => {
    expect(play(resolveConfirmScreen(input), ['g', '', '', 'd', 'w', 'a']).result).toEqual({
      kind: 'accept',
      writes: [{ path: '$.goals', value: [G1, G2] }, { path: '$.nonGoals', value: [] }],
    });
  });

  it('refuses to keep a walk that dropped every goal, and q drops the edits', () => {
    const screen = resolveConfirmScreen(input);
    expect(play(screen, ['g', 'd', 'd', '', 'w']).out).toEqual([
      'every goal was dropped: keep or replace at least one (q to drop the edits)',
    ]);
    expect(play(screen, ['g', 'd', 'd', '', 'q']).out).toEqual(MAIN);
    expect(play(screen, ['g', 'd', 'd', '', 'q', 'a']).result).toEqual({ kind: 'accept', writes: [] });
  });
});

describe('resolveCuts (C11)', () => {
  it('keeps the request-docs residue texts of this run and stage only', () => {
    const entry = (jsonPath: string, text: string) => ({
      class: 'bundle-over-cap', anchor: { artifact: 'spec', jsonPath }, findingIds: [], text,
    });
    const rows = [
      { runId: 'r1', stage: 'spec-a-resolve', entry: entry('$.sections.request-docs', 'request documents left out whole: docs/a.md') },
      { runId: 'r0', stage: 'spec-a-resolve', entry: entry('$.sections.request-docs', 'an older run') },
      { runId: 'r1', stage: 'spec-b', entry: entry('$.sections.request-docs', 'another stage') },
      { runId: 'r1', stage: 'spec-a-resolve', entry: entry('$.sections.stage-inputs', 'another section') },
      { runId: 'r1', stage: 'spec-a-resolve', entry: { text: 'not a residue entry' } },
    ];
    expect(resolveCuts(rows, 'r1')).toEqual(['request documents left out whole: docs/a.md']);
  });
});

describe('applyResolve (C3, C11)', () => {
  let dir = '';
  const env = { plan: process.env.FAKE_SP_PLAN, dir: process.env.FAKE_SP_DIR };
  const record = (): PausePayload => ({
    runId: 'r1', runFingerprint: 'f', epochId: undefined, stepId: 'resolve-confirm', stepType: 'human',
    role: undefined, modelProfile: undefined, outputSchemaRef: undefined,
    inputs: { resolution: '/r/resolution.json', goals: '/r/goals.json', template: path.join(dir, 'confirm.template.json') },
    outputs: [path.join(dir, 'confirmed.json')],
    critics: undefined, reviser: undefined, maxRounds: undefined, gatesEachRound: undefined, droppedGates: undefined,
  });
  const calls = (): unknown[] =>
    readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line) as unknown);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'resolve-confirm-'));
    writeFileSync(path.join(dir, 'plan.json'), JSON.stringify([{ exit: 0 }, { exit: 0 }]));
    writeFileSync(path.join(dir, 'confirm.template.json'), '{\n  "schemaVersion": 1,\n  "decision": "accept"\n}\n');
    process.env.FAKE_SP_PLAN = path.join(dir, 'plan.json');
    process.env.FAKE_SP_DIR = path.join(dir, 'pipeline');
  });

  afterEach(() => {
    process.env.FAKE_SP_PLAN = env.plan;
    process.env.FAKE_SP_DIR = env.dir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs one ir set per write, in order, then copies the template to confirmed.json', async () => {
    const writes = [{ path: '$.goals' as const, value: [G1] }, { path: '$.nonGoals' as const, value: [] }];
    await applyResolve({ kind: 'accept', writes }, record(), [process.execPath, FAKE]);
    const value = expect.stringMatching(/^@/u) as unknown;
    expect(calls()).toEqual([
      ['ir', 'set', '--kind', 'goals', '--file', '/r/goals.json', '--path', '$.goals', '--value', value],
      ['ir', 'set', '--kind', 'goals', '--file', '/r/goals.json', '--path', '$.nonGoals', '--value', value],
    ]);
    expect(readFileSync(path.join(dir, 'confirmed.json'), 'utf8')).toBe(readFileSync(path.join(dir, 'confirm.template.json'), 'utf8'));
  });

  it('throws with the findings and copies nothing when ir refuses the write', async () => {
    writeFileSync(path.join(dir, 'plan.json'), JSON.stringify([{ exit: 3, stdout: ['goals: id "G-1" is used more than once'] }]));
    await expect(applyResolve({ kind: 'accept', writes: [{ path: '$.goals', value: [G1, G1] }] }, record(), [process.execPath, FAKE])).rejects.toThrow(
      'ir refused /r/goals.json: goals: id "G-1" is used more than once'
    );
    expect(existsSync(path.join(dir, 'confirmed.json'))).toBe(false);
  });

  it('writes nothing for a correction or a quit', async () => {
    await applyResolve({ kind: 'correction' }, record(), [process.execPath, FAKE]);
    await applyResolve({ kind: 'quit' }, record(), [process.execPath, FAKE]);
    expect(existsSync(path.join(dir, 'calls.jsonl'))).toBe(false);
    expect(existsSync(path.join(dir, 'confirmed.json'))).toBe(false);
  });
});
```
````

## §3 — The reference's 19 numbered findings

````
brief	n	sev	item	problem (first 300 chars)
W2-08	1	high	D3, D4 (C3, C8)	 edited goals can never be confirmed from the screen. `w` returns `edit`, and applyResolve writes goals.json but not confirmed.json. The flow resumes, resolve-confirm pauses again (its output is missing), and the C8 re-pause guard sends the person to the operator; a third pause → exit 4 
W2-08	2	high	D2, D3	 the walk duplicates every goal. The initial state's goals are `input.goals.goals`, and keep/replace append to them, so T3 yields `[G-1, G-2, G-1, G-2']`: T3's exact value fails, and ir refuses the duplicate ids 
W2-08	3	high	D4, TESTS	 T3 cannot pass. The fake's plan has a single `{ exit: 0 }` entry, but D4 spawns twice (irSet, then irValidate). The second call reads `plan[1]` = undefined → TypeError → exit 1, irValidate is not ok, and applyResolve throws. irValidate is also EXTRA: `ir set` parses the whole document before it
W2-08	4	high	TESTS	 T3 asserts G-2's source in calls.jsonl, but irSet passes the value as `--value @<tmp>` and deletes the temp file in a `finally`; the fake records argv only 
W2-08	5	high	TESTS	 `'../src/screens/resolve-confirm.js'` from tools/dpf/tests/screens/ resolves to tools/dpf/tests/src/… 
W2-08	6	high	D2, D4	 the import lines fail simple-import-sort (an error): the specifiers are unsorted, and node:fs comes after the relative imports 
W2-08	7	med	D2, D3	 the screen is a prose state machine (four phases, two flags, index arithmetic) with no code. M9 cannot run on prose, and #2 hides there 
W2-08	8	med	D3	 `r` then Enter replaces the text with `''`. GoalEntrySchema refuses it, ir refuses the write, and applyResolve throws in the middle of the flow 
W2-08	9	med	D3	 dropping every goal leaves `goals: []`, which `.min(1)` refuses, so applyResolve throws 
W2-08	10	med	D4	 applyResolve has 4 params. That is only a warn, and STEP 5's `--quiet` hides it 
W2-08	11	med	ResolveConfirmInput (C11 item 6)	 nobody turns ledger residue rows into `cuts`. The row gives W2-08 "the cut lines from `residue` rows"; the brief takes `cuts: string[]` from "the flow", and W2-13 does not name it 
W2-08	12	med	TESTS	 T1 and T2 assert order and containment only: a missing `blast:` line, a wrong goal line or a dropped diffLines line passes. `a`, `c` and `q` have no unit test, though the row lists "`a` → result accept" 
W2-08	13	med	STEPS	 STEPS 2 says "Write T1-T4 … T1-T4 MUST fail", but TESTS defines T1-T3 and the FINAL REPORT lists T1…T3 
W2-08	14	low	D2	 `ResolveConfirmInput.record` is never read by the screen (EXTRA); applyResolve takes the record itself 
W2-08	15	low	D2, D3	 `goalsChanged` / `nonGoalsChanged` are never read (D4 compares with JSON.stringify), and `d` does not set them 
W2-08	16	low	D3	 walk-summary `q` → "phase 'main' (abort)" does not say what happens to the partial walk; with #2's state it stays in the lists 
W2-08	17	low	FILES, S1	 the paths are package-relative (`src/screens/…`), but the header says "run every command from the repo root" and STEPS use `tools/dpf/…` 
W2-08	18	low	PATTERN	 runScreen is the loop, not a screen; the sibling to copy is W2-05's clarifyScreen 
W2-08	19	low	DO NOT	 line 2 is the old text, with no lint-forced helper exception 
````

## §4 — The brief under review (W2-08)

````
TASK W2-08 — the resolve-confirm screen: show the resolution and edit the goals
Repo <WT> · base 36ffe5b4 · package tools/dpf (not a workspace: run every command from the repo root)
You write the failing tests AND the implementation. Touch only the files under FILES.

WHY
After spec-a-resolve, the run pauses at resolve-confirm (C3). The person must accept the
resolution, edit the goals (C11), correct, or quit. The screen shows the C11 content order
(shape, mapping, drift, blastRadius, goals, cuts, diff) and the g walk edits each goal.
Without it, the person has no terminal path to confirm or edit the goals. Row W2-13
(not yours) routes the pause to this screen.

FILES
src/screens/resolve-confirm.ts       new
tests/screens/resolve-confirm.test.ts   new

SITES (verified at 36ffe5b4; if a line moved, find it again with the grep anchor)
S1 src/screens/resolve-confirm.ts   new   (no base line: W2-01b created src/ui/screen.ts, W2-05 created src/run/ir.ts)
S2 tools/shared/ir/resolution.ts:14-20   grep 'GoalEntrySchema'   the GoalEntry/NonGoalEntry shapes {id, text, source}
S3 tools/shared/ir/resolution.ts:41   grep 'export const GoalsDocSchema'   the GoalsDoc shape {schemaVersion, goals, nonGoals}
S4 tools/shared/ir/resolution.ts:93-109   grep 'MappingEntrySchema'   the MappingEntry {noun, surfaceId, kind, path, evidence} and DriftEntry {id, snapshotSays, codeSays, status, notes} shapes
S5 tools/shared/ir/resolution.ts:136-144   grep 'export const ResolutionDocSchema'   the ResolutionDoc shape {schemaVersion, shape, mapping, drift, blastRadius}
S6 tools/shared/ir/io.ts:179   grep 'export const readIr'   readIr (the flow uses it to read resolution.json and goals.json; the screen takes the parsed docs)
S7 tools/spec-pipeline/src/driver/pause.ts:15-40   grep 'export interface PausePayload'   the pause record inputs/outputs applyResolve reads
S8 tools/shared/ir/resolution.ts:171-176   grep 'export type GoalEntry'   the GoalEntry/NonGoalEntry/GoalsDoc/ResolutionDoc types the screen takes

PATTERN TO COPY (src/ui/screen.ts from W2-01b, verbatim — the Screen contract every screen copies)
export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
export interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }
export const runScreen = async <S, R>(screen: Screen<S, R>, io: LineIO, prompt?: string): Promise<R | undefined> => {
  let turn = screen.start;
  for (const line of turn.out) io.write(line);
  for (;;) {
    const line = await io.ask(prompt);
    if (line === undefined) return undefined;
    turn = screen.next(turn.state, line);
    if (turn.result !== undefined) return turn.result;
    for (const line of turn.out) io.write(line);
  }
};

DELIVERABLES (closed list: do all of them, nothing else)
D1 src/screens/resolve-confirm.ts: export
     export const RESOLVE_CONFIRM_SOURCE = 'resolve-confirm';
   A replaced entry gets this source (C11). No step rejects it: grep `source ===` under
   SP/src finds only gate/finding sources (profile/registry.ts:77, loop/routing.ts:40,
   loop/run.ts:107,111) and undefined-checks (wiring/row-ids.ts:67, surface-refs.ts:112) —
   no goal-source comparison. The goal source is a free string (GoalEntrySchema:15).
D2 src/screens/resolve-confirm.ts: export
     import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../shared/ir/resolution.js';
     import { type PausePayload } from 'spec-pipeline/protocol';
     import { type Screen } from '../ui/screen.js';
     export interface ResolveConfirmInput {
       readonly resolution: ResolutionIr;
       readonly goals: GoalsDoc;
       readonly cuts: readonly string[];
       readonly diffLines: readonly string[] | undefined;
       readonly record: PausePayload;
     }
     export type ResolveResult =
       | { readonly kind: 'accept' }
       | { readonly kind: 'edit'; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] }
       | { readonly kind: 'correction' }
       | { readonly kind: 'quit' };
     export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult>;
   The main content (C11 order, verbatim): 1 `shape: <resolution.shape>` · 2 mapping rows
   (kind 'unknown' first, then the rest in order) each `<noun>: <kind>` + ` <path>` when path
   is not null · 3 drift rows (status 'unclear' first, then the rest in order) each `<id>: <status>`
   · 4 `blast: <blastRadius joined by ', '>` · 5 each goal `<id>: <text>` then each non-goal
   `<id>: <text>` · 6 each cut `cut: <text>` · 7 each diffLines line verbatim. Then the main
   prompt `a to accept, g to edit goals, c to correct, q to quit`. Main keys: `a` → accept ·
   `g` → start the g walk (D3) · `c` → correction · `q` → quit · any other line → the main
   content again. The state is `{ phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary',
   index: number, goals: readonly GoalEntry[], nonGoals: readonly NonGoalEntry[],
   goalsChanged: boolean, nonGoalsChanged: boolean }` (initial: phase 'main', index 0, goals
   = input.goals.goals, nonGoals = input.goals.nonGoals, both changed false).
D3 src/screens/resolve-confirm.ts: the g walk (in resolveConfirmScreen). The walk iterates
   the combined list (input.goals.goals then input.goals.nonGoals); index ranges 0 to
   total-1. For an entry at index: a goal when index < goals.length (input.goals.goals[index]),
   else a non-goal (input.goals.nonGoals[index - goals.length]). The prompt is
   `<entry.id>: <entry.text> (Enter keep, r replace, d drop)`. `next` for phase 'walk':
   Enter (empty line) → keep the entry (append to goals/nonGoals), index+1. `r` → phase
   'replace-wait', prompt `new text:`. `d` → drop (index+1). Any other line → re-prompt.
   When index >= total → phase 'walk-summary', prompt `goals updated (w to write, q to abort)`.
   `next` for phase 'replace-wait': the line is the new text; append the entry with that text
   and source RESOLVE_CONFIRM_SOURCE, mark the matching changed flag true, index+1, phase
   'walk'. `next` for phase 'walk-summary': `w` → { kind: 'edit', goals, nonGoals } · `q` →
   phase 'main' (abort) · any other line → re-prompt.
D4 src/screens/resolve-confirm.ts: export
     import { cpSync } from 'node:fs';
     import { irSet, irValidate } from '../run/ir.js';
     export const applyResolve = (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]): Promise<void>;
   accept → cpSync(record.inputs.template, record.outputs[0]) (the only plain file write).
   edit → one irSet of { kind: 'goals', file: record.inputs.goals, path: '$.goals', value:
   result.goals }; a second irSet of { kind: 'goals', file: record.inputs.goals, path:
   '$.nonGoals', value: result.nonGoals } only when result.nonGoals differs from
   originalGoals.nonGoals (compared by JSON.stringify); then irValidate of record.inputs.goals.
   correction/quit → no write. Throw an Error carrying the findings or error when any ir
   result is not ok.

TESTS (write these first)
Put them in tests/screens/resolve-confirm.test.ts. A fixture (one file):
  import { type ResolutionIr, type GoalsDoc } from '../../../shared/ir/resolution.js';
  const resolution: ResolutionIr = {
    schemaVersion: 1,
    shape: 'feature',
    mapping: [
      { noun: 'auth', surfaceId: 'S-1', kind: 'module', path: 'src/auth', evidence: 'e' },
      { noun: 'ui', surfaceId: null, kind: 'unknown', path: null, evidence: 'e' },
    ],
    drift: [
      { id: 'D-1', snapshotSays: 's', codeSays: 'c', status: 'unclear', notes: 'n' },
      { id: 'D-2', snapshotSays: 's', codeSays: 'c', status: 'matches', notes: 'n' },
    ],
    blastRadius: ['src'],
    generatedAt: '2026-01-01T00:00:00.000Z',
    branch: '900-x',
  };
  const goals: GoalsDoc = {
    schemaVersion: 1,
    goals: [{ id: 'G-1', text: 'store', source: 'resolve' }, { id: 'G-2', text: 'old', source: 'resolve' }],
    nonGoals: [],
  };
  const record: PausePayload = {
    runId: 'r1', runFingerprint: 'f', epochId: undefined, stepId: 'resolve-confirm', stepType: 'human',
    role: undefined, modelProfile: undefined, outputSchemaRef: undefined,
    inputs: { resolution: '/r/resolution.json', goals: '/r/goals.json', template: '/p/confirm.template.json' },
    outputs: ['/p/confirmed.json'],
    critics: undefined, reviser: undefined, maxRounds: undefined, gatesEachRound: undefined, droppedGates: undefined,
  };
  const input: ResolveConfirmInput = { resolution, goals, cuts: ['cut text'], diffLines: undefined, record };
  const screen = resolveConfirmScreen(input);
  import { type PausePayload } from 'spec-pipeline/protocol';
  import { resolveConfirmScreen, applyResolve, type ResolveConfirmInput } from '../src/screens/resolve-confirm.js';
The applyResolve test reuses the W2-04 fake (tools/dpf/tests/fixtures/fake-spec-pipeline.mjs):
write a plan file (a single { exit: 0 } entry) and a counter, set process.env.FAKE_SP_PLAN
and FAKE_SP_DIR (restore in afterEach), and pass cli = [process.execPath, fake].
T1 (D2)   screen.start.out → the 'ui: unknown' mapping row comes before 'auth: module' (unknown first);
          and 'D-1: unclear' comes before 'D-2: matches' (unclear first).
T2 (D2)   screen.start.out → contains 'cut: cut text' (the cut row).
T3 (D3, D4)   the walk: next 'g' → the G-1 prompt; next '' → the G-2 prompt; next 'r' → 'new text:';
          next 'new text' → the summary; next 'w' → { kind: 'edit', goals: [G-1 unchanged, G-2 {id:'G-2', text:'new text', source:'resolve-confirm'}], nonGoals: [] }.
          Then applyResolve(that result, record, goals, cli) → calls.jsonl holds one irSet of
          '$.goals' (G-2 source 'resolve-confirm', G-1 unchanged) and no irSet of '$.nonGoals' (unchanged).
The accept case (next 'a' → { kind: 'accept' }, the D2 main key) is proven by W2-13a's flow test
(scenario 1: resolve-confirm `a` → boundary), not by a unit test — it is a thin copy + one cpSync.
No old tests in this file; T1-T3 all fail at base (the module does not exist).

STEPS
1. Read only the SITES. grep -n the anchor first, then Read with offset/limit, at most 80
   lines. Send independent reads together.
2. Write T1-T4, then run once:
     npx vitest run --config vitest.tools.config.ts tools/dpf/tests/screens/resolve-confirm.test.ts --maxWorkers=1 --reporter=dot
   T1-T4 MUST fail (the module does not exist). A new test that passes now proves nothing: fix it.
3. Do D1-D4 in this order, one Edit per site.
4. Run the same command again: all green.
5. Run once each: npm run typecheck, then
     npx eslint --quiet tools/dpf/src/screens/resolve-confirm.ts tools/dpf/tests/screens/resolve-confirm.test.ts
   Fix only what you introduced.
6. Run no other suite. No git, no commit.

DO NOT
- change a signature or a behaviour that DELIVERABLES does not list
- add options, helpers, comments or docs that are not in DELIVERABLES
- touch src/ui/screen.ts, src/run/ir.ts or src/run/paths.ts: those are W2-01b/W2-05
- import from spec-pipeline internals: the dep-cruiser rule dpf-built-ins-shared-protocol-only
  allows node:*, tools/shared and spec-pipeline/protocol only
- add a node: import other than node:fs (cpSync)
- write goals.json by hand: dpf writes only through ir (the template copy in D4 is the only plain file write)
- name a goal id selector in the ir path: the path is exactly '$.goals' (or '$.nonGoals') — the [id=…] selector selects on the field id only, and writing the whole array is the contract
- add a `w` key to the main screen: `w` is only in the g-walk summary (D3); the main keys are a/g/c/q

STOP
If a SITE does not match its description, or a deliverable cannot be done inside FILES,
stop at once. Reply with one line and change nothing more:
BRIEF MISMATCH: <S/D id> — <what is at file:line> — <what you would need>

FINAL REPORT (exactly this shape, one line each, no prose)
D1 done|missing — <file:line>
D2 … D4 (same shape)
T1 red→green|missing — <test name>
T2 … T3 (same shape)
RED: <failed>/<total>   GREEN: <passed>/<total>
typecheck: clean|<n> errors   eslint: clean|<n>
Outside FILES: none|<paths>
````

## §5 — W's probe files (its evidence; outputs are quoted inside §1)

Paths are relative to the worktree root (the probes were at /tmp/dp-refine/W2-08/ when written; <WT> = worktree root).

### d2-imports.ts

````ts
import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type Screen } from '../ui/screen.js';
export const _probe: [ResolutionIr, GoalsDoc, GoalEntry, NonGoalEntry, PausePayload, Screen<unknown, unknown>] | undefined = undefined;
````

### dpf/src/run/ir.ts

````ts
// PROBE-ONLY — W2-05's ir.ts signatures verbatim (briefs/W2-05.md D1); post-W2-05 site
export type IrResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly file: string; readonly findings: string | undefined; readonly error: string | undefined };

export const irSet = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string; readonly path: string; readonly value: unknown }): Promise<IrResult> =>
  Promise.resolve({ ok: true }); // PROBE-ONLY body
export const irValidate = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string }): Promise<IrResult> =>
  Promise.resolve({ ok: true }); // PROBE-ONLY body
````

### dpf/src/screens/resolve-confirm.ts

````ts
// PROBE — briefs/W2-08.md D1 + D2 + D4 code blocks; signatures with PROBE-ONLY bodies
import { cpSync } from 'node:fs';

import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type Screen } from '../ui/screen.js';
import { irSet, irValidate } from '../run/ir.js';

export const RESOLVE_CONFIRM_SOURCE = 'resolve-confirm';

export interface ResolveConfirmInput {
  readonly resolution: ResolutionIr;
  readonly goals: GoalsDoc;
  readonly cuts: readonly string[];
  readonly diffLines: readonly string[] | undefined;
  readonly record: PausePayload;
}

export type ResolveResult =
  | { readonly kind: 'accept' }
  | { readonly kind: 'edit'; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] }
  | { readonly kind: 'correction' }
  | { readonly kind: 'quit' };

// PROBE-ONLY: ResolveState declared per D2's prose (the brief describes it, does not type it)
interface ResolveState {
  readonly phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary';
  readonly index: number;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
  readonly goalsChanged: boolean;
  readonly nonGoalsChanged: boolean;
}

export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> => {
  void input;
  throw new Error('PROBE-ONLY stub');
};

export const applyResolve = (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]): Promise<void> => {
  void result; void record; void originalGoals; void cli; void cpSync; void irSet; void irValidate;
  return Promise.resolve(); // PROBE-ONLY body
};
````

### dpf/src/ui/screen.ts

````ts
// PROBE-ONLY — W2-01b's screen.ts code verbatim (briefs/W2-01b.md D9); post-W2-01b site
import { createInterface } from 'node:readline';

export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
export interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }
export interface LineIO { readonly write: (text: string) => void; readonly ask: (prompt: string) => Promise<string | undefined> } // undefined = EOF

const DEFAULT_PROMPT = '> ';

interface Session<S, R> { readonly screen: Screen<S, R>; readonly io: LineIO; readonly prompt: string }

const writeAll = (io: LineIO, lines: readonly string[]): void => {
  lines.forEach(line => {
    io.write(line);
  });
};

/** One asked line → one turn; a turn's `out` is written before its result returns. */
const step = async <S, R>(session: Session<S, R>, turn: Turn<S, R>): Promise<R | undefined> => {
  const line = await session.io.ask(session.prompt);
  if (line === undefined) return undefined;
  const next = session.screen.next(turn.state, line);
  writeAll(session.io, next.out);
  return next.result === undefined ? step(session, next) : next.result;
};

export const runScreen = <S, R>(screen: Screen<S, R>, io: LineIO, prompt = DEFAULT_PROMPT): Promise<R | undefined> => {
  writeAll(io, screen.start.out);
  return step({ screen, io, prompt }, screen.start);
};

export const lineIO = (input: NodeJS.ReadableStream, output: NodeJS.WritableStream): LineIO => {
  const lines = createInterface({ input, terminal: false })[Symbol.asyncIterator]();
  return {
    write: text => {
      output.write(`${text}\n`);
    },
    ask: async prompt => {
      output.write(prompt);
      const next = await lines.next();
      return next.done === true ? undefined : next.value;
    },
  };
};
````

### dpf/tests/screens/fixture-fixed.ts

````ts
// PROBE — briefs/W2-08.md TESTS fixture block, verbatim (brief lines 101-133)
import { type ResolutionIr, type GoalsDoc } from '../../../shared/ir/resolution.js';
const resolution: ResolutionIr = {
  schemaVersion: 1,
  shape: 'feature',
  mapping: [
    { noun: 'auth', surfaceId: 'S-1', kind: 'module', path: 'src/auth', evidence: 'e' },
    { noun: 'ui', surfaceId: null, kind: 'unknown', path: null, evidence: 'e' },
  ],
  drift: [
    { id: 'D-1', snapshotSays: 's', codeSays: 'c', status: 'unclear', notes: 'n' },
    { id: 'D-2', snapshotSays: 's', codeSays: 'c', status: 'matches', notes: 'n' },
  ],
  blastRadius: ['src'],
  generatedAt: '2026-01-01T00:00:00.000Z',
  branch: '900-x',
};
const goals: GoalsDoc = {
  schemaVersion: 1,
  goals: [{ id: 'G-1', text: 'store', source: 'resolve' }, { id: 'G-2', text: 'old', source: 'resolve' }],
  nonGoals: [],
};
const record: PausePayload = {
  runId: 'r1', runFingerprint: 'f', epochId: undefined, stepId: 'resolve-confirm', stepType: 'human',
  role: undefined, modelProfile: undefined, outputSchemaRef: undefined,
  inputs: { resolution: '/r/resolution.json', goals: '/r/goals.json', template: '/p/confirm.template.json' },
  outputs: ['/p/confirmed.json'],
  critics: undefined, reviser: undefined, maxRounds: undefined, gatesEachRound: undefined, droppedGates: undefined,
};
const input: ResolveConfirmInput = { resolution, goals, cuts: ['cut text'], diffLines: undefined, record };
const screen = resolveConfirmScreen(input);
import { type PausePayload } from 'spec-pipeline/protocol';
import { resolveConfirmScreen, applyResolve, type ResolveConfirmInput } from '../../src/screens/resolve-confirm.js';
````

### dpf/tests/screens/fixture.ts

````ts
// PROBE — briefs/W2-08.md TESTS fixture block, verbatim (brief lines 101-133)
import { type ResolutionIr, type GoalsDoc } from '../../../shared/ir/resolution.js';
const resolution: ResolutionIr = {
  schemaVersion: 1,
  shape: 'feature',
  mapping: [
    { noun: 'auth', surfaceId: 'S-1', kind: 'module', path: 'src/auth', evidence: 'e' },
    { noun: 'ui', surfaceId: null, kind: 'unknown', path: null, evidence: 'e' },
  ],
  drift: [
    { id: 'D-1', snapshotSays: 's', codeSays: 'c', status: 'unclear', notes: 'n' },
    { id: 'D-2', snapshotSays: 's', codeSays: 'c', status: 'matches', notes: 'n' },
  ],
  blastRadius: ['src'],
  generatedAt: '2026-01-01T00:00:00.000Z',
  branch: '900-x',
};
const goals: GoalsDoc = {
  schemaVersion: 1,
  goals: [{ id: 'G-1', text: 'store', source: 'resolve' }, { id: 'G-2', text: 'old', source: 'resolve' }],
  nonGoals: [],
};
const record: PausePayload = {
  runId: 'r1', runFingerprint: 'f', epochId: undefined, stepId: 'resolve-confirm', stepType: 'human',
  role: undefined, modelProfile: undefined, outputSchemaRef: undefined,
  inputs: { resolution: '/r/resolution.json', goals: '/r/goals.json', template: '/p/confirm.template.json' },
  outputs: ['/p/confirmed.json'],
  critics: undefined, reviser: undefined, maxRounds: undefined, gatesEachRound: undefined, droppedGates: undefined,
};
const input: ResolveConfirmInput = { resolution, goals, cuts: ['cut text'], diffLines: undefined, record };
const screen = resolveConfirmScreen(input);
import { type PausePayload } from 'spec-pipeline/protocol';
import { resolveConfirmScreen, applyResolve, type ResolveConfirmInput } from '../src/screens/resolve-confirm.js';
````

### pattern.ts

````ts
// PROBE-ONLY stub (C7): the brief's PATTERN block omits the LineIO interface
export interface LineIO { readonly write: (text: string) => void; readonly ask: (prompt: string) => Promise<string | undefined> }

export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
export interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }
export const runScreen = async <S, R>(screen: Screen<S, R>, io: LineIO, prompt?: string): Promise<R | undefined> => {
  let turn = screen.start;
  for (const line of turn.out) io.write(line);
  for (;;) {
    const line = await io.ask(prompt);
    if (line === undefined) return undefined;
    turn = screen.next(turn.state, line);
    if (turn.result !== undefined) return turn.result;
    for (const line of turn.out) io.write(line);
  }
};
````

### protocol.ts

````ts
// PROBE-ONLY stub — PausePayload copied verbatim from tools/spec-pipeline/src/driver/pause.ts:15-40
type StepType = 'script' | 'llm' | 'human' | 'loop'; // manifest.ts:19
type GateDrop = {
  readonly gateId: string;
  readonly reason: 'unregistered' | 'capability-unmet';
  readonly missingCapabilities: readonly string[];
}; // driver/capability.ts:15-18

export interface PausePayload {
  readonly runId: string;
  readonly runFingerprint: string;
  readonly epochId: string | undefined;
  readonly stepId: string;
  readonly stepType: StepType;
  readonly role: string | undefined;
  readonly modelProfile: string | undefined;
  readonly outputSchemaRef: string | undefined;
  readonly inputs: Readonly<Record<string, string>>;
  readonly outputs: readonly string[];
  readonly critics: readonly string[] | undefined;
  readonly reviser: string | undefined;
  readonly maxRounds: number | undefined;
  readonly gatesEachRound: readonly string[] | undefined;
  readonly droppedGates: readonly GateDrop[] | undefined;
  readonly validationErrors?: readonly string[];
  readonly repairFindings?: string;
}
````

### shared/ir/resolution.ts

````ts
// PROBE-ONLY stub — types copied from tools/shared/ir/resolution.ts:171-177 (real shapes)
export type GoalEntry = Readonly<{ readonly id: string; readonly text: string; readonly source: string }>;
export type NonGoalEntry = Readonly<{ readonly id: string; readonly text: string; readonly source: string }>;
export type GoalsDoc = Readonly<{
  readonly schemaVersion: 1;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
}>;
export type ResolutionDoc = Readonly<{
  readonly schemaVersion: 1;
  readonly shape: 'feature' | 'modification' | 'bug' | 'refactor';
  readonly mapping: readonly {
    readonly noun: string;
    readonly surfaceId: string | null;
    readonly kind: 'feature' | 'module' | 'entry-point' | 'unknown';
    readonly path: string | null;
    readonly evidence: string;
  }[];
  readonly drift: readonly {
    readonly id: string;
    readonly snapshotSays: string;
    readonly codeSays: string;
    readonly status: 'matches' | 'drift' | 'bug' | 'unclear' | 'new' | 'broken';
    readonly notes: string | null;
  }[];
  readonly blastRadius: readonly string[];
}>;
export type ResolutionIr = ResolutionDoc & Readonly<{
  readonly generatedAt: string;
  readonly branch: string;
}>;
````

### tsconfig.fixture.json

````json
{
  "compilerOptions": {
    "noEmit": true,
    "strict": true,
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "typeRoots": ["<WT>/node_modules/@types"],
    "baseUrl": ".",
    "paths": { "spec-pipeline/protocol": ["./protocol.ts"] }
  },
  "include": ["dpf/tests/**/*.ts", "dpf/src/**/*.ts", "shared/**/*.ts", "protocol.ts"]
}
````

### tsconfig.pattern.json

````json
{
  "compilerOptions": {
    "noEmit": true,
    "strict": true,
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler"
  },
  "include": ["pattern.ts"]
}
````

### tsconfig.src.json

````json
{
  "compilerOptions": {
    "noEmit": true,
    "strict": true,
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "typeRoots": ["<WT>/node_modules/@types"],
    "baseUrl": ".",
    "paths": { "spec-pipeline/protocol": ["./protocol.ts"] }
  },
  "include": ["dpf/src/**/*.ts", "shared/**/*.ts", "protocol.ts"]
}
````
