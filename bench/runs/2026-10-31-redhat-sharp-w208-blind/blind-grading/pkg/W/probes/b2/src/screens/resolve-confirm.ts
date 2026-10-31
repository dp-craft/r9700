// PROBE-ONLY header: brief W2-08 D2 block (lines 48-64) verbatim below.
// PROBE-ONLY ResolveState stub: the state is specified in prose (brief lines 72-75), not in the
// code block; stubbed here so the rest of the block typechecks.
// PROBE-ONLY body: the brief's signature line is the plan's export-specification shorthand
// (no arrow body); a throwing body is supplied so the signature typechecks.
import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type Screen } from '../ui/screen.js';
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
export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> => { void input; throw new Error('PROBE-ONLY'); };
interface ResolveState {
  readonly phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary';
  readonly index: number;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
  readonly goalsChanged: boolean;
  readonly nonGoalsChanged: boolean;
}
