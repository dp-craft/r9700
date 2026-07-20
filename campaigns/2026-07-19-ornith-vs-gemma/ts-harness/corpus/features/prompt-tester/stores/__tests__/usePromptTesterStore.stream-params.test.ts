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

const buildRunTab = (id: number, overrides?: Partial<RunTab>): RunTab => ({
  id,
  label: `Run ${id}`,
  createdAt: 1000 + id,
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'both' as const,
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

const runWithModel = async (model: ModelEntry): Promise<void> => {
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
  await usePromptTesterStore.getState().runFull();
};

describe('T004 — stream params forwarding (buildStreamParams)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should pass non-default temperature/topP/maxTokens from buildStreamParams to streamChat', async () => {
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(emptyStream());

    const model = buildModelEntry({
      params: { temp: 1.2, topP: 0.8, maxTok: 4096, freq: 0, pres: 0 },
    });

    await runWithModel(model);

    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 1.2, topP: 0.8, maxTokens: 4096 })
    );
  });

  it('should NOT pass params equal to defaults (omitted by buildStreamParams)', async () => {
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(emptyStream());

    const model = buildModelEntry({
      params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
    });

    await runWithModel(model);

    const callArgs = vi.mocked(streamChat).mock.calls[0]?.[0];
    expect(callArgs).not.toHaveProperty('temperature');
    expect(callArgs).not.toHaveProperty('topP');
    expect(callArgs).not.toHaveProperty('maxTokens');
  });
});
