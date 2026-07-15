import { describe, expect, it } from 'vitest';

import type { ModelParams } from '@/lib/model-params';
import {
  clampParam,
  DEFAULT_MODEL_PARAMS,
  getNonDefaultParams,
  isAtDefaults,
  PARAM_RANGES,
  resolveModelParams
} from '@/lib/model-params';

// -- Builders --

const createParams = (overrides: Partial<ModelParams> = {}): ModelParams => ({
  temperature: DEFAULT_MODEL_PARAMS.temperature,
  maxTokens: DEFAULT_MODEL_PARAMS.maxTokens,
  topP: DEFAULT_MODEL_PARAMS.topP,
  thinkingEnabled: DEFAULT_MODEL_PARAMS.thinkingEnabled,
  thinkingBudget: DEFAULT_MODEL_PARAMS.thinkingBudget,
  contextSize: DEFAULT_MODEL_PARAMS.contextSize,
  ...overrides,
});

// -- DEFAULT_MODEL_PARAMS --

describe('DEFAULT_MODEL_PARAMS', () => {
  // -- Positive paths --

  it('should have temperature of 0.7', () => {
    expect(DEFAULT_MODEL_PARAMS.temperature).toBe(0.7);
  });

  it('should have maxTokens of 2048', () => {
    expect(DEFAULT_MODEL_PARAMS.maxTokens).toBe(2048);
  });

  it('should have topP of 1.0', () => {
    expect(DEFAULT_MODEL_PARAMS.topP).toBe(1.0);
  });

  it('should have thinkingEnabled of false', () => {
    expect(DEFAULT_MODEL_PARAMS.thinkingEnabled).toBe(false);
  });

  it('should have thinkingBudget of 10240', () => {
    expect(DEFAULT_MODEL_PARAMS.thinkingBudget).toBe(10240);
  });

  it('should have contextSize of 4096', () => {
    expect(DEFAULT_MODEL_PARAMS.contextSize).toBe(4096);
  });
});

// -- PARAM_RANGES --

describe('PARAM_RANGES', () => {
  // -- temperature --

  it('should have temperature range min of 0', () => {
    expect(PARAM_RANGES.temperature.min).toBe(0);
  });

  it('should have temperature range max of 2', () => {
    expect(PARAM_RANGES.temperature.max).toBe(2);
  });

  it('should have temperature range step of 0.1', () => {
    expect(PARAM_RANGES.temperature.step).toBe(0.1);
  });

  it('should have temperature range default of 0.7', () => {
    expect(PARAM_RANGES.temperature.default).toBe(0.7);
  });

  // -- maxTokens --

  it('should have maxTokens range min of 1', () => {
    expect(PARAM_RANGES.maxTokens.min).toBe(1);
  });

  it('should have maxTokens range max of 32768', () => {
    expect(PARAM_RANGES.maxTokens.max).toBe(32768);
  });

  it('should have maxTokens range step of 1', () => {
    expect(PARAM_RANGES.maxTokens.step).toBe(1);
  });

  it('should have maxTokens range default of 2048', () => {
    expect(PARAM_RANGES.maxTokens.default).toBe(2048);
  });

  // -- topP --

  it('should have topP range min of 0', () => {
    expect(PARAM_RANGES.topP.min).toBe(0);
  });

  it('should have topP range max of 1', () => {
    expect(PARAM_RANGES.topP.max).toBe(1);
  });

  it('should have topP range step of 0.05', () => {
    expect(PARAM_RANGES.topP.step).toBe(0.05);
  });

  it('should have topP range default of 1.0', () => {
    expect(PARAM_RANGES.topP.default).toBe(1.0);
  });

  // -- thinkingBudget --

  it('should have thinkingBudget range min of 1024', () => {
    expect(PARAM_RANGES.thinkingBudget.min).toBe(1024);
  });

  it('should have thinkingBudget range max of 32768', () => {
    expect(PARAM_RANGES.thinkingBudget.max).toBe(32768);
  });

  it('should have thinkingBudget range step of 1024', () => {
    expect(PARAM_RANGES.thinkingBudget.step).toBe(1024);
  });

  it('should have thinkingBudget range default of 10240', () => {
    expect(PARAM_RANGES.thinkingBudget.default).toBe(10240);
  });

  // -- contextSize --

  it('should have contextSize range min of 512', () => {
    expect(PARAM_RANGES.contextSize.min).toBe(512);
  });

  it('should have contextSize range max of 200000', () => {
    expect(PARAM_RANGES.contextSize.max).toBe(200000);
  });

  it('should have contextSize range step of 512', () => {
    expect(PARAM_RANGES.contextSize.step).toBe(512);
  });

  it('should have contextSize range default of 4096', () => {
    expect(PARAM_RANGES.contextSize.default).toBe(4096);
  });
});

// -- clampParam --

