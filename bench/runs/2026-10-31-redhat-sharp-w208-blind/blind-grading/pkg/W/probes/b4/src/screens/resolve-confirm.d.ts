// PROBE-ONLY stub: the module W2-08 creates (src/screens/resolve-confirm.ts), with the brief's
// own D2/D4 signatures, so the test fixture's imports resolve. Stands in for '../../src/...'
// (the corrected path); the brief's '../src/...' path is what the probe deliberately does NOT resolve.
import { type GoalsDoc, type GoalEntry, type NonGoalEntry, type ResolutionIr } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type Screen } from '../../ui/screen.js';

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

export const resolveConfirmScreen: (input: ResolveConfirmInput) => Screen<unknown, ResolveResult>;
export const applyResolve: (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]) => Promise<void>;
