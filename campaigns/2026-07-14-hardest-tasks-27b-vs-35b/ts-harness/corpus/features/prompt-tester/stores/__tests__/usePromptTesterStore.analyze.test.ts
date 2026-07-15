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

// Boundary mocks for analysis pipeline libs
vi.mock('@/lib/perplexity', () => ({
  computePerplexity: vi.fn().mockResolvedValue(42.5),
  ensurePerplexityModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/named-entities', () => ({
  computeNamedEntityCount: vi.fn().mockResolvedValue(3),
}));

// NOTE: computeTier2Metrics from @/lib/text-metrics is sync/pure — NOT mocked

import type { JudgeEvaluationDTO } from '@/db/idb';
import { useFeatureFlagStore, useSettingsStore } from '@/features/settings';
import { evaluateWithJudge } from '@/lib/judge-evaluator';
import { computePerplexity, ensurePerplexityModel } from '@/lib/perplexity';

import type { CellResult, LabStore, RunTab } from '../../types';
import { buildCompareRows } from '../../utils/buildCompareRows';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildCell = (
  id: string,
  status: CellResult['status'],
  overrides?: Partial<CellResult>
): CellResult => ({
  id,
  modelId: 'model-1',
  promptId: 'prompt-1',
  userPromptHash: 'hash-abc',
  output: status === 'done' ? 'Hello, world! This is the output.' : '',
  latencyMs: status === 'done' ? 100 : 0,
  tokens: status === 'done' ? 50 : 0,
  cost: 0,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status,
  ...overrides,
});

const buildRunTab = (id: number, cells: readonly CellResult[]): RunTab => ({
  id,
  label: `Run ${id}`,
  createdAt: 1000 + id,
  configSnapshot: { models: [], prompts: [], userPrompt: 'Test prompt' },
  cells,
  selectedCellIds: [],
  compareMode: 'diff' as const,
  sort: 'mean' as const,
  group: 'model' as const,
  gridCols: 3 as const,
  viewMode: 'list' as const,
});

const seedFlags = (overrides?: Partial<Record<string, boolean>>): void => {
  useFeatureFlagStore.setState({
    flags: {
      'prompt-lab-enabled': false,
      'show-cors-providers': false,
      'tutorial-enabled': false,
      'web-search-enabled': false,
      'lab-perplexity-enabled': false,
      'lab-text-analysis-enabled': false,
      ...overrides,
    },
  });
};

const seedRunWithDoneCells = (runId: number): void => {
  const cells = [
    buildCell('cell-A', 'done', { modelId: 'model-1', output: 'First response text.' }),
    buildCell('cell-B', 'done', { modelId: 'model-2', output: 'Second response text.' }),
  ];
  usePromptTesterStore.setState({
    runs: [buildRunTab(runId, cells)],
    activeRunId: runId,
  });
};

// ---------------------------------------------------------------------------
// R-010 — Pre-hydration defaults
// ---------------------------------------------------------------------------

