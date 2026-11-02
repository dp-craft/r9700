# REFINE-CHECK W2-08 (27B, blind)

## Derived

- M2 surface: tools/dpf/src/screens/resolve-confirm.ts (new) — `RESOLVE_CONFIRM_SOURCE` ('resolve-confirm'), `resolveConfirmScreen(input): Screen<ResolveState, ResolveResult>` (the C11 content order, keys a/g/c/q), `applyResolve(result, record, originalGoals, cli)` (accept → cpSync template→outputs[0]; edit → one irSet of $.goals + $.nonGoals when changed; correction/quit → no write). Source: row, C3, C11.
- M2 surface: tools/dpf/tests/screens/resolve-confirm.test.ts (new). Source: row.
- M3 readers: W2-13 flow routes the pause to this screen (specify only); W2-05's irSet/irValidate (tools/dpf/src/run/ir.ts) and W2-01b's Screen (tools/dpf/src/ui/screen.ts) are dependencies. Source: wave W2-13, W2-05, W2-01b.
- M4 branches (content order, C11): 1 shape · 2 mapping (kind 'unknown' first, then in order; `<noun>: <kind>` + ` <path>` when path not null) · 3 drift (status 'unclear' first, then in order; `<id>: <status>`) · 4 blast (joined ', ') · 5 goals then non-goals (`<id>: <text>`) · 6 cuts (`cut: <text>`) · 7 diffLines verbatim. Main keys a/g/c/q; the g walk iterates goals then non-goals (Enter keep / r replace / d drop); a replaced entry gets source RESOLVE_CONFIRM_SOURCE. Source: row, C11:228-241.
- M4 branches (applyResolve): accept → cpSync(record.inputs.template, record.outputs[0]); edit → one irSet of $.goals (+ $.nonGoals when changed, compared by JSON.stringify) then irValidate; correction/quit → no write. Source: row, C3, C11.
- M7 resources: the ir (W2-05's irSet/irValidate) for the goals write; node:fs cpSync for the template copy (the only plain file write). No child process besides the ir spawns. Source: row, C3.
- M8 tests (test cell): unknown mapping rows print before the others; a cut row prints its text; the g walk (G-1 keep, G-2 replace) → one irSet of $.goals (G-2 resolve-confirm, G-1 unchanged) and no $.nonGoals (unchanged). Source: row.
- M1 baseline: all SITES are base files (tools/shared/ir/resolution.ts, io.ts, spec-pipeline driver/pause.ts) — no post-<Id> site, so M1 does not apply.

## Compared

- Derived (M2, resolve-confirm.ts) → D1 (briefs/W2-08.md:43), D2 (briefs/W2-08.md:48-75), D3 (briefs/W2-08.md:76-87), D4 (briefs/W2-08.md:88-98).
- Derived (M4, content order) → D2 (briefs/W2-08.md:65-71).
- Derived (M4, g walk) → D3 (briefs/W2-08.md:76-87).
- Derived (M4, applyResolve) → D4 (briefs/W2-08.md:92-98).
- Derived (M7, ir) → D4 (briefs/W2-08.md:90-96).
- Derived (M8, tests) → T1-T3 (briefs/W2-08.md:137-143).
- Derived (M3, W2-13) → WHY (briefs/W2-08.md:9-10).
- Derived (M3, W2-05/W2-01b) → PATTERN TO COPY (briefs/W2-08.md:26-39), D4 (briefs/W2-08.md:90).

## Probes

- D2/D3/D4 are prose (not code); the M9 limits apply to the writer's implementation, not the brief's prose. The only code shown is the PATTERN TO COPY runScreen (briefs/W2-08.md:29-39), which has `let` + `for` ×3 (M9 violations) — but it is context (not in FILES), not a deliverable.
- PATTERN TO COPY runScreen is NOT verbatim from W2-01b: W2-01b's actual runScreen (briefs/W2-01b.md:135-138) is `export const runScreen = <S, R>(screen: Screen<S, R>, io: LineIO, prompt = DEFAULT_PROMPT): Promise<R | undefined> => { writeAll(io, screen.start.out); return step({ screen, io, prompt }, screen.start); };` — non-async, `prompt = DEFAULT_PROMPT`, a `step` helper. The brief's version is `async`, `prompt?: string`, and a for-loop body. The Turn/Screen interfaces ARE verbatim (briefs/W2-01b.md:112-113); the runScreen is fabricated.

## Findings

| # | Sev | Item (M/S/D/T id) | Problem | Evidence (quoted) | Proposed change |
|---|---|---|---|---|---|
| 1 | high | TESTS (T1 import line) | import path `'../src/screens/resolve-confirm.js'` resolves to tools/dpf/tests/src/screens/resolve-confirm.js (does not exist); the test file sits two levels below tools/dpf (tests/screens/), so it needs `'../../src/screens/resolve-confirm.js'`. | briefs/W2-08.md:133 (`import { resolveConfirmScreen, applyResolve, type ResolveConfirmInput } from '../src/screens/resolve-confirm.js';`); briefs/W2-01b.md TESTS ("every test file sits two levels below tools/dpf (tests/run/, tests/ui/), so `../src` would resolve to tools/dpf/tests/src and fail") | change to `'../../src/screens/resolve-confirm.js'` |
| 2 | med | D2 (import order) + TESTS (import order) | the relative import `../../../shared/ir/resolution.js` comes before the package `spec-pipeline/protocol`; simple-import-sort groups are node: → packages → relative, so the package must come first. The same order is wrong in the test (resolution.js before spec-pipeline/protocol). | briefs/W2-08.md:49-51 (D2 imports: resolution.js, spec-pipeline/protocol, screen.js); briefs/W2-08.md:102,132-133 (test imports: resolution.js, spec-pipeline/protocol, resolve-confirm.js); eslint.config.mjs:160 (simple-import-sort/imports), :23 (IMPORT_SORT_GROUPS) | put `spec-pipeline/protocol` before the relative imports (in D2 and the test) |
| 3 | med | D4 (irSet/irValidate calls) | the irSet/irValidate calls omit `cli`, which W2-05's signatures require (`cli: readonly string[]`); a literal reading fails tsc (missing required property). The writer has `cli` in applyResolve's signature (the 4th parameter), so it is recoverable, but the prose is incomplete. | briefs/W2-08.md:93-96 ("one irSet of { kind: 'goals', file: record.inputs.goals, path: '$.goals', value: result.goals }" … "then irValidate of record.inputs.goals"); briefs/W2-05.md:43-44 (irSet/irValidate signatures: `cli: readonly string[]`) | show `cli` in the irSet/irValidate calls (e.g. `irSet({ cli, kind: 'goals', file: record.inputs.goals, path: '$.goals', value: result.goals })`) |
| 4 | med | D2 (initial state) | the initial state is `goals = input.goals.goals`, but the D3 walk appends kept/replaced entries to `goals`; a literal reading would duplicate every entry (the state starts with the full input, then the walk appends the same entries). T3 expects the edited array (no duplicates). | briefs/W2-08.md:74-75 ("initial: phase 'main', index 0, goals = input.goals.goals, nonGoals = input.goals.nonGoals"); briefs/W2-08.md:81 ("keep the entry (append to goals/nonGoals)"); briefs/W2-08.md:141 (T3: `goals: [G-1 unchanged, G-2 {id:'G-2', text:'new text', source:'resolve-confirm'}]` — 2 entries, not 4) | the initial state's `goals`/`nonGoals` should be `[]` (empty); the walk iterates `input.goals.goals`/`input.goals.nonGoals` and appends the kept/replaced entries to build the edited arrays |
| 5 | low | PATTERN TO COPY (runScreen) | the brief claims "verbatim" but the runScreen is fabricated: W2-01b's actual runScreen is non-async with `prompt = DEFAULT_PROMPT` and a `step` helper; the brief's version is `async` with `prompt?: string` and a for-loop body (`let` + `for` ×3, M9 violations). The Turn/Screen interfaces ARE verbatim. | briefs/W2-08.md:26-39 (the `async` runScreen with `for` loops); briefs/W2-01b.md:135-138 (the actual non-async runScreen) | reword to "the Turn/Screen interfaces (verbatim) plus the runScreen (context, not copied)" or drop the runScreen body and show only the Turn/Screen interfaces |
| 6 | low | STEP 2 (test count) | says "Write T1-T4" but there are only T1-T3 (the FINAL REPORT also lists T1-T3); the range is a typo. | briefs/W2-08.md:151 ("Write T1-T4"); briefs/W2-08.md:137-143 (T1-T3); briefs/W2-08.md:181 (FINAL REPORT "T1 … T3") | change to "Write T1-T3" |
