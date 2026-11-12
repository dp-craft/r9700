import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Boundary mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: vi.fn().mockResolvedValue([]),
  getLabRunById: vi.fn().mockResolvedValue(null),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn().mockResolvedValue(undefined),
  getAllPrompts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/prompt-history', () => ({
  usePromptHistoryStore: { getState: () => ({ loadEntries: vi.fn() }) },
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

vi.mock('@/services/streaming/streamRegistry', () => ({
  streamRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    abort: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock('@/lib/prompt-composer', () => ({
  normalizeSystemPrompt: (text: string) => text,
  applyFramingPreamble: (composed: string, _preamble: string) => composed,
}));

import type { ModelEntry, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildRunTab = (id: number, overrides?: Partial<RunTab>): RunTab => ({
  id,
  label: `Run ${id}`,
  createdAt: 1000 + id,
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'diff' as const,
  sort: 'mean' as const,
  group: 'model' as const,
  gridCols: 3 as const,
  viewMode: 'list' as const,
  ...overrides,
});

const buildModelEntry = (overrides?: Partial<ModelEntry>): ModelEntry => ({
  id: 'model-1',
  providerId: 'openrouter',
  modelKey: 'gpt-4o',
  name: 'GPT-4o',
  params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
  thinking: false,
  supportsThinking: false,
  expanded: true,
  accent: true,
  ...overrides,
});

const emptyStream = async function* () {
  yield { type: 'chunk' as const, text: 'ok' };
};

// ---------------------------------------------------------------------------
// T014 — thinking options forwarding in Lab run path
// ---------------------------------------------------------------------------

describe('T014 — thinking options forwarding in streamSingleCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should pass thinkingEnabled:true to streamChat when resolvedModel.thinking is true for budget-free provider', async () => {
    // Arrange
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(emptyStream());

    const model = buildModelEntry({
      id: 'model-ollama',
      providerId: 'ollama',
      modelKey: 'llama3',
      thinking: true,
      supportsThinking: true,
    });

    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [model], prompts: [], userPrompt: 'test' },
        }),
      ],
      activeRunId: 1,
      models: [model],
      prompts: [],
      userPrompt: 'test',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert
    expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({ thinkingEnabled: true }));
  });

  it('should NOT pass thinking params to streamChat when resolvedModel.thinking is undefined', async () => {
    // Arrange
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(emptyStream());

    const model = buildModelEntry({
      id: 'model-plain',
      providerId: 'openrouter',
      modelKey: 'gpt-4o',
      thinking: false,
      supportsThinking: false,
    });

    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [model], prompts: [], userPrompt: 'test' },
        }),
      ],
      activeRunId: 1,
      models: [model],
      prompts: [],
      userPrompt: 'test',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert
    const callArgs = vi.mocked(streamChat).mock.calls[0]?.[0];
    expect(callArgs).not.toHaveProperty('thinkingEnabled');
    expect(callArgs).not.toHaveProperty('thinkingBudget');
  });

  it('should NOT pass thinking params for budget-required provider (claude) with no budget (M3b gate)', async () => {
    // Arrange
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(emptyStream());

    const model = buildModelEntry({
      id: 'model-claude',
      providerId: 'claude',
      modelKey: 'claude-3.5-sonnet',
      thinking: true,
      supportsThinking: true,
    });

    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [model], prompts: [], userPrompt: 'test' },
        }),
      ],
      activeRunId: 1,
      models: [model],
      prompts: [],
      userPrompt: 'test',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert — M3b gate: claude requires budget, none supplied → {} returned
    const callArgs = vi.mocked(streamChat).mock.calls[0]?.[0];
    expect(callArgs).not.toHaveProperty('thinkingEnabled');
    expect(callArgs).not.toHaveProperty('thinkingBudget');
  });
});