describe('pre-hydration state defaults (R-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should have analyzingCellIds === [] on initial state', () => {
    const { analyzingCellIds } = usePromptTesterStore.getState() as {
      analyzingCellIds: readonly string[];
    };
    expect(analyzingCellIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// analyzeRunCells — basic dispatch
// ---------------------------------------------------------------------------

describe('analyzeRunCells — action existence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags();
  });

  it('should expose analyzeRunCells as an action on the store', () => {
    const state = usePromptTesterStore.getState();
    expect(typeof (state as LabStore).analyzeRunCells).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// analyzeRunCells — skip error/aborted cells
// ---------------------------------------------------------------------------

describe('analyzeRunCells — skips non-done cells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags();
  });

  it('should skip cells with status === "error" and leave their tier2 undefined', async () => {
    const cells = [
      buildCell('cell-ok', 'done', { output: 'Good output text here.' }),
      buildCell('cell-err', 'error'),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const errorCell = run?.cells.find(c => c.id === 'cell-err');
    expect(errorCell?.tier2).toBeUndefined();
  });

  it('should skip cells with status === "aborted" and leave their tier2 undefined', async () => {
    const cells = [
      buildCell('cell-ok', 'done', { output: 'Good output text here.' }),
      buildCell('cell-aborted', 'aborted'),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const abortedCell = run?.cells.find(c => c.id === 'cell-aborted');
    expect(abortedCell?.tier2).toBeUndefined();
  });

  it('should skip cells with status === "idle" and leave their tier2 undefined', async () => {
    const cells = [
      buildCell('cell-ok', 'done', { output: 'Good output text here.' }),
      buildCell('cell-idle', 'idle'),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const idleCell = run?.cells.find(c => c.id === 'cell-idle');
    expect(idleCell?.tier2).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// analyzeRunCells — both flags off → sync metrics only, further-measurement fields null
// ---------------------------------------------------------------------------

describe('analyzeRunCells — both flags off: only sync metrics, no async fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags({ 'lab-perplexity-enabled': false, 'lab-text-analysis-enabled': false });
  });

  it('should set tier2 on done cells when both flags are off', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    expect(cellA?.tier2).toBeDefined();
    expect(cellA?.tier2).not.toBeNull();
  });

  it('should leave tier2.perplexity === null when lab-perplexity-enabled is off', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    expect(cellA?.tier2?.perplexity).toBeNull();
  });

  it('should leave tier2.sentiment === null when lab-text-analysis-enabled is off', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    expect(cellA?.tier2?.sentiment).toBeNull();
  });

  it('should leave tier2.namedEntityCount === null when lab-text-analysis-enabled is off', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    expect(cellA?.tier2?.namedEntityCount).toBeNull();
  });

  it('should NOT call computePerplexity when flag is off', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    expect(computePerplexity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// analyzeRunCells — perplexity flag on + consent granted + model ready
// ---------------------------------------------------------------------------

describe('analyzeRunCells — perplexity flag on, consent granted, model ready', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags({ 'lab-perplexity-enabled': true, 'lab-text-analysis-enabled': false });
    vi.mocked(computePerplexity).mockResolvedValue(42.5);
  });

  it('should set tier2.perplexity to the stubbed model value', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    expect(cellA?.tier2?.perplexity).toBe(42.5);
  });

  it('should call computePerplexity for each done cell', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    // 2 done cells seeded
    expect(computePerplexity).toHaveBeenCalledTimes(2);
  });

  it('should call ensurePerplexityModel before computing', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    expect(ensurePerplexityModel).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// analyzeRunCells — perplexity flag on computes automatically (no consent gate)
// ---------------------------------------------------------------------------

describe('analyzeRunCells — perplexity flag on computes automatically', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags({ 'lab-perplexity-enabled': true });
    vi.mocked(computePerplexity).mockResolvedValue(42.5);
  });

  it('should compute tier2.perplexity when flag is on', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    expect(cellA?.tier2?.perplexity).toBe(42.5);
  });

  it('should call computePerplexity when flag is on', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    expect(computePerplexity).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// analyzeRunCells — sequential ordering: analyzingCellIds transitions
// ---------------------------------------------------------------------------

describe('analyzeRunCells — sequential cell processing via analyzingCellIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags();
  });

  it('should reset analyzingCellIds to [] after analyzeRunCells completes', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const { analyzingCellIds } = usePromptTesterStore.getState() as {
      analyzingCellIds: readonly string[];
    };
    expect(analyzingCellIds).toEqual([]);
  });

  it('should process all done cells (both cells have tier2 populated)', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    const cellB = run?.cells.find(c => c.id === 'cell-B');
    expect(cellA?.tier2).not.toBeNull();
    expect(cellB?.tier2).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// analyzeCell — action existence + re-entrancy guard
// ---------------------------------------------------------------------------

describe('analyzeCell — action existence and re-entrancy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags();
  });

  it('should expose analyzeCell as an action on the store', () => {
    const state = usePromptTesterStore.getState();
    expect(typeof (state as LabStore).analyzeCell).toBe('function');
  });

  it('should set tier2 on the target cell when analyzeCell is called', async () => {
    const cells = [buildCell('cell-solo', 'done', { output: 'Output for analysis here.' })];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    await (usePromptTesterStore.getState() as LabStore).analyzeCell('cell-solo');

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cell = run?.cells.find(c => c.id === 'cell-solo');
    expect(cell?.tier2).toBeDefined();
    expect(cell?.tier2).not.toBeNull();
  });

  it('should remove cellId from analyzingCellIds after analyzeCell completes', async () => {
    const cells = [buildCell('cell-solo', 'done', { output: 'Some output text.' })];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    await (usePromptTesterStore.getState() as LabStore).analyzeCell('cell-solo');

    const { analyzingCellIds } = usePromptTesterStore.getState() as {
      analyzingCellIds: readonly string[];
    };
    expect(analyzingCellIds).toEqual([]);
  });

  it('should no-op when analyzeCell is called for a cell already being analyzed', async () => {
    const cells = [buildCell('cell-busy', 'done', { output: 'Some output.' })];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
      // Pre-set analyzingCellIds to simulate re-entrancy
      analyzingCellIds: ['cell-busy'],
    });

    // Capture tier2 before (should remain unchanged after no-op)
    const before = usePromptTesterStore
      .getState()
      .runs.find(r => r.id === 1)
      ?.cells.find(c => c.id === 'cell-busy')?.tier2;

    await (usePromptTesterStore.getState() as LabStore).analyzeCell('cell-busy');

    const after = usePromptTesterStore
      .getState()
      .runs.find(r => r.id === 1)
      ?.cells.find(c => c.id === 'cell-busy')?.tier2;

    // No double write: tier2 unchanged
    expect(after).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// T021 — L3 integration assertions (shipped behavior)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lookup helpers — reduce inline arrow count in test bodies (complexity gate)
