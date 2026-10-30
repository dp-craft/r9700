// PROBE-ONLY — full W2-08 implementation (lint-clean design). Predecessor symbols stubbed inline.
// tsc --noEmit --strict --target ES2023 --lib ES2023 --module esnext --moduleResolution bundler --types node

// ---- stubs for predecessors (W2-01/W2-01b/W2-02/W2-05/W2-04) ----
type Screen<S, R> = { readonly start: { readonly state: S; readonly out: readonly string[]; readonly result?: R }; readonly next: (s: S, l: string) => { readonly state: S; readonly out: readonly string[]; readonly result?: R } };
type PausePayload = {
  readonly runId: string; readonly runFingerprint: string; readonly epochId: string | undefined;
  readonly stepId: string; readonly stepType: string; readonly role: string | undefined;
  readonly modelProfile: string | undefined; readonly outputSchemaRef: string | undefined;
  readonly inputs: Readonly<Record<string, string>>; readonly outputs: readonly string[];
  readonly critics: readonly string[] | undefined; readonly reviser: string | undefined;
  readonly maxRounds: number | undefined; readonly gatesEachRound: readonly string[] | undefined;
  readonly droppedGates: readonly string[] | undefined;
};
interface ResidueEntryStub { readonly anchor: { readonly jsonPath: string }; readonly text: string }
const ResidueEntrySchema = { safeParse: (v: unknown): { success: boolean; data: ResidueEntryStub } => ({ success: true, data: v as ResidueEntryStub }) };
interface ResidueRow { readonly runId: string | undefined; readonly stage: string | undefined; readonly entry: unknown }
interface ResolutionIrStub { readonly shape: string; readonly mapping: readonly { readonly noun: string; readonly kind: string; readonly path: string | null }[]; readonly drift: readonly { readonly id: string; readonly status: string }[]; readonly blastRadius: readonly string[] }
interface GoalsDocStub { readonly schemaVersion: number; readonly goals: readonly GoalEntryStub[]; readonly nonGoals: readonly NonGoalEntryStub[] }
interface GoalEntryStub { readonly id: string; readonly text: string; readonly source: string }
interface NonGoalEntryStub { readonly id: string; readonly text: string; readonly source: string }
type IrResult = { readonly ok: true } | { readonly ok: false; readonly file: string; readonly findings: string | undefined; readonly error: string | undefined };
const irSet = (_o: { cli: readonly string[]; kind: string; file: string; path: string; value: unknown }): Promise<IrResult> => Promise.resolve({ ok: true });
const irValidate = (_o: { cli: readonly string[]; kind: string; file: string }): Promise<IrResult> => Promise.resolve({ ok: true });
import { cpSync } from 'node:fs';
// ---- end stubs ----

// ---- W2-08 implementation (real, lint-clean design) ----
const RESOLVE_CONFIRM_SOURCE = 'resolve-confirm';
const MAIN_PROMPT = 'a to accept, g to edit goals, c to correct, q to quit';
const TEXT_PROMPT = 'new text:';
const SUMMARY_PROMPT = 'goals updated (w to keep, q to abort)';
const NO_GOAL = 'keep at least one goal (q to abort)';
const CUT_STAGE = 'spec-a-resolve';
const CUT_ANCHOR = '$.sections.request-docs';

export interface ResolveConfirmInput {
  readonly resolution: ResolutionIrStub;
  readonly goals: GoalsDocStub;
  readonly cuts: readonly string[];
  readonly diffLines: readonly string[] | undefined;
}
export interface GoalWrite { readonly path: '$.goals' | '$.nonGoals'; readonly value: readonly (GoalEntryStub | NonGoalEntryStub)[] }
export type ResolveResult =
  | { readonly kind: 'accept'; readonly writes: readonly GoalWrite[] }
  | { readonly kind: 'correction' }
  | { readonly kind: 'quit' };
type Phase = 'main' | 'walk' | 'replace-wait' | 'walk-summary';
export interface ResolveState {
  readonly phase: Phase;
  readonly index: number;
  readonly goals: readonly GoalEntryStub[];
  readonly nonGoals: readonly NonGoalEntryStub[];
  readonly walkedGoals: readonly GoalEntryStub[];
  readonly walkedNonGoals: readonly NonGoalEntryStub[];
  readonly writes: readonly GoalWrite[];
}

type Turn = { readonly state: ResolveState; readonly out: readonly string[]; readonly result?: ResolveResult };
type EntryStub = GoalEntryStub | NonGoalEntryStub;

const firstWhere = <T>(rows: readonly T[], first: (row: T) => boolean): readonly T[] => [
  ...rows.filter(first),
  ...rows.filter(row => !first(row)),
];

const mainLines = (input: ResolveConfirmInput, state: ResolveState): readonly string[] => [
  `shape: ${input.resolution.shape}`,
  ...firstWhere(input.resolution.mapping, row => row.kind === 'unknown').map(row =>
    row.path === null ? `${row.noun}: ${row.kind}` : `${row.noun}: ${row.kind} ${row.path}`
  ),
  ...firstWhere(input.resolution.drift, row => row.status === 'unclear').map(row => `${row.id}: ${row.status}`),
  `blast: ${input.resolution.blastRadius.join(', ')}`,
  ...state.goals.map(entry => `${entry.id}: ${entry.text}`),
  ...state.nonGoals.map(entry => `${entry.id}: ${entry.text}`),
  ...input.cuts.map(cut => `cut: ${cut}`),
  ...(input.diffLines ?? []),
  MAIN_PROMPT,
];

const initialState = (input: ResolveConfirmInput): ResolveState => ({
  phase: 'main', index: 0, goals: input.goals.goals, nonGoals: input.goals.nonGoals, walkedGoals: [], walkedNonGoals: [], writes: [],
});

