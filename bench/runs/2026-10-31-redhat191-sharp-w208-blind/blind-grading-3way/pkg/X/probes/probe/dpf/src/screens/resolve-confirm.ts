// PROBE-ONLY assembly of W2-08 brief blocks D1 + D2 + D4 (imports sorted; sketch signatures
// get stub bodies; the prose ResolveState becomes an interface). Lines that read the result
// (import specifiers, types, signatures) are verbatim from the brief.
import { cpSync } from 'node:fs';

import { type PausePayload } from 'spec-pipeline/protocol';
import { type GoalsDoc, type GoalEntry, type NonGoalEntry, type ResolutionIr } from '../../../shared/ir/resolution.js';
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

interface ResolveState {
  phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary';
  index: number;
  goals: readonly GoalEntry[];
  nonGoals: readonly NonGoalEntry[];
  goalsChanged: boolean;
  nonGoalsChanged: boolean;
}

export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> => {
  void input;
  throw new Error('PROBE-ONLY stub: D2/D3 bodies are prose in the brief');
};

export const applyResolve = (
  result: ResolveResult,
  record: PausePayload,
  originalGoals: GoalsDoc,
  cli: readonly string[]
): Promise<void> => {
  void cpSync; void irSet; void irValidate; void result; void record; void originalGoals; void cli;
  return Promise.resolve();
};
