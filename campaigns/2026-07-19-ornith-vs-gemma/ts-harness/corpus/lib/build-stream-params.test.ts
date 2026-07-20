import { describe, expect, it } from 'vitest';

import { buildStreamParams } from './build-stream-params';
import { DEFAULT_MODEL_PARAMS, type ModelParams } from './model-params';

const makeParams = (overrides: Partial<ModelParams>): ModelParams => ({
  ...DEFAULT_MODEL_PARAMS,
  ...overrides,
});

describe('buildStreamParams', () => {
  it('should return temperature/topP/maxTokens when they differ from defaults', () => {
    const result = buildStreamParams(
      'ollama',
      makeParams({ temperature: 1.2, topP: 0.5, maxTokens: 4096 })
    );

    expect(result).toEqual({ temperature: 1.2, topP: 0.5, maxTokens: 4096 });
  });

  it('should omit a field when it equals the default', () => {
    const result = buildStreamParams('ollama', makeParams({ temperature: 1.2 }));

    expect(result).toEqual({ temperature: 1.2 });
    expect(result.topP).toBeUndefined();
    expect(result.maxTokens).toBeUndefined();
  });

  it('should forward contextSize when set to a non-default value', () => {
    const result = buildStreamParams('ollama', makeParams({ contextSize: 8192 }));

    expect(result.contextSize).toBe(8192);
  });

  it('should omit contextSize when it equals the default', () => {
    const result = buildStreamParams('ollama', makeParams({ temperature: 0.9 }));

    expect(result.contextSize).toBeUndefined();
  });

  it('should include thinkingEnabled when a non-budget provider has thinking on', () => {
    const result = buildStreamParams('ollama', makeParams({ thinkingEnabled: true }));

    expect(result.thinkingEnabled).toBe(true);
    expect(result.thinkingBudget).toBeUndefined();
  });

  it('should include thinkingEnabled and thinkingBudget for a budget provider with budget set', () => {
    const result = buildStreamParams(
      'claude',
      makeParams({ thinkingEnabled: true, thinkingBudget: 20480 })
    );

    expect(result.thinkingEnabled).toBe(true);
    expect(result.thinkingBudget).toBe(20480);
  });

  it('should omit thinking params for a budget-required provider with no budget', () => {
    const result = buildStreamParams('claude', makeParams({ thinkingEnabled: true }));

    expect(result.thinkingEnabled).toBeUndefined();
    expect(result.thinkingBudget).toBeUndefined();
  });

  it('should omit thinking params when thinking is disabled', () => {
    const result = buildStreamParams(
      'ollama',
      makeParams({ thinkingEnabled: false, thinkingBudget: 20480 })
    );

    expect(result.thinkingEnabled).toBeUndefined();
    expect(result.thinkingBudget).toBeUndefined();
  });

  it('should return an empty object when modelParams is undefined', () => {
    const result = buildStreamParams('ollama', undefined);

    expect(result).toEqual({});
  });
});
