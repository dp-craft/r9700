import { describe, expect, it } from 'vitest';

import { createReciter, RECITATION_INTERVAL } from './recitation';

describe('createReciter', () => {
  it('should leave tool results before the interval untouched', () => {
    const recite = createReciter({ stage: 'code', taskStatement: 'wire the store' });

    expect(recite('output')).toBe('output');
  });

  it('should append a task anchor to every interval-th tool result', () => {
    const recite = createReciter({ stage: 'code', taskStatement: 'wire the store' });
    const outputs = Array.from({ length: RECITATION_INTERVAL }, (): string => recite('out'));

    expect(outputs[RECITATION_INTERVAL - 1]).toContain('[task: code — wire the store]');
  });

  it('should not append the anchor to non-interval tool results', () => {
    const recite = createReciter({ stage: 'code', taskStatement: 'wire the store' });
    const outputs = Array.from({ length: RECITATION_INTERVAL - 1 }, (): string => recite('out'));

    expect(outputs.every((o: string): boolean => !o.includes('[task:'))).toBe(true);
  });

  it('should truncate the task statement to the first 80 characters', () => {
    const long = 'x'.repeat(200);
    const recite = createReciter({ stage: 'test', taskStatement: long });
    const last = Array.from({ length: RECITATION_INTERVAL }, (): string => recite('out')).at(-1) ?? '';

    expect(last).toContain(`[task: test — ${'x'.repeat(80)}]`);
    expect(last).not.toContain('x'.repeat(81));
  });

  it('should tolerate a missing task statement', () => {
    const recite = createReciter({ stage: 'code' });
    const last = Array.from({ length: RECITATION_INTERVAL }, (): string => recite('out')).at(-1) ?? '';

    expect(last).toContain('[task: code — ]');
  });
});
