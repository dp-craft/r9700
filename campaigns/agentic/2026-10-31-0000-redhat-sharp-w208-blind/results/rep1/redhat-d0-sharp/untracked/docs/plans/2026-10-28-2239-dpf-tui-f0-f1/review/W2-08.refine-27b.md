# W2-08 REFINE-CHECK (27B blind)

Base `de110510` · brief says base `36ffe5b4` — line numbers verified identical at HEAD
(`git diff --stat 36ffe5b4..HEAD -- tools/shared tools/spec-pipeline tools/dpf` empty).
`tools/dpf` has no files at HEAD (empty untracked dir `tools/dpf/tests/screens`; all W2 predecessors'
output comes from their briefs per M1).

## Derived

Part 1 — derived from contracts, SITES at HEAD and sibling briefs BEFORE reading the brief's code blocks.

1. (M2) `applyResolve` must call `irSet`/`irValidate` with an object carrying `cli` — W2-05 D1:
   `irSet = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string; readonly path: string; readonly value: unknown }): Promise<IrResult>`;
   `irValidate = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string })`.
2. (M2) The test file sits at `tools/dpf/tests/screens/` → src imports need `'../../src/…'` —
   W2-05 TESTS: "both test files sit two levels below tools/dpf: the src imports are
   `'../../src/screens/clarify.js'` and `'../../src/run/ir.js'`"; W2-04 TESTS: "the test sits two levels below tools/dpf".
3. (M3) The W2-04 fake walks `FAKE_SP_PLAN` one entry per call, auto-creating the counter file
   ("no counter file: the fake starts at entry 0", W2-04:134 / W2-05:112); `entry = plan[n]` then
   `process.exit(entry.exit)` (W2-04 D2 steps 1 and 6) — an out-of-range `n` crashes the fake with a non-zero exit.
4. (M3) `applyResolve`'s edit path makes TWO fake calls: `irSet '$.goals'` + `irValidate` (the second
   `irSet '$.nonGoals'` fires only when nonGoals changed — in the T3 fixture `nonGoals` is unchanged);
   a single-entry plan leaves call 2 at `plan[1] = undefined` → fake crash → `irValidate` not ok → throw.
5. (M4) Walk semantics (C11, 02-contracts.md:230): g-walk per goal and non-goal — Enter keeps, `r` replaces
   (next line is the text), `d` drops; replaced entries get `source: RESOLVE_CONFIRM_SOURCE`;
   one write: `irSet { kind: 'goals', path: '$.goals' }` + `$.nonGoals` only when changed; main keys a/g/c/q.
6. (M4) The walk REBUILDS the goal set: the wave's Done-when expects the edit result
   `[G-1 unchanged, G-2 { text: 'new text', source: 'resolve-confirm' }]` — kept/replaced entries appended to an
   EMPTY working list (a drop appends nothing). With the initial `state.goals = input.goals.goals` (D2) and a bare
   "append", the result would duplicate every kept entry.
7. (M2) `spec-pipeline/protocol` re-exports `PausePayload` — W2-01 D2: `export type { PausePayload } from './driver/pause.js'`
   (plus `"./protocol": "./src/protocol.ts"` in exports, W2-01 D3); fields per pause.ts:15-40, `stepType: 'human'`
   legal (manifest.ts:19 `z.enum(['script', 'llm', 'human', 'loop'])`).
8. (M7) Repo import rules: `simple-import-sort/imports` (error), groups `[side-effect, node:, external, relative]`
   (eslint.config.mjs `IMPORT_SORT_GROUPS`), blank line between groups, named members sorted case-insensitively
   (verified by `eslint --fix` on a real file, not just moved: `import type`-mixed members stay in one statement).
9. (M8) TESTS per 01-writer-brief item 6: every import line in full; a case the flow-owning row's flow test covers
   is named, marked (FLOW) and dropped — accept is such a case (W2-13a scenario 1); precedent W2-05:134
   "D4 (applyClarify) is proven by W2-13a's flow test".

## Compared

Per derived line → the brief line that carries it, or GAP.

