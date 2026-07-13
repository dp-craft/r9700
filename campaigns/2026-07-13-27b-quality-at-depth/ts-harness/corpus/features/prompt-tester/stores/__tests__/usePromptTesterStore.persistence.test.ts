import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: vi.fn().mockResolvedValue([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

import { deleteLabRun, getAllLabRuns, putLabRun } from '@/db/labRuns';

import { usePromptTesterStore } from '../usePromptTesterStore';

const PERSIST_DEBOUNCE_MS = 300;
const INITIAL_RUN_ID = 1;

const buildLabRunRow = (
  overrides: Partial<{
    id: string;
    label: string;
    createdAt: number;
    updatedAt: number;
    sort: string;
    group: string;
    gridCols: number;
    compareMode: string;
    cells: unknown[];
    selectedCellIds: string[];
    configSnapshot: unknown;
  }> = {}
) => ({
  id: '1',
  label: 'Futtatás 1',
  createdAt: 1000,
  updatedAt: 0,
  sort: 'mean',
  group: 'model',
  gridCols: 3,
  compareMode: 'diff',
  cells: [],
  selectedCellIds: [],
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getAllLabRuns).mockResolvedValue([]);
  vi.mocked(putLabRun).mockResolvedValue(undefined);
  vi.mocked(deleteLabRun).mockResolvedValue(undefined);
  usePromptTesterStore.setState({
    userPrompt: '',
    prompts: [],
    models: [],
    runs: [
      {
        id: INITIAL_RUN_ID,
        label: `Futtatás ${INITIAL_RUN_ID}`,
        createdAt: 1000,
        configSnapshot: { models: [], prompts: [], userPrompt: '' },
        cells: [],
        selectedCellIds: [],
        compareMode: 'diff',
        sort: 'mean',
        group: 'model',
        gridCols: 3,
        viewMode: 'list' as const,
      },
    ],
    activeRunId: INITIAL_RUN_ID,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('usePromptTesterStore — persistence', () => {
  it('should persist active run to labRuns 300ms after a mutating action', async () => {
    // Given the store is initialized with an empty run and fake timers are active

    // When setSort fires
    usePromptTesterStore.getState().setSort('latency');

    // Then immediately: putLabRun not yet called
    expect(vi.mocked(putLabRun)).toHaveBeenCalledTimes(0);

    // Advance past debounce and flush microtasks
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS + 10);

    // Assert: putLabRun called once with LabRunRow whose id matches activeRunId and sort matches
    const { activeRunId } = usePromptTesterStore.getState();
    expect(vi.mocked(putLabRun)).toHaveBeenCalledTimes(1);
    const calledRow = vi.mocked(putLabRun).mock.calls[0]?.[0];
    expect(calledRow.id).toBe(String(activeRunId));
    expect(calledRow.sort).toBe('latency');
  });

  it('should populate state.runs from labRuns on loadRunHistory', async () => {
    // Given getAllLabRuns returns 2 rows (reverse-chrono)
    const row0 = buildLabRunRow({ id: '10', label: 'Run 10', createdAt: 2000 });
    const row1 = buildLabRunRow({ id: '5', label: 'Run 5', createdAt: 1000 });
    vi.mocked(getAllLabRuns).mockResolvedValue([row0 as never, row1 as never]);

    // When loadRunHistory is awaited
    await usePromptTesterStore.getState().loadRunHistory();

    // Then state.runs has 2 entries mapped from rows
    const { runs, activeRunId } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.id).toBe(Number(row0.id));
    expect(runs[1]?.id).toBe(Number(row1.id));
    // And activeRunId is the first (most-recent) run
    expect(activeRunId).toBe(runs[0]?.id);
  });

  it('should persist cell rating to labRuns row after setCellScore + debounce', async () => {
    // Given an active run with a cell 'cell-x'

    (usePromptTesterStore.setState as (updater: (s: any) => Partial<any>) => void)(s => ({
      runs: s.runs.map((r: any) =>
        r.id === s.activeRunId
          ? {
              ...r,
              cells: [
                {
                  id: 'cell-x',
                  modelId: 'model-1',
                  promptId: 'prompt-1',
                  userPromptHash: 'abc',
                  output: '',
                  latencyMs: 0,
                  tokens: 0,
                  cost: 0,
                  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
                  cached: false,
                  status: 'done',
                },
              ],
            }
          : r
      ),
    }));

    // When setCellScore fires
    usePromptTesterStore.getState().setCellScore('cell-x', 'accuracy', 4);

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS + 10);

    // Assert: putLabRun called with a row whose matching cell has ratings.accuracy === 4
    expect(vi.mocked(putLabRun)).toHaveBeenCalledTimes(1);
    const calledRow = vi.mocked(putLabRun).mock.calls[0]?.[0];
    const cell = calledRow.cells.find((c: { id: string }) => c.id === 'cell-x') as
      | { ratings: { accuracy: number } }
      | undefined;
    expect(cell).toBeDefined();
    expect(cell?.ratings.accuracy).toBe(4);
  });

  it('should reassign activeRunId to most-recent remaining run after deleteRun(activeRunId)', async () => {
    // Given state.runs = [r1, r2, r3] (r1 = most-recent), activeRunId === r1.id
    const r1 = {
      id: 10,
      label: 'Run 10',
      createdAt: 3000,
      configSnapshot: { models: [], prompts: [], userPrompt: '' },
      cells: [],
      selectedCellIds: [],
      compareMode: 'diff' as const,
      sort: 'mean' as const,
      group: 'model' as const,
      gridCols: 3 as const,
      viewMode: 'list' as const,
    };
    const r2 = { ...r1, id: 5, label: 'Run 5', createdAt: 2000 };
    const r3 = { ...r1, id: 2, label: 'Run 2', createdAt: 1000 };
    usePromptTesterStore.setState({ runs: [r1, r2, r3], activeRunId: r1.id });

    // When deleteRun(r1.id) is awaited
    await usePromptTesterStore.getState().deleteRun(r1.id);

    // Assert: activeRunId is now r2 (next head after removal)
    const { activeRunId, runs } = usePromptTesterStore.getState();
    expect(activeRunId).toBe(r2.id);
    // Assert: deleteLabRun was called with String(r1.id)
    expect(vi.mocked(deleteLabRun)).toHaveBeenCalledWith(String(r1.id));
    // r1 is removed from runs
    expect(runs.find(r => r.id === r1.id)).toBeUndefined();
  });

  it('should reassign activeRunId to a fresh INITIAL_RUN_ID empty tab when deleting the only remaining run', async () => {
    // T111 case (e): activeRunId is non-nullable number, so a fresh empty tab is the type-safe "no runs" state per T110 deviation.
    const solo = {
      id: 42,
      label: 'Solo',
      createdAt: 1000,
      configSnapshot: { models: [], prompts: [], userPrompt: '' },
      cells: [],
      selectedCellIds: [],
      compareMode: 'diff' as const,
      sort: 'mean' as const,
      group: 'model' as const,
      gridCols: 3 as const,
      viewMode: 'list' as const,
    };
    usePromptTesterStore.setState({ runs: [solo], activeRunId: solo.id });

    // When deleteRun(solo.id) is awaited
    await usePromptTesterStore.getState().deleteRun(solo.id);

    const { runs, activeRunId } = usePromptTesterStore.getState();
    // Assert: a fresh empty tab was inserted (runs.length === 1)
    expect(runs).toHaveLength(1);
    // Assert: the fresh tab has INITIAL_RUN_ID
    expect(runs[0]?.id).toBe(INITIAL_RUN_ID);
    // Assert: activeRunId matches the fresh tab
    expect(activeRunId).toBe(runs[0]?.id);
  });
});
