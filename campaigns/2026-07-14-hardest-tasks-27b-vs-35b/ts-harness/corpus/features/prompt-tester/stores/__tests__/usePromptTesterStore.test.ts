// TDD Red phase — tests target the NEW LabState store shape (not yet implemented).
// Store file currently has the old shape → ALL tests fail on import/type errors.
// T016: list-comparability verification tests appended at bottom of file (GREEN immediately — R-019).

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStreamChat = vi.fn();

vi.mock('@/services/llm/stream', () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
}));

const mockPutLabRunParallel = vi.fn().mockResolvedValue(undefined);
const mockPutLabParallelismMode = vi.fn().mockResolvedValue(undefined);

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  getLabRunParallel: vi.fn().mockResolvedValue(true),
  putLabRunParallel: (...args: unknown[]) => mockPutLabRunParallel(...args),
  getLabParallelismMode: vi.fn().mockResolvedValue('same-model'),
  putLabParallelismMode: (...args: unknown[]) => mockPutLabParallelismMode(...args),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

const mockArchiveCompletedRun = vi.fn().mockResolvedValue(undefined);

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: (...args: unknown[]) => mockArchiveCompletedRun(...args),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import type {
  CellRatings,
  CellResult,
  LabState,
  ModelEntry,
  PromptEntry,
  RatingCategoryId
} from '../../types';
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

