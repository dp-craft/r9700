import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  getLabRunParallel: vi.fn().mockResolvedValue(true),
  putLabRunParallel: vi.fn().mockResolvedValue(undefined),
  getLabParallelismMode: vi.fn().mockResolvedValue('same-model'),
  putLabParallelismMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: vi.fn().mockResolvedValue([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

import {
  getLabParallelismMode,
  getLabRunParallel,
  putLabParallelismMode,
  putLabRunParallel
} from '@/db/appSettings';

import type { CellRatings, CellResult, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Test builders
// ---------------------------------------------------------------------------

const ZERO_RATINGS: CellRatings = {
  accuracy: 0,
  style: 0,
  tone: 0,
  length: 0,
  readability: 0,
};

function buildCell(overrides: Partial<CellResult> = {}): CellResult {
  return {
    id: 'cell-1',
    modelId: 'model-1',
    promptId: 'prompt-1',
    userPromptHash: 'hash-abc',
    output: 'result',
    latencyMs: 100,
    tokens: 10,
    cost: 0,
    ratings: ZERO_RATINGS,
    cached: false,
    status: 'done',
    ...overrides,
  };
}

function buildRunTab(overrides: Partial<RunTab> = {}): RunTab {
  return {
    id: 1,
    label: 'Run 1',
    createdAt: 1000,
    configSnapshot: { models: [], prompts: [], userPrompt: '' },
    cells: [],
    selectedCellIds: [],
    compareMode: 'diff',
    sort: 'mean',
    group: 'model',
    gridCols: 3,
    viewMode: 'list',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLabRunParallel).mockResolvedValue(true);
  vi.mocked(getLabParallelismMode).mockResolvedValue('same-model');
  usePromptTesterStore.setState({
    runParallel: true,
    parallelismMode: 'same-model',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePromptTesterStore parallel-runs slices', () => {
  it('should default runParallel to true', () => {
    expect(usePromptTesterStore.getState().runParallel).toBe(true);
  });

  it('should default parallelismMode to same-model', () => {
    expect(usePromptTesterStore.getState().parallelismMode).toBe('same-model');
  });

  it('should update runParallel and persist when setRunParallel is called with false', () => {
    usePromptTesterStore.getState().setRunParallel(false);

    expect(usePromptTesterStore.getState().runParallel).toBe(false);
    expect(putLabRunParallel).toHaveBeenCalledWith(false);
  });

  it('should update parallelismMode and persist when setParallelismMode is called with everything', () => {
    usePromptTesterStore.getState().setParallelismMode('everything');

    expect(usePromptTesterStore.getState().parallelismMode).toBe('everything');
    expect(putLabParallelismMode).toHaveBeenCalledWith('everything');
  });

  it('should hydrate runParallel and parallelismMode from appSettings on loadParallelRunsSettings', async () => {
    vi.mocked(getLabRunParallel).mockResolvedValue(false);
    vi.mocked(getLabParallelismMode).mockResolvedValue('everything');

    await usePromptTesterStore.getState().loadParallelRunsSettings();

    expect(usePromptTesterStore.getState().runParallel).toBe(false);
    expect(usePromptTesterStore.getState().parallelismMode).toBe('everything');
  });

  it('should be a no-op when runChanged is called and no cells are outdated', async () => {
    // With no models/runs configured, runChanged exits early without scheduling anything
    const stateBefore = JSON.stringify(usePromptTesterStore.getState().runs);

    await usePromptTesterStore.getState().runChanged();

    expect(JSON.stringify(usePromptTesterStore.getState().runs)).toBe(stateBefore);
  });
});

describe('usePromptTesterStore — hasOutdatedCells()', () => {
  it('should return false when there are no cells in the active run', () => {
    // Arrange: active run with zero cells
    const tab = buildRunTab({ id: 1, cells: [] });
    usePromptTesterStore.setState({ runs: [tab], activeRunId: 1 });

    // Act + Assert
    expect(usePromptTesterStore.getState().hasOutdatedCells()).toBe(false);
  });

  it('should return false when every cell matches the current live selection', () => {
    // Arrange: cell whose modelId and promptId exist in configSnapshot + live models/prompts match
    // djb2('') = "5381" — must match so isCellOutdated returns false for userPromptHash check
    const cell = buildCell({ modelId: 'model-1', promptId: 'prompt-1', userPromptHash: '5381' });
    const model = {
      id: 'model-1',
      providerId: 'ollama',
      modelKey: 'llama3',
      name: 'Llama 3',
      params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
      thinking: false,
      supportsThinking: false,
      expanded: false,
      accent: false,
    } as const;
    const prompt = {
      id: 'prompt-1',
      kind: 'custom' as const,
      text: 'hello',
      edited: false,
    };
    const tab = buildRunTab({
      id: 1,
      cells: [cell],
      configSnapshot: { models: [model], prompts: [prompt], userPrompt: '' },
    });
    // Live state matches snapshot exactly; userPrompt is '' so hash matches
    usePromptTesterStore.setState({
      runs: [tab],
      activeRunId: 1,
      models: [model],
      prompts: [prompt],
      userPrompt: '',
    });

    // Act + Assert
    expect(usePromptTesterStore.getState().hasOutdatedCells()).toBe(false);
  });

  it('should return true when at least one cell has a modelId absent from configSnapshot', () => {
    // Arrange: configSnapshot has no models → snapshotModel lookup fails → cell is outdated
    const cell = buildCell({ modelId: 'missing-model', promptId: 'prompt-1' });
    const tab = buildRunTab({
      id: 1,
      cells: [cell],
      configSnapshot: { models: [], prompts: [], userPrompt: '' },
    });
    usePromptTesterStore.setState({ runs: [tab], activeRunId: 1, models: [], prompts: [] });

    // Act + Assert
    expect(usePromptTesterStore.getState().hasOutdatedCells()).toBe(true);
  });

  it('should return true when the live userPrompt differs from the cell snapshot hash', () => {
    // Arrange: cell captured with hash of 'original', live userPrompt is 'changed'
    const model = {
      id: 'model-1',
      providerId: 'ollama',
      modelKey: 'llama3',
      name: 'Llama 3',
      params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
      thinking: false,
      supportsThinking: false,
      expanded: false,
      accent: false,
    } as const;
    const prompt = {
      id: 'prompt-1',
      kind: 'custom' as const,
      text: 'hello',
      edited: false,
    };
    // Use a known wrong hash so userPromptHash check diverges
    const cell = buildCell({
      modelId: 'model-1',
      promptId: 'prompt-1',
      userPromptHash: 'stale-hash',
    });
    const tab = buildRunTab({
      id: 1,
      cells: [cell],
      configSnapshot: { models: [model], prompts: [prompt], userPrompt: 'original' },
    });
    usePromptTesterStore.setState({
      runs: [tab],
      activeRunId: 1,
      models: [model],
      prompts: [prompt],
      userPrompt: 'changed',
    });

    // Act + Assert
    expect(usePromptTesterStore.getState().hasOutdatedCells()).toBe(true);
  });
});
