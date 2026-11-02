// PROBE-ONLY: W2-08 brief TESTS fixture, verbatim (import lines in the brief's order).
import { type ResolutionIr, type GoalsDoc } from '../../../shared/ir/resolution.js';
const resolution: ResolutionIr = {
  schemaVersion: 1,
  shape: 'feature',
  mapping: [
    { noun: 'auth', surfaceId: 'S-1', kind: 'module', path: 'src/auth', evidence: 'e' },
    { noun: 'ui', surfaceId: null, kind: 'unknown', path: null, evidence: 'e' },
  ],
  drift: [
    { id: 'D-1', snapshotSays: 's', codeSays: 'c', status: 'unclear', notes: 'n' },
    { id: 'D-2', snapshotSays: 's', codeSays: 'c', status: 'matches', notes: 'n' },
  ],
  blastRadius: ['src'],
  generatedAt: '2026-01-01T00:00:00.000Z',
  branch: '900-x',
};
const goals: GoalsDoc = {
  schemaVersion: 1,
  goals: [{ id: 'G-1', text: 'store', source: 'resolve' }, { id: 'G-2', text: 'old', source: 'resolve' }],
  nonGoals: [],
};
const record: PausePayload = {
  runId: 'r1', runFingerprint: 'f', epochId: undefined, stepId: 'resolve-confirm', stepType: 'human',
  role: undefined, modelProfile: undefined, outputSchemaRef: undefined,
  inputs: { resolution: '/r/resolution.json', goals: '/r/goals.json', template: '/p/confirm.template.json' },
  outputs: ['/p/confirmed.json'],
  critics: undefined, reviser: undefined, maxRounds: undefined, gatesEachRound: undefined, droppedGates: undefined,
};
const input: ResolveConfirmInput = { resolution, goals, cuts: ['cut text'], diffLines: undefined, record };
const screen = resolveConfirmScreen(input);
import { type PausePayload } from 'spec-pipeline/protocol';
import { resolveConfirmScreen, applyResolve, type ResolveConfirmInput } from '../src/screens/resolve-confirm.js';

// PROBE-ONLY sink: keep the fixture's names referenced, as T1-T3 read them.
const _probe: readonly unknown[] = [screen, applyResolve];
void _probe;
