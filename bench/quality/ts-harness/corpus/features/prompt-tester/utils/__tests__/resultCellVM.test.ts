import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../starMetrics', () => ({
  meanQualityStars: vi.fn(() => 0),
}));

import type { CellResult, ConfigSnapshot, ModelEntry, PromptEntry } from '../../types';
import type { LiveLookup } from '../resultCellVM';
import { buildCellVM, formatTps, formatTtfSeconds } from '../resultCellVM';
import { meanQualityStars } from '../starMetrics';

const mockMeanQualityStars = vi.mocked(meanQualityStars);

beforeEach(() => {
  vi.clearAllMocks();
  mockMeanQualityStars.mockReturnValue(0);
});

const makeCell = (overrides: Partial<CellResult> = {}): CellResult => ({
  id: 'cell-1',
  modelId: 'model-abc',
  promptId: 'prompt-xyz',
  userPromptHash: 'hash-1',
  output: 'Some output text',
  latencyMs: 100,
  tokens: 50,
  cost: 0.01,
  ratings: { accuracy: 3, style: 3, tone: 3, length: 3, readability: 3 },
  cached: false,
  status: 'done',
  ...overrides,
});

const makeModels = (name = 'GPT-4'): readonly ModelEntry[] => [
  {
    id: 'model-abc',
    providerId: 'openai',
    modelKey: 'gpt-4',
    name,
    params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
    thinking: false,
    supportsThinking: false,
    expanded: false,
    accent: false,
    axisId: 1,
  },
];

const makePrompts = (text = 'Be helpful'): readonly PromptEntry[] => [
  {
    id: 'prompt-xyz',
    kind: 'skill',
    skillId: 'skill-1',
    text,
    edited: false,
    axisId: 1,
  },
];

const makeSnapshot = (): ConfigSnapshot => ({
  models: makeModels(),
  prompts: makePrompts(),
  userPrompt: 'test prompt',
});

const noopLookup: LiveLookup = {
  resolveModelLabel: () => undefined,
  resolveSkillName: () => undefined,
  resolveSkillPhrase: () => undefined,
};

describe('formatTtfSeconds', () => {
  it('should return seconds with 2 decimals when given milliseconds', () => {
    expect(formatTtfSeconds(1234)).toBe('1.23s');
  });

  it('should format sub-second values correctly', () => {
    expect(formatTtfSeconds(500)).toBe('0.50s');
  });

  it('should return em-dash when undefined', () => {
    expect(formatTtfSeconds(undefined)).toBe('—');
  });

  it('should return 0.00s when zero', () => {
    expect(formatTtfSeconds(0)).toBe('0.00s');
  });

  it('should handle very large values', () => {
    expect(formatTtfSeconds(123456)).toBe('123.46s');
  });

  it('should handle very small fractions', () => {
    expect(formatTtfSeconds(1)).toBe('0.00s');
  });
});

describe('formatTps', () => {
  it('should format tokens per second with 2 decimals and unit', () => {
    expect(formatTps(45.678)).toBe('45.68 tok/s');
  });

  it('should always show 2 decimal places for whole numbers', () => {
    expect(formatTps(100)).toBe('100.00 tok/s');
  });

  it('should return em-dash when undefined', () => {
    expect(formatTps(undefined)).toBe('—');
  });

  it('should return 0.00 tok/s when zero', () => {
    expect(formatTps(0)).toBe('0.00 tok/s');
  });

  it('should handle very large values', () => {
    expect(formatTps(9999.99)).toBe('9999.99 tok/s');
  });

  it('should handle very small fractions', () => {
    expect(formatTps(0.04)).toBe('0.04 tok/s');
  });
});

