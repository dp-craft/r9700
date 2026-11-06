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
  providerId: 'ollama',
  modelKey: 'llama3',
  name: 'Llama3',
  params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
  thinking: true,
  supportsThinking: true,
  expanded: true,
  accent: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// T015 — reasoning chunk buffer in streamSingleCell
// ---------------------------------------------------------------------------

describe('T015 — reasoning chunk buffer accumulation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should accumulate reasoning chunks into cell reasoning field', async () => {
    // Arrange
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'reasoning' as const, text: 'Step 1. ' };
        yield { type: 'reasoning' as const, text: 'Step 2.' };
        yield { type: 'chunk' as const, text: 'Final answer' };
      })()
    );

    const model = buildModelEntry();

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
    const cells = usePromptTesterStore.getState().runs[0]?.cells;
    expect(cells).toHaveLength(1);
    expect(cells?.[0]?.reasoning).toBe('Step 1. Step 2.');
  });

  it('should accumulate content chunks into cell output field', async () => {
    // Arrange
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'chunk' as const, text: 'Hello ' };
        yield { type: 'chunk' as const, text: 'world' };
      })()
    );

    const model = buildModelEntry();

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
    const cells = usePromptTesterStore.getState().runs[0]?.cells;
    expect(cells).toHaveLength(1);
    expect(cells?.[0]?.output).toBe('Hello world');
    expect(cells?.[0]?.reasoning).toBeUndefined();
  });

  it('should produce correct final cell state with mixed reasoning and content chunks', async () => {
    // Arrange
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'reasoning' as const, text: 'Think: ' };
        yield { type: 'reasoning' as const, text: 'A then B.' };
        yield { type: 'chunk' as const, text: 'Answer: ' };
        yield { type: 'chunk' as const, text: 'B.' };
      })()
    );

    const model = buildModelEntry();

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
    const cell = usePromptTesterStore.getState().runs[0]?.cells[0];
    expect(cell?.output).toBe('Answer: B.');
    expect(cell?.reasoning).toBe('Think: A then B.');
    expect(cell?.status).toBe('done');
  });
});
