// TDD Red phase — tests target runEvalComparison which is absent from the on-disk store.
// GREEN phase: swap in the failed_llm implementation and all 4 tests must pass.

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

const mockStreamChat = vi.fn();
vi.mock('@/services/llm/stream', () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
}));

const mockEvaluateComparison = vi.fn();
vi.mock('@/lib/judge-evaluator', () => ({
  evaluateComparison: (...args: unknown[]) => mockEvaluateComparison(...args),
  evaluateWithJudge: vi.fn(),
}));

const mockPutLabRunParallel = vi.fn();
const mockPutLabParallelismMode = vi.fn();
vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  getLabRunParallel: vi.fn().mockResolvedValue(true),
  putLabRunParallel: (...args: unknown[]) => mockPutLabRunParallel(...args),
  getLabParallelismMode: vi.fn().mockResolvedValue('same-model'),
  putLabParallelismMode: (...args: unknown[]) => mockPutLabParallelismMode(...args),
}));

const mockPutLabRun = vi.fn();
vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: (...args: unknown[]) => mockPutLabRun(...args),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
  getLabRunById: vi.fn().mockResolvedValue(undefined),
}));

const mockArchiveCompletedRun = vi.fn();
vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: (...args: unknown[]) => mockArchiveCompletedRun(...args),
  getArchivedRunById: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvalComparisonDTO } from '@/db/idb';
import { useSettingsStore } from '@/features/settings';

import type {
  CellResult,
  ConfigSnapshot,
  LabState,
  RunTab
} from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StoreWithEval = LabState & {
  readonly runEvalComparison: (runId: number) => Promise<void>;
  readonly persistActiveRun: () => Promise<void>;
};

const getStoreWithActions = (): StoreWithEval =>
  usePromptTesterStore.getState() as unknown as StoreWithEval;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildConfigSnapshot = (overrides?: Partial<ConfigSnapshot>): ConfigSnapshot => ({
  models: [],
  prompts: [],
  userPrompt: 'What is TDD?',
  ...overrides,
});

const buildCellResult = (overrides?: Partial<CellResult>): CellResult => ({
  id: 'cell-1',
  modelId: 'model-1',
  promptId: 'prompt-1',
  userPromptHash: 'abc123',
  output: 'Output text',
  latencyMs: 100,
  tokens: 50,
  cost: 0,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
  ...overrides,
});

const buildRunTab = (overrides?: Partial<RunTab>): RunTab => ({
  id: 1,
  label: 'Run 1',
  createdAt: 1000,
  configSnapshot: buildConfigSnapshot(),
  cells: [],
  selectedCellIds: [],
  compareMode: 'diff',
  sort: 'mean',
  group: 'none',
  gridCols: 2,
  viewMode: 'list',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const mockEvalResult: EvalComparisonDTO = {
  winnerLabel: 'cell-1',
  ranking: [{ label: 'cell-1', cellId: 'cell-1', rank: 1, reasoning: 'best output' }],
  overallReasoning: 'cell-1 is the best',
  error: null,
  evaluatedAt: 1000,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('usePromptTesterStore — runEvalComparison', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );

    useSettingsStore.setState({
      labEvalProviderId: 'test-provider',
      labEvalModelId: 'test-model',
    });

    mockEvaluateComparison.mockResolvedValue(mockEvalResult);
    mockPutLabRun.mockResolvedValue(undefined);
    mockPutLabRunParallel.mockResolvedValue(undefined);
    mockPutLabParallelismMode.mockResolvedValue(undefined);
    mockArchiveCompletedRun.mockResolvedValue(undefined);

    usePromptTesterStore.setState({
      runs: [buildRunTab({ cells: [buildCellResult()] })],
      activeRunId: 1,
    } as Partial<LabState>);
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it('should call evaluateComparison and set run.evalComparison to the resolved DTO when the run has done cells and no existing evalComparison', async () => {
    // Given: a run with one done cell and no existing evalComparison
    const store = getStoreWithActions();

    // When
    const p = store.runEvalComparison(1);
    await vi.advanceTimersByTimeAsync(350);
    await p;

    // Then
    expect(mockEvaluateComparison).toHaveBeenCalledTimes(1);
    const run = (usePromptTesterStore.getState() as LabState).runs.find(r => r.id === 1);
    expect(run?.evalComparison).toEqual(mockEvalResult);
  });

  it('should call persistActiveRun after setting evalComparison', async () => {
    // Given: a run with a done cell
    const store = getStoreWithActions();

    // When
    const p = store.runEvalComparison(1);
    await vi.advanceTimersByTimeAsync(350);
    await p;

    // Then: putLabRun (called by persistActiveRun) was invoked once
    expect(mockPutLabRun).toHaveBeenCalledTimes(1);
  });

  it('should pass outputs composed from the run\'s done cells (id + text) to evaluateComparison', async () => {
    // Given: run has one done cell and one non-done cell
    const doneCell = buildCellResult({ id: 'c-done', output: 'answer text', status: 'done' });
    const pendingCell = buildCellResult({ id: 'c-pending', output: 'partial', status: 'idle' });
    usePromptTesterStore.setState({
      runs: [buildRunTab({ cells: [doneCell, pendingCell] })],
      activeRunId: 1,
    } as Partial<LabState>);

    const store = getStoreWithActions();

    // When
    const p = store.runEvalComparison(1);
    await vi.advanceTimersByTimeAsync(350);
    await p;

    // Then: only the done cell appears in outputs with { id, label, text }
    const requestArg = mockEvaluateComparison.mock.calls[0]?.[0] as {
      readonly outputs: ReadonlyArray<{ readonly id: string; readonly label: string; readonly text: string }>;
    };
    expect(requestArg.outputs).toEqual([{ id: 'c-done', label: 'c-done', text: 'answer text' }]);
  });

  it('should NOT call evaluateComparison nor persistActiveRun when run.evalComparison is already present (F-06 skip)', async () => {
    // Given: run already has an evalComparison result
    usePromptTesterStore.setState({
      runs: [
        buildRunTab({
          cells: [buildCellResult()],
          evalComparison: mockEvalResult,
        }),
      ],
      activeRunId: 1,
    } as Partial<LabState>);

    const store = getStoreWithActions();

    // When
    await store.runEvalComparison(1);
    await vi.advanceTimersByTimeAsync(350);

    // Then: neither evaluateComparison nor persistActiveRun (putLabRun) were invoked
    expect(mockEvaluateComparison).not.toHaveBeenCalled();
    expect(mockPutLabRun).not.toHaveBeenCalled();
  });
});
