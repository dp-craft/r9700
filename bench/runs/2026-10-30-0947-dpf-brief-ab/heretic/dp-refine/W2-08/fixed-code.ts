   constants and types, and resolveCuts
import { cpSync } from 'node:fs';

import type { PausePayload } from 'spec-pipeline/protocol';

import { ResidueEntrySchema } from '../../../shared/ir/index.js';
import type { GoalEntry, NonGoalEntry, ResolutionIr } from '../../../shared/ir/resolution.js';
import type { ResidueRow } from '../follow/ledger.js';
import { type IrResult, irSet } from '../run/ir.js';
import type { Screen, Turn } from '../ui/screen.js';

export const RESOLVE_CONFIRM_SOURCE = 'resolve-confirm';

const MAIN_PROMPT = 'a to accept, g to edit goals, c to correct, q to quit';
const TEXT_PROMPT = 'new text:';
const SUMMARY_PROMPT = 'goals updated (w to keep the edits, q to drop them)';
const NO_GOAL = 'every goal was dropped: keep or replace at least one (q to drop the edits)';
const CUT_STAGE = 'spec-a-resolve';
const CUT_ANCHOR = '$.sections.request-docs';

export interface GoalLists {
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
}
export interface ResolveConfirmInput {
  readonly resolution: ResolutionIr;
  readonly goals: GoalLists;
  readonly cuts: readonly string[];
  readonly diffLines: readonly string[] | undefined;
}
export interface GoalWrite {
  readonly path: '$.goals' | '$.nonGoals';
  readonly value: readonly GoalEntry[];
}
export type ResolveResult =
  | { readonly kind: 'accept'; readonly writes: readonly GoalWrite[] }
  | { readonly kind: 'correction' }
  | { readonly kind: 'quit' };
type Phase = 'main' | 'walk' | 'text' | 'summary';
export interface ResolveState {
  readonly phase: Phase;
  readonly lists: GoalLists;
  readonly walked: readonly (GoalEntry | undefined)[];
  readonly writes: readonly GoalWrite[];
}
type ResolveTurn = Turn<ResolveState, ResolveResult>;

/** C11 item 6: this run's request-doc cuts, each residue entry's text. */
export const resolveCuts = (rows: readonly ResidueRow[], runId: string): readonly string[] =>
  rows
    .filter(row => row.runId === runId && row.stage === CUT_STAGE)
    .map(row => ResidueEntrySchema.safeParse(row.entry))
    .flatMap(parsed => (parsed.success && parsed.data.anchor.jsonPath === CUT_ANCHOR ? [parsed.data.text] : []));
const firstWhere = <T>(rows: readonly T[], first: (row: T) => boolean): readonly T[] => [
  ...rows.filter(first),
  ...rows.filter(row => !first(row)),
];
const mainLines = (input: ResolveConfirmInput, lists: GoalLists): readonly string[] => [
  `shape: ${input.resolution.shape}`,
  ...firstWhere(input.resolution.mapping, row => row.kind === 'unknown').map(row =>
    row.path === null ? `${row.noun}: ${row.kind}` : `${row.noun}: ${row.kind} ${row.path}`
  ),
  ...firstWhere(input.resolution.drift, row => row.status === 'unclear').map(row => `${row.id}: ${row.status}`),
  `blast: ${input.resolution.blastRadius.join(', ')}`,
  ...[...lists.goals, ...lists.nonGoals].map(entry => `${entry.id}: ${entry.text}`),
  ...input.cuts.map(cut => `cut: ${cut}`),
  ...(input.diffLines ?? []),
  MAIN_PROMPT,
];
const entriesOf = (lists: GoalLists): readonly GoalEntry[] => [...lists.goals, ...lists.nonGoals];
const walkPrompt = (entry: GoalEntry): string => `${entry.id}: ${entry.text} (Enter keep, r replace, d drop)`;
const changed = (before: readonly GoalEntry[], after: readonly GoalEntry[]): boolean =>
  JSON.stringify(before) !== JSON.stringify(after);
