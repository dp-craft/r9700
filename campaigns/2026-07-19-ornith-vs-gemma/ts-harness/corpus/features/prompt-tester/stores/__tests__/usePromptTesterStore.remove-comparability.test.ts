import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Boundary mocks — hoisted before imports
// ---------------------------------------------------------------------------

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

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: vi.fn().mockResolvedValue(undefined),
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

import type { ModelEntry, PromptEntry, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Test builders
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
  thinking: false,
  supportsThinking: false,
  expanded: false,
  accent: false,
  ...overrides,
});

const buildPromptEntry = (overrides?: Partial<PromptEntry>): PromptEntry => ({
  id: 'prompt-1',
  kind: 'custom' as const,
  text: 'Tell me a joke',
  edited: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// describe: remove-model comparability invariant (Fix 5 — commit 94b23b2b)
// ---------------------------------------------------------------------------

describe('usePromptTesterStore — remove-model comparability invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should keep result cells comparable (not outdated) after a model is removed', async () => {
    // Arrange — two models, one prompt, one user prompt
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'chunk' as const, text: 'response' };
      })()
    );

    const modelA = buildModelEntry({ id: 'model-a', modelKey: 'llama3', name: 'Llama3' });
    const modelB = buildModelEntry({
      id: 'model-b',
      modelKey: 'mistral',
      name: 'Mistral',
      providerId: 'openrouter',
      accent: false,
    });
    const prompt = buildPromptEntry();

    const initialRun = buildRunTab(1, {
      configSnapshot: { models: [modelA, modelB], prompts: [prompt], userPrompt: 'hello' },
    });

    usePromptTesterStore.setState({
      runs: [initialRun],
      activeRunId: 1,
      models: [modelA, modelB],
      prompts: [prompt],
      userPrompt: 'hello',
    });

    // streamChat is called once per model; second call needs a fresh iterator
    let callCount = 0;
    vi.mocked(streamChat).mockImplementation(() => {
      callCount++;
      return (async function* () {
        yield { type: 'chunk' as const, text: `response-${callCount}` };
      })();
    });

    // Act — drive the run to completion so cells gain resolvedModel snapshots
    await usePromptTesterStore.getState().runFull();

    // Precondition: both cells are done with resolvedModel populated
    const cellsAfterRun = usePromptTesterStore.getState().runs[0]?.cells ?? [];
    expect(cellsAfterRun).toHaveLength(2);
    expect(cellsAfterRun.every(c => c.status === 'done')).toBe(true);
    expect(cellsAfterRun.every(c => c.resolvedModel !== undefined)).toBe(true);

    // Precondition: hasOutdatedCells() is false immediately after a clean run
    expect(usePromptTesterStore.getState().hasOutdatedCells()).toBe(false);

    // Act — remove one model from the live selection
    usePromptTesterStore.getState().removeModel('model-b');

    // Assert — cells must still be comparable; resolvedModel fallback keeps them non-outdated
    expect(usePromptTesterStore.getState().hasOutdatedCells()).toBe(false);
  });

  it('should have each surviving cell non-outdated against post-removal live selection', async () => {
    // Arrange — single model run; after removal resolvedModel fallback governs
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'chunk' as const, text: 'answer' };
      })()
    );

    const model = buildModelEntry({ id: 'sole-model', modelKey: 'llama3', name: 'Llama3' });
    const prompt = buildPromptEntry({ id: 'prompt-sole', text: 'What is 2+2?' });
    const initialRun = buildRunTab(1, {
      configSnapshot: { models: [model], prompts: [prompt], userPrompt: 'query' },
    });

    usePromptTesterStore.setState({
      runs: [initialRun],
      activeRunId: 1,
      models: [model],
      prompts: [prompt],
      userPrompt: 'query',
    });

    await usePromptTesterStore.getState().runFull();

    const cellsAfterRun = usePromptTesterStore.getState().runs[0]?.cells ?? [];
    expect(cellsAfterRun).toHaveLength(1);
    expect(cellsAfterRun[0]?.status).toBe('done');
    expect(cellsAfterRun[0]?.resolvedModel).toBeDefined();

    // Remove the sole model — live models is now []
    usePromptTesterStore.getState().removeModel('sole-model');

    // The store-level derived check confirms no cells are marked outdated
    expect(usePromptTesterStore.getState().hasOutdatedCells()).toBe(false);
  });
});
