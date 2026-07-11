import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectPackets } from '../collect-packets';

let root: string;

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, JSON.stringify(value), 'utf8');
};

const seedWellFormed = async (dir: string): Promise<void> => {
  const runDir = join(dir, 'spec1-T001-1700000000000');
  await mkdir(join(runDir, 'attempt-1', 'files'), { recursive: true });
  await writeJson(join(runDir, 'run.json'), {
    specId: 'spec1',
    taskId: 'T001',
    modelId: 'qwen:7b',
    mode: 'tdd',
    status: 'completed',
    finalRung: 'ollama',
    attempts: 1,
    totalTokens: 1234,
  });
  await writeJson(join(runDir, 'attempt-1', 'meta.json'), {
    attempt: 1,
    rung: 'ollama',
    furthestStage: 'green',
    failedStage: '',
    gateName: 'tsc',
    toolCalls: 5,
    durationMs: 4200,
  });
  await writeFile(join(runDir, 'attempt-1', 'gate-output.txt'), 'gate ok\n', 'utf8');
  await writeFile(join(runDir, 'attempt-1', 'files', 'mod.ts'), 'export const x = 1;', 'utf8');
  await writeFile(
    join(runDir, 'attempt-1', 'files', 'mod.test.ts'),
    'it("works", () => {});',
    'utf8'
  );
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'eval-collect-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('collectPackets', () => {
  it('should return a packet for a well-formed run dir', async () => {
    await seedWellFormed(root);

    const packets = await collectPackets(root);

    expect(packets).toHaveLength(1);
    expect(packets[0]?.runId).toBe('spec1-T001-1700000000000');
  });

  it('should carry the modelId from run.json onto the packet', async () => {
    await seedWellFormed(root);

    const packets = await collectPackets(root);

    expect(packets[0]?.modelId).toBe('qwen:7b');
  });

  it('should read each attempt meta into an AttemptPacket', async () => {
    await seedWellFormed(root);

    const packets = await collectPackets(root);

    expect(packets[0]?.attempts[0]?.furthestStage).toBe('green');
    expect(packets[0]?.attempts[0]?.gateName).toBe('tsc');
    expect(packets[0]?.attempts[0]?.toolCalls).toBe(5);
  });

  it('should include the gate output text for the attempt', async () => {
    await seedWellFormed(root);

    const packets = await collectPackets(root);

    expect(packets[0]?.attempts[0]?.gateOutput).toContain('gate ok');
  });

  it('should snapshot every mutated file with basename and content', async () => {
    await seedWellFormed(root);

    const packets = await collectPackets(root);

    const names = packets[0]?.attempts[0]?.files.map(f => f.basename) ?? [];
    expect(names).toContain('mod.ts');
    expect(names).toContain('mod.test.ts');
  });

  it('should skip a run dir missing run.json without throwing', async () => {
    await seedWellFormed(root);
    await mkdir(join(root, 'broken-run'), { recursive: true });

    const packets = await collectPackets(root);

    expect(packets).toHaveLength(1);
  });

  it('should skip a run dir whose run.json is invalid JSON', async () => {
    const runDir = join(root, 'bad-json-run');
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'run.json'), '{ not json', 'utf8');

    const packets = await collectPackets(root);

    expect(packets).toEqual([]);
  });

  it('should return an empty array when the root dir does not exist', async () => {
    const packets = await collectPackets(join(root, 'nope'));

    expect(packets).toEqual([]);
  });

  it('should tolerate an attempt dir with no files subdir', async () => {
    const runDir = join(root, 'spec2-T002-1700000000001');
    await mkdir(join(runDir, 'attempt-1'), { recursive: true });
    await writeJson(join(runDir, 'run.json'), {
      specId: 'spec2',
      taskId: 'T002',
      modelId: 'm',
      mode: 'impl',
      status: 'failed',
      finalRung: 'ollama',
      attempts: 1,
      totalTokens: 0,
    });
    await writeJson(join(runDir, 'attempt-1', 'meta.json'), {
      attempt: 1,
      rung: 'ollama',
      furthestStage: 'red',
      failedStage: 'red',
      gateName: 'vitest',
      toolCalls: 2,
      durationMs: 100,
    });
    await writeFile(join(runDir, 'attempt-1', 'gate-output.txt'), 'fail', 'utf8');

    const packets = await collectPackets(root);

    expect(packets[0]?.attempts[0]?.files).toEqual([]);
  });
});
