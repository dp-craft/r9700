# W2-08 refine-27b (blind review)

## Derived

M2 surface (row:58, C11, C3, C7:157):
- File `src/screens/resolve-confirm.ts` (new): exports `RESOLVE_CONFIRM_SOURCE` (C11: 'resolve-confirm'), `resolveConfirmScreen(input: ResolveConfirmInput): Screen<…, ResolveResult>` (C7:157), `applyResolve(…)` (C7:157).
- `ResolveConfirmInput` per C11: `resolution: ResolutionIr` (read with readIr, C11) · `goals: GoalsDoc` · `cuts` (C11: ledger residue rows, this runId, stage spec-a-resolve) · `diffLines` (C11: previous correction's snapshot, optional) · `record: PausePayload`.
- Screen text (C11 order): shape · mapping (unknown first) · drift (unclear first) · blastRadius · goals+non-goals · cuts · diffLines. Prompt: `a to accept, g to edit goals, c to correct, q to quit`.
- `g` walk (C11): each goal and non-goal: Enter keep · `r` replace (next line is the text) · `d` drop. Replaced entry `source: RESOLVE_CONFIRM_SOURCE`.
- `applyResolve` (C11, C3): accept → copy `inputs.template` to `outputs[0]`; edit → one `irSet` of `$.goals` (and `$.nonGoals` when changed) + `irValidate`; correction/quit → no write.
- Consumer imports it: W2-13 routes the pause to `resolveConfirmScreen` (C8:181).

M3 readers: W2-13 (W2-13a scenario 1) calls `resolveConfirmScreen` and `applyResolve`. W2-09 (W2-08's successor) reads `goals.json` after the edit. The file `confirmed.json` is a byte copy of the template (C3), not read by any step.

M4 branches: main keys a/g/c/q (each → result); walk keys Enter/r/d (keep/replace/drop); walk-summary keys w/q (write/abort).

M7 resources: `applyResolve` edit case spawns `irSet` (always) + `irSet` (nonGoals, only when changed) + `irValidate` — each a fake spawn (W2-04 fake plan, one entry per invocation).

M8 tests: one per M4 branch: unknown mapping row first (T1), cut row (T2), accept → result (proven by W2-13a, not unit), g-walk replace G-2 + write (T3).

## Compared

Per derived line:
- M2 file → brief:12-14 (FILES) — covered.
- M2 exports → brief:42-43 (D1), 48-64 (D2), 88-91 (D4) — covered.
- M2 `ResolveConfirmInput` → brief:52-58 — covered (fields match C11).
- M2 screen text → brief:65-71 — covered (C11 order, prompt).
- M2 `g` walk → brief:76-87 (D3) — covered.
- M2 `applyResolve` → brief:88-98 (D4) — covered.
- M2 consumer → brief:9-10 (W2-13 routes) — covered.
- M3 readers → brief:9-10, 144-145 (accept proven by W2-13a) — covered.
- M4 branches → brief:70-71 (main keys), 80-87 (walk keys) — covered.
- M7 resources → brief:134-136 (fake plan) — covered.
- M8 tests → brief:137-145 (T1-T3, accept) — covered.

Per D/T id:
- D1 → derived M2 (RESOLVE_CONFIRM_SOURCE) — served.
- D2 → derived M2 (ResolveConfirmInput, screen text, main keys, state) — served.
- D3 → derived M2 (g walk) — served.
- D4 → derived M2 (applyResolve) — served.
- T1 → derived M8 (unknown mapping row) — served.
- T2 → derived M8 (cut row) — served.
- T3 → derived M8 (g-walk replace + write) — served.
- accept (W2-13a) → derived M8 (accept proven by W2-13a) — served.

No GAP. No EXTRA. (The Findings below are defects in the covered lines, not missing coverage.)

## Probes

- D1+D2+D4 · probe/a/src/screens/resolve-confirm.ts · tsc: Cannot find name 'ResolveState' (×2) · eslint: max-params (4 params, ×2) [import-sort/arrow-parens = probe artifacts]
- TESTS · probe/a/tests/screens/resolve-confirm.test.ts · tsc: Cannot find module '../src/screens/resolve-confirm.js' · eslint: n/a (test file, not probed)
- PATTERN TO COPY · probe/a/src/ui/screen-impl.ts · tsc: Argument of type 'string | undefined' not assignable to 'string' (io.ask) · eslint: no-restricted-syntax (let ×1, for/for-of ×3) + complexity (6>4) [import-sort = probe artifact]

## Findings

| # | Sev | Item (M/S/D/T id) | Problem | Evidence (quoted) | Proposed change |
|---|---|---|---|---|---|
| 1 | high | T3 (line 133) | test import path wrong: `../src/…` does not resolve from `tests/screens/` | `import { resolveConfirmScreen, applyResolve, type ResolveConfirmInput } from '../src/screens/resolve-confirm.js';` (line 133); tsc probe 2: `Cannot find module '../src/screens/resolve-confirm.js'` | change to `'../../src/screens/resolve-confirm.js'` (like W2-04 line 129 `../../src/run/runner.js`) |
| 2 | med | PATTERN TO COPY (26-39) | claims "verbatim" but has a type error (`io.ask(prompt)`, `prompt?: string`) and M9 violations (`let`, `for`, `for-of` ×3, complexity 6) | tsc probe 3: `Argument of type 'string | undefined' is not assignable to parameter of type 'string'`; eslint probe 2: `no-restricted-syntax` (let/for/for-of), `complexity` (6>4) | drop the `runScreen` body (it already exists in W2-01b's `screen.ts`); keep only the `Turn`/`Screen` types (the actual contract). If the writer copies `runScreen`, it must not use `let`/`for` and must pass a non-optional `prompt` |
| 3 | high | D2 (72-75) | initial state `goals = input.goals.goals` + D3 "append to goals" → duplication; T3 expects exactly `[G-1, G-2']` | brief:74-75 "goals = input.goals.goals, nonGoals = input.goals.nonGoals"; brief:81 "Enter (empty line) → keep the entry (append to goals/nonGoals)"; T3:141 `goals: [G-1 unchanged, G-2 {…}]` | initial `goals = []`, `nonGoals = []` (the walk builds the new list) |
| 4 | low | D2/D3 (74-75, 85) | `goalsChanged`/`nonGoalsChanged` are set on replace but never read (D4 uses `JSON.stringify`) | brief:74 "goalsChanged: boolean, nonGoalsChanged: boolean"; brief:85 "mark the matching changed flag true"; brief:95-96 "compared by JSON.stringify" | remove the two flags, or use them for the `$.nonGoals` write decision instead of `JSON.stringify` |
| 5 | low | D4 (91) | `applyResolve` has 4 params (M9 `max-params` ≤3, warn) | `applyResolve = (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]): Promise<void>;` (line 91); eslint probe 1: `max-params` (4 params) | fold into ≤3 params (e.g. group `{result, record, originalGoals}` into one object) or drop `originalGoals` and compare against a captured value |
| 6 | high | TESTS (134-136) | edit case = `irSet($.goals)` + `irValidate` = 2 fake invocations, but the plan file has "a single { exit: 0 } entry" → the 2nd invocation (`irValidate`) takes `plan[1]` = undefined → crash | brief:135 "a single { exit: 0 } entry"; D4:93-97 "one irSet of `$.goals` … then irValidate"; W2-04: `entry = plan[n]`, one entry per invocation | plan file needs ≥2 entries (one `irSet`, one `irValidate`), e.g. `[{exit:0}, {exit:0}]` |
| 7 | low | D2 (64) | `ResolveState` is referenced in the signature but never defined as a type | `export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult>;` (line 64); tsc probe 1: `Cannot find name 'ResolveState'` (×2) | define `type ResolveState = { phase: 'main' \| 'walk' \| 'replace-wait' \| 'walk-summary'; index: number; goals: readonly GoalEntry[]; nonGoals: readonly NonGoalEntry[]; … }` |
| 8 | low | STEPS (151,153) | STEPS says "Write T1-T4" / "T1-T4 MUST fail", but TESTS defines T1-T3 and line 146 says "T1-T3 all fail at base", FINAL REPORT says "T1 … T3" | brief:151 "Write T1-T4"; brief:153 "T1-T4 MUST fail"; brief:146 "T1-T3 all fail at base"; brief:181 "T2 … T3" | change lines 151 and 153 to "T1-T3" |
