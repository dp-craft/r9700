// ---------------------------------------------------------------------------
// T005 — runFull/runPartial execute cells via runPool bounded by LAB_RUN_CONCURRENCY
// Tests: (a) runPool called with correct concurrency, (b) per-cell error isolation
// ---------------------------------------------------------------------------

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

const mockStreamChat = vi.fn();
const mockRunPool = vi.fn();

vi.mock('@/services/llm/stream', () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
}));

vi.mock('@/lib/concurrency-pool', () => ({
  runPool: (...args: unknown[]) => mockRunPool(...args),
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
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
  getLabRunById: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn().mockResolvedValue(undefined),
  getAllPrompts: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { LAB_RUN_CONCURRENCY } from '@/config';
import type { PoolOptions, TaskFactory } from '@/lib/concurrency-pool';

import type { CellResult, LabState, ModelEntry, PromptEntry } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildModelEntry = (overrides?: Partial<ModelEntry>): ModelEntry => ({
  id: 'model-1',
  providerId: 'openrouter',
  modelKey: 'gpt-4o',
  name: 'GPT-4o',
  params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
  thinking: false,
  supportsThinking: false,
  expanded: false,
  accent: false,
  ...overrides,
});

const buildPromptEntry = (overrides?: Partial<PromptEntry>): PromptEntry => ({
  id: 'prompt-1',
  kind: 'custom',
  text: 'Explain TDD',
  edited: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getStore = (): LabState => usePromptTesterStore.getState() as LabState;

const resetStore = (): void => {
  usePromptTesterStore.setState(
    usePromptTesterStore.getInitialState
      ? usePromptTesterStore.getInitialState()
      : (usePromptTesterStore.getState() as LabState)
  );
};

// ---------------------------------------------------------------------------
// Tests — runPool concurrency (FR-006)
// ---------------------------------------------------------------------------

describe('runFull/runPartial — runPool integration (FR-006)', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();

    // Default: runPool executes all task factories sequentially and returns fulfilled results
    mockRunPool.mockImplementation(
      async (tasks: readonly TaskFactory<void>[], _options?: PoolOptions) => {
        const results: PromiseSettledResult<void>[] = [];
        const signal = new AbortController().signal;
        for (const task of tasks) {
          try {
            const value = await task(signal);
            results.push({ status: 'fulfilled', value });
          } catch (reason) {
            results.push({ status: 'rejected', reason });
          }
        }
        return results;
      }
    );

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'response' };
    });
  });

  it('should call runPool with LAB_RUN_CONCURRENCY for runFull when runParallel=true mode=same-model (default)', async () => {
    // Arrange — default: runParallel=true, parallelismMode='same-model'
    // → deriveParallelRunsSettings: serialAcrossModels=true, serialWithinModel=false → concurrency=LAB_RUN_CONCURRENCY
    usePromptTesterStore.setState(
      () =>
        ({
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      await store.runFull();
    });

    // Assert — serialWithinModel=false → concurrency = LAB_RUN_CONCURRENCY
    expect(mockRunPool).toHaveBeenCalledTimes(1);
    const callArgs = mockRunPool.mock.calls[0] as [readonly TaskFactory<void>[], PoolOptions];
    expect(callArgs[1]).toEqual(expect.objectContaining({ concurrency: LAB_RUN_CONCURRENCY }));
  });

  it('should cap runFull to concurrency 1 when runParallel=false (serial-all)', async () => {
    // Arrange — runParallel=false → serialWithinModel=true → concurrency=1 for every group
    usePromptTesterStore.setState(
      () =>
        ({
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' }), buildPromptEntry({ id: 'prompt-2' })],
        }) as Partial<LabState>
    );

    const store = usePromptTesterStore.getState() as LabState & {
      runFull: () => Promise<void>;
      setRunParallel: (v: boolean) => void;
    };

    act(() => {
      store.setRunParallel(false);
    });

    // Act
    await act(async () => {
      await store.runFull();
    });

    // Assert — serialWithinModel=true → every group has concurrency=1
    expect(mockRunPool).toHaveBeenCalledTimes(1);
    const callArgs = mockRunPool.mock.calls[0] as [readonly TaskFactory<void>[], PoolOptions];
    expect(callArgs[1]).toEqual(expect.objectContaining({ concurrency: 1 }));
  });

  it('should call runPool with LAB_RUN_CONCURRENCY for runPartial when runParallel=true mode=same-model (default)', async () => {
    // Arrange — two models, one already done; default runParallel=true, parallelismMode='same-model'
    // → serialWithinModel=false → concurrency=LAB_RUN_CONCURRENCY
    const doneCell: CellResult = {
      id: 'model-1::prompt-1',
      modelId: 'model-1',
      promptId: 'prompt-1',
      userPromptHash: 'abc',
      output: 'cached',
      latencyMs: 100,
      tokens: 10,
      cost: 0,
      ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
      cached: false,
      status: 'done',
    };

    usePromptTesterStore.setState((s: unknown) => {
      const state = s as LabState;
      return {
        models: [
          buildModelEntry({ id: 'model-1' }),
          buildModelEntry({ id: 'model-2', modelKey: 'gpt-4-turbo', name: 'GPT-4 Turbo' }),
        ],
        prompts: [buildPromptEntry({ id: 'prompt-1' })],
        runs: state.runs.map(r => (r.id === state.activeRunId ? { ...r, cells: [doneCell] } : r)),
      } as Partial<LabState>;
    });

    const store = usePromptTesterStore.getState() as LabState & { runPartial: () => Promise<void> };

    // Act
    await act(async () => {
      await store.runPartial();
    });

    // Assert — serialWithinModel=false → concurrency = LAB_RUN_CONCURRENCY
    expect(mockRunPool).toHaveBeenCalledTimes(1);
    const callArgs = mockRunPool.mock.calls[0] as [readonly TaskFactory<void>[], PoolOptions];
    expect(callArgs[1]).toEqual(expect.objectContaining({ concurrency: LAB_RUN_CONCURRENCY }));
  });

  it('should pass correct number of task factories to runPool for runFull', async () => {
    // Arrange — 2 models × 2 prompts = 4 cells; scheduleRun groups by modelKey → 2 groups × 2 tasks each
    usePromptTesterStore.setState(
      () =>
        ({
          models: [
            buildModelEntry({ id: 'model-1' }),
            buildModelEntry({ id: 'model-2', modelKey: 'gpt-4-turbo', name: 'Turbo' }),
          ],
          prompts: [
            buildPromptEntry({ id: 'prompt-1' }),
            buildPromptEntry({ id: 'prompt-2', text: 'Second prompt' }),
          ],
        }) as Partial<LabState>
    );

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      await store.runFull();
    });

    // Assert — scheduleRun produces 2 groups (one per modelKey), runPool called once per group
    // Total task factories across all runPool calls = 4 (2 per group)
    expect(mockRunPool).toHaveBeenCalledTimes(2);
    const totalTasks = (
      mockRunPool.mock.calls as [readonly TaskFactory<void>[], PoolOptions][]
    ).reduce((sum, call) => sum + call[0].length, 0);
    expect(totalTasks).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Tests — per-cell error isolation (FR-010)
// ---------------------------------------------------------------------------

describe('runFull/runPartial — per-cell error isolation (FR-010)', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('should set status:error on failed cell while siblings reach done in runFull', async () => {
    // Arrange — 2 models × 1 prompt
    usePromptTesterStore.setState(
      () =>
        ({
          models: [
            buildModelEntry({ id: 'model-ok', providerId: 'openrouter', modelKey: 'gpt-4o' }),
            buildModelEntry({ id: 'model-fail', providerId: 'openrouter', modelKey: 'gpt-fail' }),
          ],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    // runPool executes tasks — one will throw (the failing model)
    mockRunPool.mockImplementation(
      async (tasks: readonly TaskFactory<void>[], _options?: PoolOptions) => {
        const results: PromiseSettledResult<void>[] = [];
        const signal = new AbortController().signal;
        for (const task of tasks) {
          try {
            const value = await task(signal);
            results.push({ status: 'fulfilled', value });
          } catch (reason) {
            results.push({ status: 'rejected', reason });
          }
        }
        return results;
      }
    );

    let _callIdx = 0;
    mockStreamChat.mockImplementation(async function* (opts: { modelId: string }) {
      _callIdx++;
      if (opts.modelId === 'gpt-fail') {
        throw new Error('Provider unavailable');
      }
      yield { type: 'chunk', text: 'success' };
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      await store.runFull();
    });

    // Assert
    const finalState = getStore();
    const activeRun = finalState.runs.find(r => r.id === finalState.activeRunId);
    const failedCell = activeRun?.cells.find(c => c.modelId === 'model-fail');
    const okCell = activeRun?.cells.find(c => c.modelId === 'model-ok');

    expect(failedCell?.status).toBe('error');
    expect(failedCell?.error).toBe('Provider unavailable');
    expect(okCell?.status).toBe('done');
  });

  it('should set status:error on failed cell while siblings reach done in runPartial', async () => {
    // Arrange — 2 models × 1 prompt, none cached
    usePromptTesterStore.setState(
      () =>
        ({
          models: [
            buildModelEntry({ id: 'model-ok', providerId: 'openrouter', modelKey: 'gpt-4o' }),
            buildModelEntry({ id: 'model-fail', providerId: 'openrouter', modelKey: 'gpt-fail' }),
          ],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    mockRunPool.mockImplementation(
      async (tasks: readonly TaskFactory<void>[], _options?: PoolOptions) => {
        const results: PromiseSettledResult<void>[] = [];
        const signal = new AbortController().signal;
        for (const task of tasks) {
          try {
            const value = await task(signal);
            results.push({ status: 'fulfilled', value });
          } catch (reason) {
            results.push({ status: 'rejected', reason });
          }
        }
        return results;
      }
    );

    mockStreamChat.mockImplementation(async function* (opts: { modelId: string }) {
      if (opts.modelId === 'gpt-fail') {
        throw new Error('Provider unavailable');
      }
      yield { type: 'chunk', text: 'success' };
    });

    const store = usePromptTesterStore.getState() as LabState & { runPartial: () => Promise<void> };

    // Act
    await act(async () => {
      await store.runPartial();
    });

    // Assert
    const finalState = getStore();
    const activeRun = finalState.runs.find(r => r.id === finalState.activeRunId);
    const failedCell = activeRun?.cells.find(c => c.modelId === 'model-fail');
    const okCell = activeRun?.cells.find(c => c.modelId === 'model-ok');

    expect(failedCell?.status).toBe('error');
    expect(failedCell?.error).toBe('Provider unavailable');
    expect(okCell?.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// B-001 — serialAcrossModels flag controls group execution order (regression)
// ---------------------------------------------------------------------------

describe('runFull — serialAcrossModels group concurrency (B-001)', () => {
  // Deferred-promise handle type
  type DeferredHandle = { resolve: () => void };

  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();

    // Default streamChat stub — not used for timing assertions here
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'response' };
    });
  });

  it('should fire only 1st group runPool before resolving it when serialAcrossModels=true (runParallel=true mode=same-model)', async () => {
    // Arrange — 2 models with DISTINCT modelKey → scheduleRun produces 2 groups
    // default: runParallel=true, parallelismMode='same-model' → serialAcrossModels=true, serialWithinModel=false
    usePromptTesterStore.setState(
      () =>
        ({
          models: [
            buildModelEntry({ id: 'model-a', modelKey: 'model-alpha', name: 'Alpha' }),
            buildModelEntry({ id: 'model-b', modelKey: 'model-beta', name: 'Beta' }),
          ],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    const handles: DeferredHandle[] = [];
    mockRunPool.mockImplementation(
      () =>
        new Promise<PromiseSettledResult<void>[]>(resolve => {
          handles.push({
            resolve: () => resolve([{ status: 'fulfilled', value: undefined }]),
          });
        })
    );

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act — kick off without awaiting
    void store.runFull();

    // Flush microtasks so the first group's runPool call lands
    await act(async () => {
      await Promise.resolve();
    });

    // Assert — only 1st group's runPool has been called
    expect(mockRunPool).toHaveBeenCalledTimes(1);

    // Resolve the 1st group and flush again
    handles[0].resolve();
    await act(async () => {
      await Promise.resolve();
    });

    // Assert — 2nd group's runPool is now called
    expect(mockRunPool).toHaveBeenCalledTimes(2);

    // Clean up — resolve 2nd group so the store settles
    handles[1]?.resolve();
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('should fire BOTH groups runPool before any resolves when serialAcrossModels=false (runParallel=true mode=everything)', async () => {
    // Arrange — 2 models with DISTINCT modelKey → scheduleRun produces 2 groups
    // runParallel=true, parallelismMode='everything' → serialAcrossModels=false, serialWithinModel=false
    usePromptTesterStore.setState(
      () =>
        ({
          models: [
            buildModelEntry({ id: 'model-a', modelKey: 'model-alpha', name: 'Alpha' }),
            buildModelEntry({ id: 'model-b', modelKey: 'model-beta', name: 'Beta' }),
          ],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    const storeForMode = usePromptTesterStore.getState() as LabState & {
      setParallelismMode: (m: 'same-model' | 'everything') => void;
    };
    act(() => {
      storeForMode.setParallelismMode('everything');
    });

    const handles: DeferredHandle[] = [];
    mockRunPool.mockImplementation(
      () =>
        new Promise<PromiseSettledResult<void>[]>(resolve => {
          handles.push({
            resolve: () => resolve([{ status: 'fulfilled', value: undefined }]),
          });
        })
    );

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act — kick off without awaiting
    void store.runFull();

    // Flush microtasks — concurrent execution fires all groups immediately
    await act(async () => {
      await Promise.resolve();
    });

    // Assert — BOTH groups' runPool calls have fired before any resolves
    expect(mockRunPool).toHaveBeenCalledTimes(2);

    // Clean up — resolve both so the store settles
    handles[0]?.resolve();
    handles[1]?.resolve();
    await act(async () => {
      await Promise.resolve();
    });
  });
});
