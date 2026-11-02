# REFINE-CHECK W2-08 (27B)

Brief: briefs/W2-08.md · base at HEAD de110510 (brief head says base 36ffe5b4 — SITES sha to be re-verified in C)

## Derived

M2 surface — FILES (row wave-2:58): `tools/dpf/src/screens/resolve-confirm.ts` new · `tools/dpf/tests/screens/resolve-confirm.test.ts` new; the package is per-file, no barrel (W2-01b D4), so W2-13 imports `resolveConfirmScreen`/`applyResolve` straight from that file.
M2 surface — C7 module map (02-contracts.md:157): exports are `resolveConfirmScreen(input: ResolveConfirmInput): Screen<…, ResolveResult>` and `applyResolve(…)`; the screen is pure (02-contracts.md C7 "every screen is pure; runScreen is the one I/O shell"), so the `readIr` calls (row: "read with `readIr`, tools/shared/ir/io.ts") happen OUTSIDE `resolveConfirmScreen` — the input already carries parsed docs.
M2 surface — C11 "Source": `RESOLVE_CONFIRM_SOURCE` = `'resolve-confirm'`, a constant IN `screens/resolve-confirm.ts` (it is an export only if a reader imports it — W2-13 has no need; D-8 forbids testing it).
M2 surface — the input must carry, per C11 + row: the resolution doc (shape/mapping/drift/blastRadius; `readIr('resolution', …)` → `ResolutionIr`, tools/shared/ir/registry.ts:46; note the registry schema is `ResolutionIrSchema`, the row's `ResolutionDocSchema` is the pre-stamp parent at tools/shared/ir/resolution.ts:136), the goals doc (`readIr('goals', …)` → `GoalsDoc`, registry.ts:50), the residue rows + this run's `runId` (for the cuts), optional `diffLines` (C14 "Diff lines": `irDiff` output, produced at the next resolve-confirm by W2-09's snapshot — a value only another row produces), and the pause record paths (`inputs.template`, `inputs.goals`, `outputs[0]`) + `cli` for `applyResolve` (C3 inputs/outputs; the W2-05 `applyClarify` shape: record + cli).
M2 surface — imports available: `Screen`/`Turn` from `../ui/screen.js` (W2-01b D9), `irSet`/`irValidate` from `../run/ir.js` (W2-05 D1: `irSet(o: { cli, kind, file, path, value }): Promise<IrResult>`), `ResidueRow` type from `../follow/ledger.js` (W2-02 D: `{ runId: string|undefined; stage: string|undefined; entry: unknown }`), `PausePayload` from `spec-pipeline/protocol` (W2-01 D2), goal entry types from `tools/shared/ir/resolution.js` (`GoalEntry`/`NonGoalEntry`, tools/shared/ir/resolution.ts:171-172).
M3 readers — W2-13 routes the `resolve-confirm` pause to this screen (C8 table, 02-contracts.md:181); it is the only consumer. W2-09 (C14) produces `diffLines`; W2-13 passes them in. No later row reads this file's internals beyond the C7 exports.
M3 readers — this row needs from earlier not-done rows: W2-05 (`irSet`, and its `IrResult`), W2-01b (`screen.ts`), W2-02 (`ResidueRow`), W2-01 (`PausePayload`). All four have briefs; W2-05 is the row's dependency cell.
M3 readers — risk cell (wave-2:58): "The brief greps `source ===` under `SP/src` to prove no step rejects an unknown source" — the brief must carry that grep and its (empty) result as evidence that `source: 'resolve-confirm'` is accepted by every SP step.
M4 branches — start turn prints, in C11 order: 1 shape; 2 mapping with `kind: 'unknown'` rows first (rest in order); 3 drift with `status: 'unclear'` rows first; 4 blastRadius; 5 goals then non-goals (id + text); 6 the cuts: residue rows with this `runId` and stage `spec-a-resolve`, anchored at `$.sections.request-docs`, each `entry.text` (ResidueEntry has `anchor.jsonPath` + `text`, tools/shared/ir/residue.ts:37-42); 7 `diffLines` when present. Then a prompt line naming the keys (C11: `a` accept · `g` edit goals · `c` correction · `q` quit).
M4 branches — main state `next(line)`: `a` → result accept (applyResolve copies `inputs.template` → `outputs[0]`, C3 "byte copy"); `g` → goal walk; `c` → result correction (W2-09); `q` → result quit; any other line → prompt again.
M4 branches — goal walk (C11 "Per entry"): each goal and non-goal shown; Enter keeps; `r` replaces — the NEXT line is the new text; `d` drops; after the last entry a write turn: the row's test cell ends with `w` → one `irSet`. A replaced entry gets `source: RESOLVE_CONFIRM_SOURCE`.
M4 branches — applyResolve on a goals result: ONE `irSet` of `{ kind: 'goals', file: inputs.goals, path: '$.goals', value }` always, and a second `irSet` of `$.nonGoals` ONLY when nonGoals changed (C11 "One write"). Not ok → throw carrying findings/error (W2-05 applyClarify pattern). `ir set` itself validates the whole document (W2-05 PATTERN: "Replace one node, validate the whole document"), so no separate `irValidate` is required.
M7 resources — the screen opens nothing; `applyResolve` does a `cpSync` (self-contained, sync) and `irSet` spawns (W2-05 resolves on 'close'). Nothing to release on any M4 path.
M8 tests — row test cell, one test each: (1) `unknown` mapping rows print before the others; (2) a cut row prints its text; (3) `a` → result accept; (4) `g`, `r` on G-2 with new text, `w` → one `irSet` with G-2 `resolve-confirm` and G-1 unchanged (the last needs the W2-04 fake + calls.jsonl, asserting one `ir set` argv and the value). D-8: no test for `RESOLVE_CONFIRM_SOURCE`, types, or re-exports.

## Compared

Derived → brief:
- M2 files/no barrel → FILES (12-14) exactly the two files; line 9 names W2-13 as router. OK.
- M2 screen pure / readIr outside → S6 (22) "the screen takes the parsed docs"; D2 input carries the docs. OK.
- M2 RESOLVE_CONFIRM_SOURCE → D1 (42-47) with the grep evidence. OK.
- M2 input carries resolution/goals/cuts/diffLines/record + cli → D2 input (52-58); cli is an applyResolve param (D4, 91). cuts arrive pre-filtered as strings (the runId/stage filtering belongs to W2-13) — derived assumed a ResidueRow import; the brief's choice is simpler and consistent with C11. OK, no GAP.
- M2 available imports → D2 (49-51) + D4 (89-90); ResidueRow/ledger.js not imported (above). OK.
- M3 sole consumer W2-13 → lines 9-10. OK.
- M3 deps W2-05/W2-01b/W2-02/W2-01 → S1 (17); D2/D4 imports. OK.
- M3 risk-cell grep → D1 (44-47); grep verified at HEAD (exact hit set: profile/registry.ts:77, loop/routing.ts:40, loop/run.ts:107,111, wiring/row-ids.ts:67, wiring/surface-refs.ts:112). OK.
- M4 start-turn order 1-7 + prompt → D2 (65-70). OK.
- M4 main keys a/g/c/q → D2 (70-71). OK.
- M4 walk mechanics → D3 (76-87) — GAP: F6 (state contradiction).
- M4 one-write applyResolve + throw → D4 (92-98); the brief adds irValidate after irSet per the W2-05 applyClarify pattern — overrides the derived "not needed" inference (house pattern). OK.
- M7 resources → nothing opened; no cleanup lines needed. OK, no EXTRA.
- M8 test cell → T1 (137-138), T2 (139), T3 (140-143); the accept case is named + FLOW-excluded to W2-13a scenario 1 (144-145); "T1-T3 all fail at base" (146). GAPs: F1, F2, F5.

D/T ids → derived/contract:
- D1 → M2 source + risk cell. No EXTRA.
- D2 → M2 pure input, M4 order/keys. GAPs: F3 (block does not compile), F4 (import order), F6 (state), F14 (dead flags).
- D3 → M4 walk. GAP: F6 (shared with D2).
- D4 → M4 one-write. GAPs: F9 (4 params), F13 (kind omitted).
- TESTS → M8. GAPs: F1 (import depth), F2 (plan entries), F5 (import order).
- STEPS → STEP 2: F8 (T1-T4 count); STEP 1/5/6 match the house (typecheck + eslint --quiet).
- SITES → anchors re-verified at HEAD de110510 (C step); F11 (S8 range/type), F15 (sha).
- PATTERN → M2 screen contract. GAP: F7 (false "verbatim", banned syntax, tsc error).
- DO NOT → line 164 attribution correct (screen.ts + paths.ts = W2-01b; ir.ts = W2-05 — paths.ts confirmed in W2-01b FILES:20); F12 (line 2 ≠ fixed text); lines 167/169/170 consistent with D2-D4.

## Probes

pattern · /tmp/dp-refine/W2-08/pattern.ts · tsc: error TS2345 (11,31) 'string | undefined' not assignable to 'string' (io.ask(prompt) vs ask: (prompt: string), W2-01b:114) · eslint: 5 warnings — complexity 6 (max 4); no-restricted-syntax ×4 (1 let, 3 for)
d1 · /tmp/dp-refine/W2-08/d1.ts · tsc: none · eslint: none
d2 · /tmp/dp-refine/W2-08/d2.ts · tsc: error TS1005: '=>' expected (brief line 64, uninitialised const) · eslint: parsing error '=>' expected
d4 · /tmp/dp-refine/W2-08/d4.ts · tsc: error TS1005: '=>' expected (brief line 91, uninitialised const) · eslint: parsing error '=>' expected
tests · /tmp/dp-refine/W2-08/tests.ts · tsc: none (fixture typechecks against the real schema shapes) · eslint: 1 warning — max-params (4) on the D4-signature stub (evidence for F9); the fixture block itself is clean
d2-imports · /tmp/dp-refine/W2-08/d2-imports.ts · tsc: n/a (module targets absent until W2-01/W2-01b land) · eslint: error simple-import-sort/imports "Run autofix to sort these imports!"
tests-imports · /tmp/dp-refine/W2-08/tests-imports.ts · tsc: n/a · eslint: error simple-import-sort/imports "Run autofix to sort these imports!"

Note: import lines probed in isolation (eslint-only — the module targets do not exist yet); the blocks were probed with PROBE-ONLY stubs mirroring the real signatures (W2-01b:114 ask, pause.ts:15-40 PausePayload, W2-05 irSet/irValidate, resolution.ts z.infer shapes).

## Findings

| # | Sev | Item (M/S/D/T id) | Problem | Evidence (quoted) | Proposed change |
|---|---|---|---|---|---|
| F1 | high | T3 (TESTS) | import path depth wrong — the test sits in tests/screens/, so `../src/…` resolves to tools/dpf/tests/src/ (does not exist); the module is at `../../src/…` | line 133: `import { resolveConfirmScreen, applyResolve, type ResolveConfirmInput } from '../src/screens/resolve-confirm.js';` · W2-04: "the test sits two levels below tools/dpf" (imports `../../src/run/runner.js`) · W2-05 imports `../../src/screens/clarify.js` | change to `'../../src/screens/resolve-confirm.js'` |
| F2 | high | T3 (TESTS) | a single-entry plan cannot feed two spawns: the edit path is irSet + irValidate (D4 93-96); the fake takes `entry = plan[n]` — plan[1] is undefined → TypeError in the child → nonzero exit → irValidate not ok → applyResolve throws → T3 cannot pass; "and a counter" also contradicts the W2-04 helper | line 135: "write a plan file (a single { exit: 0 } entry) and a counter" · W2-04 D2: "entry = plan[n]; write n + 1 to counterFile" · W2-04 helper: "no counter file: the fake starts at 0" | "write a plan file (two { exit: 0 } entries: irSet then irValidate); no counter file (the fake starts at 0)" |
| F3 | med | D2 | the code block does not compile: an uninitialised const signature; ResolveState is defined only in prose | line 64: `export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult>;` → probe d2.ts: TS1005: '=>' expected · state only at 72-75 ("The state is `{ phase: … }`") | make line 64 the real function (arrow with body) or mark it a signature; give ResolveState a code form in the block |
| F4 | high | D2 | import order violates simple-import-sort/imports (error tier): a relative import before the package import; STEP 5's `eslint --quiet` would fail on the block as written | lines 49-51: `'../../../shared/ir/resolution.js'` before `'spec-pipeline/protocol'` · eslint.config.mjs:23 groups `[['^\u0000'],['^node:'],['^@?\w'],['^\.']]`, :160 error · probe d2-imports.ts: "Run autofix to sort these imports!" | move the PausePayload import first, then the two relatives |
| F5 | high | TESTS | same error: relative (102), package (132), relative (133); test files keep import sort | probe tests-imports.ts: "Run autofix to sort these imports!" · eslint.config.mjs test block: "Formatting, import order, `no-var` and `prefer-const` deliberately stay." | order: `'spec-pipeline/protocol'`, then `'../../../shared/ir/resolution.js'`, then the fixed `'../../src/…'` import |
| F6 | high | D2 + D3 | state contradiction: initial state is the full copy, but keep/replace APPEND — a literal implementation duplicates every entry and fails T3 | D2 74-75: "goals = input.goals.goals, nonGoals = input.goals.nonGoals" · D3 81: keep → "(append to goals/nonGoals)", 84: "append the entry with that text" → [G-1, G-2, G-1, G-2'] vs T3 141: "goals: [G-1 unchanged, G-2 {id:'G-2', text:'new text', source:'resolve-confirm'}]" | start state goals/nonGoals empty (the main screen prints from input) — or make keep/replace/drop mutate the initial copy in place; T3 unchanged |
| F7 | med | PATTERN | false "verbatim" evidence + banned syntax shown as the pattern: the real W2-01b D9 uses `prompt = DEFAULT_PROMPT` + recursive step (no let/for); the block has `let turn` + three `for` loops and a tsc error | header 26: "(src/ui/screen.ts from W2-01b, verbatim)" vs W2-01b:135 `runScreen = <S, R>(screen, io, prompt = DEFAULT_PROMPT)` + step/Session (118-137) · probe pattern.ts: TS2345 on `io.ask(prompt)` (real ask: `(prompt: string)`, W2-01b:114) + eslint 4× no-restricted-syntax + complexity 6 | replace the block with the real W2-01b slice (or just the Turn/Screen interfaces, which are the part screens copy) |
| F8 | med | STEP 2 | count mismatch: only T1-T3 exist | line 151: "Write T1-T4" · line 153: "T1-T4 MUST fail" · TESTS defines T1 (137), T2 (139), T3 (140); the accept case is FLOW-excluded (144) | "Write T1-T3" / "T1-T3 MUST fail" |
| F9 | low | D4 | 4 params > max-params warn 3 — hidden by STEP 5's --quiet | line 91 (4 params) · eslint.config.mjs:46 `['warn', 3]` · probe tests.ts: "too many parameters (4). Maximum allowed is 3" | object parameter `{ result, record, originalGoals, cli }`; update the T3 call (line 141). (W2-13's brief does not exist yet — no NEEDS row) |
| F10 | low | FILES/S1 | package-relative paths; the house is repo-relative | lines 13-14/17/42/48/76/88: `src/screens/resolve-confirm.ts`, `tests/screens/…` · REFINE item 2: "Paths repo-relative" · W2-05 FILES: "tools/dpf/src/run/ir.ts" | prefix `tools/dpf/` on FILES, S1 and the D1-D4 site lines |
| F11 | low | S8 | range and type off: the screen takes ResolutionIr (line 177), outside the stated range; the description names ResolutionDoc | line 24: "171-176 … the GoalEntry/NonGoalEntry/GoalsDoc/ResolutionDoc types the screen takes" · D2 imports ResolutionIr (49) · resolution.ts:177 | "171-177 … the … types (incl. ResolutionIr) the screen takes" |
| F12 | low | DO NOT | line 2 is not the fixed template text (drops the lint-limits helper clause) | line 163: "- add options, helpers, comments or docs that are not in DELIVERABLES" vs 01 template: "- add options, comments or docs that are not in DELIVERABLES, or a helper beyond the ones it names — unless the lint limits need one: then name it on its D line in the FINAL REPORT" | restore the fixed text |
| F13 | low | D4 | irValidate prose omits the required kind | line 96: "then irValidate of record.inputs.goals" · W2-05: `irValidate = (o: { cli, kind, file })` | "then irValidate of { kind: 'goals', file: record.inputs.goals }" |
| F14 | low | D2 | dead state flags: never read (applyResolve compares via JSON.stringify; `w` always emits edit) | lines 72-75: "goalsChanged: boolean, nonGoalsChanged: boolean" · D3 85: "mark the matching changed flag true" · D4 95-96: compare "by JSON.stringify" — nothing reads the flags | drop the two flags (state = phase, index, goals, nonGoals) |
| F15 | low | SITES | stale verification sha | line 16: "verified at 36ffe5b4" · HEAD is de110510 (docs-only commits since; anchors re-verified in step C) | re-verify S2-S8 at HEAD, write de110510 |