1 → D4 (lines 93-96) shows the irSet/irValidate objects WITHOUT `cli` — **GAP (F4)**.
2 → TESTS line 133 `import { … } from '../src/screens/resolve-confirm.js'` — **GAP (F1)**.
3 → TESTS line 135 "write a plan file (a single { exit: 0 } entry) **and a counter**" — **GAP (F2a)**.
4 → TESTS line 135 "a single { exit: 0 } entry" for the two-call edit path — **GAP (F2b)**.
5 → D2 (content order, keys, prompt) + D3 (walk) + D4 (one irSet of `$.goals`, `$.nonGoals` only when changed,
   `cpSync` the only plain write) — match. D1 grep claim verified at HEAD: `grep -rn 'source ===' tools/spec-pipeline/src`
   → loop/routing.ts:40, loop/run.ts:107,111, wiring/row-ids.ts:67, wiring/surface-refs.ts:112, profile/registry.ts:77 — no goal-source comparison.
6 → D2 initial state "goals = input.goals.goals" + D3 "Enter → keep the entry (append to goals/nonGoals)" —
   no reset instruction — **GAP (F3)**; and D3 walk-summary `q` → phase 'main' without restoring the original lists — **GAP (F6)**.
7 → D2 import `{ type PausePayload } from 'spec-pipeline/protocol'` + fixture `record` — match (S7 range 15-40 exact).
8 → D2 import block (lines 49-51), D4 import block (lines 89-90) and TESTS imports (lines 102, 132-133) —
   all fail `simple-import-sort` (member order, group order, missing group blanks) — **GAP (F8)**.
9 → TESTS lines 144-145 name accept as (FLOW), W2-13a scenario 1 — match; `c` (correction) and `q` (quit)
   results are neither unit-tested nor named-dropped — **GAP (F13)**.

Per D/T → derived or EXTRA.

D1 → match (D1 grep claim verified, see 5).
D2 → state fields `goalsChanged`/`nonGoalsChanged` are set (D3 "mark the matching changed flag true") but never
   read (D4 compares by `JSON.stringify`; `ResolveResult` carries no flags) — **EXTRA (F10)**.
   S8 range "171-176" misses `ResolutionIr` at resolution.ts:177 (imported by D2, used by the fixture) — **EXTRA (F11)**.
D3 → covered under derived 6 (F3, F6).
D4 → covered under derived 1 (F4); `applyResolve` has 4 params vs `max-params` warn 3 (incrementalRules; hidden by
   `--quiet`) — **EXTRA (F14)**.
T1 → derived (C11 unknown-first, unclear-first) — match.
T2 → derived (the cut row) — match.
T3 → derived (C11 walk + the irSet write) — match modulo F1/F2/F3.
STEPS → "Write T1-T4" / "T1-T4 MUST fail" (lines 151, 153) but only T1-T3 exist (TESTS; FINAL REPORT "T1 … T3") —
   **EXTRA (F7)**. FILES (lines 13-14) and S1 (line 17) are package-relative ("src/…", "tests/…") while S2-S8 and
   W2-04/W2-05 are repo-relative ("tools/dpf/src/…") — **EXTRA (F9)**. DO NOT line 2 (line 163) drops the fixed
   template's clause "or a helper beyond the ones it names — unless the lint limits need one: then name it on its
   D line in the FINAL REPORT" (01-writer-brief.md template lines 51-52) — **EXTRA (F12)**.

## Probes

tsc per the stack profile: `npx tsc --noEmit --strict --target ES2023 --lib ES2023 --module esnext
--moduleResolution bundler --types node <probe>` · eslint via `--stdin --stdin-filename <path>` (source probed under
the registered path `tools/scripts/__probe.ts` — `tools/dpf` is unregistered at HEAD, W2-01b D3 adds it; test probed
under its real path, matched by the `tools/*/tests/**/*.ts` block now). Stubs (PROBE-ONLY, marked in-file):
`dpf/src/ui/screen.ts` (Turn/Screen/LineIO from W2-01b D9), `dpf/src/run/ir.ts` (signatures from W2-05 D1),
`node_modules/spec-pipeline` (PausePayload verbatim from pause.ts:15-40, StepType/GateDrop inlined); real copies:
`shared/ir/{resolution,common,version,path}.ts`; `zod`/`@types` symlinked.

