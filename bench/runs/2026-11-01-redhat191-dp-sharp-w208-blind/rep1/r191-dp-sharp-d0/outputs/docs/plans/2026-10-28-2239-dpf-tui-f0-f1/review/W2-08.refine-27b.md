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
