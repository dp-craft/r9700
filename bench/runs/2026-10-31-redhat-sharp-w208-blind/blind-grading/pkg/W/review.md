# REFINE-CHECK — W2-08 (blind review, 27B)

## Derived

Part 1 — derived from the row (wave-2-dpf-cli.md:58), C3, C7, C8, C11, C14, the
predecessor briefs (W2-01b, W2-02, W2-05) and the code the row names, BEFORE reading
the brief body.

M2 surface —
- D: new file tools/dpf/src/screens/resolve-confirm.ts exporting `resolveConfirmScreen(input: ResolveConfirmInput): Screen<…, ResolveResult>` and `applyResolve(…)` (C7:157; row FILES cell). (row)
- D: new test file tools/dpf/tests/screens/resolve-confirm.test.ts (row FILES cell). (row)
- S: `Screen`/`Turn`/`LineIO`/`runScreen`/`lineIO` come from src/ui/screen.ts (post-W2-01b; C7 ts block: `Turn { state, out, result? }`, `Screen { start, next }`, `runScreen` writes every turn's `out`, the result turn's too; `lineIO` is node:readline's async iterator, NOT readline/promises `question()`). (C7)
- S: both documents are read with `readIr` (tools/shared/ir/io.ts:179 `readIr = <K extends IrKind>(kind, file): IrResult<IrOf<K>>`; io.ts:22-25 `IrResult<T> = ok:true{value} | ok:false{file, issues}`); kind 'resolution' → ResolutionIrSchema (registry.ts:49, fileName resolution.json), kind 'goals' → GoalsDocSchema (registry.ts:50, fileName goals.json). The row says "read with readIr, tools/shared/ir/io.ts". (row)
- S: paths come from the pause record's inputs/outputs, never rebuilt (C8 "Paths come from the record's inputs and outputs"; 02-contracts.md "Traps" last bullet): C3 inputs = { resolution, goals, template }, outputs = [confirmed.json]. (C3, C8)
- S: content order (C11): 1 shape · 2 mapping, kind 'unknown' first · 3 drift, status 'unclear' first · 4 blastRadius · 5 goals and non-goals · 6 this run's request-doc cuts · 7 diffLines when present. (C11)
- S: cut rows = ledger residue rows with this runId (the pause record carries runId, pause.ts:19), stage 'spec-a-resolve', anchor jsonPath '$.sections.request-docs' (residue row = { at, round, kind:'residue', runId, stage, entry }, loop-ports.ts:936-942; ResidueEntry { class, anchor { artifact, jsonPath }, findingIds, text, dropped? }, residue.ts:37-47), each entry.text printed. (C11, row)
- S: diffLines = irDiff output for resolution and goals, snapshot vs current, computed at the NEXT resolve-confirm (C14 "Diff lines") — optional input, produced by W2-09/W2-13, printed when present. (C14)
- K: keys a · g · c · q (row). `a` → copy inputs.template to outputs[0] (C3: "confirmed.json is a byte copy of the template. No step reads it"), result kind accept (test cell "a → result accept"). `g` walks each goal AND non-goal: Enter keep · `r` replace (the next line is the text) · `d` drop (row, C11 "Per entry"). `c` → correction (W2-09's screen; not yours — this row can only produce a result kind, W2-13 routes, C8:181). `q` → quit.
- K: `w` commits the edits: the test cell says "`g`, `r` on G-2 with new text, `w` → one `irSet`" — `w` is NOT in C11's key list (a·g·c·q), so it must live in the post-walk summary state, mirroring clarify (W2-05 D3: "w to write, e to start over, q to quit"; "w → { kind: 'write', answers }"). The brief must place it and say so.
- S: `applyResolve`: accept → cpSync inputs.template → outputs[0] (the only plain file write, W2-05 D4 pattern "Copy the pause record's inputs.template to its outputs[0] (node:fs cpSync)"); edits → ONE `irSet({ kind: 'goals', file: inputs.goals, path: '$.goals', value })` (C11 "One write") and a second `irSet` for `$.nonGoals` ONLY when it changed; replaced entries get `source: RESOLVE_CONFIRM_SOURCE` = 'resolve-confirm', a constant in screens/resolve-confirm.ts (C11 "Source").
- S: `irSet` is post-W2-05: `irSet(o: { cli, kind, file, path, value: unknown }): Promise<IrResult>`, IrResult = `{ ok: true } | { ok: false; file; findings?: string; error?: string }` (W2-05 brief D1); import from '../run/ir.js'. (W2-05)
- S: a goal entry = { id: /^G-\d+$/, text: min 1, source: min 1 }, non-goal id /^NG-\d+$/ (resolution.ts:11-21); goals array min(1) (resolution.ts:23), unique ids across goals+nonGoals (resolution.ts:39,41).

M3 readers —
- W2-09 (row :59) depends on W2-08: its correction screen is reached via this screen's `c`; its snapshot feeds this screen's `diffLines` (C14 "Diff lines: At the next resolve-confirm…"). (row, C14)
- W2-13 routes the `resolve-confirm` pause to this screen (C8:181). (C8)
- This row needs from W2-05 (not done): irSet + the screen/apply pattern (W2-05 brief). From W2-02: ResidueRow { runId: string | undefined; stage: string | undefined; entry: unknown } (W2-02 brief D4) — the screen takes the rows from the flow (W2-13 reads the ledger via ledgerTail), entry is unknown and must be narrowed for `.text`/`.anchor`. (W2-02)
- No step in SP/src rejects an unknown goal source: `grep -rn 'source ===' tools/spec-pipeline/src/` → 6 hits, all about gate/finding/layout sources (profile/registry.ts:77, loop/routing.ts:40, loop/run.ts:107,111, wiring/row-ids.ts:67, wiring/surface-refs.ts:112), none on a goal entry's `.source`; goal-coverage-lint.ts has zero `source` references; no 'resolve-confirm' string anywhere under tools/. The row MANDATES this grep in the brief ("The brief greps source === under SP/src to prove no step rejects an unknown source"). (row)

M4 branches —
- readIr ok:false for either document (issues) → the screen cannot show the content: the brief must say what `start` does (print the issues and refuse a result, or throw) — C11 is silent; untested in the test cell. (C11, io.ts:22-25)
- `r` followed by an empty line → text min(1) would fail GoalsDocSchema; the write would be refused by irSet (exit 3). The brief must say: re-ask, or keep the old text. (resolution.ts:16)
- `d` on every goal → goals min(1) fails; the brief must say what happens (refuse the drop, or let irSet refuse). (resolution.ts:23)
- unknown key at the main menu and at the summary → repeat the prompt (clarify pattern: "Any other line → the summary again", W2-05 D3). (W2-05)
- `applyResolve` when irSet is not ok → throw an Error carrying findings or error (W2-05 D4: "Throw an Error carrying the findings or error when either is not ok"). (W2-05)

M7 resources —
- The screen is pure (C7: "every screen is pure; runScreen is the one I/O shell"); nothing opened. applyResolve: cpSync (no handle) + irSet subprocess (W2-05 runIr resolves on 'close', handles 'error'; temp file unlinked in finally). No listeners, no streams. (C7, W2-05)

M8 tests — from the row's test cell (one per observable):
- T: `unknown` mapping rows print before the others (C11 order 2; turn's `out`). (row)
- T: a cut row prints its text (residue row matching runId + stage 'spec-a-resolve' + anchor '$.sections.request-docs' → entry.text in `out`; a non-matching row does not). (row)
- T: `a` → result accept (no ir call, no goals write). (row)
- T: `g`, then `r` on G-2 with new text, then `w` → exactly ONE irSet (calls.jsonl argv: ir set --kind goals --file <goals> --path $.goals --value @…; value = G-1 original + G-2 { new text, source 'resolve-confirm' }; nonGoals unchanged → no second call). (row)
- D-8: no test for the RESOLVE_CONFIRM_SOURCE constant itself, for re-exports, or for a type. (00-plan.md:70 via 01-writer-brief.md item 6)

## Compared

Part 2 — derived line → brief line (or GAP); D/T id → derived line (or EXTRA).

Derived → brief
- M2 (D: resolveConfirmScreen + applyResolve) → D2:64, D4:91.
- M2 (D: test file) → TESTS:100-146.
- M2 (S: screen.ts contract) → PATTERN:26-39 (Turn/Screen verbatim; runScreen L29-39 NOT verbatim — finding 7).
- M2 (S: readIr) → S6 (io.ts:179).
- M2 (S: paths from record inputs/outputs) → S7 (pause.ts:15-40), D4:92-96.
- M2 (S: content order C11) → D2:65-69.
- M2 (S: cut rows = ledger residue) → D2:55 (`cuts: readonly string[]`), D2:69 "6 each cut `cut: <text>`" (the flow extracts entry.text; the screen prints the lines).
- M2 (S: diffLines optional) → D2:56, D2:69 "7 each diffLines line verbatim".
- M2 (K: keys a/g/c/q) → D2:70-72.
- M2 (K: g walk Enter/r/d) → D3:76-87.
- M2 (K: w post-walk, not in the C11 key list) → D3:83-87 (walk-summary w/q; DO NOT:170 keeps w out of main) — placed correctly.
- M2 (S: applyResolve accept→cpSync, edit→one irSet + conditional second, source) → D4:92-98, D1:43.
- M2 (S: irSet signature) → S1 note (W2-05 creates src/run/ir.ts), D4:90 import.
- M2 (S: goal entry shape) → S2 (resolution.ts:14-20), S8 (resolution.ts:171-176).
- M3 (W2-09: c → correction, diffLines feed) → D2:70 (`c` → correction), D2:56 (diffLines).
- M3 (W2-13 routes the pause) → WHY:9-10.
- M3 (source === grep obligation) → D1:44-47 (six hits named, all gate/finding sources).
- M4 (readIr ok:false) → not this screen's input: the screen takes the PARSED docs (S6, D2:52-58); the flow (W2-13) owns the readIr failure. No GAP.
- M4 (`r` + empty line → text min(1)) → D3:84 silent — finding 10.
- M4 (`d` on every goal → goals min(1)) → D4:97-98 states the result (irValidate refuses; applyResolve throws carrying findings). No test mandated by the row's test cell. Not a finding.
- M4 (unknown key → repeat the prompt) → D2:72, D3:87.
- M4 (irSet not ok → throw) → D4:97-98.
- M7 (pure screen; cpSync no handle) → D4:92; nothing opened. No GAP.
- M8 (unknown-first test) → T1:137-138.
- M8 (cut row test) → T2:139.
- M8 (a → accept, no ir call) → deferred to W2-13a's flow test scenario 1 (brief:144-145; wave-2-dpf-cli.md:64) — legitimate per the wave.
- M8 (g/r/w → one irSet) → T3:140-143 (walk bookkeeping broken — finding 2; fake plan insufficient — finding 3).
- M8 (D-8 exemptions) → no constant/re-export/type test — matches.

D/T → derived (or EXTRA)
- D1 → M3 grep obligation; C11 source (M2 S: applyResolve source).
- D2 → M2 (S: content order, paths, screen contract; K: keys) + M4 (unknown key).
- D3 → M2 (K: walk, w) + M4 (`r` empty line, unknown key).
- D4 → M2 (S: applyResolve, irSet) + M4 (irSet not ok, `d` on every goal).
- T1 → M8 (unknown-first). T2 → M8 (cut row). T3 → M8 (g/r/w).
- EXTRA: none — every deliverable traces to a derived line; the state flags (D2:73-75) are implementation detail, dead per D4:95-96,86 — finding 12.

## Probes

M9 — one line per code block; probe files under /tmp/dp-refine/W2-08/. The src blocks are probed
as tools/scripts/dep-auto-baseline.ts — the rule equivalent for tools/dpf src AFTER W2-01b D3
adds `tools/dpf/**/*.{ts,mjs}` to the per-package incrementalRules list (W2-01b brief:50);
the test block as tools/dpf/tests/screens/resolve-confirm.test.ts (test exemption block).
Stubs are PROBE-ONLY (real signatures from W2-01b/W2-05 briefs and tools/shared/ir/resolution.ts).

- PATTERN:27-39 · b1/pattern.ts · tsc: TS2345 at L11 `io.ask(prompt)` — prompt is `string | undefined` (param `prompt?: string`), ask takes `string` · eslint: 5 warnings — complexity 6 (>4) on the async arrow; no-restricted-syntax ×4 (`let turn`, `for(;;)`, 2× `for-of`). The block is not verbatim W2-01b (whose runScreen is a recursive `step`, no loop/let; LineIO interface absent here).
- D2:48-64 · b2/src/screens/resolve-confirm.ts · tsc: none (all types resolve; fixture-compatible) · eslint: import-sort error at L6 (relative before external, no blank line between groups); max-statements-per-line at L21 is a PROBE-ONLY artifact (the brief's L64 is signature shorthand with no arrow body).
- D4:88-91 · b3/src/screens/resolve-confirm.ts · tsc: none · eslint: import-sort error at L4 (node:→relative group order is CORRECT; the blank line between the groups is missing — plain lint of the pair as written errors identically); max-params warnings at L9 (the brief's 4-param line — real) and L10 (PROBE-ONLY arrow body — artifact).
- TESTS:102-133 · b4/tests/screens/resolve-confirm.test.ts · tsc: exactly one error — TS2307 at L33 `Cannot find module '../src/screens/resolve-confirm.js'` (the file sits in tools/dpf/tests/screens/; `../../src/…` is required); every fixture object typechecks against the real shapes, incl. `epochId: undefined` (no exactOptionalPropertyTypes) and `stepType: 'human'` · eslint: import-sort errors at L2 and L32 (mid-file imports; group and specifier order).

## Findings

| # | Sev | Item (M/S/D/T id) | Problem | Evidence (quoted) | Proposed change |
|---|---|---|---|---|---|
| 1 | high | TESTS L133 (D2 import) | The test imports `'../src/screens/resolve-confirm.js'`; the file sits in tools/dpf/tests/screens/, so `../src` resolves to tools/dpf/tests/src — no module, T1-T3 cannot compile or pass | probe b4 tsc: `TS2307: Cannot find module '../src/screens/resolve-confirm.js'`; W2-04 brief:122 "the test sits two levels below tools/dpf" → `../../src/…` | L133: `'../../src/screens/resolve-confirm.js'` |
| 2 | high | D2 L74-75 + D3 L78-84 (M2 walk) | State initializes `goals = input.goals.goals, nonGoals = input.goals.nonGoals`, and D3 appends every kept/replaced entry ("keep the entry (append to goals/nonGoals)", L81; L84) → after the walk state.goals = [G-1, G-2, G-1, G-2'] (doubled); T3 expects `goals: [G-1 unchanged, G-2 {…'new text'…}]` → T3 cannot pass. L78's condition "index < goals.length" is ambiguous (state.goals.length vs input.goals.goals.length — with empty init state.goals.length === index always) | brief L74-75 ("goals = input.goals.goals, nonGoals = input.goals.nonGoals"), L81 ("append to goals/nonGoals"), L141 (T3 expects 2 entries) | L74-75: initial `goals = [], nonGoals = []` (the walk appends the kept and replaced entries); L78: "a goal when index < input.goals.goals.length (input.goals.goals[index]), else a non-goal (input.goals.nonGoals[index - input.goals.goals.length])"; L81: append to state goals when the entry is a goal, else state nonGoals |
| 3 | high | TESTS L134-136 (T3 fake plan) | "a single { exit: 0 } entry": the edit path makes TWO fake calls (irSet then irValidate, D4 L93-96); call 2 gets entry = plan[1] = undefined, the fake does `process.exit(entry.exit)` (W2-04 D2 step 6) → the child crashes → irValidate not ok → applyResolve throws (D4 L97) → T3 cannot pass | brief L135 ("write a plan file (a single { exit: 0 } entry)"); W2-04 brief L111-112 (`entry = plan[n]`), L128 (`process.exit(entry.exit)`) | L134-136: plan `[{ exit: 0 }, { exit: 0 }]` (irSet, then irValidate); "(no counter file: the fake starts at entry 0)" — W2-04 wording |
| 4 | med | D2 L49-51 (M9 lint) | Relative import before the external, no blank line between groups, specifier order wrong → import-sort error; STEP 5's `npx eslint --quiet` fails (errors are not suppressed) | probe b2 eslint L6:1 `Run autofix to sort these imports!`; fix-probe wanted order: `spec-pipeline/protocol` · blank · `GoalEntry, GoalsDoc, NonGoalEntry, ResolutionIr` from '../../../shared/ir/resolution.js' · `type Screen` from '../ui/screen.js' | L49-51: external first, blank line, then the two relatives (resolution.js specifiers alphabetical, then screen.js) |
| 5 | med | D4 L89-90 (M9 lint) | Group order correct (node: before relative) but no blank line between the groups → import-sort error | plain lint of the pair as written: `1:1 error Run autofix to sort these imports!`; fix-probe output inserts the blank line | blank line after L89 (`node:fs`) |
| 6 | med | TESTS L102 + L132-133 (M9 lint) | Imports scattered (one at top, two mid-file after `const screen`), group/specifier order wrong → two import-sort errors | probe b4 eslint L2:1 and L32:1; fix-probe wanted order: `spec-pipeline/protocol` · blank · `GoalsDoc, ResolutionIr` from '../../../shared/ir/resolution.js' · `applyResolve, type ResolveConfirmInput, resolveConfirmScreen` from '../../src/screens/resolve-confirm.js' | hoist all three imports to the top in that order (incl. finding 1's path fix); delete L102 and L132-133 in place |
| 7 | med | PATTERN L29-39 (M2 drift) | Claims "verbatim" from W2-01b but is fabricated: W2-01b's runScreen is a recursive `step` (no loop, no `let`) and its contract shows LineIO + colon-form signatures; the block does not compile (TS2345) and lints 5 warnings | W2-01b brief L41-43 (LineIO, `export const runScreen: <S, R>(…) => Promise<R | undefined>;`, lineIO); probe b1: tsc TS2345, eslint 5 warnings | replace L29-39 with W2-01b's verbatim L41-43 (LineIO interface + runScreen/lineIO colon-form lines) |
| 8 | med | STEPS L151 + L153 (M10) | "Write T1-T4" / "T1-T4 MUST fail" — only T1-T3 exist; a writer looks for a T4 that is nowhere defined | brief L137-146 (T1, T2, T3 only), L146 ("T1-T3 all fail at base"), L180-181 ("T2 … T3") | L151 "Write T1-T3"; L153 "T1-T3 MUST fail" |
| 9 | med | TESTS L121 + T3 L140-141 (M8) | Fixture `nonGoals: []` → the non-goal walk branch (D3 append to nonGoals) is never exercised; T3 walks goals only | brief L121 (`nonGoals: []`), L140-141 (walk touches G-1/G-2 only) | fixture `nonGoals: [{ id: 'NG-1', text: 'no ui', source: 'resolve' }]`; T3 walk: g → G-1; '' → G-2; r → 'new text:'; 'new text' → NG-1 prompt; '' → keep NG-1 → summary; w → `{ kind: 'edit', goals: [G-1 unchanged, G-2 modified], nonGoals: [NG-1 unchanged] }`; assertions unchanged (one `$.goals` irSet; no `$.nonGoals` irSet — NG-1 unchanged, JSON.stringify equal) |
| 10 | med | D3 L84 (M4) | Empty line in replace-wait: "the line is the new text" → text '' → entry fails GoalEntry text min(1) (resolution.ts:16); `w` → irSet writes it → irValidate refuses → applyResolve throws (D4 L97). Siblings handle the same input differently: W2-05 clarify re-asks on an empty line ("a blank answer would fail C1's refine") — M4: inputs of one kind are handled alike in every sibling | brief L84 ("the line is the new text"); W2-05 brief L71-72; resolution.ts:16 | D3 replace-wait: "an empty line (whitespace only included) → re-prompt (empty text would fail irValidate); otherwise the line is the new text; …" |
| 11 | low | D4 L91 (M6 convention) | applyResolve has 4 params; max-params warn (max 3, the documented quality metric and sibling convention — W2-05 applyClarify takes 3); hidden by STEP 5's `--quiet` but the warning is real | probe b3 eslint L9:28 `Function has too many parameters (4). Maximum allowed is 3` | `applyResolve(result: ResolveResult, input: ResolveConfirmInput, cli: readonly string[]): Promise<void>` — paths become `input.record.inputs.template` / `input.record.outputs[0]` / `input.record.inputs.goals`; nonGoals compared against `input.goals.nonGoals`; T3 call → `applyResolve(that result, input, cli)` |
| 12 | low | D2 L73-75 + D3 L85 (M6) | State fields `goalsChanged`/`nonGoalsChanged` are never read: D4 compares result.nonGoals against originalGoals.nonGoals by JSON.stringify (L95-96) and `w` emits edit unconditionally (L86); L85's "mark the matching changed flag true" sets a flag nothing reads | brief L73-75 (flags), L85, L95-96, L86 | drop both fields from the state and the "mark the matching changed flag true" clause |
| 13 | low | FILES L13-14 + S1 L17 (M10) | Package-relative paths while siblings W2-04/05 use repo-relative `tools/dpf/…` and this brief's own S2-S8 are repo-relative — a writer could create the files at the repo root | W2-04 FILES ("tools/dpf/src/run/runner.ts"), W2-05 FILES ("tools/dpf/src/run/ir.ts"); W2-08 S2-S8 ("tools/shared/…") | FILES: `tools/dpf/src/screens/resolve-confirm.ts` / `tools/dpf/tests/screens/resolve-confirm.test.ts`; S1 likewise |
| 14 | low | header L2 + SITES L16 (M1) | base 36ffe5b4 is a docs-only commit — tools/dpf does not exist there (no screen.ts/ir.ts, yet D2:51 and D4:90 import both); S2-S8 verified at HEAD | `git show 36ffe5b4:tools/dpf/src/ui/screen.ts` → empty; S2-S8 re-verified at de110510 (all match) | L2 `base de110510`; L16 "verified at de110510" (runbook step C) |