// ---------------------------------------------------------------------------

const getCellFromRun = (runId: number, cellId: string): CellResult | undefined =>
  usePromptTesterStore
    .getState()
    .runs.find(r => r.id === runId)
    ?.cells.find(c => c.id === cellId);

// Helpers for 3+ cell runs
const buildRunWith3DoneCells = (runId: number): void => {
  const cells: readonly CellResult[] = [
    buildCell('cell-X', 'done', { modelId: 'model-1', output: 'First response here.' }),
    buildCell('cell-Y', 'done', { modelId: 'model-2', output: 'Second response here.' }),
    buildCell('cell-Z', 'done', { modelId: 'model-3', output: 'Third response here.' }),
  ];
  usePromptTesterStore.setState({
    runs: [buildRunTab(runId, cells)],
    activeRunId: runId,
  });
};

// ---------------------------------------------------------------------------
// F-02 regression: cold model (isPerplexityModelReady=false) + consent granted
// → ensurePerplexityModel called AND perplexity computed (not left null)
// ---------------------------------------------------------------------------

describe('analyzeRunCells — F-02 regression: cold model warmed before compute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags({ 'lab-perplexity-enabled': true, 'lab-text-analysis-enabled': false });
    vi.mocked(computePerplexity).mockResolvedValue(55.5);
    vi.mocked(ensurePerplexityModel).mockResolvedValue(undefined);
  });

  it('should call ensurePerplexityModel when model is cold and consent is granted', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    expect(ensurePerplexityModel).toHaveBeenCalled();
  });

  it('should call computePerplexity even when model starts cold', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    expect(computePerplexity).toHaveBeenCalled();
  });

  it('should set tier2.perplexity to the stubbed value (not null) after warming cold model', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    expect(cellA?.tier2?.perplexity).toBe(55.5);
  });
});