describe('clampParam', () => {
  // -- Positive paths --

  it('should return value unchanged when value is within temperature range', () => {
    const result = clampParam('temperature', 1.0);

    expect(result).toBe(1.0);
  });

  it('should return value unchanged when value is at temperature minimum', () => {
    const result = clampParam('temperature', 0);

    expect(result).toBe(0);
  });

  it('should return value unchanged when value is at temperature maximum', () => {
    const result = clampParam('temperature', 2);

    expect(result).toBe(2);
  });

  it('should return value unchanged when value is within maxTokens range', () => {
    const result = clampParam('maxTokens', 1024);

    expect(result).toBe(1024);
  });

  it('should return value unchanged when value is within topP range', () => {
    const result = clampParam('topP', 0.5);

    expect(result).toBe(0.5);
  });

  it('should return value unchanged when value is within thinkingBudget range', () => {
    const result = clampParam('thinkingBudget', 16384);

    expect(result).toBe(16384);
  });

  it('should return value unchanged when value is within contextSize range', () => {
    const result = clampParam('contextSize', 8192);

    expect(result).toBe(8192);
  });

  // -- Negative cases --

  it('should return min when value is below temperature minimum', () => {
    const result = clampParam('temperature', -1);

    expect(result).toBe(PARAM_RANGES.temperature.min);
  });

  it('should return max when value is above temperature maximum', () => {
    const result = clampParam('temperature', 10);

    expect(result).toBe(PARAM_RANGES.temperature.max);
  });

  it('should return min when value is below maxTokens minimum', () => {
    const result = clampParam('maxTokens', 0);

    expect(result).toBe(PARAM_RANGES.maxTokens.min);
  });

  it('should return max when value is above maxTokens maximum', () => {
    const result = clampParam('maxTokens', 99999);

    expect(result).toBe(PARAM_RANGES.maxTokens.max);
  });

  it('should return min when value is below topP minimum', () => {
    const result = clampParam('topP', -0.5);

    expect(result).toBe(PARAM_RANGES.topP.min);
  });

  it('should return max when value is above topP maximum', () => {
    const result = clampParam('topP', 2);

    expect(result).toBe(PARAM_RANGES.topP.max);
  });

  it('should return min when value is below thinkingBudget minimum', () => {
    const result = clampParam('thinkingBudget', 0);

    expect(result).toBe(PARAM_RANGES.thinkingBudget.min);
  });

  it('should return max when value is above thinkingBudget maximum', () => {
    const result = clampParam('thinkingBudget', 99999);

    expect(result).toBe(PARAM_RANGES.thinkingBudget.max);
  });

  it('should return min when value is below contextSize minimum', () => {
    const result = clampParam('contextSize', 0);

    expect(result).toBe(PARAM_RANGES.contextSize.min);
  });

  it('should return max when value is above contextSize maximum', () => {
    const result = clampParam('contextSize', 999999);

    expect(result).toBe(PARAM_RANGES.contextSize.max);
  });

  // -- Edge cases --

  it('should return range default when value is NaN for temperature', () => {
    const result = clampParam('temperature', NaN);

    expect(result).toBe(PARAM_RANGES.temperature.default);
  });

  it('should return range default when value is NaN for maxTokens', () => {
    const result = clampParam('maxTokens', NaN);

    expect(result).toBe(PARAM_RANGES.maxTokens.default);
  });

  it('should return range default when value is NaN for topP', () => {
    const result = clampParam('topP', NaN);

    expect(result).toBe(PARAM_RANGES.topP.default);
  });

  it('should return range default when value is NaN for thinkingBudget', () => {
    const result = clampParam('thinkingBudget', NaN);

    expect(result).toBe(PARAM_RANGES.thinkingBudget.default);
  });

  it('should return range default when value is NaN for contextSize', () => {
    const result = clampParam('contextSize', NaN);

    expect(result).toBe(PARAM_RANGES.contextSize.default);
  });
});

// -- isAtDefaults --

describe('isAtDefaults', () => {
  // -- Positive paths --

  it('should return true when params is undefined', () => {
    const result = isAtDefaults(undefined);

    expect(result).toBe(true);
  });

  it('should return true when params matches DEFAULT_MODEL_PARAMS exactly', () => {
    const params = createParams();

    const result = isAtDefaults(params);

    expect(result).toBe(true);
  });

  // -- Negative cases --

  it('should return false when temperature differs from default', () => {
    const params = createParams({ temperature: 1.2 });

    const result = isAtDefaults(params);

    expect(result).toBe(false);
  });

  it('should return false when maxTokens differs from default', () => {
    const params = createParams({ maxTokens: 4096 });

    const result = isAtDefaults(params);

    expect(result).toBe(false);
  });

  it('should return false when topP differs from default', () => {
    const params = createParams({ topP: 0.9 });

    const result = isAtDefaults(params);

    expect(result).toBe(false);
  });

  it('should return false when thinkingEnabled differs from default', () => {
    const params = createParams({ thinkingEnabled: true });

    const result = isAtDefaults(params);

    expect(result).toBe(false);
  });

  it('should return false when thinkingBudget differs from default', () => {
    const params = createParams({ thinkingBudget: 20480 });

    const result = isAtDefaults(params);

    expect(result).toBe(false);
  });

  it('should return false when contextSize differs from default', () => {
    const params = createParams({ contextSize: 8192 });

    const result = isAtDefaults(params);

    expect(result).toBe(false);
  });

  // -- Edge cases --

  it('should return false when multiple params differ from defaults', () => {
    const params = createParams({ temperature: 0.5, maxTokens: 1024 });

    const result = isAtDefaults(params);

    expect(result).toBe(false);
  });
});

