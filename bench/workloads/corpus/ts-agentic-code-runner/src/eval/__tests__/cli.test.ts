import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../cli';
import type { RunnerGrade } from '../grade-schema';

let dir: string;

const grade: RunnerGrade = {
  runId: 'r',
  modelId: 'm',
  furthestStage: 'green',
  bars: [{ bar: 'faithfulTest', verdict: 'pass', evidence: 'e' }],
  primaryGap: 'none',
  fixDistance: 'trivial',
  mergeable: true,
  notes: '',
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eval-cli-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('eval cli', () => {
  it('should return 0 and print packets JSON for --collect on an empty root', async () => {
    const logSpy = vi.spyOn(console, 'log');

    const code = await main(['--collect', dir]);

    expect(code).toBe(0);
    expect(JSON.parse((logSpy.mock.calls[0]?.[0] as string) ?? 'null')).toEqual([]);
  });

  it('should return 0 and print markdown for --report on a valid grades file', async () => {
    const path = join(dir, 'grades.json');
    await writeFile(path, JSON.stringify([grade]), 'utf8');
    const logSpy = vi.spyOn(console, 'log');

    const code = await main(['--report', path]);

    expect(code).toBe(0);
    expect(logSpy.mock.calls[0]?.[0]).toContain('Runner Capability Stats');
  });

  it('should return 2 for --report when the grades file does not exist', async () => {
    const code = await main(['--report', join(dir, 'missing.json')]);

    expect(code).toBe(2);
  });

  it('should return 2 for --report when the grades file is invalid JSON', async () => {
    const path = join(dir, 'bad.json');
    await writeFile(path, '{ not json', 'utf8');

    const code = await main(['--report', path]);

    expect(code).toBe(2);
  });

  it('should return 2 for an unknown flag', async () => {
    const code = await main(['--bogus']);

    expect(code).toBe(2);
  });

  it('should return 2 when no flag is provided', async () => {
    const code = await main([]);

    expect(code).toBe(2);
  });

  it('should return 0 for --help', async () => {
    const code = await main(['--help']);

    expect(code).toBe(0);
  });

  it('should return 2 when --collect has no argument', async () => {
    const code = await main(['--collect']);

    expect(code).toBe(2);
  });
});
