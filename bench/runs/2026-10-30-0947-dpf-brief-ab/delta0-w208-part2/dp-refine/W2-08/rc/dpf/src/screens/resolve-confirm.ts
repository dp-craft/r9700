// PROBE-ONLY: the complete file W2-08's brief blocks compose to (D1 const + D2 imports/types/
// screen + D3 walk + D4 applyResolve + D5 resolveCuts). Stubs stand in for W2-01b/W2-02/W2-05
// files and tools/shared (absent at base). No let/for/while (NO_IMPERATIVE_SYNTAX).
import { cpSync } from 'node:fs';

import { type PausePayload } from 'spec-pipeline/protocol';

import { type ResidueEntry, ResidueEntrySchema } from '../../../shared/ir/residue.js';
import { type GoalEntry, type GoalsDoc, type NonGoalEntry, type ResolutionIr } from '../../../shared/ir/resolution.js';
import { type ResidueRow } from '../follow/ledger.js';
import { irSet } from '../run/ir.js';
import { type Screen, type Turn } from '../ui/screen.js';

export const RESOLVE_CONFIRM_SOURCE = 'resolve-confirm';
const CUT_STAGE = 'spec-a-resolve';
const CUT_ANCHOR = '$.sections.request-docs';
const MAIN_PROMPT = 'a to accept, g to edit goals, c to correct, q to quit';
const WALK_SUMMARY_PROMPT = 'goals updated (w to write, q to abort)';
const NO_GOAL_LINE = 'every goal was dropped: keep or replace at least one (q to drop the edits)';

export interface ResolveConfirmInput {
  readonly resolution: ResolutionIr;
  readonly goals: GoalsDoc;
  readonly cuts: readonly string[];
  readonly diffLines: readonly string[] | undefined;
}
export type GoalWrite =
  | { readonly path: '$.goals'; readonly value: readonly GoalEntry[] }
  | { readonly path: '$.nonGoals'; readonly value: readonly NonGoalEntry[] };
export type ResolveResult =
  | { readonly kind: 'accept'; readonly writes: readonly GoalWrite[] }
  | { readonly kind: 'correction' }
  | { readonly kind: 'quit' };
interface ResolveState {
  readonly phase: 'main' | 'walk' | 'replace-wait' | 'walk-summary';
  readonly index: number;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
  readonly walked: readonly (GoalEntry | NonGoalEntry | undefined)[];
  readonly writes: readonly GoalWrite[];
}

