import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Boundary mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/judge-evaluator', () => ({
  evaluateWithJudge: vi.fn(),
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

vi.mock('@/lib/perplexity', () => ({
  computePerplexity: vi.fn().mockResolvedValue(42.5),
  ensurePerplexityModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/named-entities', () => ({
  computeNamedEntityCount: vi.fn().mockResolvedValue(3),
}));

import { useFeatureFlagStore } from '@/features/settings';
import { computePerplexity } from '@/lib/perplexity';
import { useUIStore } from '@/stores/useUIStore';

import type { CellResult, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildDoneCell = (id: string): CellResult => ({
  id,
  modelId: 'model-1',
  promptId: 'prompt-1',
  userPromptHash: 'hash-abc',
  output: 'Hello, world! This is the output.',
  latencyMs: 100,
  tokens: 50,
  cost: 0,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
});

const buildRunTab = (id: number, cells: readonly CellResult[]): RunTab => ({
  id,
  label: `Run ${id}`,
  createdAt: 1000 + id,
  configSnapshot: { models: [], prompts: [], userPrompt: 'Test prompt' },
  cells,
  selectedCellIds: [],
  compareMode: 'diff',
  sort: 'mean',
  group: 'model',
  gridCols: 3,
  viewMode: 'grid',
});

const enablePerplexity = (): void => {
  useFeatureFlagStore.setState({
    flags: {
      'prompt-lab-enabled': false,
      'show-cors-providers': false,
      'tutorial-enabled': false,
      'web-search-enabled': false,
      'lab-perplexity-enabled': true,
      'lab-text-analysis-enabled': false,
    },
  });
};

const seedDoneRun = (runId: number): void => {
  usePromptTesterStore.setState({
    runs: [buildRunTab(runId, [buildDoneCell('cell-A')])],
    activeRunId: runId,
  });
};

const mockedComputePerplexity = vi.mocked(computePerplexity);

beforeEach(() => {
  vi.clearAllMocks();
  mockedComputePerplexity.mockResolvedValue(42.5);
  useUIStore.setState({ inFlightCalls: 0 });
  enablePerplexity();
});

describe('usePromptTesterStore — in-flight header counter (T008)', () => {
  it('should increment useUIStore.inFlightCalls while a perplexity forward pass runs and return to baseline after resolve', async () => {
    // Arrange — a done cell + a deferred perplexity computation
    seedDoneRun(1);
    const baseline = useUIStore.getState().inFlightCalls;
    let resolvePerplexity: ((value: number) => void) | undefined;
    mockedComputePerplexity.mockReturnValue(
      new Promise<number>(resolve => {
        resolvePerplexity = resolve;
      })
    );

    // Act — start the analyze (do not await yet)
    const pending = usePromptTesterStore.getState().analyzeCell('cell-A');
    await Promise.resolve();

    // Assert — counter incremented while in flight
    expect(useUIStore.getState().inFlightCalls).toBeGreaterThan(baseline);

    // Act — resolve the forward pass and let it settle
    resolvePerplexity?.(12.3);
    await pending;

    // Assert — counter returns to baseline
    expect(useUIStore.getState().inFlightCalls).toBe(baseline);
  });

  it('should return inFlightCalls to baseline when the perplexity forward pass rejects (finally path)', async () => {
    // Arrange — a done cell + a rejecting perplexity computation
    seedDoneRun(2);
    const baseline = useUIStore.getState().inFlightCalls;
    mockedComputePerplexity.mockRejectedValue(new Error('forward pass failed'));

    // Act — run the analyze to completion
    await usePromptTesterStore.getState().analyzeCell('cell-A');

    // Assert — counter restored despite the rejection
    expect(useUIStore.getState().inFlightCalls).toBe(baseline);
  });
});