describe('buildCellVM resolution precedence', () => {
  it('should use resolvedModel snapshot name when present on cell', () => {
    const cell = makeCell({
      resolvedModel: {
        name: 'Snapshot GPT-4',
        providerId: 'openai',
        modelKey: 'gpt-4',
        params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
        thinking: false,
      },
    });
    const result = buildCellVM(
      cell,
      makeModels('Live GPT-4'),
      makePrompts(),
      makeSnapshot(),
      'hash-1',
      noopLookup
    );
    expect(result.modelLabel).toBe('Snapshot GPT-4');
  });

  it('should use resolvedSkillLabel snapshot when present on cell', () => {
    const cell = makeCell({
      resolvedSkillLabel: 'Snapshot Skill',
      resolvedSkillText: 'Snapshot phrase content',
    });
    const result = buildCellVM(
      cell,
      makeModels(),
      makePrompts(),
      makeSnapshot(),
      'hash-1',
      noopLookup
    );
    expect(result.phrase).toBe('Snapshot phrase content');
  });

  it('should fall back to live lookup when snapshot fields are absent', () => {
    const lookup: LiveLookup = {
      resolveModelLabel: id => (id === 'model-abc' ? 'Live Resolved Model' : undefined),
      resolveSkillName: () => 'Live Skill Name',
      resolveSkillPhrase: () => 'Live skill phrase',
    };
    const cell = makeCell();
    const result = buildCellVM(cell, makeModels(), makePrompts(), makeSnapshot(), 'hash-1', lookup);
    expect(result.modelLabel).toBe('Live Resolved Model');
    expect(result.phrase).toBe('Live skill phrase');
  });

  it('should use raw modelId with warning when both snapshot and live lookup fail', () => {
    const cell = makeCell({ modelId: 'unknown-model-id' });
    const models: readonly ModelEntry[] = [];
    const result = buildCellVM(cell, models, makePrompts(), makeSnapshot(), 'hash-1', noopLookup);
    expect(result.modelLabel).toBe('unknown-model-id');
    expect(result.warning).toBe('unresolved');
  });

  it('should use raw promptId as phrase with warning when all lookups fail', () => {
    const cell = makeCell({ promptId: 'orphan-prompt-id' });
    const prompts: readonly PromptEntry[] = [];
    const result = buildCellVM(cell, makeModels(), prompts, makeSnapshot(), 'hash-1', noopLookup);
    expect(result.phrase).toBe('orphan-prompt-id');
    expect(result.warning).toBe('unresolved');
  });

  it('should not set warning when snapshot resolution succeeds', () => {
    const cell = makeCell({
      resolvedModel: {
        name: 'Resolved Name',
        providerId: 'openai',
        modelKey: 'gpt-4',
        params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
        thinking: false,
      },
      resolvedSkillLabel: 'Skill',
      resolvedSkillText: 'Phrase text',
    });
    const result = buildCellVM(
      cell,
      makeModels(),
      makePrompts(),
      makeSnapshot(),
      'hash-1',
      noopLookup
    );
    expect(result.warning).toBeUndefined();
  });

  it('should not set warning when live lookup succeeds', () => {
    const lookup: LiveLookup = {
      resolveModelLabel: () => 'Live Model',
      resolveSkillName: () => 'Live Skill',
      resolveSkillPhrase: () => 'Live phrase',
    };
    const cell = makeCell();
    const result = buildCellVM(cell, makeModels(), makePrompts(), makeSnapshot(), 'hash-1', lookup);
    expect(result.warning).toBeUndefined();
  });

  it('should set warning only when model OR phrase is unresolved', () => {
    const lookup: LiveLookup = {
      resolveModelLabel: () => 'Live Model',
      resolveSkillName: () => undefined,
      resolveSkillPhrase: () => undefined,
    };
    const cell = makeCell({ promptId: 'missing-prompt' });
    const prompts: readonly PromptEntry[] = [];
    const result = buildCellVM(cell, makeModels(), prompts, makeSnapshot(), 'hash-1', lookup);
    expect(result.modelLabel).toBe('Live Model');
    expect(result.phrase).toBe('missing-prompt');
    expect(result.warning).toBe('unresolved');
  });

  // --- removed-items-remain-enabled token ---

  it('should not be outdated when model was removed from live models but resolvedModel snapshot is present', () => {
    // Given — cell has resolvedModel snapshot; model no longer in live models list
    const cell = makeCell({
      resolvedModel: {
        name: 'Archived GPT-4',
        providerId: 'openai',
        modelKey: 'gpt-4',
        params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
        thinking: false,
      },
    });
    const removedModels: readonly ModelEntry[] = []; // model removed from live list

    // When
    const vm = buildCellVM(
      cell,
      removedModels,
      makePrompts(),
      makeSnapshot(),
      'hash-1',
      noopLookup
    );

    // Then — snapshot resolves name; cell is NOT outdated; no unresolved warning
    expect(vm.isOutdated).toBe(false);
    expect(vm.modelLabel).toBe('Archived GPT-4');
    expect(vm.warning).toBeUndefined();
  });

  it('should be outdated with unresolved warning when model was removed and no resolvedModel snapshot', () => {
    // Given — legacy cell: no resolvedModel; model gone from live models
    const cell = makeCell({ modelId: 'removed-model-id' });
    const removedModels: readonly ModelEntry[] = []; // model removed
    const emptySnapshot: ConfigSnapshot = {
      models: [], // snapshot also missing the model
      prompts: makePrompts(),
      userPrompt: 'test prompt',
    };

    // When
    const vm = buildCellVM(cell, removedModels, makePrompts(), emptySnapshot, 'hash-1', noopLookup);

    // Then — no snapshot fallback; cell IS outdated; unresolved warning present
    expect(vm.isOutdated).toBe(true);
    expect(vm.modelLabel).toBe('removed-model-id');
    expect(vm.warning).toBe('unresolved');
  });

  it('should prefer snapshot over live lookup even when live lookup would succeed', () => {
    const lookup: LiveLookup = {
      resolveModelLabel: () => 'Live Model Override',
      resolveSkillName: () => 'Live Skill Override',
      resolveSkillPhrase: () => 'Live phrase override',
    };
    const cell = makeCell({
      resolvedModel: {
        name: 'Snapshot Wins',
        providerId: 'openai',
        modelKey: 'gpt-4',
        params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
        thinking: false,
      },
      resolvedSkillText: 'Snapshot phrase wins',
    });
    const result = buildCellVM(cell, makeModels(), makePrompts(), makeSnapshot(), 'hash-1', lookup);
    expect(result.modelLabel).toBe('Snapshot Wins');
    expect(result.phrase).toBe('Snapshot phrase wins');
  });
});

