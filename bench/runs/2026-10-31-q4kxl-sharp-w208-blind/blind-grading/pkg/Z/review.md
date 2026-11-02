# W2-08 refine-27b check

## Derived (blind — row, contracts, code only; brief body unread)

Row: wave-2-dpf-cli.md:58 · contracts C3 (02-contracts.md:47), C11 (02-contracts.md:228), C6 (:124), C7 (:139), C8 (:175)

M2 surface
- M2-1 new `tools/dpf/src/screens/resolve-confirm.ts` exporting `resolveConfirmScreen(input: ResolveConfirmInput): Screen<S, ResolveResult>` and `applyResolve(…)` (C7:157; row).
- M2-2 screen content, exactly C11's order: 1 shape · 2 mapping, `kind: 'unknown'` first · 3 drift, `status: 'unclear'` first · 4 blastRadius · 5 goals and non-goals · 6 this run's request-doc cuts · 7 `diffLines` (W2-09) when present.
- M2-3 the resolution and goals documents are read with `readIr` (tools/shared/ir/io.ts:179, kinds `resolution` → `ResolutionIr`, `goals` → `GoalsDoc`; registry.ts:19-33). `ResolutionIr` = `ResolutionDocSchema` + `generatedAt: IsoDate` + `branch: NonEmpty` (resolution.ts:164).
- M2-4 keys `a` accept · `g` edit goals · `c` correction · `q` quit (C11); `g` walks each goal and non-goal: Enter keep · `r` replace (the next line is the text) · `d` drop (row; C11 Per entry).
- M2-5 `applyResolve`: accept → copy `inputs.template` to `outputs[0]` (C3: `confirmed.json` is a byte copy; wave-2 § Design: copying a pipeline-emitted template is the only plain file write → `cpSync`); edits → one `irSet` of `$.goals` and a second only when `$.nonGoals` changed (C11 One write); replaced entries get `source: RESOLVE_CONFIRM_SOURCE` (row; C11 Source).
- M2-6 `RESOLVE_CONFIRM_SOURCE = 'resolve-confirm'`, a constant in `screens/resolve-confirm.ts` (C11 Source).
- M2-7 input comes from the C3 step inputs `{ resolution, goals, template }` (C3 JSON) resolved from the pause record's `inputs` (C8: paths come from the record, no file name rebuilt); plus `runId` (PausePayload, pause.ts:16) to filter the cuts; plus the ledger residue rows (`ResidueRow { runId, stage, entry }`, W2-02 brief D4 line 76); plus optional `diffLines` (C11 item 7, produced by W2-09).
- M2-8 new test file `tools/dpf/tests/screens/resolve-confirm.test.ts` (row FILES cell).
- M2-9 every user-visible line verbatim, exact TypeScript types for `ResolveConfirmInput` / `ResolveResult` / `applyResolve` (REFINE item 2; the row's C7 cell writes `Screen<…, …>` only).
- M2-10 imports limited to `node:*`, `tools/shared/**`, `spec-pipeline/protocol` (C7; dep-cruiser `dpf-built-ins-shared-protocol-only`, W2-01b brief D5). Expected: `type Screen`/`Turn` from `../ui/screen.js` (W2-01b D9), `readIr` from `../../../shared/ir/io.js`, `irSet` from `../run/ir.js` (W2-05 D1), `ResidueRow` from `../follow/ledger.js` (W2-02 D4), `PausePayload` type from `spec-pipeline/protocol` (C6).
- M2-11 the row's applyResolve text defines only `accept` and `edits`: what happens for a `correction` or `quit` result (throw? no write?) must be stated — the flow (W2-13, not done) is the caller.

M3 readers
- M3-1 W2-13 (flow, later row) consumes `resolveConfirmScreen` / `applyResolve` — the exact signatures are its dependency; W2-13's brief will grep them.
- M3-2 W2-09 (later row) supplies the `diffLines` — only an optional input for this row.
- M3-3 new file, no barrel (dpf is `per-file (no barrel)`, W2-01b D4); no other reader at base.
- M3-4 needs from not-done predecessors: screen.ts (W2-01b D9), ir.ts `irSet` (W2-05 D1), `ResidueRow` (W2-02 D4), the fake pipeline `tools/dpf/tests/fixtures/fake-spec-pipeline.mjs` (W2-04 D2) for the `irSet` test, the clarify screen as the closest sibling (W2-05 D2-D4).

M4 branches
- M4-1 `readIr` failure (missing/malformed resolution or goals file): the row and contracts are silent — the brief MUST define it (a screen cannot throw inside runScreen; some printed error + a defined result or no-result).
- M4-2 unknown-mapping-first and unclear-drift-first: the non-first rows keep document order (C11 says only "first").
- M4-3 main screen: `a` → accept result; `g` → walk; `c` → correction result; `q` → quit result; any other line (incl. empty) → the screen again (the clarify sibling redisplay on unknown lines, W2-05 D3); EOF → `runScreen` returns undefined (C7).
- M4-4 the `g` walk: per entry Enter keep · `r` (the NEXT line is the replacement text — a blank one is undefined by C11, the brief must state) · `d` drop. `GoalsDocSchema` requires `goals: min(1)` (resolution.ts:44) — dropping the LAST goal must be handled or stated (an `irSet` of `[]` would be refused by `ir`). The walk's end and its confirm key are undefined by C11; the row's test cell shows a `w` line before the `irSet` → a confirm step with `w` (cf. clarify's summary `w`, W2-05 D3).
- M4-5 stamping `source: RESOLVE_CONFIRM_SOURCE` on a replaced entry: by the screen at replace time or by `applyResolve` — the brief must name one (C11 puts the constant in `screens/resolve-confirm.ts`).
- M4-6 `applyResolve` accept: byte-copy template → `outputs[0]` (cpSync), no ir call (C3: no step reads it).
- M4-7 `applyResolve` edit: `irSet({ kind: 'goals', file: <inputs.goals>, path: '$.goals', value })` (+ one for `$.nonGoals` only when changed, C11); on `!ok` throw carrying findings/error (the W2-05 applyClarify pattern, its D4).
- M4-8 the cuts: filter residue rows `runId === <this run>`, `stage === 'spec-a-resolve'`, anchor `$.sections.request-docs`; print each `entry.text`. `ResidueRow.runId/stage` are `string | undefined` and `entry` is `unknown` — the read of `entry.text`/anchor must be type-safe as written (M5).
- M4-9 the `spec-a-resolve` stage string: is it a protocol constant or a literal in dpf? C6's export list has no stage name — the brief must say which (a literal in dpf is its own name to own, like `request.txt` in W2-01b D7).

M7 resources
- M7-1 the screen is pure (C7, wave-2 § Design: every screen is a pure `Screen<S, R>` plus an `apply…` for its writes): no file, child or registration opened. `applyResolve`'s only subprocess is W2-05's `irSet` (its `runIr` resolves on `'close'`/`'error'`, W2-05 D1) — no new wait to check; the temp file inside `irSet` is W2-05's.

M8 tests (row test cell, verbatim: "screen tests: `unknown` mapping rows print before the others · a cut row prints its text · `a` → result accept · `g`, `r` on G-2 with new text, `w` → one `irSet` with G-2 `resolve-confirm` and G-1 unchanged")
- M8-1 a fixture with ≥2 mapping rows incl. one `kind: 'unknown'` → its line prints before the others' (start or first `next`).
- M8-2 a fixture with residue rows, one matching (this runId, stage `spec-a-resolve`, anchor `$.sections.request-docs`) and one not → the matching `entry.text` prints, the other does not.
- M8-3 main screen `next('a')` → the accept result.
- M8-4 `next('g')`, walk (keep G-1, `r` + new text on G-2, …), then `w` → the edit result; `applyResolve` on it (W2-04 fake, plan `[{ exit: 0 }]`) → exactly ONE `ir set` call, path `$.goals`, value with G-2 new text + `source: 'resolve-confirm'` and G-1 unchanged; no `$.nonGoals` call.
- M8-5 fixtures must satisfy the FULL schemas `readIr` runs: `ResolutionIr` (shape, mapping ≥1, drift, blastRadius, generatedAt IsoDate, branch) and `GoalsDoc` (goals ≥1); the brief names them.
- M8-6 the `irSet` test reuses the W2-04 fake: `cli = [process.execPath, fake]`, `calls.jsonl` assertions (W2-05 T5 style).
- M8-7 the readIr-failure branch (M4-1) needs a test or an explicit exemption (REFINE item 6: 3–6 tests; D-8: no test for a constant).

## Compared (briefs/W2-08.md line numbers)

Derived line → the brief line that serves it, or GAP:
- M2-1 → D2 L64 + D4 L91. Covered.
- M2-2 → D2 L65-70 (main content, C11 order, verbatim). Covered.
- M2-3 → S6 L22 + D2 L52-54: the screen TAKES the parsed docs (`resolution: ResolutionIr`, `goals: GoalsDoc`); readIr is "the flow uses it". GAP→design (C7 purity: `Screen.start/next` may not do I/O); M4-1 moves to W2-13 (NEEDS).
- M2-4 → D2 L70-72 (keys) + D3 L76-87 (walk). Covered.
- M2-5 → D4 L92-98. Covered (D4 adds `irValidate` — see the EXTRA note under D4; it is not itself a defect but changes the fake plan count — finding 3).
- M2-6 → D1 L43. Covered; the grep claim verified 6/6 true (Probes).
- M2-7 → D2 L52-58: the input carries parsed docs + pre-extracted `cuts` + `diffLines` + the whole `record`; the residue filter (runId/stage/anchor) is W2-13's, not the screen's. GAP→design (NEEDS: W2-13).
- M2-8 → FILES L14. Covered (package-relative path — finding 9).
- M2-9 → D2 L49-75 + D4 L89-98 (exact types). Covered.
- M2-10 → D2 L49-51 + D4 L89-90 imports. Covered (node:fs only, matching the DO NOT node: line).
- M2-11 → D4 L97 "correction/quit → no write". Covered.
- M3-1 → n/a in this brief (later row); the exported signatures are its dependency. NEEDS: W2-13's brief will grep `applyResolve` — finding 5 changes the signature.
- M3-2 → D2 L56 `diffLines`. Covered.
- M3-3 → n/a (new file; dpf has no barrel, W2-01b D4).
- M3-4 → PATTERN L26-39 (mispasted — finding 7), TESTS L134-136 (fake reuse — finding 3), S1 L17.
- M4-1 → GAP→design: the screen does no I/O; the readIr-failure branch is W2-13's (NEEDS).
- M4-2 → D2 L66-67. Covered.
- M4-3 → D2 L70-72. Covered (the accept case — finding 8 is about its test, not the branch).
- M4-4 → D3 L76-87. Covered as branches; findings 4 (doubling) and 10 (last-goal drop).
- M4-5 → D3 L84-85 (the screen stamps at replace time, with D1's constant). Covered.
- M4-6 → D4 L92. Covered.
- M4-7 → D4 L93-98 (+ irValidate note). Covered.
- M4-8 → GAP→design: the screen takes pre-cut `cuts: readonly string[]` (D2 L55); the type-safe read of `entry.text`/anchor is W2-13's (NEEDS).
- M4-9 → GAP→design: no stage literal in this brief; W2-13 owns `'spec-a-resolve'` (NEEDS).
- M7-1 → covered: no new resource in the deliverables; the screen is pure; applyResolve's only subprocess is W2-05's `irSet`/`irValidate`.
- M8-1 → T1 L137-138. Covered (finding 6: the drift half is vacuous).
- M8-2 → T2 L139. Covered.
- M8-3 → GAP: dropped at L144-145 on an unverifiable W2-13a citation — finding 8.
- M8-4 → T3 L140-143. Covered (findings 1, 3, 4 block it).
- M8-5 → the TESTS fixture L103-122, named `ResolutionIr`/`GoalsDoc`. Covered (probe: full schema conformance).
- M8-6 → L134-136. Covered (finding 3: plan entry count + counter).
- M8-7 → design: no readIr in this row; C11 item 7 (diffLines render) untested and unmarked — finding 13.

Brief D/T → the derived line or contract clause it serves, or EXTRA:
- D1 → M2-6, C11 Source. Served.
- D2 → M2-1/2/9/10, M4-2/3. Served (findings 4, 9, 12).
- D3 → M4-4/5. Served (findings 4, 10).
- D4 → M2-5/11, M4-6/7. Served (findings 3, 5). EXTRA: `irValidate` of `record.inputs.goals` (L96) — not in C11 or the row's text; pattern-consistent (W2-05 D4 `applyClarify` validates after set) — not a defect, but it makes the edit path TWO subprocess calls (finding 3).
- T1 → M8-1 (finding 6). T2 → M8-2. T3 → M8-4/6 (findings 1, 3, 4).
- No EXTRA deliverables.

Cross-row NEEDS (not edits to W2-08): W2-13 owns the readIr reads of `record.inputs.resolution`/`.goals` (S6), the residue filter (runId, stage `'spec-a-resolve'`, anchor `$.sections.request-docs`, `entry.text`), the `ResolveConfirmInput` construction, the `applyResolve` call, and the readIr-failure behaviour (M4-1) — W2-08's screen is pure and takes parsed docs + pre-extracted cuts. W2-13a's flow tests must reach the screen cases this row does not unit-test (after finding 8's fix, only the diffLines render, finding 13).

## Probes (one line per code block in the brief)
- PATTERN L26-39 · /tmp/dp-refine/W2-08/probe-pattern.ts · tsc: `error TS2304: Cannot find name 'LineIO'` (the block uses `LineIO` without defining or importing it; the real W2-01b D9 defines it in-file) · eslint (proxy `--stdin-filename tools/shared/ir/resolution.ts` — `tools/dpf/**` is not registered at HEAD, W2-01b D3 adds it; the proxy receives the same `incrementalRules` warn level dpf will get): 5 warnings — `complexity 6 > 4`, `no-restricted-syntax` on the `let` (L4) and three `for` loops (L5, L6, L11).
- D1 L44-47 grep claim · `grep -rn 'source ===' tools/spec-pipeline/src` · 6 hits, all six cited locations verbatim (profile/registry.ts:77, loop/routing.ts:40, loop/run.ts:107,111, wiring/row-ids.ts:67, surface-refs.ts:112) — claim TRUE.
- D2 L49-64 · /tmp/dp-refine/W2-08/probe-types.ts (real resolution types; `PausePayload` stubbed PROBE-ONLY from pause.ts:15-40 — `spec-pipeline/protocol` is W2-01's, not at HEAD) · tsc: none · eslint: none (the only errors are probe artifacts: import sort / comma-dangle / max-statements on the probe's own lines).
- D4 L89-91 · probe-types.ts (also standalone /tmp/dp-refine/W2-08/probe-4params.ts) · tsc: none · eslint: `max-params` warning "Arrow function has too many parameters (4). Maximum allowed is 3" — finding 5.
- TESTS L102-131 fixture · probe-types.ts · tsc: none — every field conforms: `schemaVersion` literal 1, `z.iso.datetime()` infers `string` (common.ts:28), `'human' ∈ StepTypeSchema` (manifest.ts), grain rule (surfaceId null ⇒ kind 'unknown'), notes present for `unclear`/`matches` (NOTES_REQUIRED_STATUSES).
- TESTS L133 import · `path.resolve('<repo>/tools/dpf/tests/screens', '../src/screens/resolve-confirm.js')` → `<repo>/tools/dpf/tests/src/screens/resolve-confirm.js` — a path that cannot exist (finding 1).
- TESTS L134-136 fake plan · /tmp/dp-refine/W2-08/fake-replica.mjs (replicating the W2-04 D2 core: `plan[n]` per call, counter file) · plan `[{ exit: 0 }]`, two invocations (irSet then irValidate) · call 2: `TypeError: Cannot read properties of undefined (reading 'exit')`, child exit 1 (finding 3).

## Findings

| # | Sev | Item (M/S/D/T id) | Problem | Evidence (quoted) | Proposed change |
|---|-----|-------------------|---------|-------------------|----------------|
| 1 | high | T (TESTS L133) | the test import cannot resolve: from `tools/dpf/tests/screens/`, `'../src/screens/resolve-confirm.js'` resolves to `tools/dpf/tests/src/screens/…` | probe: `path.resolve('…/tools/dpf/tests/screens', '../src/screens/resolve-confirm.js')` → `…/tools/dpf/tests/src/screens/resolve-confirm.js`; W2-05 convention: "both test files sit two levels below tools/dpf" → `../../src/…` | L133: `from '../../src/screens/resolve-confirm.js'` |
| 2 | high | STEPS 2 (L151) | count mismatch: "Write T1-T4" but only T1-T3 are defined ("No old tests in this file; T1-T3 all fail at base", L146; FINAL REPORT L181 "T2 … T3") — M10: the writer stops (STOP rule) or invents a T4 | L151 vs L137-146, L181 | fix together with finding 8: restore the accept case as T4, keep "Write T1-T4", FINAL REPORT "T2 … T4" |
| 3 | high | T3 (TESTS L134-136) | the fake plan cannot serve T3: D4's edit path makes TWO ir subprocess calls (L93-96: irSet `$.goals` "then irValidate of record.inputs.goals") but the plan is "a single { exit: 0 } entry"; the W2-04 fake takes `plan[n]` per invocation (W2-04 D2 L110-111), so call 2 reads `plan[1]` = undefined → child crashes → irValidate `!ok` → applyResolve throws → T3 cannot go green. "and a counter" also contradicts W2-05 TESTS ("no counter file: the fake starts at 0") | probe fake-replica.mjs, plan `[{exit:0}]`, 2 calls → call 2 `TypeError: Cannot read properties of undefined (reading 'exit')`, exit 1 | L135: plan file with TWO `{ exit: 0 }` entries, no counter file ("no counter file: the fake starts at 0") |
| 4 | high | D2 L72-75 / D3 L80-85 | walk accumulation doubles every entry: the state is initialized "goals = input.goals.goals, nonGoals = input.goals.nonGoals" (L74-75) and the walk APPENDS kept/replaced entries (L81, L84); a full walk (keep G-1, replace G-2, `w`) returns `goals: [G-1, G-2, G-1', G-2']` — 4 entries — while T3 (L141) expects `[G-1 unchanged, G-2 {… new text …}]` — 2 entries; T3 cannot go green; aborting and re-entering `g` doubles again | brief text L74-75 ("initial: … goals = input.goals.goals, nonGoals = input.goals.nonGoals") + L81 ("append to goals/nonGoals") + L84 ("append the entry") vs T3 L141 | the state's `goals`/`nonGoals` become pure walk accumulators: initialized `[]` and re-initialized on `g`; main content section 5 renders from `input.goals`, not the state; `w` returns the accumulators (T3's expectation then holds) |
| 5 | med | D4 L91 | `applyResolve(result, record, originalGoals, cli)` has 4 parameters: `max-params` warning (M9 "lints with no output" fails on the block as written), and it propagates into T3's call and W2-13's caller; the brief's own cited pattern avoids exactly this — W2-01b D9: "`step` takes a Session object: four parameters break max-params 3" | probe: `4:120 warning Arrow function has too many parameters (4). Maximum allowed is 3  max-params` (probe-4params.ts; confirmed again on probe-types.ts L66) | object param: `applyResolve(o: { result: ResolveResult; record: PausePayload; originalGoals: GoalsDoc; cli: readonly string[] }): Promise<void>` (repo convention: `irSet(o: {…})`, W2-05 D1); T3's call updated accordingly |
| 6 | med | T1 L137-138 + fixture L110-113 | T1's drift assertion is vacuous: the fixture's drift is already `[unclear, matches]`, so "'D-1: unclear' comes before 'D-2: matches'" passes with an implementation that never sorts; M8: "which wrong implementation still passes?" — a no-sort one | fixture L110-113: `drift: [{ id: 'D-1', … status: 'unclear' … }, { id: 'D-2', … status: 'matches' … }]`; T1 L138 | reorder the fixture drift to `matches` first (e.g. D-2 `matches` then D-1 `unclear`); the mapping half (unknown second in the fixture, first in `out`) is not vacuous — keep it |
| 7 | med | PATTERN L26-39 | the block is labeled "src/ui/screen.ts from W2-01b, verbatim" but is not W2-01b's code: the real D9 `runScreen` is a NON-async arrow built on `step`/`writeAll` recursion, with NO `let`/`for` ("No `let`/`for`: no-restricted-syntax"), and it writes the result turn's `out` BEFORE returning the result (`writeAll(session.io, next.out); return next.result === undefined ? step(session, next) : next.result;` — "a turn's `out` is written before its result returns"); the pasted block returns `turn.result` (L36) BEFORE writing that turn's `out` (L37) — the opposite of C7 ("runScreen writes every turn's out, the result turn's too") — and uses `let`/`for(;;)`; it also references `LineIO` without defining it | W2-01b.md D9 (quoted above); probe: tsc `TS2304 Cannot find name 'LineIO'`; eslint 5 warnings (complexity 6, let, 3× for) | replace the block with the real W2-01b D9 code (Turn/Screen/LineIO + `step`/`writeAll`/`runScreen`), or keep only the Turn/Screen interfaces and name the file |
| 8 | med | T (TESTS L144-145; row test cell) | the row's test cell lists "`a` → result accept" but the brief drops it, citing "W2-13a's flow test (scenario 1: resolve-confirm `a` → boundary)" — W2-13a's test set does not exist yet (wave-2 § Execute: "written by a TESTS-ONLY 27B run from C7–C14 before W2-13 exists"), the wave file names no such scenario, so the justification is unverifiable (E: memory is no source) and the drop carries no `(FLOW)` mark (REFINE item 6) | L144-145 quoted; wave-2 § Execute quoted; 01-writer-brief.md REFINE item 6 | restore the case as T4: `screen.start.next(state, 'a').result` toEqual `{ kind: 'accept' }` (fixes finding 2's count at the same time; FINAL REPORT "T2 … T4") |
| 9 | med | FILES L13-14, S1 L17, D lines L42-88, TESTS L101 | paths are package-relative (`src/screens/resolve-confirm.ts`) while REFINE item 2 requires repo-relative, the row's FILES cell is `tools/dpf/src/…`, and the SAME file appears with the full path in STEP 2 (L152) and STEP 5 (L157) — mixed convention; the writer "run every command from the repo root" (L2), so `Write src/screens/…` lands at the repo root | FILES L13 vs STEP 5 L157 `npx eslint --quiet tools/dpf/src/screens/resolve-confirm.ts …`; exemplar W2-04 FILES `tools/dpf/src/run/runner.ts` | make FILES/S1/D/TESTS paths repo-relative (`tools/dpf/src/screens/resolve-confirm.ts`, `tools/dpf/tests/screens/resolve-confirm.test.ts`) |
| 10 | med | D3 L76-87 | dropping the LAST goal is unhandled: `d` on both fixture goals → walk-summary → `w` → `{ kind: 'edit', goals: [], nonGoals: [] }` → irSet `$.goals` = `[]` → `GoalsDocSchema` goals `.min(1)` refuses it → applyResolve throws (L97-98) after the walk was already "confirmed" — a cryptic failure on a reachable path; S3's `GoalsDoc` site is the one that carries the min(1) | resolution.ts:23 `goals: z.array(GoalEntrySchema).min(1).readonly()`; D3 L81-82 (no guard on `d`); D4 L97-98 "Throw an Error … when any ir result is not ok" | state the guard in D3: "d on the last remaining GOAL → re-prompt (ir requires at least one goal: GoalsDocSchema goals min 1)" (dropping all non-goals stays legal) |
| 11 | low | S8 L24 | the range `resolution.ts:171-176` misses `ResolutionIr` at line 177, which D2 L49 imports | resolution.ts:177 `export type ResolutionIr = Readonly<z.infer<typeof ResolutionIrSchema>>;` | S8 → `resolution.ts:171-177`, description "… ResolutionDoc/ResolutionIr types the screen takes" |
| 12 | low | D2 L72-75 / D3 L84-85 | dead state: `goalsChanged`/`nonGoalsChanged` are set (L85) but never read — D4 decides the second irSet by JSON.stringify (L95-96); `input.record` (L57) is unused by the screen (applyResolve takes `record` separately) | L73-75, L85, L95-96, L57 vs L91 | drop the two flags from the state (or let D4 read them), and say why `input.record` is carried (or drop it) — with finding 4's fix the state is only phase/index + the two accumulators |
| 13 | low | D2 L69-70 (C11 item 7) | the diffLines render ("7 each diffLines line verbatim") is untested (fixture `diffLines: undefined`, L130) and carries no `(FLOW)` mark (REFINE item 6); W2-13a's future flow test set is not known to cover it | L69-70 vs L130; 01-writer-brief.md REFINE item 6 | mark it `(FLOW)` with the W2-13a scenario named, or add a one-line assertion with a second input carrying `diffLines: ['d']` → `out` contains `'d'` |
| 14 | low | DO NOT L163 | the second fixed DO NOT line deviates from the template: it adds "helpers" to the ban list and drops the escape clause — template (W2-04 L165-166): "add options, comments or docs that are not in DELIVERABLES, or a helper beyond the ones it names — unless the lint limits need one: then name it on its D line in the FINAL REPORT" | W2-08 L163 "add options, helpers, comments or docs that are not in DELIVERABLES" vs W2-04 L165-166 | restore the template's fixed text |
| 15 | low | STEPS 3 L154 | "one Edit per site" for two NEW files — the template/W2-04 wording is "one Write per new file" | W2-08 L154 vs W2-04 L156 "Do D1-D2 in this order, one Write per new file." | "Do D1-D4 in this order, one Write per new file." |

