// PROBE-ONLY: TESTS fixture block of briefs/W2-08.md, verbatim (lines 103-131); import lines
// (102, 132-133) probed separately in tests-imports.ts (eslint) and stubbed here for tsc.
// Stub for '../../../shared/ir/resolution.js' (real: tools/shared/ir/resolution.ts, z.infer shapes):
type GoalEntry = { readonly id: string; readonly text: string; readonly source: string };
type NonGoalEntry = { readonly id: string; readonly text: string; readonly source: string };
type GoalsDoc = { readonly schemaVersion: number; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] };
type MappingEntry = { readonly noun: string; readonly surfaceId: string | null; readonly kind: 'feature' | 'module' | 'entry-point' | 'unknown'; readonly path: string | null; readonly evidence: string };
type DriftEntry = { readonly id: string; readonly snapshotSays: string; readonly codeSays: string; readonly status: 'matches' | 'drift' | 'bug' | 'unclear' | 'new' | 'broken'; readonly notes: string | null };
type ResolutionIr = { readonly schemaVersion: number; readonly shape: 'feature' | 'modification' | 'bug' | 'refactor'; readonly mapping: readonly MappingEntry[]; readonly drift: readonly DriftEntry[]; readonly blastRadius: readonly string[]; readonly generatedAt: string; readonly branch: string };
// Stub for 'spec-pipeline/protocol' (lands in W2-01; real: tools/spec-pipeline/src/driver/pause.ts:15-40):
type PausePayload = { readonly runId: string; readonly runFingerprint: string; readonly epochId: string | undefined; readonly stepId: string; readonly stepType: 'script' | 'llm' | 'human' | 'loop'; readonly role: string | undefined; readonly modelProfile: string | undefined; readonly outputSchemaRef: string | undefined; readonly inputs: Readonly<Record<string, string>>; readonly outputs: readonly string[]; readonly critics: readonly string[] | undefined; readonly reviser: string | undefined; readonly maxRounds: number | undefined; readonly gatesEachRound: readonly string[] | undefined; readonly droppedGates: readonly unknown[] | undefined };
// Stub for this row's D2 (module lands in W2-08):
type ResolveConfirmInput = { readonly resolution: ResolutionIr; readonly goals: GoalsDoc; readonly cuts: readonly string[]; readonly diffLines: readonly string[] | undefined; readonly record: PausePayload };
const resolveConfirmScreen = (input: ResolveConfirmInput): { readonly start: { readonly out: readonly string[] } } => ({ start: { out: input.cuts } });
const applyResolve = (_result: { readonly kind: string }, _record: PausePayload, _originalGoals: GoalsDoc, _cli: readonly string[]): Promise<void> => Promise.resolve();

// The fixture block, verbatim (lines 103-131):
const resolution: ResolutionIr = {
  schemaVersion: 1,
  shape: 'feature',
  mapping: [
    { noun: 'auth', surfaceId: 'S-1', kind: 'module', path: 'src/auth', evidence: 'e' },
    { noun: 'ui', surfaceId: null, kind: 'unknown', path: null, evidence: 'e' },
  ],
  drift: [
    { id: 'D-1', snapshotSays: 's', codeSays: 'c', status: 'unclear', notes: 'n' },
    { id: 'D-2', snapshotSays: 's', codeSays: 'c', status: 'matches', notes: 'n' },
  ],
  blastRadius: ['src'],
  generatedAt: '2026-01-01T00:00:00.000Z',
  branch: '900-x',
};
const goals: GoalsDoc = {
  schemaVersion: 1,
  goals: [{ id: 'G-1', text: 'store', source: 'resolve' }, { id: 'G-2', text: 'old', source: 'resolve' }],
  nonGoals: [],
};
const record: PausePayload = {
  runId: 'r1', runFingerprint: 'f', epochId: undefined, stepId: 'resolve-confirm', stepType: 'human',
  role: undefined, modelProfile: undefined, outputSchemaRef: undefined,
  inputs: { resolution: '/r/resolution.json', goals: '/r/goals.json', template: '/p/confirm.template.json' },
  outputs: ['/p/confirmed.json'],
  critics: undefined, reviser: undefined, maxRounds: undefined, gatesEachRound: undefined, droppedGates: undefined,
};
const input: ResolveConfirmInput = { resolution, goals, cuts: ['cut text'], diffLines: undefined, record };
const screen = resolveConfirmScreen(input);

// Probe scaffolding (the block's consts are used by the T1-T3 tests, outside this block):
export const _probe = [resolution, goals, record, input, screen, applyResolve];
