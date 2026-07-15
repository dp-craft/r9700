import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Boundary mocks — hoisted before imports (mock @/db/* and @/services/* only)
// ---------------------------------------------------------------------------

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: vi.fn().mockResolvedValue(undefined),
  getArchivedRunById: vi.fn().mockResolvedValue(null),
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
  getLabRunParallel: vi.fn().mockResolvedValue(false),
  putLabRunParallel: vi.fn().mockResolvedValue(undefined),
  getLabParallelismMode: vi.fn().mockResolvedValue('off'),
  putLabParallelismMode: vi.fn().mockResolvedValue(undefined),
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

import type { JudgeEvaluationDTO } from '@/db/idb';
import { putLabRun } from '@/db/labRuns';
import { useSettingsStore } from '@/features/settings';
import { evaluateWithJudge } from '@/lib/judge-evaluator';

import type { CellResult, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

const mockedJudge = vi.mocked(evaluateWithJudge);
const mockedPutLabRun = vi.mocked(putLabRun);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildCell = (id: string, overrides?: Partial<CellResult>): CellResult => ({
  id,
  modelId: 'cell-own-model',
  promptId: 'prompt-1',
  userPromptHash: 'hash-abc',
  output: `Output for ${id}`,
  latencyMs: 100,
  tokens: 50,
  cost: 0,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
  resolvedModel: {
    name: 'Cell Own Model',
    providerId: 'cell-own-provider',
    modelKey: 'cell-own-model',
    params: { temp: 0.5, topP: 1, maxTok: 0, freq: 0, pres: 0 },
    thinking: false,
  },
  ...overrides,
});

const buildRunTab = (id: number, cells: readonly CellResult[]): RunTab => ({
  id,
  label: `Run ${id}`,
  createdAt: 1000 + id,
  configSnapshot: {
    models: [],
    prompts: [
      { id: 'p1', kind: 'custom' as const, text: 'You are concise.', edited: false },
      { id: 'p2', kind: 'custom' as const, text: '   ', edited: false },
      { id: 'p3', kind: 'custom' as const, text: 'Stay on topic.', edited: false },
    ],
    userPrompt: 'Explain recursion.',
  },
  cells,
  selectedCellIds: [],
  compareMode: 'diff' as const,
  sort: 'mean' as const,
  group: 'model' as const,
  gridCols: 3 as const,
  viewMode: 'list' as const,
});

const judgeResult: JudgeEvaluationDTO = {
  score: 3,
  criteria: [],
  overallReasoning: 'ok',
  error: null,
};

const seedEvalConfig = (providerId: string | null, modelId: string | null): void => {
  useSettingsStore.setState({ labEvalProviderId: providerId, labEvalModelId: modelId });
};

const seedRun = (runId: number, cells: readonly CellResult[]): void => {
  usePromptTesterStore.setState({ runs: [buildRunTab(runId, cells)], activeRunId: runId });
};

// ---------------------------------------------------------------------------
// Change 1 — runJudge resolves from eval-config + composes systemPrompt
// ---------------------------------------------------------------------------

describe('runJudge — eval-config resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    mockedJudge.mockResolvedValue(judgeResult);
  });

  it('should use labEvalProviderId/labEvalModelId from settings as the judge target', async () => {
    seedEvalConfig('eval-provider', 'eval-model');
    seedRun(7, [buildCell('cell-A')]);

    await usePromptTesterStore.getState().runJudge('cell-A');

    expect(mockedJudge).toHaveBeenCalledTimes(1);
    expect(mockedJudge.mock.calls[0][1]).toEqual({
      providerId: 'eval-provider',
      modelId: 'eval-model',
    });
  });

  it('should compose systemPrompt from non-empty configSnapshot.prompts texts', async () => {
    seedEvalConfig('eval-provider', 'eval-model');
    seedRun(7, [buildCell('cell-A')]);

    await usePromptTesterStore.getState().runJudge('cell-A');

    const request = mockedJudge.mock.calls[0][0];
    expect(request.systemPrompt).toBe('You are concise.\n\nStay on topic.');
  });

  it('should set error judge when no evaluator model is configured', async () => {
    seedEvalConfig(null, null);
    seedRun(7, [buildCell('cell-A')]);

    await usePromptTesterStore.getState().runJudge('cell-A');

    expect(mockedJudge).not.toHaveBeenCalled();
    const cell = usePromptTesterStore.getState().runs[0].cells.find(c => c.id === 'cell-A');
    expect(cell?.judge?.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Change 2 — evaluateRunOutputs (sequential, idempotent, persists)
// ---------------------------------------------------------------------------

describe('evaluateRunOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    seedEvalConfig('eval-provider', 'eval-model');
    mockedJudge.mockResolvedValue(judgeResult);
  });

  it('should judge only un-judged done cells', async () => {
    seedRun(9, [
      buildCell('cell-A'),
      buildCell('cell-B', { status: 'error' }),
      buildCell('cell-C'),
    ]);

    await usePromptTesterStore.getState().evaluateRunOutputs(9);

    expect(mockedJudge).toHaveBeenCalledTimes(2);
  });

  it('should skip cells already carrying cell.judge (F-06 idempotency)', async () => {
    seedRun(9, [
      buildCell('cell-A', { judge: judgeResult }),
      buildCell('cell-B'),
    ]);

    await usePromptTesterStore.getState().evaluateRunOutputs(9);

    expect(mockedJudge).toHaveBeenCalledTimes(1);
  });

  it('should call runJudge sequentially (ordered, awaited)', async () => {
    const order: readonly string[] = [];
    const mutableOrder = order as string[];
    let active = 0;
    mockedJudge.mockImplementation(async () => {
      expect(active).toBe(0);
      active += 1;
      mutableOrder.push('start');
      await Promise.resolve();
      active -= 1;
      mutableOrder.push('end');
      return judgeResult;
    });
    seedRun(9, [buildCell('cell-A'), buildCell('cell-B')]);

    await usePromptTesterStore.getState().evaluateRunOutputs(9);

    expect(mutableOrder).toEqual(['start', 'end', 'start', 'end']);
  });

  it('should persist the active run after evaluating', async () => {
    seedRun(9, [buildCell('cell-A')]);

    await usePromptTesterStore.getState().evaluateRunOutputs(9);

    expect(mockedPutLabRun).toHaveBeenCalled();
  });

  it('should no-op when the run does not exist', async () => {
    seedRun(9, [buildCell('cell-A')]);

    await usePromptTesterStore.getState().evaluateRunOutputs(999);

    expect(mockedJudge).not.toHaveBeenCalled();
  });
});
