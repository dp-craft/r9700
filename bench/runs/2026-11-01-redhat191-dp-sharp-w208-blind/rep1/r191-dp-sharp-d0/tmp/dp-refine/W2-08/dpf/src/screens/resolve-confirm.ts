// PROBE — briefs/W2-08.md D1 + D2 + D4 code blocks; signatures with PROBE-ONLY bodies
import { cpSync } from 'node:fs';

import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type Screen } from '../ui/screen.js';
import { irSet, irValidate } from '../run/ir.js';

export const RESOLVE_CONFIRM_SOURCE = 'resolve-confirm';

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

// PROBE-ONLY: ResolveState declared per D2's prose (the brief describes it, does not type it)
interface ResolveState {
  readonly phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary';
  readonly index: number;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
  readonly goalsChanged: boolean;
  readonly nonGoalsChanged: boolean;
}

export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> => {
  void input;
  throw new Error('PROBE-ONLY stub');
};

export const applyResolve = (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]): Promise<void> => {
  void result; void record; void originalGoals; void cli; void cpSync; void irSet; void irValidate;
  return Promise.resolve(); // PROBE-ONLY body
};
