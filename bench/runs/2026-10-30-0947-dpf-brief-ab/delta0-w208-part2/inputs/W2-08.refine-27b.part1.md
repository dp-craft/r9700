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