// -- getNonDefaultParams --

describe('getNonDefaultParams', () => {
  // -- Positive paths --

  it('should return empty object when params is undefined', () => {
    const result = getNonDefaultParams(undefined);

    expect(result).toEqual({});
  });

  it('should return empty object when params matches defaults exactly', () => {
    const params = createParams();

    const result = getNonDefaultParams(params);

    expect(result).toEqual({});
  });

  it('should return only temperature when only temperature differs', () => {
    const params = createParams({ temperature: 0.5 });

    const result = getNonDefaultParams(params);

    expect(result).toEqual({ temperature: 0.5 });
  });

  it('should return only maxTokens when only maxTokens differs', () => {
    const params = createParams({ maxTokens: 4096 });

    const result = getNonDefaultParams(params);

    expect(result).toEqual({ maxTokens: 4096 });
  });

  it('should return only topP when only topP differs', () => {
    const params = createParams({ topP: 0.85 });

    const result = getNonDefaultParams(params);

    expect(result).toEqual({ topP: 0.85 });
  });

  it('should return only thinkingEnabled when only thinkingEnabled differs', () => {
    const params = createParams({ thinkingEnabled: true });

    const result = getNonDefaultParams(params);

    expect(result).toEqual({ thinkingEnabled: true });
  });

  it('should return only thinkingBudget when only thinkingBudget differs', () => {
    const params = createParams({ thinkingBudget: 20480 });

    const result = getNonDefaultParams(params);

    expect(result).toEqual({ thinkingBudget: 20480 });
  });

  it('should return only contextSize when only contextSize differs', () => {
    const params = createParams({ contextSize: 8192 });

    const result = getNonDefaultParams(params);

    expect(result).toEqual({ contextSize: 8192 });
  });

  // -- Edge cases --

  it('should return all changed fields when multiple params differ', () => {
    const params = createParams({ temperature: 0.2, maxTokens: 512, thinkingEnabled: true });

    const result = getNonDefaultParams(params);

    expect(result).toEqual({ temperature: 0.2, maxTokens: 512, thinkingEnabled: true });
  });

  it('should not include unchanged fields in the returned object', () => {
    const params = createParams({ temperature: 0.5 });

    const result = getNonDefaultParams(params);

    expect(result).not.toHaveProperty('maxTokens');
    expect(result).not.toHaveProperty('topP');
    expect(result).not.toHaveProperty('thinkingEnabled');
    expect(result).not.toHaveProperty('thinkingBudget');
    expect(result).not.toHaveProperty('contextSize');
  });
});

// -- resolveModelParams --

describe('resolveModelParams', () => {
  // -- Positive paths --

  it('should return DEFAULT_MODEL_PARAMS when params is undefined', () => {
    const result = resolveModelParams(undefined);

    expect(result).toEqual(DEFAULT_MODEL_PARAMS);
  });

  it('should return the passed params object when all fields are present', () => {
    const params = createParams({ temperature: 1.5, maxTokens: 4096 });

    const result = resolveModelParams(params);

    expect(result).toEqual(params);
  });

  it('should preserve temperature from passed params', () => {
    const params = createParams({ temperature: 0.3 });

    const result = resolveModelParams(params);

    expect(result.temperature).toBe(0.3);
  });

  it('should preserve maxTokens from passed params', () => {
    const params = createParams({ maxTokens: 8192 });

    const result = resolveModelParams(params);

    expect(result.maxTokens).toBe(8192);
  });

  it('should preserve topP from passed params', () => {
    const params = createParams({ topP: 0.75 });

    const result = resolveModelParams(params);

    expect(result.topP).toBe(0.75);
  });

  it('should preserve thinkingEnabled from passed params', () => {
    const params = createParams({ thinkingEnabled: true });

    const result = resolveModelParams(params);

    expect(result.thinkingEnabled).toBe(true);
  });

  it('should preserve thinkingBudget from passed params', () => {
    const params = createParams({ thinkingBudget: 16384 });

    const result = resolveModelParams(params);

    expect(result.thinkingBudget).toBe(16384);
  });

  it('should preserve contextSize from passed params', () => {
    const params = createParams({ contextSize: 16384 });

    const result = resolveModelParams(params);

    expect(result.contextSize).toBe(16384);
  });

  // -- Edge cases --

  it('should return an object with all ModelParams fields when params is undefined', () => {
    const result = resolveModelParams(undefined);

    expect(result).toHaveProperty('temperature');
    expect(result).toHaveProperty('maxTokens');
    expect(result).toHaveProperty('topP');
    expect(result).toHaveProperty('thinkingEnabled');
    expect(result).toHaveProperty('thinkingBudget');
    expect(result).toHaveProperty('contextSize');
  });
});
