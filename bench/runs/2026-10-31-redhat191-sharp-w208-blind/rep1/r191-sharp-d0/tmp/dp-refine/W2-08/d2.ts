// PROBE-ONLY: D2 code block of briefs/W2-08.md. The three import lines are stubbed below
// (predecessor modules land in W2-01/W2-01b); the block's own code is verbatim.
// Stub for '../../../shared/ir/resolution.js' (real: tools/shared/ir/resolution.ts:171-177, z.infer shapes):
type GoalEntry = { readonly id: string; readonly text: string; readonly source: string };
type NonGoalEntry = { readonly id: string; readonly text: string; readonly source: string };
type GoalsDoc = { readonly schemaVersion: number; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] };
type ResolutionIr = {
  readonly schemaVersion: number;
  readonly shape: 'feature' | 'modification' | 'bug' | 'refactor';
  readonly mapping: readonly { readonly noun: string; readonly surfaceId: string | null; readonly kind: 'feature' | 'module' | 'entry-point' | 'unknown'; readonly path: string | null; readonly evidence: string }[];
  readonly drift: readonly { readonly id: string; readonly snapshotSays: string; readonly codeSays: string; readonly status: 'matches' | 'drift' | 'bug' | 'unclear' | 'new' | 'broken'; readonly notes: string | null }[];
  readonly blastRadius: readonly string[];
  readonly generatedAt: string;
  readonly branch: string;
};
// Stub for 'spec-pipeline/protocol' (lands in W2-01; real: tools/spec-pipeline/src/driver/pause.ts:15-40):
type PausePayload = { readonly runId: string; readonly runFingerprint: string; readonly epochId: string | undefined; readonly stepId: string; readonly stepType: string; readonly role: string | undefined; readonly modelProfile: string | undefined; readonly outputSchemaRef: string | undefined; readonly inputs: Readonly<Record<string, string>>; readonly outputs: readonly string[]; readonly critics: readonly string[] | undefined; readonly reviser: string | undefined; readonly maxRounds: number | undefined; readonly gatesEachRound: readonly string[] | undefined; readonly droppedGates: readonly unknown[] | undefined };
// Stub for '../ui/screen.js' (W2-01b src/ui/screen.ts D9):
type Turn<S, R> = { readonly state: S; readonly out: readonly string[]; readonly result?: R };
type Screen<S, R> = { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> };

// The D2 block, verbatim (import lines stubbed above):
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
export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult>;

// The D2 state type, from the deliverable prose:
interface ResolveState {
  readonly phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary';
  readonly index: number;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
  readonly goalsChanged: boolean;
  readonly nonGoalsChanged: boolean;
}
