import { describe, expect, it } from 'vitest';

import { LAB_RUN_CONCURRENCY } from '@/config';

import {
  deriveParallelRunsSettings,
  type ExecutionGroup,
  type ParallelRunsSettings,
  scheduleRun
} from '../resolveConcurrency';

type TestCell = { readonly modelKey: string; readonly label: string };

const BOTH_OFF: ParallelRunsSettings = {
  serialAcrossModels: false,
  serialWithinModel: false,
};

const SERIAL_ACROSS: ParallelRunsSettings = {
  serialAcrossModels: true,
  serialWithinModel: false,
};

const SERIAL_WITHIN: ParallelRunsSettings = {
  serialAcrossModels: false,
  serialWithinModel: true,
};

const BOTH_ON: ParallelRunsSettings = {
  serialAcrossModels: true,
  serialWithinModel: true,
};

describe('scheduleRun', () => {
  it('should return empty array when cells is empty', () => {
    const result = scheduleRun<TestCell>([], BOTH_OFF);
    expect(result).toEqual([]);
  });

  it('should group cells by modelKey', () => {
    const cells: readonly TestCell[] = [
      { modelKey: 'gpt-4', label: 'a' },
      { modelKey: 'claude', label: 'b' },
      { modelKey: 'gpt-4', label: 'c' },
    ];

    const result = scheduleRun(cells, BOTH_OFF);

    expect(result).toHaveLength(2);
    expect(result[0].modelKey).toBe('gpt-4');
    expect(result[0].items).toEqual([
      { modelKey: 'gpt-4', label: 'a' },
      { modelKey: 'gpt-4', label: 'c' },
    ]);
    expect(result[1].modelKey).toBe('claude');
    expect(result[1].items).toEqual([{ modelKey: 'claude', label: 'b' }]);
  });

  it('should set concurrency to LAB_RUN_CONCURRENCY when both switches off', () => {
    const cells: readonly TestCell[] = [
      { modelKey: 'gpt-4', label: 'a' },
      { modelKey: 'gpt-4', label: 'b' },
    ];

    const result = scheduleRun(cells, BOTH_OFF);

    expect(result).toHaveLength(1);
    expect(result[0].concurrency).toBe(LAB_RUN_CONCURRENCY);
  });

  it('should set concurrency to LAB_RUN_CONCURRENCY when serialAcrossModels is true (parallel still allowed within group)', () => {
    const cells: readonly TestCell[] = [
      { modelKey: 'gpt-4', label: 'a' },
      { modelKey: 'claude', label: 'b' },
      { modelKey: 'gpt-4', label: 'c' },
    ];

    const result = scheduleRun(cells, SERIAL_ACROSS);

    expect(result).toHaveLength(2);
    expect(result[0].concurrency).toBe(LAB_RUN_CONCURRENCY);
    expect(result[1].concurrency).toBe(LAB_RUN_CONCURRENCY);
  });

  it('should set concurrency to 1 when serialWithinModel is true', () => {
    const cells: readonly TestCell[] = [
      { modelKey: 'gpt-4', label: 'a' },
      { modelKey: 'gpt-4', label: 'b' },
    ];

    const result = scheduleRun(cells, SERIAL_WITHIN);

    expect(result).toHaveLength(1);
    expect(result[0].concurrency).toBe(1);
  });

  it('should set concurrency to 1 when both switches on', () => {
    const cells: readonly TestCell[] = [
      { modelKey: 'gpt-4', label: 'a' },
      { modelKey: 'claude', label: 'b' },
    ];

    const result = scheduleRun(cells, BOTH_ON);

    expect(result).toHaveLength(2);
    expect(result[0].concurrency).toBe(1);
    expect(result[1].concurrency).toBe(1);
  });

  it('should handle single model single cell', () => {
    const cells: readonly TestCell[] = [{ modelKey: 'gpt-4', label: 'a' }];

    const result = scheduleRun(cells, BOTH_OFF);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      modelKey: 'gpt-4',
      items: [{ modelKey: 'gpt-4', label: 'a' }],
      concurrency: LAB_RUN_CONCURRENCY,
    });
  });

  it('should preserve insertion order of model groups', () => {
    const cells: readonly TestCell[] = [
      { modelKey: 'claude', label: 'a' },
      { modelKey: 'gpt-4', label: 'b' },
      { modelKey: 'gemini', label: 'c' },
      { modelKey: 'claude', label: 'd' },
    ];

    const result = scheduleRun(cells, BOTH_OFF);

    expect(result).toHaveLength(3);
    expect(result[0].modelKey).toBe('claude');
    expect(result[1].modelKey).toBe('gpt-4');
    expect(result[2].modelKey).toBe('gemini');
  });

  it('should return readonly arrays', () => {
    const cells: readonly TestCell[] = [{ modelKey: 'gpt-4', label: 'a' }];
    const result: readonly ExecutionGroup<TestCell>[] = scheduleRun(cells, BOTH_OFF);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('deriveParallelRunsSettings', () => {
  it('should serialize both axes when runParallel is false (mode=same-model)', () => {
    expect(deriveParallelRunsSettings(false, 'same-model')).toEqual({
      serialAcrossModels: true,
      serialWithinModel: true,
    });
  });

  it('should serialize both axes when runParallel is false (mode=everything)', () => {
    expect(deriveParallelRunsSettings(false, 'everything')).toEqual({
      serialAcrossModels: true,
      serialWithinModel: true,
    });
  });

  it('should serialize across models only when runParallel is true and mode is same-model', () => {
    expect(deriveParallelRunsSettings(true, 'same-model')).toEqual({
      serialAcrossModels: true,
      serialWithinModel: false,
    });
  });

  it('should parallelize everything when runParallel is true and mode is everything', () => {
    expect(deriveParallelRunsSettings(true, 'everything')).toEqual({
      serialAcrossModels: false,
      serialWithinModel: false,
    });
  });
});
