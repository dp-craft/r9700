// PROBE-ONLY: the complete test file W2-08's TESTS blocks compose to (T1-T10).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type PausePayload } from 'spec-pipeline/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type GoalsDoc, type ResolutionIr } from '../../../shared/ir/resolution.js';
import { applyResolve, type ResolveConfirmInput, resolveConfirmScreen, resolveCuts } from '../../src/screens/resolve-confirm.js';

const FAKE = fileURLToPath(new URL('../fixtures/fake-spec-pipeline.mjs', import.meta.url));
const G1 = { id: 'G-1', text: 'store', source: 'resolve' };
const G2 = { id: 'G-2', text: 'old', source: 'resolve' };
const NG1 = { id: 'NG-1', text: 'no sync', source: 'resolve' };
const resolution: ResolutionIr = {
  schemaVersion: 1,
  shape: 'feature',
  mapping: [
    { noun: 'auth', surfaceId: 'S-1', kind: 'module', path: 'src/auth', evidence: 'e' },
    { noun: 'ui', surfaceId: null, kind: 'unknown', path: null, evidence: 'e' },
  ],
  drift: [
    { id: 'D-1', snapshotSays: 's', codeSays: 'c', status: 'matches', notes: 'n' },
    { id: 'D-2', snapshotSays: 's', codeSays: 'c', status: 'unclear', notes: 'n' },
  ],
  blastRadius: ['src/auth', 'src/ui'],
  generatedAt: '2026-01-01T00:00:00.000Z',
  branch: '900-x',
};
const goals: GoalsDoc = { schemaVersion: 1, goals: [G1, G2], nonGoals: [NG1] };
const input: ResolveConfirmInput = { resolution, goals, cuts: ['cut text'], diffLines: ['- G-2: older'] };
const screen = resolveConfirmScreen(input);
const MAIN = [
  'shape: feature',
  'ui: unknown',
  'auth: module src/auth',
  'D-2: unclear',
  'D-1: matches',
  'blast: src/auth, src/ui',
  'G-1: store',
  'G-2: old',
  'NG-1: no sync',
  'cut: cut text',
  '- G-2: older',
  'a to accept, g to edit goals, c to correct, q to quit',
];

it('T1 the main content (C11 order)', () => {
  expect(screen.start.out).toEqual(MAIN);
});

it('T2 the main keys', () => {
  const start = screen.start;
  expect(screen.next(start.state, 'a').result).toEqual({ kind: 'accept', writes: [] });
  expect(screen.next(start.state, 'c').result).toEqual({ kind: 'correction' });
  expect(screen.next(start.state, 'q').result).toEqual({ kind: 'quit' });
  const x = screen.next(start.state, 'x');
  expect(x.out).toEqual(MAIN);
  expect(x.result).toBeUndefined();
});

it('T3 the g walk', () => {
  const t1 = screen.next(screen.start.state, 'g');
  expect(t1.out).toEqual(['G-1: store (Enter keep, r replace, d drop)']);
  const t2 = screen.next(t1.state, '');
  expect(t2.out).toEqual(['G-2: old (Enter keep, r replace, d drop)']);
  const t3 = screen.next(t2.state, 'r');
  expect(t3.out).toEqual(['new text:']);
  const t4 = screen.next(t3.state, '  ');
  expect(t4.out).toEqual(['new text:']);
  const t5 = screen.next(t4.state, 'new text');
  expect(t5.out).toEqual(['NG-1: no sync (Enter keep, r replace, d drop)']);
  const t6 = screen.next(t5.state, '');
  expect(t6.out).toEqual(['goals updated (w to write, q to abort)']);
  const t7 = screen.next(t6.state, 'w');
  expect(t7.out).toEqual(MAIN.map(l => (l === 'G-2: old' ? 'G-2: new text' : l)));
});

it('T4 the walk result: one $.goals write', () => {
  const t = ['g', '', 'r', '  ', 'new text', '', 'w', 'a']
    .reduce((turn, line) => screen.next(turn.state, line), screen.start);
  expect(t.result).toEqual({
    kind: 'accept',
    writes: [{ path: '$.goals', value: [G1, { id: 'G-2', text: 'new text', source: 'resolve-confirm' }] }],
  });
});

it('T5 dropping NG-1 writes $.nonGoals too', () => {
  const t = ['g', '', '', 'd', 'w', 'a']
    .reduce((turn, line) => screen.next(turn.state, line), screen.start);
  expect(t.result).toEqual({
    kind: 'accept',
    writes: [{ path: '$.goals', value: [G1, G2] }, { path: '$.nonGoals', value: [] }],
  });
});