const toMain = (input: ResolveConfirmInput, state: ResolveState): Turn => ({
  state: { ...state, phase: 'main', index: 0, walkedGoals: [], walkedNonGoals: [] },
  out: mainLines(input, state),
});

const walkPrompt = (entry: { id: string; text: string }): string => `${entry.id}: ${entry.text} (Enter keep, r replace, d drop)`;

const entriesOf = (state: ResolveState): readonly EntryStub[] => [...state.goals, ...state.nonGoals];

const walkTurn = (state: ResolveState): Turn => {
  const next = entriesOf(state)[state.index];
  return next === undefined
    ? { state: { ...state, phase: 'walk-summary' }, out: [SUMMARY_PROMPT] }
    : { state: { ...state, phase: 'walk' }, out: [walkPrompt(next)] };
};

const appendEntry = (state: ResolveState, entry: EntryStub): { goals: readonly GoalEntryStub[]; nonGoals: readonly NonGoalEntryStub[] } =>
  state.index < state.goals.length
    ? { goals: [...state.walkedGoals, entry as GoalEntryStub], nonGoals: state.walkedNonGoals }
    : { goals: state.walkedGoals, nonGoals: [...state.walkedNonGoals, entry as NonGoalEntryStub] };

const advance = (state: ResolveState, keep: EntryStub | undefined): Turn => {
  const walked = keep === undefined ? { goals: state.walkedGoals, nonGoals: state.walkedNonGoals } : appendEntry(state, keep);
  return walkTurn({ ...state, index: state.index + 1, walkedGoals: walked.goals, walkedNonGoals: walked.nonGoals });
};

const mainNext = (input: ResolveConfirmInput, state: ResolveState, line: string): Turn => {
  const keys: Readonly<Partial<Record<string, () => Turn>>> = {
    g: () => walkTurn({ ...state, index: 0, walkedGoals: [], walkedNonGoals: [] }),
    a: () => ({ state, out: [], result: { kind: 'accept', writes: state.writes } }),
    c: () => ({ state, out: [], result: { kind: 'correction' } }),
    q: () => ({ state, out: [], result: { kind: 'quit' } }),
  };
  const handler = keys[line];
  return handler === undefined ? toMain(input, state) : handler();
};

const walkNext = (state: ResolveState, line: string): Turn => {
  const entry = entriesOf(state)[state.index];
  if (line === 'd') return advance(state, undefined);
  if (line === '') return advance(state, entry);
  if (line === 'r') return { state: { ...state, phase: 'replace-wait' }, out: [TEXT_PROMPT] };
  return walkTurn(state);
};

const textNext = (state: ResolveState, line: string): Turn => {
  const entry = entriesOf(state)[state.index];
  const text = line.trim();
  if (text === '') return { state, out: [TEXT_PROMPT] };
  return advance(state, { id: entry.id, text, source: RESOLVE_CONFIRM_SOURCE });
};

const changed = (before: readonly EntryStub[], after: readonly EntryStub[]): boolean =>
  JSON.stringify(before) !== JSON.stringify(after);

const writesOf = (input: ResolveConfirmInput, goals: readonly GoalEntryStub[], nonGoals: readonly NonGoalEntryStub[]): readonly GoalWrite[] => [
  { path: '$.goals', value: goals },
  ...(changed(input.goals.nonGoals, nonGoals) ? [{ path: '$.nonGoals' as const, value: nonGoals }] : []),
];

const summaryNext = (input: ResolveConfirmInput, state: ResolveState, line: string): Turn => {
  if (line === 'q') return toMain(input, state);
  if (line !== 'w') return { state, out: [SUMMARY_PROMPT] };
  const edited = { goals: state.walkedGoals, nonGoals: state.walkedNonGoals };
  if (edited.goals.length === 0) return { state, out: [NO_GOAL] };
  return toMain(input, { ...state, goals: edited.goals, nonGoals: edited.nonGoals, writes: writesOf(input, edited.goals, edited.nonGoals) });
};

export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> => {
  const start = initialState(input);
  return {
    start: { state: start, out: mainLines(input, start) },
    next: (state, line) => {
      const phases: Readonly<Record<Phase, () => Turn>> = {
        main: () => mainNext(input, state, line),
        walk: () => walkNext(state, line),
        'replace-wait': () => textNext(state, line),
        'walk-summary': () => summaryNext(input, state, line),
      };
      return phases[state.phase]();
    },
  };
};

const assertOk = (result: IrResult): void => {
  if (!result.ok) throw new Error(`ir refused ${result.file}: ${result.findings ?? result.error ?? ''}`);
};

const applyWrites = (writes: readonly GoalWrite[], file: string, cli: readonly string[]): Promise<void> =>
  writes.reduce(
    (chain: Promise<void>, write: GoalWrite) => chain.then(() => irSet({ cli, kind: 'goals', file, path: write.path, value: write.value })).then(assertOk),
    Promise.resolve()
  );

export const applyResolve = async (result: ResolveResult, record: PausePayload, cli: readonly string[]): Promise<void> => {
  if (result.kind !== 'accept') return;
  const file = record.inputs.goals;
  await applyWrites(result.writes, file, cli);
  const validateResult = await irValidate({ cli, kind: 'goals', file });
  assertOk(validateResult);
  cpSync(record.inputs.template, record.outputs[0]);
};

export const resolveCuts = (rows: readonly ResidueRow[], runId: string): readonly string[] =>
  rows
    .filter(row => row.runId === runId && row.stage === CUT_STAGE)
    .map(row => ResidueEntrySchema.safeParse(row.entry))
    .flatMap(parsed => (parsed.success && parsed.data.anchor.jsonPath === CUT_ANCHOR ? [parsed.data.text] : []));
// ---- end W2-08 implementation ----