export const resolveConfirmScreen = (input: ResolveConfirmInput): Screen<ResolveState, ResolveResult> => {
  const { resolution, goals, cuts, diffLines } = input;
  const total = goals.goals.length + goals.nonGoals.length;
  const entryAt = (index: number): GoalEntry | NonGoalEntry =>
    index < goals.goals.length ? goals.goals[index] : goals.nonGoals[index - goals.goals.length];
  const promptAt = (index: number): string => `${entryAt(index).id}: ${entryAt(index).text} (Enter keep, r replace, d drop)`;
  const mainOut = (state: ResolveState): readonly string[] => [
    `shape: ${resolution.shape}`,
    ...[...resolution.mapping]
      .sort((a, b) => Number(b.kind === 'unknown') - Number(a.kind === 'unknown'))
      .map(m => `${m.noun}: ${m.kind}${m.path === null ? '' : ` ${m.path}`}`),
    ...[...resolution.drift]
      .sort((a, b) => Number(b.status === 'unclear') - Number(a.status === 'unclear'))
      .map(d => `${d.id}: ${d.status}`),
    `blast: ${resolution.blastRadius.join(', ')}`,
    ...state.goals.map(g => `${g.id}: ${g.text}`),
    ...state.nonGoals.map(n => `${n.id}: ${n.text}`),
    ...cuts.map(c => `cut: ${c}`),
    ...(diffLines ?? []),
    MAIN_PROMPT,
  ];
  const initial: ResolveState = { phase: 'main', index: 0, goals: goals.goals, nonGoals: goals.nonGoals, walked: [], writes: [] };
  const rebuild = (state: ResolveState): Pick<ResolveState, 'goals' | 'nonGoals' | 'writes'> => {
    const newGoals = state.walked.slice(0, goals.goals.length).filter((e): e is GoalEntry => e !== undefined);
    const newNonGoals = state.walked.slice(goals.goals.length).filter((e): e is NonGoalEntry => e !== undefined);
    const writes: GoalWrite[] = [{ path: '$.goals', value: newGoals }];
    if (JSON.stringify(newNonGoals) !== JSON.stringify(goals.nonGoals)) writes.push({ path: '$.nonGoals', value: newNonGoals });
    return { goals: newGoals, nonGoals: newNonGoals, writes };
  };
  const doneFor = (line: string): ResolveResult | undefined =>
    line === 'c' ? { kind: 'correction' } : line === 'q' ? { kind: 'quit' } : undefined;
  const mainNext = (state: ResolveState, line: string): Turn<ResolveState, ResolveResult> => {
    if (line === 'g') return { state: { ...state, phase: 'walk', index: 0, walked: [] }, out: [promptAt(0)] };
    if (line === 'a') return { state, out: [], result: { kind: 'accept', writes: state.writes } };
    const done = doneFor(line);
    if (done !== undefined) return { state, out: [], result: done };
    return { state, out: mainOut(state) };
  };
  const walkNext = (state: ResolveState, line: string): Turn<ResolveState, ResolveResult> => {
    const advance = (decision: GoalEntry | NonGoalEntry | undefined): Turn<ResolveState, ResolveResult> => {
      const nextIndex = state.index + 1;
      const nextPhase = nextIndex >= total ? 'walk-summary' as const : 'walk' as const;
      return {
        state: { ...state, phase: nextPhase, index: nextIndex, walked: [...state.walked, decision] },
        out: nextPhase === 'walk-summary' ? [WALK_SUMMARY_PROMPT] : [promptAt(nextIndex)],
      };
    };
    if (line === '') return advance(entryAt(state.index));
    if (line === 'r') return { state: { ...state, phase: 'replace-wait' }, out: ['new text:'] };
    if (line === 'd') return advance(undefined);
    return { state, out: [promptAt(state.index)] };
  };
  const replaceNext = (state: ResolveState, line: string): Turn<ResolveState, ResolveResult> => {
    const trimmed = line.trim();
    if (trimmed === '') return { state, out: ['new text:'] };
    const replaced: GoalEntry | NonGoalEntry = { ...entryAt(state.index), text: trimmed, source: RESOLVE_CONFIRM_SOURCE };
    const nextIndex = state.index + 1;
    const nextPhase = nextIndex >= total ? 'walk-summary' as const : 'walk' as const;
    return {
      state: { ...state, phase: nextPhase, index: nextIndex, walked: [...state.walked, replaced] },
      out: nextPhase === 'walk-summary' ? [WALK_SUMMARY_PROMPT] : [promptAt(nextIndex)],
    };
  };
  const summaryNext = (state: ResolveState, line: string): Turn<ResolveState, ResolveResult> => {
    if (line === 'w') {
      const rebuilt = rebuild(state);
      if (rebuilt.goals.length === 0) return { state, out: [NO_GOAL_LINE] };
      const next: ResolveState = { ...state, ...rebuilt, phase: 'main' };
      return { state: next, out: mainOut(next) };
    }
    if (line === 'q') {
      const next: ResolveState = { ...state, phase: 'main', walked: [] };
      return { state: next, out: mainOut(next) };
    }
    return { state, out: [WALK_SUMMARY_PROMPT] };
  };
  const next = (state: ResolveState, line: string): Turn<ResolveState, ResolveResult> =>
    state.phase === 'main' ? mainNext(state, line)
      : state.phase === 'walk' ? walkNext(state, line)
        : state.phase === 'replace-wait' ? replaceNext(state, line)
          : summaryNext(state, line);
  return { start: { state: initial, out: mainOut(initial) }, next };
};

export const applyResolve = async (
  result: ResolveResult,
  record: PausePayload,
  cli: readonly string[]
): Promise<void> => {
  if (result.kind !== 'accept') return;
  const runWrite = async (write: GoalWrite): Promise<void> => {
    const r = await irSet({ cli, kind: 'goals', file: record.inputs.goals, path: write.path, value: write.value });
    if (!r.ok) {
      throw new Error(
        r.findings !== undefined
          ? `ir refused ${record.inputs.goals}: ${r.findings}`
          : `ir error ${record.inputs.goals}: ${r.error}`
      );
    }
  };
  await result.writes.reduce((chain, write) => chain.then(() => runWrite(write)), Promise.resolve());
  cpSync(record.inputs.template, record.outputs[0]);
};

const inCutStage = (row: ResidueRow, runId: string): boolean => row.runId === runId && row.stage === CUT_STAGE;
const cutEntry = (row: ResidueRow): ResidueEntry | undefined => {
  const parsed = ResidueEntrySchema.safeParse(row.entry);
  if (!parsed.success) return undefined;
  return parsed.data.anchor.jsonPath === CUT_ANCHOR ? parsed.data : undefined;
};
export const resolveCuts = (rows: readonly ResidueRow[], runId: string): readonly string[] =>
  rows.filter(row => inCutStage(row, runId)).map(row => cutEntry(row)).filter((e): e is ResidueEntry => e !== undefined).map(e => e.text);
