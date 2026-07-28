// L1 unit — getEvalComparisonPrompt (NEW:prompt-tester.eval-prompt-copy).
// Pure prompt composition for clipboard copy; no LLM call.

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  getLabRunById: vi.fn().mockResolvedValue(null),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn().mockResolvedValue(undefined),
  getAllPrompts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  getAllArchivedRuns: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/prompt-history', () => ({
  usePromptHistoryStore: { getState: () => ({ refresh: vi.fn(), loadEntries: vi.fn() }) },
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { buildEvalComparisonPrompt } from '@/lib/eval-comparison-prompt';

import type { CellResult, LabState, PromptEntry, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildPromptEntry = (overrides?: Partial<PromptEntry>): PromptEntry => ({
  id: 'prompt-1',
  kind: 'custom',
  text: 'Be concise.',
  edited: false,
  ...overrides,
});

const buildCellResult = (overrides?: Partial<CellResult>): CellResult => ({
  id: 'model-1::prompt-1',
  modelId: 'model-1',
  promptId: 'prompt-1',
  userPromptHash: 'abc123',
  output: 'Cell output text',
  latencyMs: 500,
  tokens: 100,
  cost: 0.001,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
  ...overrides,
});

const buildRunTab = (overrides?: Partial<RunTab>): RunTab => ({
  id: 1,
  label: 'Run 1',
  createdAt: 0,
  configSnapshot: {
    models: [],
    prompts: [buildPromptEntry()],
    userPrompt: 'Explain TDD',
  },
  cells: [buildCellResult()],
  selectedCellIds: [],
  compareMode: 'both',
  sort: 'mean',
  group: 'none',
  gridCols: 2,
  viewMode: 'grid',
  evalComparison: null,
  ...overrides,
});

const getStore = (): LabState => usePromptTesterStore.getState() as LabState;

const resetStore = (): void => {
  usePromptTesterStore.setState(
    usePromptTesterStore.getInitialState
      ? usePromptTesterStore.getInitialState()
      : (usePromptTesterStore.getState() as LabState)
  );
  vi.clearAllMocks();
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getEvalComparisonPrompt (NEW:prompt-tester.eval-prompt-copy)', () => {
  beforeEach(resetStore);

  it('should return the composed userMessage for a run with done cells', () => {
    // Arrange
    const cellA = buildCellResult({ id: 'model-1::prompt-1', output: 'Answer A' });
    const cellB = buildCellResult({ id: 'model-2::prompt-1', output: 'Answer B' });
    usePromptTesterStore.setState({
      runs: [
        buildRunTab({
          id: 7,
          configSnapshot: {
            models: [],
            prompts: [buildPromptEntry({ text: 'Be concise.' })],
            userPrompt: 'Explain TDD',
          },
          cells: [cellA, cellB],
        }),
      ],
    });

    const expected = buildEvalComparisonPrompt({
      userPrompt: 'Explain TDD',
      systemPrompts: ['Be concise.'],
      candidates: [
        { cellId: 'model-1::prompt-1', output: 'Answer A' },
        { cellId: 'model-2::prompt-1', output: 'Answer B' },
      ],
    }).userMessage;

    // Act
    const result = (getStore() as LabState & {
      getEvalComparisonPrompt: (runId: number) => string;
    }).getEvalComparisonPrompt(7);

    // Assert
    expect(result).toBe(expected);
  });

  it('should exclude non-done cells from the composed candidates', () => {
    // Arrange
    const done = buildCellResult({ id: 'model-1::prompt-1', output: 'Done output' });
    const streaming = buildCellResult({
      id: 'model-2::prompt-1',
      output: 'partial',
      status: 'streaming',
    });
    usePromptTesterStore.setState({
      runs: [buildRunTab({ id: 7, cells: [done, streaming] })],
    });

    // Act
    const result = (getStore() as LabState & {
      getEvalComparisonPrompt: (runId: number) => string;
    }).getEvalComparisonPrompt(7);

    // Assert: only the done cell's output appears
    expect(result).toContain('Done output');
    expect(result).not.toContain('partial');
  });

  it('should return an empty string when the run is missing', () => {
    // Arrange
    usePromptTesterStore.setState({ runs: [] });

    // Act
    const result = (getStore() as LabState & {
      getEvalComparisonPrompt: (runId: number) => string;
    }).getEvalComparisonPrompt(999);

    // Assert
    expect(result).toBe('');
  });
});