// ---------------------------------------------------------------------------
// T021-1: Sequential cascade — analyzeRunCells visits each cell id in order
// ---------------------------------------------------------------------------

describe('analyzeRunCells — sequential cascade over ≥3 done cells (T021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags();
  });

  it('should drain analyzingCellIds as each done cell is processed, then reset to []', async () => {
    buildRunWith3DoneCells(1);
    // Capture the snapshot of analyzingCellIds at each state change where the set is non-empty
    const snapshots: string[][] = [];

    const unsubscribe = usePromptTesterStore.subscribe(state => {
      const ids = (state as unknown as { analyzingCellIds: readonly string[] }).analyzingCellIds;
      if (ids.length > 0) {
        snapshots.push([...ids]);
      }
    });

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);
    unsubscribe();

    // First snapshot: all 3 cells marked up-front before any compute
    expect(snapshots[0]).toEqual(expect.arrayContaining(['cell-X', 'cell-Y', 'cell-Z']));
    expect(snapshots[0]).toHaveLength(3);
    // The set drains: final non-empty snapshot has exactly 1 cell remaining
    const lastNonEmpty = snapshots[snapshots.length - 1];
    expect(lastNonEmpty).toHaveLength(1);
    // After action completes: empty
    const { analyzingCellIds } = usePromptTesterStore.getState() as {
      analyzingCellIds: readonly string[];
    };
    expect(analyzingCellIds).toEqual([]);
  });

  it('should mark ALL done cells analyzing up-front before first compute resolves', async () => {
    seedFlags({ 'lab-perplexity-enabled': true });
    buildRunWith3DoneCells(1);

    let upfrontSnapshot: readonly string[] | null = null;
    let firstComputeCalled = false;

    // Override the already-mocked computePerplexity to capture state on first call
    vi.mocked(computePerplexity).mockImplementation(async () => {
      if (!firstComputeCalled) {
        firstComputeCalled = true;
        upfrontSnapshot = [
          ...(usePromptTesterStore.getState() as unknown as { analyzingCellIds: readonly string[] })
            .analyzingCellIds,
        ];
      }
      return 42.5;
    });

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    // At the time the first compute runs, all 3 done cells must already be in the set
    expect(upfrontSnapshot).not.toBeNull();
    expect(upfrontSnapshot).toHaveLength(3);
    expect(upfrontSnapshot).toEqual(expect.arrayContaining(['cell-X', 'cell-Y', 'cell-Z']));
  });

  it('should populate tier2 on every done cell in a 3-cell run', async () => {
    buildRunWith3DoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    expect(getCellFromRun(1, 'cell-X')?.tier2).toBeDefined();
    expect(getCellFromRun(1, 'cell-Y')?.tier2).toBeDefined();
    expect(getCellFromRun(1, 'cell-Z')?.tier2).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// T021-2: Re-entrancy guard — concurrent analyzeCell calls run compute once
// ---------------------------------------------------------------------------

describe('analyzeCell — re-entrancy guard blocks concurrent second call (T021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags({ 'lab-perplexity-enabled': true, 'lab-text-analysis-enabled': false });
    vi.mocked(computePerplexity).mockResolvedValue(7.7);
  });

  it('should call computePerplexity exactly once even when analyzeCell is invoked twice concurrently for the same cell', async () => {
    const cells: readonly CellResult[] = [
      buildCell('cell-concurrent', 'done', { output: 'Some output text to analyze.' }),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    const store = usePromptTesterStore.getState() as LabStore;
    // Fire both without awaiting the first — second must be blocked by re-entrancy guard
    const p1 = store.analyzeCell('cell-concurrent');
    const p2 = store.analyzeCell('cell-concurrent');
    await Promise.all([p1, p2]);

    expect(computePerplexity).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T021-3: Cascade to drawer + compare table via getState()
// ---------------------------------------------------------------------------

describe('analyzeRunCells — tier2 visible to DetailPanel path and buildCompareRows (T021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags({ 'lab-perplexity-enabled': true, 'lab-text-analysis-enabled': false });
    vi.mocked(computePerplexity).mockResolvedValue(18.3);
  });

  it('should expose tier2 on the cell accessible via getState().runs.find().cells.find()', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const cell = usePromptTesterStore
      .getState()
      .runs.find(r => r.id === 1)
      ?.cells.find(c => c.id === 'cell-A');
    expect(cell?.tier2).not.toBeNull();
    expect(cell?.tier2).toBeDefined();
  });

  it('should produce a perplexity-true metric row whose value reflects the stored tier2.perplexity', async () => {
    seedRunWithDoneCells(1);
    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, [
          buildCell('cell-A', 'done', {
            modelId: 'model-1',
            output: 'First response text.',
            resolvedModel: {
              name: 'Model A',
              providerId: 'prov-1',
              modelKey: 'key-1',
              params: { temp: 0.7, topP: 1, maxTok: 4096, freq: 0, pres: 0 },
              thinking: false,
            },
          }),
        ]),
      ],
      activeRunId: 1,
    });

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const analyzedCells = usePromptTesterStore.getState().runs.find(r => r.id === 1)!.cells;

    const metricLabels = {
      latency: 'Latency',
      tps: 'TPS',
      perplexity: 'Perplexity',
      readability: 'Readability',
      lexicalDiversity: 'Lex Div',
      wordCount: 'Words',
      sentenceCount: 'Sentences',
      readingTime: 'Reading Time',
      sentiment: 'Sentiment',
      passiveVoiceRatio: 'Passive',
      questionDensity: 'Questions',
      ngramRepetition: 'Repetition',
      namedEntityCount: 'Entities',
      avgSentenceLength: 'Avg Sent Len',
      hedgingDensity: 'Hedging',
    };
    const rowLabels = {
      temp: 'Temp',
      topP: 'Top-P',
      thinking: 'Thinking',
      latency: 'Latency',
      yes: 'Yes',
      no: 'No',
    };
    const paramLabels = {
      temp: 'Temp',
      topP: 'Top-P',
      maxTok: 'Max Tok',
      freq: 'Freq',
      pres: 'Pres',
      thinking: 'Thinking',
      thinkingBudget: 'Thinking Budget',
      contextSize: 'Context',
    };

    const { metricRows } = buildCompareRows(
      analyzedCells,
      ['cell-A'],
      paramLabels,
      rowLabels,
      metricLabels
    );

    const truePerplexityRow = metricRows.find(r => r.metricKey === 'perplexity-true');
    expect(truePerplexityRow).toBeDefined();
    // The stored tier2.perplexity (18.3) formatted to 2 decimal places
    expect(truePerplexityRow?.values[0]).toBe('18.30');
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation: perplexity model/compute throws → null, analyzingCellIds reset
// ---------------------------------------------------------------------------

