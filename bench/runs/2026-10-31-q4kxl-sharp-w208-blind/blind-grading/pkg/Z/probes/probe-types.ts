// PROBE-ONLY: W2-08 brief D2/D4 + TESTS fixture, types checked against the real
// tools/shared/ir/resolution.ts at HEAD de110510.
// PausePayload + GateDrop are stubs (spec-pipeline/protocol is W2-01's, not at HEAD);
// the stubs copy pause.ts:15-40 and capability.ts:15-19 verbatim except stepType: string.
import type {
  ResolutionIr,
  GoalsDoc,
  GoalEntry,
  NonGoalEntry,
} from '../../..<WT>/tools/shared/ir/resolution.js';

// -- stub of PausePayload (tools/spec-pipeline/src/driver/pause.ts:15-40) --
interface GateDrop {
  readonly gateId: string;
  readonly reason: 'unregistered' | 'capability-unmet';
  readonly missingCapabilities: readonly string[];
}
interface PausePayload {
  readonly runId: string;
  readonly runFingerprint: string;
  readonly epochId: string | undefined;
  readonly stepId: string;
  readonly stepType: string;
  readonly role: string | undefined;
  readonly modelProfile: string | undefined;
  readonly outputSchemaRef: string | undefined;
  readonly inputs: Record<string, string>;
  readonly outputs: readonly string[];
  readonly critics: readonly string[] | undefined;
  readonly reviser: string | undefined;
  readonly maxRounds: number | undefined;
  readonly gatesEachRound: readonly string[] | undefined;
  readonly droppedGates: readonly GateDrop[] | undefined;
}
// -- end stub --

// D2: the brief's imports + interfaces, verbatim shape
interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }

export interface ResolveConfirmInput {
  readonly resolution: ResolutionIr;
  readonly goals: GoalsDoc;
  readonly cuts: readonly string[];
  readonly diffLines: readonly string[] | undefined;
  readonly record: PausePayload;
}
export type ResolveResult =
  | { readonly kind: 'accept' }
  | { readonly kind: 'edit'; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] }
  | { readonly kind: 'correction' }
  | { readonly kind: 'quit' };

export interface ResolveState {
  readonly phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary';
  readonly index: number;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
  readonly goalsChanged: boolean;
  readonly nonGoalsChanged: boolean;
}
export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> =>
  ({ start: { state: { phase: 'main', index: 0, goals: input.goals.goals, nonGoals: input.goals.nonGoals, goalsChanged: false, nonGoalsChanged: false }, out: [] }, next: () => { throw new Error('probe'); } });

// D4: the brief's signature (4 params)
export const applyResolve = (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]): Promise<void> =>
  Promise.resolve(undefined).then(() => { void result.kind; void record.runId; void originalGoals.goals.length; void cli.length; });

// TESTS: the brief's fixture, verbatim values
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

// T3 call shape (post-fix object param would differ; probe the brief as written)
void screen;
void applyResolve({ kind: 'edit', goals: [{ id: 'G-1', text: 'store', source: 'resolve' }, { id: 'G-2', text: 'new text', source: 'resolve-confirm' }], nonGoals: [] }, record, goals, ['node', 'fake']);