describe('buildCellVM — meanRating from quality stars', () => {
  it('should call meanQualityStars with cell.output', () => {
    // Arrange
    const cell = makeCell({ output: 'hello world output' });

    // Act
    buildCellVM(cell, makeModels(), makePrompts(), makeSnapshot(), 'hash-1', noopLookup);

    // Assert
    expect(mockMeanQualityStars).toHaveBeenCalledWith('hello world output');
  });

  it('should set meanRating to the value returned by meanQualityStars', () => {
    // Arrange
    mockMeanQualityStars.mockReturnValue(4.33);
    const cell = makeCell({ output: 'good output' });

    // Act
    const vm = buildCellVM(cell, makeModels(), makePrompts(), makeSnapshot(), 'hash-1', noopLookup);

    // Assert
    expect(vm.meanRating).toBe(4.33);
  });

  it('should return meanRating 0 when output is empty (meanQualityStars returns 0)', () => {
    // Arrange
    mockMeanQualityStars.mockReturnValue(0);
    const cell = makeCell({ output: '' });

    // Act
    const vm = buildCellVM(cell, makeModels(), makePrompts(), makeSnapshot(), 'hash-1', noopLookup);

    // Assert
    expect(vm.meanRating).toBe(0);
  });

  it('should return meanRating 5 for best-quality output', () => {
    // Arrange
    mockMeanQualityStars.mockReturnValue(5);
    const cell = makeCell({ output: 'perfect output' });

    // Act
    const vm = buildCellVM(cell, makeModels(), makePrompts(), makeSnapshot(), 'hash-1', noopLookup);

    // Assert
    expect(vm.meanRating).toBe(5);
  });

  it('should set output field on VM from cell.output', () => {
    // Arrange
    const cell = makeCell({ output: 'cell output text' });

    // Act
    const vm = buildCellVM(cell, makeModels(), makePrompts(), makeSnapshot(), 'hash-1', noopLookup);

    // Assert
    expect(vm.output).toBe('cell output text');
  });
});
