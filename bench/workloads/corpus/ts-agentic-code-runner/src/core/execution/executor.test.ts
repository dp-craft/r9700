import { describe, expect, it } from 'vitest';

import type { AgentType } from '../shared/types';
import { assertFootprint, executeTask, FootprintError, type TaskSpec } from './executor';

const makeSpec = (overrides: Partial<TaskSpec> = {}): TaskSpec => ({
  agentType: 'code-logic-writer',
  navBundlePath: 'specs/x/nav/T001.json',
  targetFiles: ['a.ts', 'b.ts'],
  ...overrides,
});

describe('assertFootprint', () => {
  const fiftyFiles = Array.from({ length: 50 }, (_, i) => `f${i}.ts`);
  const fiftyOneFiles = [...fiftyFiles, 'overflow.ts'];

  it('should not throw when targetFiles count is at most fifty', () => {
    expect(() => assertFootprint(makeSpec({ targetFiles: fiftyFiles }))).not.toThrow();
  });

  it('should throw FootprintError when targetFiles exceed fifty', () => {
    const spec = makeSpec({ targetFiles: fiftyOneFiles });
    expect(() => assertFootprint(spec)).toThrow(FootprintError);
  });

  it('should throw FootprintError when targetFiles is empty', () => {
    const spec = makeSpec({ targetFiles: [] });
    expect(() => assertFootprint(spec)).toThrow(FootprintError);
  });

  it('should name the empty-footprint cause in the thrown message', () => {
    const spec = makeSpec({ targetFiles: [] });
    expect(() => assertFootprint(spec)).toThrow(/footprint is empty/i);
  });
});

describe('executeTask', () => {
  it('should resolve a well-formed result with touchedFiles length at most two', async () => {
    const result = await executeTask(makeSpec({ targetFiles: ['a.ts', 'b.ts'] }));
    expect(result.touchedFiles.length).toBeLessThanOrEqual(2);
    expect(result.agentType).toBe('code-logic-writer');
    expect(result.status).toBe('completed');
  });

  it('should set touchedFiles to the spec targetFiles', async () => {
    const result = await executeTask(makeSpec({ targetFiles: ['only.ts'] }));
    expect(result.touchedFiles).toEqual(['only.ts']);
  });

  it('should reject with FootprintError when footprint exceeds fifty files', async () => {
    const fiftyOneFiles = Array.from({ length: 51 }, (_, i) => `f${i}.ts`);
    const spec = makeSpec({ targetFiles: fiftyOneFiles });
    await expect(executeTask(spec)).rejects.toBeInstanceOf(FootprintError);
  });

  it('should reject when agentType is an unsupported value', async () => {
    const spec = makeSpec({ agentType: 'totally-invalid' as AgentType });
    await expect(executeTask(spec)).rejects.toThrow();
  });
});
