// PROBE-ONLY: W2-08 D1 + D2 + D4 code blocks, in place at the real path.
import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type Screen } from '../ui/screen.js';
import { cpSync } from 'node:fs';
import { irSet, irValidate } from '../run/ir.js';

// D1
export const RESOLVE_CONFIRM_SOURCE = 'resolve-confirm';

// D2
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

// D2 signature (references ResolveState; the brief describes it in prose but never defines it).
export const resolveConfirmScreen: (input: ResolveConfirmInput) => Screen<ResolveState, ResolveResult> = (input) => {
  // PROBE-ONLY stub body
  const _unused = input;
  return {
    start: { state: { phase: 'main', index: 0, goals: [], nonGoals: [], goalsChanged: false, nonGoalsChanged: false }, out: [] },
    next: (state: ResolveState, line: string) => {
      const _unused2 = [state, line];
      return { state, out: [] };
    },
  };
};

// D4 signature (4 parameters).
export const applyResolve: (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]) => Promise<void> = (result, record, originalGoals, cli) => {
  // PROBE-ONLY stub body
  const _unused = [cpSync, irSet, irValidate, result, record, originalGoals, cli];
  return Promise.resolve();
};
