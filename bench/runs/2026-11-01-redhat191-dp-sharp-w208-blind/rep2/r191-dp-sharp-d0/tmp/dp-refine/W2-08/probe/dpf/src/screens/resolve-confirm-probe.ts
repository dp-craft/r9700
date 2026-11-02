// PROBE-ONLY: W2-08 brief D1+D2+D4 code, verbatim (import lines in the brief's order).
// The brief's signature lines are type specs; they are materialised here with PROBE-ONLY bodies.
import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type Screen } from '../ui/screen.js';

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
  readonly phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary';
  readonly index: number;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
  readonly goalsChanged: boolean;
  readonly nonGoalsChanged: boolean;
}

export function resolveConfirmScreen(input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> {
  throw new Error('PROBE-ONLY');
}

import { cpSync } from 'node:fs';
import { irSet, irValidate } from '../run/ir.js';

export function applyResolve(result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]): Promise<void> {
  throw new Error('PROBE-ONLY');
}

// PROBE-ONLY sink: keep the brief's imported names referenced, as the screen uses them.
const _probe: readonly unknown[] = [cpSync, irSet, irValidate, RESOLVE_CONFIRM_SOURCE];
void _probe;
