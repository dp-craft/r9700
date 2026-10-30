// PROBE-ONLY: D4 applyResolve signature. Stub types for the new file.
import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../tools/shared/ir/resolution.js';

// PROBE-ONLY stubs (W2-01/W2-01b not done yet)
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

export type ResolveResult =
  | { readonly kind: 'accept' }
  | { readonly kind: 'edit'; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] }
  | { readonly kind: 'correction' }
  | { readonly kind: 'quit' };

export const applyResolve = (
  result: ResolveResult,
  record: PausePayload,
  originalGoals: GoalsDoc,
  cli: readonly string[],
): Promise<void> => {
  void result; void record; void originalGoals; void cli;
  return Promise.resolve();
};