describe('analyzeRunCells — graceful degradation: perplexity throws → null + analyzingCellIds reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags({ 'lab-perplexity-enabled': true, 'lab-text-analysis-enabled': false });
    // ensurePerplexityModel throws (simulates timeout or model load failure)
    vi.mocked(ensurePerplexityModel).mockRejectedValue(
      new Error('perplexity model load timed out')
    );
  });

  it('should set tier2.perplexity to null when ensurePerplexityModel rejects', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    expect(cellA?.tier2).toBeDefined();
    expect(cellA?.tier2?.perplexity).toBeNull();
  });

  it('should reset analyzingCellIds to [] even when ensurePerplexityModel rejects', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const { analyzingCellIds } = usePromptTesterStore.getState() as {
      analyzingCellIds: readonly string[];
    };
    expect(analyzingCellIds).toEqual([]);
  });

  it('should still set tier2 on all done cells even when perplexity throws for every cell', async () => {
    seedRunWithDoneCells(1);

    await (usePromptTesterStore.getState() as LabStore).analyzeRunCells(1);

    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cellA = run?.cells.find(c => c.id === 'cell-A');
    const cellB = run?.cells.find(c => c.id === 'cell-B');
    expect(cellA?.tier2).toBeDefined();
    expect(cellB?.tier2).toBeDefined();
  });
});

