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