- P1 · `probe/dpf/src/screens/resolve-confirm.ts` (D1+D2+D4 assembled; stub bodies; the prose state as an interface) · tsc: none · eslint: none with the canonical imports (with the brief's import order: `simple-import-sort/imports` error — F8) · `max-params` warning on the 4-param `applyResolve` (F14)
- P2 · `probe/dpf/tests/screens/resolve-confirm.test.ts` (fixture verbatim, brief's imports) · tsc: `error TS2307: Cannot find module '../src/screens/resolve-confirm.js'` (F1) · eslint: `simple-import-sort/imports` ×2 (F8)
- P2b · same with `'../../src/…'` · tsc: none · eslint: `simple-import-sort/imports` (member order/group blanks — F8)
- P3 · `probe/pattern.ts` (PATTERN TO COPY block verbatim) · tsc: `Cannot find name 'Screen'` / `Cannot find name 'LineIO'` (F5)
- P5 · `probe/imports-only.ts` (D2+D4 import lines in the brief's order) · eslint: `simple-import-sort/imports` error (F8)
- final · corrected source file + corrected test file (F1/F8 fixes applied) · tsc: none · eslint: none

## Findings

| # | Sev | Item | Problem | Evidence (quoted) | Proposed change |
|---|---|---|---|---|---|
| F1 | high | TESTS line 133 | The test's src import specifier `'../src/screens/resolve-confirm.js'` does not resolve: the test sits two levels below tools/dpf, so it needs `'../../src/…'` — as written T1-T3 can never pass (import error, not "the module does not exist") | probe P2: `error TS2307: Cannot find module '../src/screens/resolve-confirm.js'`; W2-05 TESTS: "both test files sit two levels below tools/dpf: the src imports are `'../../src/screens/clarify.js'` and `'../../src/run/ir.js'`" | line 133 → `import { applyResolve, type ResolveConfirmInput, resolveConfirmScreen } from '../../src/screens/resolve-confirm.js';`, hoisted with the other imports (F8 layout) |
| F2 | high | TESTS line 135 | "(a single { exit: 0 } entry) **and a counter**": the counter instruction contradicts the established pattern, and a single-entry plan cannot serve the edit path — `applyResolve` makes TWO fake calls (irSet + irValidate), so call 2 reads `plan[1] = undefined`, the fake crashes (`process.exit(entry.exit)` on an undefined entry), `irValidate` is not ok and `applyResolve` throws — T3 cannot pass | W2-05:112 "plan file (no counter file: the fake starts at entry 0)"; W2-05:127 "(one plan, three calls: the fake's counter walks it)"; W2-04 D2 step 1 "entry = plan[n]" + step 6 "process.exit(entry.exit)"; D4: edit → irSet `$.goals` "then irValidate of record.inputs.goals" (no `$.nonGoals` call: `nonGoals` unchanged in the fixture) | line 135 → "write a plan file with two { exit: 0 } entries (no counter file: the fake starts at entry 0)" |
| F3 | high | D3 (lines 76-87) | The walk never resets the working lists: D2 initial state is `goals = input.goals.goals`, and D3 says Enter/r "append to goals/nonGoals" — a literal implementation appends to the already-populated lists, so `w` returns `[G-1, G-2, G-1, G-2-new]` while T3 expects `[G-1, G-2 {text:'new text', source:'resolve-confirm'}]` — T3 cannot pass; the reset is a behaviour DO NOT forbids inventing | T3 line 141: `w` → "goals: [G-1 unchanged, G-2 {id:'G-2', text:'new text', source:'resolve-confirm'}]"; D2 line 74 "initial: … goals = input.goals.goals"; D3 line 81 "Enter (empty line) → keep the entry (append to goals/nonGoals)" | D3: after "The walk iterates the combined list" add "On `g`, reset state.goals and state.nonGoals to empty and index to 0 (the walk rebuilds them: keep/replace append, drop appends nothing)" |
| F4 | med | D4 (lines 93-96) | The shown irSet/irValidate call objects omit `cli`, which the W2-05 D1 signatures require — copied literally the body is a type error (`cli` missing) at STEP 5 | W2-05 D1: `irSet = (o: { readonly cli: readonly string[]; … })`; D4 line 93: "one irSet of { kind: 'goals', file: record.inputs.goals, path: '$.goals', value: result.goals }" (no `cli`) | D4: show the objects with `cli` first: `{ cli, kind: 'goals', file: record.inputs.goals, path: '$.goals', value: result.goals }` and `{ cli, kind: 'goals', file: record.inputs.goals }` for irValidate |
| F5 | med | PATTERN TO COPY (lines 26-39) | Claimed "src/ui/screen.ts from W2-01b, verbatim" but the shown `runScreen` is not W2-01b's code: W2-01b D9 is `runScreen = <S, R>(screen, io, prompt = DEFAULT_PROMPT)` delegating to `writeAll`/`step` with "No `let`/`for`: no-restricted-syntax"; the block shows `async … let turn = …; for (const line of …)` with `prompt?: string`, omits `LineIO`/`DEFAULT_PROMPT`/`lineIO`, and does not compile standalone | probe P3: `Cannot find name 'Screen'`, `Cannot find name 'LineIO'`; W2-01b D9: "export const runScreen = <S, R>(screen: Screen<S, R>, io: LineIO, prompt = DEFAULT_PROMPT): Promise<R | undefined> => { writeAll(io, screen.start.out); return step({ screen, io, prompt }, screen.start); }" | replace the block with W2-01b's `Turn`, `Screen`, `LineIO` interfaces verbatim + the real `runScreen` (or the three interfaces + one line: "`runScreen` (W2-01b) is the only I/O shell — a screen never calls it"); keep the header minus any "verbatim" claim that is not true |
| F6 | med | D3 line 87 | walk-summary `q` → phase 'main' (abort) without restoring the originals: after abort, the main screen displays the walked (modified) lists while goals.json is unchanged — `a` after an abort confirms a document that shows goals never written | D3 line 86-87: "`w` → { kind: 'edit', goals, nonGoals } · `q` → phase 'main' (abort)"; D2 state: `goals`/`nonGoals` are the displayed lists | D3: "`q` → restore state.goals/state.nonGoals from input.goals, phase 'main' (abort)" |
| F7 | low | STEPS lines 151, 153 | "Write T1-T4" / "T1-T4 MUST fail" but only T1-T3 exist (TESTS section; FINAL REPORT says "T1 … T3") — M10 count mismatch | line 151 "Write T1-T4, then run once"; line 141-143 define T1, T2, T3 only; line 181 "T2 … T3 (same shape)" | "Write T1-T3" / "T1-T3 MUST fail" |
| F8 | low | D2 lines 49-51, D4 lines 89-90, TESTS lines 102/132-133 | The import lines fail `simple-import-sort/imports` (error; not hidden by `--quiet`): members unsorted (`type ResolutionIr, type GoalsDoc, …` → `GoalEntry, GoalsDoc, NonGoalEntry, ResolutionIr`; `resolveConfirmScreen, applyResolve, type ResolveConfirmInput` → `applyResolve, type ResolveConfirmInput, resolveConfirmScreen`), group order wrong (relative before external; `../ui` before `../run`), group blank lines missing, TESTS imports split across code | probe P5/P2: `error … simple-import-sort/imports`; canonical form verified by `eslint --fix` on a real file: `import { cpSync } from 'node:fs';` ⏎ blank ⏎ `import { type PausePayload } from 'spec-pipeline/protocol';` ⏎ blank ⏎ `import { type GoalEntry, type GoalsDoc, type NonGoalEntry, type ResolutionIr } from '../../../shared/ir/resolution.js';` + `import { irSet, irValidate } from '../run/ir.js';` + `import { type Screen } from '../ui/screen.js';` | collect ALL five imports in the D2 block in that canonical order (blank lines between the node:/external/relative groups); D4 keeps only the `applyResolve` signature; TESTS: all imports at the top of the fixture — `import { type PausePayload } from 'spec-pipeline/protocol';` ⏎ blank ⏎ `import { type GoalsDoc, type ResolutionIr } from '../../../shared/ir/resolution.js';` + `import { applyResolve, type ResolveConfirmInput, resolveConfirmScreen } from '../../src/screens/resolve-confirm.js';` (drops lines 132-133) |
| F9 | low | FILES lines 13-14, S1 line 17 | Package-relative paths ("src/screens/resolve-confirm.ts", "tests/screens/…") while S2-S8 of the same brief and W2-04/W2-05 use repo-relative ("tools/dpf/src/…") — inconsistent; the writer resolves them, but the convention is repo-relative | line 13 "src/screens/resolve-confirm.ts  new"; S2 "tools/shared/ir/resolution.ts:14-20"; W2-04 FILES "tools/dpf/src/run/runner.ts new" | "tools/dpf/src/screens/resolve-confirm.ts  new" / "tools/dpf/tests/screens/resolve-confirm.test.ts  new"; S1 "tools/dpf/src/screens/resolve-confirm.ts new" |
| F10 | low | D2 lines 73-75, D3 lines 84-85 | State fields `goalsChanged`/`nonGoalsChanged` are set ("mark the matching changed flag true") but never read: D4's second irSet is decided by "compared by JSON.stringify" against `originalGoals.nonGoals`, and `ResolveResult` carries no flags — dead state | D2 line 73-74 state; D3 line 85 "mark the matching changed flag true"; D4 lines 94-96 "only when result.nonGoals differs from originalGoals.nonGoals (compared by JSON.stringify)" | drop `goalsChanged`/`nonGoalsChanged` from the state (line 73) and drop "mark the matching changed flag true" (line 85) |
| F11 | low | S8 line 24 | Range "171-176" misses `ResolutionIr` at resolution.ts:177 — imported by D2 and used to type the fixture, but outside the SITES range a reader of "only the SITES" never sees it | line 24 "S8 tools/shared/ir/resolution.ts:171-176 … the GoalEntry/NonGoalEntry/GoalsDoc/ResolutionDoc types the screen takes"; resolution.ts:177 "export type ResolutionIr = Readonly<z.infer<typeof ResolutionIrSchema>>;" | "171-177" and add ResolutionIr to the S8 description |
| F12 | low | DO NOT line 163 | Deviates from the fixed template's second DO NOT line, which ends "or a helper beyond the ones it names — unless the lint limits need one: then name it on its D line in the FINAL REPORT" | 01-writer-brief.md template: "- add options, comments or docs that are not in DELIVERABLES, or a helper beyond the ones it names — unless the lint limits need one: then name it on its D line in the FINAL REPORT"; brief line 163 "- add options, helpers, comments or docs that are not in DELIVERABLES" | replace line 163 with the fixed template text |
| F13 | low | TESTS lines 144-145 | The `c` (correction) and `q` (quit) results — D2 main keys, thin copies (no write) — are neither unit-tested nor named-dropped; only accept gets the (FLOW) name-and-drop treatment, and M8 requires every dropped flow-covered case to be named + marked (FLOW) | D2 line 70-71: "`c` → correction · `q` → quit"; lines 144-145 name only accept: "The accept case (next 'a' → { kind: 'accept' }, the D2 main key) is proven by W2-13a's flow test (scenario 1: …), not by a unit test"; W2-05:134 precedent names its dropped case | extend lines 144-145: "The accept, correction and quit cases (the D2 main keys; thin copies, no write) are proven by W2-13a's flow test, not by unit tests" |
| F14 | low | D4 line 91 | `applyResolve` takes 4 params (`result, record, originalGoals, cli`) vs `max-params` warn 3 (incrementalRules); STEP 5's `--quiet` hides the warning, so the gate passes — no change needed, recorded so the warn is not mistaken for a miss | eslint.config.mjs: `'max-params': ['warn', 3]`; probe P1: "warning … Arrow function has too many parameters (4)" (on the stub) | none — keep the signature (the 4th param `originalGoals` is load-bearing for the `$.nonGoals` diff); the warn is hidden by STEP 5's `--quiet` |