describe('analyzeCell — graceful degradation: computePerplexity throws mid-compute → null + analyzingCellIds reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags({ 'lab-perplexity-enabled': true, 'lab-text-analysis-enabled': false });
    vi.mocked(ensurePerplexityModel).mockResolvedValue(undefined);
    // computePerplexity throws — model loaded but inference fails
    vi.mocked(computePerplexity).mockRejectedValue(new Error('inference failed'));
  });

  it('should set tier2.perplexity to null when computePerplexity rejects', async () => {
    const cells = [buildCell('cell-throw', 'done', { output: 'Some output text.' })];
    usePromptTesterStore.setState({ runs: [buildRunTab(1, cells)], activeRunId: 1 });

    await (usePromptTesterStore.getState() as LabStore).analyzeCell('cell-throw');

    const cell = usePromptTesterStore
      .getState()
      .runs.find(r => r.id === 1)
      ?.cells.find(c => c.id === 'cell-throw');
    expect(cell?.tier2?.perplexity).toBeNull();
  });

  it('should remove cellId from analyzingCellIds even when computePerplexity rejects', async () => {
    const cells = [buildCell('cell-throw', 'done', { output: 'Some output text.' })];
    usePromptTesterStore.setState({ runs: [buildRunTab(1, cells)], activeRunId: 1 });

    await (usePromptTesterStore.getState() as LabStore).analyzeCell('cell-throw');

    const { analyzingCellIds } = usePromptTesterStore.getState() as {
      analyzingCellIds: readonly string[];
    };
    expect(analyzingCellIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T021-4: runJudge round-trip
// ---------------------------------------------------------------------------

const STUB_JUDGE_RESULT: JudgeEvaluationDTO = {
  score: 3,
  criteria: [
    { name: 'relevance', score: 3, reasoning: 'On topic.' },
    { name: 'coherence', score: 3, reasoning: 'Flows well.' },
    { name: 'completeness', score: 3, reasoning: 'Covers the question.' },
    { name: 'helpfulness', score: 3, reasoning: 'Useful.' },
    { name: 'conciseness', score: 3, reasoning: 'Concise.' },
  ],
  overallReasoning: 'Good answer.',
  error: null,
};

describe('runJudge — round-trip writes judge to cell and persistence mock (T021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedFlags();
    // T009: judge target now resolves from the configured eval-model, not the cell's own model
    useSettingsStore.setState({ labEvalProviderId: 'eval-provider', labEvalModelId: 'eval-model' });
    vi.mocked(evaluateWithJudge).mockResolvedValue(STUB_JUDGE_RESULT);
    vi.useFakeTimers();
  });

  it('should write judge result to cell.judge after runJudge completes', async () => {
    const cells: readonly CellResult[] = [
      buildCell('cell-judge', 'done', {
        modelId: 'model-key-1',
        output: 'The answer is 42.',
        resolvedModel: {
          name: 'Model One',
          providerId: 'provider-a',
          modelKey: 'model-key-1',
          params: { temp: 0.7, topP: 1, maxTok: 4096, freq: 0, pres: 0 },
          thinking: false,
        },
      }),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    const judgePromise = (usePromptTesterStore.getState() as LabStore).runJudge('cell-judge');
    await vi.runAllTimersAsync();
    await judgePromise;

    const cell = usePromptTesterStore
      .getState()
      .runs.find(r => r.id === 1)
      ?.cells.find(c => c.id === 'cell-judge');
    expect(cell?.judge).toStrictEqual(STUB_JUDGE_RESULT);
  });

  it('should call evaluateWithJudge with JudgeConfig using the configured eval provider+model (T009)', async () => {
    const cells: readonly CellResult[] = [
      buildCell('cell-judge', 'done', {
        modelId: 'model-key-1',
        output: 'The answer is 42.',
        resolvedModel: {
          name: 'Model One',
          providerId: 'provider-a',
          modelKey: 'model-key-1',
          params: { temp: 0.7, topP: 1, maxTok: 4096, freq: 0, pres: 0 },
          thinking: false,
        },
      }),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    const judgePromise = (usePromptTesterStore.getState() as LabStore).runJudge('cell-judge');
    await vi.runAllTimersAsync();
    await judgePromise;

    expect(evaluateWithJudge).toHaveBeenCalledWith(
      expect.objectContaining({ responseText: 'The answer is 42.' }),
      { providerId: 'eval-provider', modelId: 'eval-model' }
    );
  });

  it('should persist the run (call putLabRun) after judge is written', async () => {
    const { putLabRun } = await import('@/db/labRuns');
    const cells: readonly CellResult[] = [
      buildCell('cell-judge', 'done', {
        modelId: 'model-key-1',
        output: 'The answer is 42.',
        resolvedModel: {
          name: 'Model One',
          providerId: 'provider-a',
          modelKey: 'model-key-1',
          params: { temp: 0.7, topP: 1, maxTok: 4096, freq: 0, pres: 0 },
          thinking: false,
        },
      }),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    const judgePromise = (usePromptTesterStore.getState() as LabStore).runJudge('cell-judge');
    await vi.runAllTimersAsync();
    await judgePromise;

    expect(putLabRun).toHaveBeenCalled();
    const calls = vi.mocked(putLabRun).mock.calls;
    const callArg = calls[calls.length - 1]?.[0];
    const persistedCell = callArg?.cells.find((c: CellResult) => c.id === 'cell-judge');
    expect(persistedCell?.judge).toStrictEqual(STUB_JUDGE_RESULT);
  });

  it('should write cell.judge with an error field and NOT call evaluateWithJudge when model is unresolvable', async () => {
    // T009: unresolvable now means no eval-model configured
    useSettingsStore.setState({ labEvalProviderId: null, labEvalModelId: null });
    const cells: readonly CellResult[] = [
      buildCell('cell-no-model', 'done', {
        output: 'Some output.',
      }),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });

    await (usePromptTesterStore.getState() as LabStore).runJudge('cell-no-model');

    expect(evaluateWithJudge).not.toHaveBeenCalled();
    const judge = getCellFromRun(1, 'cell-no-model')?.judge;
    expect(judge).toBeDefined();
    expect(judge?.error).toBeTruthy();
    expect(judge?.score).toBeNull();
  });

  it('should clear judgingCellId when the judge evaluation rejects', async () => {
    // Given: an active run with a done cell that has a resolvable judge model
    const cells: readonly CellResult[] = [
      buildCell('cell-judge', 'done', {
        modelId: 'model-key-1',
        output: 'The answer is 42.',
        resolvedModel: {
          name: 'Model One',
          providerId: 'provider-a',
          modelKey: 'model-key-1',
          params: { temp: 0.7, topP: 1, maxTok: 4096, freq: 0, pres: 0 },
          thinking: false,
        },
      }),
    ];
    usePromptTesterStore.setState({
      runs: [buildRunTab(1, cells)],
      activeRunId: 1,
    });
    vi.mocked(evaluateWithJudge).mockRejectedValue(new Error('judge failed'));

    // When: runJudge is invoked and the judge evaluation rejects
    // (attach a catch immediately so the rejection is handled, not "unhandled")
    const judgePromise = (usePromptTesterStore.getState() as LabStore)
      .runJudge('cell-judge')
      .catch(() => {
        // runJudge may reject — the stuck-flag bug is the concern, not the rejection
      });
    await vi.runAllTimersAsync();
    await judgePromise;

    // Then: the judging flag is cleared so the cell is not stuck "judging" forever
    expect(usePromptTesterStore.getState().judgingCellId).toBeNull();
  });
});