/** C11: `$.goals` is one write; `$.nonGoals` a second only when it changed. */
const writesOf = (before: GoalLists, after: GoalLists): readonly GoalWrite[] => [
  { path: '$.goals', value: after.goals },
  ...(changed(before.nonGoals, after.nonGoals) ? [{ path: '$.nonGoals' as const, value: after.nonGoals }] : []),
];
const listsOf = (lists: GoalLists, walked: readonly (GoalEntry | undefined)[]): GoalLists => ({
  goals: walked.slice(0, lists.goals.length).filter(entry => entry !== undefined),
  nonGoals: walked.slice(lists.goals.length).filter(entry => entry !== undefined),
});
const toMain = (input: ResolveConfirmInput, state: ResolveState): ResolveTurn => ({
  state: { ...state, phase: 'main', walked: [] },
  out: mainLines(input, state.lists),
});
const walkTurn = (state: ResolveState, walked: readonly (GoalEntry | undefined)[]): ResolveTurn => {
  const next = entriesOf(state.lists)[walked.length];
  return next === undefined
    ? { state: { ...state, phase: 'summary', walked }, out: [SUMMARY_PROMPT] }
    : { state: { ...state, phase: 'walk', walked }, out: [walkPrompt(next)] };
};
const advance = (state: ResolveState, decision: GoalEntry | undefined): ResolveTurn =>
  walkTurn(state, [...state.walked, decision]);
const MAIN_RESULTS: Readonly<Record<string, (state: ResolveState) => ResolveResult>> = {
  a: state => ({ kind: 'accept', writes: state.writes }),
  c: () => ({ kind: 'correction' }),
  q: () => ({ kind: 'quit' }),
};
const mainNext = (input: ResolveConfirmInput, state: ResolveState, line: string): ResolveTurn => {
  if (line === 'g') return walkTurn(state, []);
  const result = MAIN_RESULTS[line]?.(state);
  return result === undefined ? toMain(input, state) : { state, out: [], result };
};
const walkNext = (state: ResolveState, line: string): ResolveTurn => {
  const entry = entriesOf(state.lists)[state.walked.length];
  if (line === 'd') return advance(state, undefined);
  if (line === '') return advance(state, entry);
  return line === 'r' ? { state: { ...state, phase: 'text' }, out: [TEXT_PROMPT] } : { state, out: [walkPrompt(entry)] };
};
const textNext = (state: ResolveState, line: string): ResolveTurn => {
  const entry = entriesOf(state.lists)[state.walked.length];
  const text = line.trim();
  return text === ''
    ? { state, out: [TEXT_PROMPT] }
    : advance(state, { id: entry.id, text, source: RESOLVE_CONFIRM_SOURCE });
};
const summaryNext = (input: ResolveConfirmInput, state: ResolveState, line: string): ResolveTurn => {
  const edited = listsOf(state.lists, state.walked);
  if (line === 'q') return toMain(input, state);
  if (line !== 'w') return { state, out: [SUMMARY_PROMPT] };
  if (edited.goals.length === 0) return { state, out: [NO_GOAL] };
  return toMain(input, { ...state, lists: edited, writes: writesOf(input.goals, edited) });
};
export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> => ({
  start: { state: { phase: 'main', lists: input.goals, walked: [], writes: [] }, out: mainLines(input, input.goals) },
  next: (state, line) => {
    const phases: Readonly<Record<Phase, () => ResolveTurn>> = {
      main: () => mainNext(input, state, line),
      walk: () => walkNext(state, line),
      text: () => textNext(state, line),
      summary: () => summaryNext(input, state, line),
    };
    return phases[state.phase]();
  },
});
   `listsOf` builds the edited lists from them at `w` (no duplicates). A blank replace
   text asks again (GoalEntrySchema refuses empty text). Dropping every goal prints a
   line and stays (`.min(1)` refuses an empty goal set); `q` drops the edits. `w` keeps
   the edits and returns to the main content, which shows the edited goals; `a` returns
   `accept` carrying the writes.