it('T6 dropping every goal: no write, q drops the walk', () => {
  const turns = ['g', 'd', 'd', '', 'w', 'q', 'a'].reduce(
    (acc, line) => [...acc, screen.next(acc[acc.length - 1].state, line)],
    [screen.start]
  );
  expect(turns[5].out).toEqual(['every goal was dropped: keep or replace at least one (q to drop the edits)']);
  expect(turns[6].out).toEqual(MAIN);
  expect(turns[7].result).toEqual({ kind: 'accept', writes: [] });
});

describe('applyResolve (D4)', () => {
  const cli = [process.execPath, FAKE];
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'w2-08-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FAKE_SP_PLAN;
    delete process.env.FAKE_SP_DIR;
  });

  const record = (template: string, out: string): PausePayload => ({
    runId: 'r1', runFingerprint: 'f', epochId: undefined, stepId: 'resolve-confirm', stepType: 'human',
    role: undefined, modelProfile: undefined, outputSchemaRef: undefined,
    inputs: { resolution: '/r/resolution.json', goals: '/r/goals.json', template },
    outputs: [out],
    critics: undefined, reviser: undefined, maxRounds: undefined, gatesEachRound: undefined, droppedGates: undefined,
  });

  const plan = (entries: readonly unknown[]) => {
    const planPath = join(dir, 'plan.json');
    writeFileSync(planPath, JSON.stringify(entries));
    process.env.FAKE_SP_PLAN = planPath;
    process.env.FAKE_SP_DIR = dir;
    return planPath;
  };

  const calls = (): string[][] => {
    const file = join(dir, 'calls.jsonl');
    return existsSync(file)
      ? readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l) as string[])
      : [];
  };

  it('T7 accept: the writes in order, then the template copy', async () => {
    const template = join(dir, 'confirm.template.json');
    writeFileSync(template, '{"ok": true}');
    plan([{ exit: 0 }, { exit: 0 }]);
    const out = join(dir, 'confirmed.json');
    await applyResolve(
      { kind: 'accept', writes: [{ path: '$.goals', value: [G1] }, { path: '$.nonGoals', value: [] }] },
      record(template, out),
      cli
    );
    expect(calls()).toEqual([
      ['ir', 'set', '--kind', 'goals', '--file', '/r/goals.json', '--path', '$.goals', '--value', expect.stringMatching(/^@/u)],
      ['ir', 'set', '--kind', 'goals', '--file', '/r/goals.json', '--path', '$.nonGoals', '--value', expect.stringMatching(/^@/u)],
    ]);
    expect(readFileSync(out)).toEqual(readFileSync(template));
  });

  it('T8 a refused write: no copy', async () => {
    const template = join(dir, 'confirm.template.json');
    writeFileSync(template, 't');
    plan([{ exit: 3, stdout: ['goals: id "G-1" is used more than once'] }]);
    const out = join(dir, 'confirmed.json');
    await expect(
      applyResolve({ kind: 'accept', writes: [{ path: '$.goals', value: [G1] }] }, record(template, out), cli)
    ).rejects.toThrow('ir refused /r/goals.json: goals: id "G-1" is used more than once');
    expect(existsSync(out)).toBe(false);
  });

  it('T9 correction and quit: no write, no copy', async () => {
    const template = join(dir, 'confirm.template.json');
    writeFileSync(template, 't');
    plan([]);
    const out = join(dir, 'confirmed.json');
    await applyResolve({ kind: 'correction' }, record(template, out), cli);
    await applyResolve({ kind: 'quit' }, record(template, out), cli);
    expect(calls()).toEqual([]);
    expect(existsSync(out)).toBe(false);
  });
});

it('T10 resolveCuts (D5)', () => {
  const entry = (jsonPath: string, text: string) => ({ class: 'bundle-over-cap', anchor: { artifact: 'spec', jsonPath }, findingIds: [], text });
  const rows = [
    { runId: 'r1', stage: 'spec-a-resolve', entry: entry('$.sections.request-docs', 'request documents left out whole: docs/a.md') },
    { runId: 'r0', stage: 'spec-a-resolve', entry: entry('$.sections.request-docs', 'older run') },
    { runId: 'r1', stage: 'other-stage', entry: entry('$.sections.request-docs', 'other stage') },
    { runId: 'r1', stage: 'spec-a-resolve', entry: entry('$.other', 'other anchor') },
    { runId: 'r1', stage: 'spec-a-resolve', entry: 'not json' },
  ];
  expect(resolveCuts(rows, 'r1')).toEqual(['request documents left out whole: docs/a.md']);
});