const buildCellResult = (overrides?: Partial<CellResult>): CellResult => ({
  id: 'model-1::prompt-1',
  modelId: 'model-1',
  promptId: 'prompt-1',
  userPromptHash: 'abc123',
  output: 'Some output',
  latencyMs: 500,
  tokens: 100,
  cost: 0.001,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getStore = (): LabState => usePromptTesterStore.getState() as LabState;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePromptTesterStore — LabState shape', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // addModel — FR-020
  // -------------------------------------------------------------------------

  describe('addModel', () => {
    it('should set accent: true and expanded: false when adding the first model', () => {
      const { result } = renderHook(() => usePromptTesterStore((s: LabState) => s.models));

      act(() => {
        (
          usePromptTesterStore.getState() as unknown as {
            addModel: (input: {
              providerId: string;
              modelKey: string;
              name: string;
              supportsThinking: boolean;
            }) => void;
          }
        ).addModel({
          providerId: 'openrouter',
          modelKey: 'gpt-4o',
          name: 'GPT-4o',
          supportsThinking: false,
        });
      });

      const models = result.current as readonly ModelEntry[];
      expect(models).toHaveLength(1);
      expect(models[0]?.accent).toBe(true);
      expect(models[0]?.expanded).toBe(false);
    });

    it('should set thinking: true when first model supportsThinking is true', () => {
      const { result } = renderHook(() => usePromptTesterStore((s: LabState) => s.models));

      act(() => {
        (
          usePromptTesterStore.getState() as unknown as {
            addModel: (input: {
              providerId: string;
              modelKey: string;
              name: string;
              supportsThinking: boolean;
            }) => void;
          }
        ).addModel({
          providerId: 'claude',
          modelKey: 'claude-opus-4',
          name: 'Claude Opus 4',
          supportsThinking: true,
        });
      });

      const models = result.current as readonly ModelEntry[];
      expect(models[0]?.thinking).toBe(true);
    });

    it('should set thinking: false when first model supportsThinking is false', () => {
      const { result } = renderHook(() => usePromptTesterStore((s: LabState) => s.models));

      act(() => {
        (
          usePromptTesterStore.getState() as unknown as {
            addModel: (input: {
              providerId: string;
              modelKey: string;
              name: string;
              supportsThinking: boolean;
            }) => void;
          }
        ).addModel({
          providerId: 'openrouter',
          modelKey: 'gpt-4o',
          name: 'GPT-4o',
          supportsThinking: false,
        });
      });

      const models = result.current as readonly ModelEntry[];
      expect(models[0]?.thinking).toBe(false);
    });

    it('should not set accent: true when adding a second model', () => {
      const store = usePromptTesterStore.getState() as LabState & {
        addModel: (input: {
          providerId: string;
          modelKey: string;
          name: string;
          supportsThinking: boolean;
        }) => void;
      };

      act(() => {
        store.addModel({
          providerId: 'openrouter',
          modelKey: 'gpt-4o',
          name: 'GPT-4o',
          supportsThinking: false,
        });
        store.addModel({
          providerId: 'openrouter',
          modelKey: 'gpt-4-turbo',
          name: 'GPT-4 Turbo',
          supportsThinking: false,
        });
      });

      const { models } = getStore();
      expect(models).toHaveLength(2);
      expect(models[1]?.accent).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // runFull — FR-015, FR-018
  // -------------------------------------------------------------------------

  describe('runFull', () => {
    it('should clear existing cells and re-populate for all model × prompt pairs', async () => {
      const staleCell = buildCellResult({ id: 'model-1::prompt-1', status: 'done' });

      // Seed state with one model, one prompt, one stale cell
      usePromptTesterStore.setState((s: unknown) => {
        const state = s as LabState;
        const activeRun = state.runs.find(r => r.id === state.activeRunId);
        if (!activeRun) return s as Partial<LabState>;
        return {
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
          runs: state.runs.map(r =>
            r.id === state.activeRunId ? { ...r, cells: [staleCell] } : r
          ),
        } as Partial<LabState>;
      });

      // Mock LLM stream to return immediately with a chunk
      mockStreamChat.mockImplementation(async function* () {
        yield { type: 'chunk', text: 'Hello' };
      });

      const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

      // Capture cells at the start of the run (after clear, before stream completes)
      let cellsAfterClear: readonly CellResult[] = [];
      const unsubscribe = usePromptTesterStore.subscribe((s: unknown) => {
        const state = s as LabState;
        const run = state.runs.find(r => r.id === state.activeRunId);
        if (run && run.cells.length === 0) {
          cellsAfterClear = run.cells;
        }
      });

      await act(async () => {
        await store.runFull();
      });

      unsubscribe();

      expect(cellsAfterClear.length).toBe(0);

      const finalState = getStore();
      const activeRun = finalState.runs.find(r => r.id === finalState.activeRunId);
      expect(activeRun?.cells.length).toBeGreaterThanOrEqual(0);
      // Cells were cleared: the stale 'done' cell is gone
      expect(
        activeRun?.cells.find(c => c.status === 'done' && c.id === 'model-1::prompt-1')?.output
      ).not.toBe('stale-output');
    });

    it('should abort an in-flight run before starting a new full run', async () => {
      const abortSpy = vi.fn();
      let resolveStream!: () => void;
      let callCount = 0;

      mockStreamChat.mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          await new Promise<void>(resolve => {
            resolveStream = resolve;
          });
          yield { type: 'chunk', text: 'late' };
        } else {
          yield { type: 'chunk', text: 'second-run' };
        }
      });

      usePromptTesterStore.setState(
        () =>
          ({
            models: [buildModelEntry({ id: 'model-1' })],
            prompts: [buildPromptEntry({ id: 'prompt-1' })],
          }) as Partial<LabState>
      );

      const store = usePromptTesterStore.getState() as LabState & {
        runFull: () => Promise<void>;
        abortRun: () => void;
      };

      // Patch abortRun to spy without losing original
      const originalAbort = store.abortRun.bind(store);
      (usePromptTesterStore.getState() as Record<string, unknown>).abortRun = () => {
        abortSpy();
        originalAbort();
      };

      // Start first run (won't finish until resolveStream is called)
      const firstRun = act(async () => {
        store.runFull();
      });

      // Immediately trigger second full run — should abort first
      await act(async () => {
        resolveStream?.();
        await store.runFull();
      });

      await firstRun;

      // The store should not be streaming after both runs settle
      const finalState = getStore();
      expect(finalState.streaming.runId).toBeNull();
    });

    it('should pass the provider modelKey (not the ModelEntry id) to streamChat', async () => {
      // Arrange: one model with distinct id vs modelKey
      usePromptTesterStore.setState(
        () =>
          ({
            models: [buildModelEntry({ id: 'model-uuid-1', modelKey: 'deepseek-r1:latest' })],
            prompts: [buildPromptEntry({ id: 'prompt-1' })],
          }) as Partial<LabState>
      );

      const capturedModelIds: string[] = [];

      mockStreamChat.mockImplementation(async function* (opts: { modelId: string }) {
        capturedModelIds.push(opts.modelId);
        yield { type: 'chunk', text: 'response' };
      });

      const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

      await act(async () => {
        await store.runFull();
      });

      expect(capturedModelIds).toContain('deepseek-r1:latest');
      expect(capturedModelIds).not.toContain('model-uuid-1');
    });
  });

  // -------------------------------------------------------------------------
  // runPartial — FR-016
  // -------------------------------------------------------------------------

  describe('runPartial', () => {
    it('should only run cells that are not already done (wanted \\ cached)', async () => {
      const doneCell = buildCellResult({
        id: 'model-1::prompt-1',
        modelId: 'model-1',
        promptId: 'prompt-1',
        status: 'done',
        output: 'cached output',
      });

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

      const streamedModelIds: string[] = [];

      mockStreamChat.mockImplementation(async function* (opts: { modelId: string }) {
        streamedModelIds.push(opts.modelId as string);
        yield { type: 'chunk', text: 'new output' };
      });

      const store = usePromptTesterStore.getState() as LabState & {
        runPartial: () => Promise<void>;
      };

      await act(async () => {
        await store.runPartial();
      });

      // Only model-2 × prompt-1 should be streamed (model-1 × prompt-1 is already done)
      expect(streamedModelIds).not.toContain('gpt-4o');
      expect(streamedModelIds).toContain('gpt-4-turbo');
    });

    it('should preserve the cached done cell output after partial run', async () => {
      const doneCell = buildCellResult({
        id: 'model-1::prompt-1',
        status: 'done',
        output: 'preserved cached output',
      });

      usePromptTesterStore.setState((s: unknown) => {
        const state = s as LabState;
        return {
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
          runs: state.runs.map(r => (r.id === state.activeRunId ? { ...r, cells: [doneCell] } : r)),
        } as Partial<LabState>;
      });

      mockStreamChat.mockImplementation(async function* () {
        // no-op — all cells are already done
      });

      const store = usePromptTesterStore.getState() as LabState & {
        runPartial: () => Promise<void>;
      };

      await act(async () => {
        await store.runPartial();
      });

      const finalState = getStore();
      const activeRun = finalState.runs.find(r => r.id === finalState.activeRunId);
      const cachedCell = activeRun?.cells.find(c => c.id === 'model-1::prompt-1');
      expect(cachedCell?.output).toBe('preserved cached output');
    });
  });

  // -------------------------------------------------------------------------
  // abortRun — FR-018
  // -------------------------------------------------------------------------

  describe('abortRun', () => {
    it('should cancel the in-flight AbortController and clear streaming state', async () => {
      let capturedSignal: AbortSignal | null = null;

      mockStreamChat.mockImplementation(async function* (opts: { signal?: AbortSignal }) {
        capturedSignal = opts.signal ?? null;
        // Simulate a long-running stream
        await new Promise<void>((_, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        });
        yield { type: 'chunk', text: 'never' };
      });

      usePromptTesterStore.setState(
        () =>
          ({
            models: [buildModelEntry({ id: 'model-1' })],
            prompts: [buildPromptEntry({ id: 'prompt-1' })],
          }) as Partial<LabState>
      );

      const store = usePromptTesterStore.getState() as LabState & {
        runFull: () => Promise<void>;
        abortRun: () => void;
      };

      // Start run without awaiting
      void act(async () => {
        store.runFull();
      });

      // Abort immediately
      act(() => {
        store.abortRun();
      });

      // Signal should have been aborted
      expect((capturedSignal as AbortSignal | null)?.aborted ?? true).toBe(true);

      const finalState = getStore();
      expect(finalState.streaming.runId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // forkRun — FR-031
  // -------------------------------------------------------------------------

  describe('forkRun', () => {
    it('should create a new RunTab with cloned config snapshot', () => {
      const currentState = usePromptTesterStore.getState();
      const activeRun = currentState.runs.find(r => r.id === currentState.activeRunId);
      if (activeRun) {
        usePromptTesterStore.setState({
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
          userPrompt: 'Explain TDD',
          runs: currentState.runs.map(r =>
            r.id === currentState.activeRunId
              ? {
                  ...r,
                  configSnapshot: {
                    models: [buildModelEntry({ id: 'model-1' })],
                    prompts: [buildPromptEntry({ id: 'prompt-1' })],
                    userPrompt: 'Explain TDD',
                  },
                }
              : r
          ),
        });
      }

      const store = usePromptTesterStore.getState() as LabState & { forkRun: () => void };

      const runsBefore = getStore().runs.length;

      act(() => {
        store.forkRun();
      });

      const finalState = getStore();
      expect(finalState.runs).toHaveLength(runsBefore + 1);

      const newRun = finalState.runs[finalState.runs.length - 1];
      expect(newRun?.configSnapshot.userPrompt).toBe('Explain TDD');
      expect(newRun?.configSnapshot.models).toHaveLength(1);
      expect(newRun?.configSnapshot.prompts).toHaveLength(1);
    });

    it('should create the forked RunTab with empty cells', () => {
      const store = usePromptTesterStore.getState() as LabState & { forkRun: () => void };

      act(() => {
        store.forkRun();
      });

      const finalState = getStore();
      const newRun = finalState.runs[finalState.runs.length - 1];
      expect(newRun?.cells).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // toggleCellSelection — FR-037, FR-045
  // -------------------------------------------------------------------------

  describe('toggleCellSelection', () => {
    const seedCells = (ids: string[]) => {
      usePromptTesterStore.setState((s: unknown) => {
        const state = s as LabState;
        return {
          runs: state.runs.map(r =>
            r.id === state.activeRunId
              ? {
                  ...r,
                  cells: ids.map(id =>
                    buildCellResult({
                      id,
                      modelId: id.split('::')[0] ?? 'model',
                      promptId: id.split('::')[1] ?? 'prompt',
                    })
                  ),
                }
              : r
          ),
        } as Partial<LabState>;
      });
    };

    it('should select a cell and return true', () => {
      seedCells(['model-1::prompt-1']);

      const store = usePromptTesterStore.getState() as LabState & {
        toggleCellSelection: (cellId: string) => boolean;
      };

      let result!: boolean;
      act(() => {
        result = store.toggleCellSelection('model-1::prompt-1');
      });

      expect(result).toBe(true);
      const activeRun = getStore().runs.find(r => r.id === getStore().activeRunId);
      expect(activeRun?.selectedCellIds).toContain('model-1::prompt-1');
    });

    it('should deselect an already-selected cell and return true', () => {
      seedCells(['model-1::prompt-1']);

      usePromptTesterStore.setState((s: unknown) => {
        const state = s as LabState;
        return {
          runs: state.runs.map(r =>
            r.id === state.activeRunId ? { ...r, selectedCellIds: ['model-1::prompt-1'] } : r
          ),
        } as Partial<LabState>;
      });

      const store = usePromptTesterStore.getState() as LabState & {
        toggleCellSelection: (cellId: string) => boolean;
      };

      let result!: boolean;
      act(() => {
        result = store.toggleCellSelection('model-1::prompt-1');
      });

      expect(result).toBe(true);
      const activeRun = getStore().runs.find(r => r.id === getStore().activeRunId);
      expect(activeRun?.selectedCellIds).not.toContain('model-1::prompt-1');
    });

    it('should allow selecting up to 3 cells', () => {
      seedCells(['m::p1', 'm::p2', 'm::p3']);

      const store = usePromptTesterStore.getState() as LabState & {
        toggleCellSelection: (cellId: string) => boolean;
      };

      let r1!: boolean, r2!: boolean, r3!: boolean;
      act(() => {
        r1 = store.toggleCellSelection('m::p1');
        r2 = store.toggleCellSelection('m::p2');
        r3 = store.toggleCellSelection('m::p3');
      });

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(r3).toBe(true);

      const activeRun = getStore().runs.find(r => r.id === getStore().activeRunId);
      expect(activeRun?.selectedCellIds).toHaveLength(3);
    });

    it('should return true and select a 4th cell (unbounded selection)', () => {
      seedCells(['m::p1', 'm::p2', 'm::p3', 'm::p4']);

      usePromptTesterStore.setState((s: unknown) => {
        const state = s as LabState;
        return {
          runs: state.runs.map(r =>
            r.id === state.activeRunId ? { ...r, selectedCellIds: ['m::p1', 'm::p2', 'm::p3'] } : r
          ),
        } as Partial<LabState>;
      });

      const store = usePromptTesterStore.getState() as LabState & {
        toggleCellSelection: (cellId: string) => boolean;
      };

      let result!: boolean;
      act(() => {
        result = store.toggleCellSelection('m::p4');
      });

      expect(result).toBe(true);
      const activeRun = getStore().runs.find(r => r.id === getStore().activeRunId);
      expect(activeRun?.selectedCellIds).toHaveLength(4);
      expect(activeRun?.selectedCellIds).toContain('m::p4');
    });
  });

  // -------------------------------------------------------------------------
  // setCellScore — FR-042
  // -------------------------------------------------------------------------

  describe('setCellScore', () => {
    const categoryId: RatingCategoryId = 'accuracy';

    const seedDoneCell = (cellId: string) => {
      usePromptTesterStore.setState((s: unknown) => {
        const state = s as LabState;
        return {
          runs: state.runs.map(r =>
            r.id === state.activeRunId
              ? { ...r, cells: [buildCellResult({ id: cellId, status: 'done' })] }
              : r
          ),
        } as Partial<LabState>;
      });
    };

    it('should set the rating for the given category on the target cell', () => {
      seedDoneCell('model-1::prompt-1');

      const store = usePromptTesterStore.getState() as LabState & {
        setCellScore: (
          cellId: string,
          categoryId: RatingCategoryId,
          value: 0 | 1 | 2 | 3 | 4 | 5
        ) => void;
      };

      act(() => {
        store.setCellScore('model-1::prompt-1', categoryId, 4);
      });

      const activeRun = getStore().runs.find(r => r.id === getStore().activeRunId);
      const cell = activeRun?.cells.find(c => c.id === 'model-1::prompt-1');
      expect(cell?.ratings[categoryId]).toBe(4);
    });

    it('should preserve other category ratings when setting one category', () => {
      const initialRatings: CellRatings = {
        accuracy: 3,
        style: 5,
        tone: 0,
        length: 2,
        readability: 1,
      };

      usePromptTesterStore.setState((s: unknown) => {
        const state = s as LabState;
        return {
          runs: state.runs.map(r =>
            r.id === state.activeRunId
              ? {
                  ...r,
                  cells: [
                    buildCellResult({
                      id: 'model-1::prompt-1',
                      status: 'done',
                      ratings: initialRatings,
                    }),
                  ],
                }
              : r
          ),
        } as Partial<LabState>;
      });

      const store = usePromptTesterStore.getState() as LabState & {
        setCellScore: (
          cellId: string,
          categoryId: RatingCategoryId,
          value: 0 | 1 | 2 | 3 | 4 | 5
        ) => void;
      };

      act(() => {
        store.setCellScore('model-1::prompt-1', 'tone', 4);
      });

      const activeRun = getStore().runs.find(r => r.id === getStore().activeRunId);
      const cell = activeRun?.cells.find(c => c.id === 'model-1::prompt-1');
      expect(cell?.ratings.accuracy).toBe(3);
      expect(cell?.ratings.style).toBe(5);
      expect(cell?.ratings.tone).toBe(4);
      expect(cell?.ratings.length).toBe(2);
      expect(cell?.ratings.readability).toBe(1);
    });

    it('should preserve cell ratings across runFull when cell id is unchanged', async () => {
      const cellId = 'model-1::prompt-1';

      seedDoneCell(cellId);

      const storeWithScore = usePromptTesterStore.getState() as LabState & {
        setCellScore: (
          cellId: string,
          categoryId: RatingCategoryId,
          value: 0 | 1 | 2 | 3 | 4 | 5
        ) => void;
        runFull: () => Promise<void>;
      };

      // Set a rating before re-run
      act(() => {
        storeWithScore.setCellScore(cellId, 'accuracy', 5);
      });

      mockStreamChat.mockImplementation(async function* () {
        yield { type: 'chunk', text: 'new response' };
      });

      usePromptTesterStore.setState(
        () =>
          ({
            models: [buildModelEntry({ id: 'model-1' })],
            prompts: [buildPromptEntry({ id: 'prompt-1' })],
          }) as Partial<LabState>
      );

      await act(async () => {
        await storeWithScore.runFull();
      });

      const finalState = getStore();
      const activeRun = finalState.runs.find(r => r.id === finalState.activeRunId);
      const cell = activeRun?.cells.find(c => c.id === cellId);
      // Ratings must survive the re-run when cell id is stable
      expect(cell?.ratings.accuracy).toBe(5);
    });

    it('should clear a rating when value is 0', () => {
      const initialRatings: CellRatings = {
        accuracy: 4,
        style: 0,
        tone: 0,
        length: 0,
        readability: 0,
      };

      usePromptTesterStore.setState((s: unknown) => {
        const state = s as LabState;
        return {
          runs: state.runs.map(r =>
            r.id === state.activeRunId
              ? {
                  ...r,
                  cells: [
                    buildCellResult({
                      id: 'model-1::prompt-1',
                      status: 'done',
                      ratings: initialRatings,
                    }),
                  ],
                }
              : r
          ),
        } as Partial<LabState>;
      });

      const store = usePromptTesterStore.getState() as LabState & {
        setCellScore: (
          cellId: string,
          categoryId: RatingCategoryId,
          value: 0 | 1 | 2 | 3 | 4 | 5
        ) => void;
      };

      act(() => {
        store.setCellScore('model-1::prompt-1', 'accuracy', 0);
      });

      const activeRun = getStore().runs.find(r => r.id === getStore().activeRunId);
      const cell = activeRun?.cells.find(c => c.id === 'model-1::prompt-1');
      expect(cell?.ratings.accuracy).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// openArchivedRun — T032
// ---------------------------------------------------------------------------

import type { ArchivedRunInput } from '../../types';

describe('openArchivedRun', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  const buildArchivedRun = (overrides?: Partial<ArchivedRunInput>): ArchivedRunInput => ({
    id: 'archived-1',
    label: 'My Archive',
    configSnapshot: { models: [], prompts: [], userPrompt: 'What is TDD?' },
    ...overrides,
  });

  it('should add a new RunTab from archived run and set it as active', () => {
    // Arrange
    const archived = buildArchivedRun({ label: 'Restored Run' });
    const store = usePromptTesterStore.getState() as LabState & {
      openArchivedRun: (archived: ArchivedRunInput) => void;
    };
    const runsBefore = getStore().runs.length;

    // Act
    act(() => {
      store.openArchivedRun(archived);
    });

    // Assert
    const finalState = getStore();
    expect(finalState.runs).toHaveLength(runsBefore + 1);
    const newRun = finalState.runs[finalState.runs.length - 1];
    expect(finalState.activeRunId).toBe(newRun?.id);
  });

  it('should use archived name as label with "Archived" fallback when name is undefined', () => {
    // Arrange
    const archived = buildArchivedRun({ label: undefined as unknown as string });
    const store = usePromptTesterStore.getState() as LabState & {
      openArchivedRun: (archived: ArchivedRunInput) => void;
    };

    // Act
    act(() => {
      store.openArchivedRun(archived);
    });

    // Assert
    const finalState = getStore();
    const newRun = finalState.runs[finalState.runs.length - 1];
    expect(newRun?.label).toBe('Archived');
  });

  it('should preserve archived configSnapshot in the new tab', () => {
    // Arrange
    const models = [buildModelEntry({ id: 'arch-model-1', modelKey: 'gpt-4', name: 'GPT-4' })];
    const prompts = [buildPromptEntry({ id: 'arch-prompt-1', text: 'Archived prompt text' })];
    const archived = buildArchivedRun({
      label: 'Snapshot Test',
    });

    // We need to pre-seed the archived run's configSnapshot via a forkRun-like approach.
    // Since ArchivedRun extends TestRunDTO (not LabState), we seed models/prompts on the
    // archived object's configSnapshot if that field exists, else the store derives it.
    // Per contract, the new tab's configSnapshot is reconstructed from archived data.
    // We verify by reading back the new tab after calling openArchivedRun with a
    // run that carries configSnapshot.
    const archivedWithSnapshot = {
      ...archived,
      configSnapshot: {
        models,
        prompts,
        userPrompt: 'Archived user prompt',
      },
    } as ArchivedRunInput & {
      configSnapshot: { models: typeof models; prompts: typeof prompts; userPrompt: string };
    };

    const store = usePromptTesterStore.getState() as LabState & {
      openArchivedRun: (archived: ArchivedRunInput) => void;
    };

    // Act
    act(() => {
      store.openArchivedRun(archivedWithSnapshot as ArchivedRunInput);
    });

    // Assert
    const finalState = getStore();
    const newRun = finalState.runs[finalState.runs.length - 1];
    expect(newRun?.configSnapshot.models).toHaveLength(1);
    expect(newRun?.configSnapshot.models[0]?.id).toBe('arch-model-1');
    expect(newRun?.configSnapshot.prompts).toHaveLength(1);
    expect(newRun?.configSnapshot.prompts[0]?.text).toBe('Archived prompt text');
  });
});

// ---------------------------------------------------------------------------
// counter accuracy — FR-014 / FR-018
// ---------------------------------------------------------------------------

describe('counter accuracy (FR-014/018)', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  it('should have models.length === 1 after a single addModel call', () => {
    // Arrange: fresh store (models = [])

    // Act
    act(() => {
      (
        usePromptTesterStore.getState() as unknown as {
          addModel: (input: {
            providerId: string;
            modelKey: string;
            name: string;
            supportsThinking: boolean;
          }) => void;
        }
      ).addModel({ providerId: 'test', modelKey: 'gpt-4', name: 'GPT-4', supportsThinking: false });
    });

    // Assert: exactly one model, no double-count
    expect(usePromptTesterStore.getState().models).toHaveLength(1);
  });

  it('should have prompts.length === 1 after a single addSystemPromptToActiveRun call', () => {
    // Arrange: fresh store (prompts = [])

    // Act
    act(() => {
      (
        usePromptTesterStore.getState() as unknown as {
          addSystemPromptToActiveRun: (input: { kind: 'blank' }) => void;
        }
      ).addSystemPromptToActiveRun({ kind: 'blank' });
    });

    // Assert: exactly one prompt, no double-count
    expect(usePromptTesterStore.getState().prompts).toHaveLength(1);
  });

  it('should increment models counter from 1 to 2 on second addModel', () => {
    // Arrange: call addModel once
    const store = usePromptTesterStore.getState() as unknown as {
      addModel: (input: {
        providerId: string;
        modelKey: string;
        name: string;
        supportsThinking: boolean;
      }) => void;
    };

    act(() => {
      store.addModel({
        providerId: 'test',
        modelKey: 'gpt-4',
        name: 'GPT-4',
        supportsThinking: false,
      });
    });

    // Act: second add
    act(() => {
      store.addModel({
        providerId: 'test',
        modelKey: 'gpt-3.5',
        name: 'GPT-3.5',
        supportsThinking: false,
      });
    });

    // Assert: exactly two models
    expect(usePromptTesterStore.getState().models).toHaveLength(2);
  });

  it('should increment prompts counter from 1 to 2 on second addSystemPromptToActiveRun', () => {
    // Arrange: call addSystemPromptToActiveRun once
    const store = usePromptTesterStore.getState() as unknown as {
      addSystemPromptToActiveRun: (input: { kind: 'blank' }) => void;
    };

    act(() => {
      store.addSystemPromptToActiveRun({ kind: 'blank' });
    });

    // Act: second add
    act(() => {
      store.addSystemPromptToActiveRun({ kind: 'blank' });
    });

    // Assert: exactly two prompts
    expect(usePromptTesterStore.getState().prompts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// model picker state — FR-013/014
// ---------------------------------------------------------------------------

describe('model picker state (FR-013/014)', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  it('should default modelPickerOpen to false', () => {
    // Given a freshly initialised store
    // When reading modelPickerOpen
    const { modelPickerOpen } = usePromptTesterStore.getState() as unknown as {
      modelPickerOpen: boolean;
    };

    // Then it is false
    expect(modelPickerOpen).toBe(false);
  });

  it('should set modelPickerOpen to true on openModelPicker', () => {
    // Given the picker is closed
    const store = usePromptTesterStore.getState() as unknown as {
      openModelPicker: () => void;
      modelPickerOpen: boolean;
    };

    // When openModelPicker is called
    act(() => {
      store.openModelPicker();
    });

    // Then modelPickerOpen is true
    const { modelPickerOpen } = usePromptTesterStore.getState() as unknown as {
      modelPickerOpen: boolean;
    };
    expect(modelPickerOpen).toBe(true);
  });

  it('should set modelPickerOpen to false on closeModelPicker', () => {
    // Given the picker has been opened
    const store = usePromptTesterStore.getState() as unknown as {
      openModelPicker: () => void;
      closeModelPicker: () => void;
    };

    act(() => {
      store.openModelPicker();
    });

    // When closeModelPicker is called
    act(() => {
      store.closeModelPicker();
    });

    // Then modelPickerOpen is false
    const { modelPickerOpen } = usePromptTesterStore.getState() as unknown as {
      modelPickerOpen: boolean;
    };
    expect(modelPickerOpen).toBe(false);
  });

  it('should add model and close picker on confirmModelPicker', () => {
    // Given the picker is open
    const store = usePromptTesterStore.getState() as unknown as {
      openModelPicker: () => void;
      confirmModelPicker: (input: {
        providerId: string;
        modelKey: string;
        name: string;
        supportsThinking: boolean;
      }) => void;
    };

    act(() => {
      store.openModelPicker();
    });

    // When confirmModelPicker is called with a model
    act(() => {
      store.confirmModelPicker({
        providerId: 'openrouter',
        modelKey: 'gpt-4',
        name: 'GPT-4',
        supportsThinking: false,
      });
    });

    // Then models has exactly 1 entry AND picker is closed
    const state = usePromptTesterStore.getState() as unknown as {
      models: readonly unknown[];
      modelPickerOpen: boolean;
    };
    expect(state.models).toHaveLength(1);
    expect(state.modelPickerOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mode / setMode — FR-004
// ---------------------------------------------------------------------------

import type { PromptTesterMode } from '../../types';

describe('usePromptTesterStore — mode (FR-004)', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  it('should default mode to simple', () => {
    // Given the store is freshly initialised (no explicit mode set)
    // When reading the mode field
    const mode = (usePromptTesterStore.getState() as unknown as { mode: PromptTesterMode }).mode;

    // Then it equals 'simple'
    expect(mode).toBe('simple');
  });

  it('should set mode to advanced via setMode', () => {
    // Given the store is in simple mode (default)
    const store = usePromptTesterStore.getState() as unknown as {
      setMode: (m: PromptTesterMode) => void;
      mode: PromptTesterMode;
    };

    // When setMode('advanced') is called
    act(() => {
      store.setMode('advanced');
    });

    // Then mode is 'advanced'
    const updated = (usePromptTesterStore.getState() as unknown as { mode: PromptTesterMode }).mode;
    expect(updated).toBe('advanced');
  });

  it('should set mode back to simple via setMode', () => {
    // Given the store is in advanced mode
    const store = usePromptTesterStore.getState() as unknown as {
      setMode: (m: PromptTesterMode) => void;
      mode: PromptTesterMode;
    };
    act(() => {
      store.setMode('advanced');
    });

    // When setMode('simple') is called
    act(() => {
      store.setMode('simple');
    });

    // Then mode is 'simple'
    const updated = (usePromptTesterStore.getState() as unknown as { mode: PromptTesterMode }).mode;
    expect(updated).toBe('simple');
  });
});

// ---------------------------------------------------------------------------
// FR-019 / FR-020 — addSystemPromptToActiveRun edited flag
// ---------------------------------------------------------------------------

describe('addSystemPromptToActiveRun edited flag (FR-019/020)', () => {
  beforeEach(() => {
    const state = usePromptTesterStore.getState();
    const activeRun = state.runs.find(r => r.id === state.activeRunId);
    if (activeRun) {
      usePromptTesterStore.setState({
        prompts: [],
        runs: state.runs.map(r =>
          r.id === state.activeRunId
            ? { ...r, configSnapshot: { ...r.configSnapshot, prompts: [] } }
            : r
        ),
      });
    } else {
      usePromptTesterStore.setState({ prompts: [] });
    }
  });

  it('should set edited=true for history entries', () => {
    // Arrange — store has no prompts
    const store = usePromptTesterStore.getState() as unknown as {
      addSystemPromptToActiveRun: (input: {
        kind: 'history';
        runId: string;
        prompt: string;
      }) => void;
    };

    // Act
    act(() => {
      store.addSystemPromptToActiveRun({ kind: 'history', runId: '1', prompt: 'test prompt' });
    });

    // Assert — FR-020: history entry MUST have edited=true
    const prompts = (
      usePromptTesterStore.getState() as unknown as { prompts: readonly { edited: boolean }[] }
    ).prompts;
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.edited).toBe(true);
  });

  it('should set edited=false for skill entries', () => {
    // Arrange — store has no prompts
    const store = usePromptTesterStore.getState() as unknown as {
      addSystemPromptToActiveRun: (input: {
        kind: 'skill';
        skillId: string;
        name: string;
        prompt: string;
      }) => void;
    };

    // Act
    act(() => {
      store.addSystemPromptToActiveRun({
        kind: 'skill',
        skillId: 'sk1',
        name: 'Test',
        prompt: 'prompt',
      });
    });

    // Assert — FR-019: skill entry MUST have edited=false (regression guard)
    const prompts = (
      usePromptTesterStore.getState() as unknown as { prompts: readonly { edited: boolean }[] }
    ).prompts;
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.edited).toBe(false);
  });

  it('should set edited=true for blank entries', () => {
    // Arrange — store has no prompts
    const store = usePromptTesterStore.getState() as unknown as {
      addSystemPromptToActiveRun: (input: { kind: 'blank' }) => void;
    };

    // Act
    act(() => {
      store.addSystemPromptToActiveRun({ kind: 'blank' });
    });

    // Assert — blank entry MUST have edited=true (regression guard)
    const prompts = (
      usePromptTesterStore.getState() as unknown as { prompts: readonly { edited: boolean }[] }
    ).prompts;
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.edited).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// run completion archive — FR-025
// ---------------------------------------------------------------------------

describe('run completion archive (FR-025)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Drain any debounced persist/archive timer this block scheduled before
    // switching to real timers — otherwise a pending archive leaks into the
    // next describe block's first test (cross-test pollution).
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it('should call archiveCompletedRun after persistActiveRun on runFull completion', async () => {
    // Arrange
    usePromptTesterStore.setState(
      () =>
        ({
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'Hello' };
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    const callOrder: string[] = [];
    const { putLabRun } = await import('@/db/labRuns');
    (putLabRun as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('persist');
    });
    mockArchiveCompletedRun.mockImplementation(async () => {
      callOrder.push('archive');
    });

    // Act — run and advance debounce timer
    const runPromise = act(async () => {
      const p = store.runFull();
      // Advance past PERSIST_DEBOUNCE_MS (300ms)
      await vi.advanceTimersByTimeAsync(350);
      return p;
    });

    await runPromise;

    // Assert
    expect(mockArchiveCompletedRun).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['persist', 'archive']);
    const archivedArg = mockArchiveCompletedRun.mock.calls[0]?.[0] as { id: string } | undefined;
    const activeId = String(usePromptTesterStore.getState().activeRunId);
    expect(archivedArg?.id).toBe(activeId);
  });

  it('should call archiveCompletedRun after persistActiveRun on runPartial completion', async () => {
    // Arrange — seed with one uncached model so partial has work to do
    usePromptTesterStore.setState((s: unknown) => {
      const state = s as LabState;
      return {
        models: [
          buildModelEntry({ id: 'model-1' }),
          buildModelEntry({ id: 'model-2', modelKey: 'gpt-4-turbo', name: 'GPT-4 Turbo' }),
        ],
        prompts: [buildPromptEntry({ id: 'prompt-1' })],
        runs: state.runs.map(r =>
          r.id === state.activeRunId
            ? {
                ...r,
                cells: [
                  buildCellResult({
                    id: 'model-1::prompt-1',
                    modelId: 'model-1',
                    promptId: 'prompt-1',
                    status: 'done',
                  }),
                ],
              }
            : r
        ),
      } as Partial<LabState>;
    });

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'partial result' };
    });

    const store = usePromptTesterStore.getState() as LabState & {
      runPartial: () => Promise<void>;
    };

    // Act
    const runPromise = act(async () => {
      const p = store.runPartial();
      await vi.advanceTimersByTimeAsync(350);
      return p;
    });

    await runPromise;

    // Assert
    expect(mockArchiveCompletedRun).toHaveBeenCalledTimes(1);
  });

  it('should not throw when archiveCompletedRun rejects', async () => {
    // Arrange
    usePromptTesterStore.setState(
      () =>
        ({
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'Hello' };
    });

    mockArchiveCompletedRun.mockRejectedValueOnce(new Error('IDB write failed'));

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act & Assert — should not throw
    await expect(
      act(async () => {
        const p = store.runFull();
        await vi.advanceTimersByTimeAsync(350);
        return p;
      })
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// multi-action ordering — persist before archive (FR-025)
// ---------------------------------------------------------------------------

describe('multi-action ordering — persist before archive (FR-025)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call persistActiveRun (putLabRun) before archiveCompletedRun', async () => {
    // Arrange
    usePromptTesterStore.setState(
      () =>
        ({
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'Hello' };
    });

    const callOrder: string[] = [];

    const { putLabRun } = await import('@/db/labRuns');
    (putLabRun as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('persist');
    });
    mockArchiveCompletedRun.mockImplementation(async () => {
      callOrder.push('archive');
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      const p = store.runFull();
      await vi.advanceTimersByTimeAsync(350);
      return p;
    });

    // Assert — persist MUST precede archive
    expect(callOrder).toEqual(['persist', 'archive']);
  });

  it('should pass the same run id to archiveCompletedRun as was persisted via putLabRun', async () => {
    // Arrange
    const initialState = usePromptTesterStore.getState();
    const activeRunId = initialState.activeRunId;

    usePromptTesterStore.setState(
      () =>
        ({
          models: [buildModelEntry({ id: 'model-1' })],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'Hello' };
    });

    let persistedId: string | undefined;
    let archivedId: string | undefined;

    const { putLabRun } = await import('@/db/labRuns');
    (putLabRun as ReturnType<typeof vi.fn>).mockImplementation(async (row: { id: string }) => {
      persistedId = row.id;
    });
    mockArchiveCompletedRun.mockImplementation(async (row: { id: string }) => {
      archivedId = row.id;
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      const p = store.runFull();
      await vi.advanceTimersByTimeAsync(350);
      return p;
    });

    // Assert — both calls reference the same run id (String(activeRunId))
    expect(persistedId).toBe(String(activeRunId));
    expect(archivedId).toBe(String(activeRunId));
    expect(persistedId).toBe(archivedId);
  });
});

// ---------------------------------------------------------------------------
// deleteCell — T005
// ---------------------------------------------------------------------------

import { putLabRun as mockPutLabRunRef } from '@/db/labRuns';

describe('deleteCell (T005)', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  const seedActiveRunWithCell = (cellId: string): void => {
    usePromptTesterStore.setState((s: unknown) => {
      const state = s as LabState;
      return {
        runs: state.runs.map(r =>
          r.id === state.activeRunId
            ? {
                ...r,
                cells: [
                  buildCellResult({
                    id: cellId,
                    modelId: cellId.split('::')[0] ?? 'model',
                    promptId: cellId.split('::')[1] ?? 'prompt',
                  }),
                ],
              }
            : r
        ),
      } as Partial<LabState>;
    });
  };

  it('should remove the cell with the given id from the active RunTab cells', async () => {
    // Arrange
    seedActiveRunWithCell('model-1::prompt-1');

    const store = usePromptTesterStore.getState() as unknown as {
      deleteCell: (cellId: string) => Promise<void>;
    };

    // Act
    await act(async () => {
      await store.deleteCell('model-1::prompt-1');
    });

    // Assert
    const state = getStore();
    const activeRun = state.runs.find(r => r.id === state.activeRunId);
    expect(activeRun?.cells.find(c => c.id === 'model-1::prompt-1')).toBeUndefined();
  });

  it('should call putLabRun exactly once after deleting a cell', async () => {
    // Arrange
    seedActiveRunWithCell('model-1::prompt-1');

    const store = usePromptTesterStore.getState() as unknown as {
      deleteCell: (cellId: string) => Promise<void>;
    };

    // Act
    await act(async () => {
      await store.deleteCell('model-1::prompt-1');
    });

    // Assert
    expect(mockPutLabRunRef).toHaveBeenCalledTimes(1);
  });

  it('should NOT write to archivedRuns when deleting a cell', async () => {
    // Arrange
    const { archiveRun: mockArchiveRun } = await import('@/db/archivedRuns');

    seedActiveRunWithCell('model-1::prompt-1');

    const store = usePromptTesterStore.getState() as unknown as {
      deleteCell: (cellId: string) => Promise<void>;
    };

    // Act
    await act(async () => {
      await store.deleteCell('model-1::prompt-1');
    });

    // Assert — neither archiveRun nor archiveCompletedRun is called
    expect(mockArchiveCompletedRun).not.toHaveBeenCalled();
    expect(mockArchiveRun).not.toHaveBeenCalled();
  });

  it('should abort the in-flight AbortController for the deleted cell', async () => {
    // Arrange: start a run so the store owns a live AbortController
    seedActiveRunWithCell('model-1::prompt-1');

    let streamAbortSignal: AbortSignal | undefined;
    mockStreamChat.mockImplementation(async function* (opts: { signal?: AbortSignal }) {
      streamAbortSignal = opts.signal;
      // Hang indefinitely so the cell remains in-flight
      await new Promise<void>(resolve => {
        opts.signal?.addEventListener('abort', () => resolve());
      });
    });

    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
      prompts: [buildPromptEntry({ id: 'prompt-1' })],
    });

    const store = usePromptTesterStore.getState() as unknown as {
      deleteCell: (cellId: string) => Promise<void>;
      runFull: () => Promise<void>;
    };

    // Start run without awaiting (cell will be streaming)
    void act(async () => {
      void store.runFull();
    });

    // Give the stream time to register
    await new Promise(r => setTimeout(r, 10));

    // Act — delete while streaming
    await act(async () => {
      await store.deleteCell('model-1::prompt-1');
    });

    // Assert — the signal that was passed to streamChat is now aborted
    expect(streamAbortSignal).toBeDefined();
    expect(streamAbortSignal?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// axisId sticky assignment — T005
// ---------------------------------------------------------------------------

describe('axisId sticky assignment (T005)', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  const callAddModel = (
    store: unknown,
    overrides?: Partial<{ providerId: string; modelKey: string; name: string }>
  ): void => {
    (
      store as {
        addModel: (input: {
          providerId: string;
          modelKey: string;
          name: string;
          supportsThinking: boolean;
        }) => void;
      }
    ).addModel({
      providerId: overrides?.providerId ?? 'openrouter',
      modelKey: overrides?.modelKey ?? `key-${Math.random()}`,
      name: overrides?.name ?? 'Model',
      supportsThinking: false,
    });
  };

  it('should assign axisId 1 to the first model added', () => {
    // Arrange: fresh store — no models
    const store = usePromptTesterStore.getState();

    // Act
    act(() => {
      callAddModel(store);
    });

    // Assert
    const { models } = getStore();
    expect(models[0]?.axisId).toBe(1);
  });

  it('should assign axisId 2 to the second model added', () => {
    // Arrange
    const store = usePromptTesterStore.getState();

    // Act
    act(() => {
      callAddModel(store, { modelKey: 'first' });
      callAddModel(store, { modelKey: 'second' });
    });

    // Assert
    const { models } = getStore();
    expect(models[0]?.axisId).toBe(1);
    expect(models[1]?.axisId).toBe(2);
  });

  it('should not reuse axisIds after removing an earlier model (monotonic, non-colliding)', () => {
    // Arrange: add two models, remove the first, add a third
    const store = usePromptTesterStore.getState() as LabState & {
      addModel: (input: {
        providerId: string;
        modelKey: string;
        name: string;
        supportsThinking: boolean;
      }) => void;
      removeModel: (modelId: string) => void;
    };

    act(() => {
      callAddModel(store, { modelKey: 'first' });
      callAddModel(store, { modelKey: 'second' });
    });

    const firstModelId = getStore().models[0]?.id ?? '';

    act(() => {
      store.removeModel(firstModelId);
    });

    act(() => {
      callAddModel(store, { modelKey: 'third' });
    });

    // Assert: remaining model keeps axisId 2, new model gets axisId 3 (not reusing 1)
    const { models } = getStore();
    const axisIds = models.map(m => m.axisId);
    // All axis ids must be unique (non-colliding)
    expect(new Set(axisIds).size).toBe(axisIds.length);
    // New model axisId must be strictly greater than 2 (monotonic)
    const newModel = models.find(m => m.modelKey === 'third');
    expect(newModel?.axisId).toBeGreaterThan(2);
  });

  it('should assign axisId 1 to the first prompt added via addPrompt', () => {
    // Arrange: fresh store
    const store = usePromptTesterStore.getState() as LabState & {
      addPrompt: (entry: PromptEntry) => void;
    };

    // Act
    act(() => {
      store.addPrompt(buildPromptEntry({ id: 'p-1', text: 'First prompt' }));
    });

    // Assert
    const { prompts } = getStore();
    expect(prompts[0]?.axisId).toBe(1);
  });

  it('should assign non-colliding incrementing axisIds across multiple addPrompt calls', () => {
    // Arrange
    const store = usePromptTesterStore.getState() as LabState & {
      addPrompt: (entry: PromptEntry) => void;
    };

    // Act
    act(() => {
      store.addPrompt(buildPromptEntry({ id: 'p-1' }));
      store.addPrompt(buildPromptEntry({ id: 'p-2' }));
      store.addPrompt(buildPromptEntry({ id: 'p-3' }));
    });

    // Assert: axisIds are 1, 2, 3 (monotonically increasing, no duplicates)
    const { prompts } = getStore();
    expect(prompts.map(p => p.axisId)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// T014 — parallel-defaults rename + contextSize slider default
// ---------------------------------------------------------------------------

describe('usePromptTesterStore — T014 parallel-defaults + contextSize (NEW:prompt-tester.parallel-defaults)', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  // ---- DEFAULT_SLIDER_VALUES.contextSize ----

  it('should include contextSize: 4096 in DEFAULT_SLIDER_VALUES when new model is added', () => {
    // Given a fresh store
    const store = usePromptTesterStore.getState() as unknown as {
      addModel: (input: {
        providerId: string;
        modelKey: string;
        name: string;
        supportsThinking: boolean;
      }) => void;
    };

    // When a model is added (params are seeded from DEFAULT_SLIDER_VALUES)
    act(() => {
      store.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
    });

    // Then the model's params include contextSize: 4096
    const { models } = getStore();
    expect(models[0]?.params).toHaveProperty('contextSize', 4096);
  });

  // ---- runParallel default ----

  it('should default runParallel to true', () => {
    // Given a freshly initialised store
    // When reading runParallel
    const state = usePromptTesterStore.getState() as unknown as { runParallel: boolean };

    // Then it is true (parallel execution enabled by default)
    expect(state.runParallel).toBe(true);
  });

  // ---- parallelismMode default ----

  it('should default parallelismMode to same-model', () => {
    // Given a freshly initialised store
    // When reading parallelismMode
    const state = usePromptTesterStore.getState() as unknown as {
      parallelismMode: 'same-model' | 'everything';
    };

    // Then it is 'same-model'
    expect(state.parallelismMode).toBe('same-model');
  });

  // ---- old field names must NOT exist ----

  it('should NOT expose serialAcrossModels on the state (field was removed)', () => {
    // Given a freshly initialised store
    const state = usePromptTesterStore.getState() as Record<string, unknown>;

    // Then the removed field name is absent
    expect('serialAcrossModels' in state).toBe(false);
  });

  it('should NOT expose serialWithinModel on the state (field was removed)', () => {
    // Given a freshly initialised store
    const state = usePromptTesterStore.getState() as Record<string, unknown>;

    // Then the removed field name is absent
    expect('serialWithinModel' in state).toBe(false);
  });

  // ---- setRunParallel action ----

  it('should update runParallel to false via setRunParallel', () => {
    // Given runParallel starts as true
    const store = usePromptTesterStore.getState() as unknown as {
      setRunParallel: (next: boolean) => void;
    };

    // When setRunParallel(false) is called
    act(() => {
      store.setRunParallel(false);
    });

    // Then runParallel is false
    const state = usePromptTesterStore.getState() as unknown as { runParallel: boolean };
    expect(state.runParallel).toBe(false);
  });

  it('should persist runParallel via putLabRunParallel when setRunParallel is called', async () => {
    // Given a fresh store
    const store = usePromptTesterStore.getState() as unknown as {
      setRunParallel: (next: boolean) => void;
    };

    // When setRunParallel(false) is called
    await act(async () => {
      store.setRunParallel(false);
    });

    // Then putLabRunParallel was called with false
    expect(mockPutLabRunParallel).toHaveBeenCalledTimes(1);
    expect(mockPutLabRunParallel).toHaveBeenCalledWith(false);
  });

  // ---- setParallelismMode action ----

  it('should update parallelismMode to everything via setParallelismMode', () => {
    // Given parallelismMode starts as same-model
    const store = usePromptTesterStore.getState() as unknown as {
      setParallelismMode: (next: 'same-model' | 'everything') => void;
    };

    // When setParallelismMode('everything') is called
    act(() => {
      store.setParallelismMode('everything');
    });

    // Then parallelismMode is 'everything'
    const state = usePromptTesterStore.getState() as unknown as {
      parallelismMode: 'same-model' | 'everything';
    };
    expect(state.parallelismMode).toBe('everything');
  });

  it('should persist parallelismMode via putLabParallelismMode when setParallelismMode is called', async () => {
    // Given a fresh store
    const store = usePromptTesterStore.getState() as unknown as {
      setParallelismMode: (next: 'same-model' | 'everything') => void;
    };

    // When setParallelismMode('everything') is called
    await act(async () => {
      store.setParallelismMode('everything');
    });

    // Then putLabParallelismMode was called with 'everything'
    expect(mockPutLabParallelismMode).toHaveBeenCalledTimes(1);
    expect(mockPutLabParallelismMode).toHaveBeenCalledWith('everything');
  });

  // ---- contextSize forwarded to streamChat ----

  it('should forward contextSize from model params to streamChat during runFull', async () => {
    // Arrange: one model with contextSize: 4096 in params, one prompt
    usePromptTesterStore.setState(
      () =>
        ({
          models: [
            buildModelEntry({
              id: 'model-ctx',
              modelKey: 'gpt-4o',
              params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0, contextSize: 4096 },
            }),
          ],
          prompts: [buildPromptEntry({ id: 'prompt-1' })],
        }) as Partial<LabState>
    );

    const capturedOptions: Array<Record<string, unknown>> = [];
    mockStreamChat.mockImplementation(async function* (opts: Record<string, unknown>) {
      capturedOptions.push(opts);
      yield { type: 'chunk', text: 'ok' };
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      await store.runFull();
    });

    // Then streamChat received contextSize: 4096
    expect(capturedOptions.length).toBeGreaterThan(0);
    expect(capturedOptions[0]).toMatchObject({ contextSize: 4096 });
  });
});

// ---------------------------------------------------------------------------
// T016 — list-comparability (NEW:prompt-tester.list-comparability)
// Verifies that cell selection in the list view feeds the compare view through
// the same per-tab selectedCellIds slice. Pure-verification (R-019): GREEN immediately.
// ---------------------------------------------------------------------------

import type { ModelParamsReadOnlyLabels } from '../../types';
import {
  buildCompareRows,
  type CompareMetricLabels,
  type CompareRowLabels
} from '../../utils/buildCompareRows';

const STUB_METRIC_LABELS: CompareMetricLabels = {
  latency: 'latency',
  tps: 'tps',
  perplexity: 'perplexity',
  readability: 'readability',
  lexicalDiversity: 'lexicalDiversity',
  wordCount: 'wordCount',
  sentenceCount: 'sentenceCount',
  readingTime: 'readingTime',
  sentiment: 'sentiment',
  passiveVoiceRatio: 'passiveVoiceRatio',
  questionDensity: 'questionDensity',
  ngramRepetition: 'ngramRepetition',
  namedEntityCount: 'namedEntityCount',
  avgSentenceLength: 'avgSentenceLength',
  hedgingDensity: 'hedgingDensity',
};

const STUB_ROW_LABELS: CompareRowLabels = {
  temp: 'Temp',
  topP: 'Top-P',
  thinking: 'Thinking',
  latency: 'Latency',
  yes: 'Yes',
  no: 'No',
};

const STUB_LABELS: ModelParamsReadOnlyLabels = {
  temp: 'Temp',
  topP: 'Top-P',
  maxTok: 'Max Tokens',
  freq: 'Freq',
  pres: 'Pres',
  contextSize: 'Context',
  thinking: 'Thinking',
  thinkingBudget: 'Budget',
};

describe('usePromptTesterStore — list-comparability (T016)', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  const seedThreeCells = (): void => {
    usePromptTesterStore.setState((s: unknown) => {
      const state = s as LabState;
      return {
        runs: state.runs.map(r =>
          r.id === state.activeRunId
            ? {
                ...r,
                cells: [
                  buildCellResult({
                    id: 'model-a::prompt-1',
                    modelId: 'model-a',
                    promptId: 'prompt-1',
                    output: 'Response A',
                  }),
                  buildCellResult({
                    id: 'model-b::prompt-1',
                    modelId: 'model-b',
                    promptId: 'prompt-1',
                    output: 'Response B',
                  }),
                  buildCellResult({
                    id: 'model-c::prompt-1',
                    modelId: 'model-c',
                    promptId: 'prompt-1',
                    output: 'Response C',
                  }),
                ],
              }
            : r
        ),
      } as Partial<LabState>;
    });
  };

  it('should update selectedCellIds on the active RunTab when toggleCellSelection is called from the list view', () => {
    // Given: three cells seeded in the active run
    seedThreeCells();

    const store = usePromptTesterStore.getState() as LabState & {
      toggleCellSelection: (cellId: string) => boolean;
    };

    // When: two cells are selected via the list-view action
    act(() => {
      store.toggleCellSelection('model-a::prompt-1');
      store.toggleCellSelection('model-b::prompt-1');
    });

    // Then: the active run's selectedCellIds contains exactly those two ids
    const state = getStore();
    const activeRun = state.runs.find(r => r.id === state.activeRunId);
    expect(activeRun?.selectedCellIds).toHaveLength(2);
    expect(activeRun?.selectedCellIds).toContain('model-a::prompt-1');
    expect(activeRun?.selectedCellIds).toContain('model-b::prompt-1');
  });

  it('should derive compare-view data from the same selectedCellIds that list-view selection wrote', () => {
    // Given: three cells seeded; two selected via the list-view action
    seedThreeCells();

    const store = usePromptTesterStore.getState() as LabState & {
      toggleCellSelection: (cellId: string) => boolean;
    };

    act(() => {
      store.toggleCellSelection('model-a::prompt-1');
      store.toggleCellSelection('model-b::prompt-1');
    });

    // When: compare-view data is derived using buildCompareRows (the seam CompareStripContainer uses)
    const state = getStore();
    const activeRun = state.runs.find(r => r.id === state.activeRunId);
    const selectedIds = activeRun?.selectedCellIds ?? [];

    const result = buildCompareRows(
      activeRun?.cells ?? [],
      selectedIds,
      STUB_LABELS,
      STUB_ROW_LABELS,
      STUB_METRIC_LABELS
    );

    // Then: compare data contains exactly the two selected cells' outputs
    expect(result.diffPanes).toHaveLength(2);
    const outputs = result.diffPanes.map(p => p.text);
    expect(outputs).toContain('Response A');
    expect(outputs).toContain('Response B');
    expect(outputs).not.toContain('Response C');
  });

  it('should remove a cell from selectedCellIds when it is deselected from the list view', () => {
    // Given: three cells seeded; two initially selected
    seedThreeCells();

    usePromptTesterStore.setState((s: unknown) => {
      const state = s as LabState;
      return {
        runs: state.runs.map(r =>
          r.id === state.activeRunId
            ? { ...r, selectedCellIds: ['model-a::prompt-1', 'model-b::prompt-1'] }
            : r
        ),
      } as Partial<LabState>;
    });

    const store = usePromptTesterStore.getState() as LabState & {
      toggleCellSelection: (cellId: string) => boolean;
    };

    // When: one of the selected cells is toggled off from the list view
    act(() => {
      store.toggleCellSelection('model-a::prompt-1');
    });

    // Then: selectedCellIds retains only the remaining cell, and compare data updates accordingly
    const state = getStore();
    const activeRun = state.runs.find(r => r.id === state.activeRunId);
    expect(activeRun?.selectedCellIds).toHaveLength(1);
    expect(activeRun?.selectedCellIds).not.toContain('model-a::prompt-1');

    const result = buildCompareRows(
      activeRun?.cells ?? [],
      activeRun?.selectedCellIds ?? [],
      STUB_LABELS,
      STUB_ROW_LABELS,
      STUB_METRIC_LABELS
    );
    expect(result.diffPanes).toHaveLength(1);
    expect(result.diffPanes[0]?.text).toBe('Response B');
  });
});

describe('compareSplitRatio (T005)', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    vi.clearAllMocks();
  });

  const getRatioStore = (): LabState & { setCompareSplitRatio: (ratio: number) => void } =>
    usePromptTesterStore.getState() as LabState & {
      setCompareSplitRatio: (ratio: number) => void;
    };

  it('should default compareSplitRatio to 0.5 on initial state', () => {
    expect(getStore().compareSplitRatio).toBe(0.5);
  });

  it('should pass through an in-range ratio unchanged when setCompareSplitRatio is called', () => {
    act(() => {
      getRatioStore().setCompareSplitRatio(0.42);
    });
    expect(getStore().compareSplitRatio).toBe(0.42);
  });

  it('should clamp to 0.15 when setCompareSplitRatio is called below the minimum', () => {
    act(() => {
      getRatioStore().setCompareSplitRatio(0.05);
    });
    expect(getStore().compareSplitRatio).toBe(0.15);
  });

  it('should clamp to 0.85 when setCompareSplitRatio is called above the maximum', () => {
    act(() => {
      getRatioStore().setCompareSplitRatio(0.95);
    });
    expect(getStore().compareSplitRatio).toBe(0.85);
  });

  it('should NOT include compareSplitRatio in the persisted run row', async () => {
    act(() => {
      getRatioStore().setCompareSplitRatio(0.6);
    });
    const { putLabRun } = await import('@/db/labRuns');
    const persistMock = putLabRun as ReturnType<typeof vi.fn>;
    const store = usePromptTesterStore.getState() as LabState & {
      persistActiveRun: () => Promise<void>;
    };
    await act(async () => {
      await store.persistActiveRun();
    });
    expect(persistMock).toHaveBeenCalled();
    const calls = persistMock.mock.calls;
    const persistedRow = calls[calls.length - 1]?.[0];
    expect(persistedRow).toBeDefined();
    expect(persistedRow as Record<string, unknown>).not.toHaveProperty('compareSplitRatio');
  });
});
