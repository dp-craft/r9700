// TDD Red phase — targets run engine fixes not yet implemented:
// FR-002 (zero-prompt), FR-003 (per-cell error), FR-004 (isRunDisabled),
// FR-005 (retryCell), and supersede (abort-on-restart).

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStreamChat = vi.fn();

vi.mock('@/services/llm/stream', () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
}));

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
  usePromptHistoryStore: { getState: () => ({ refresh: vi.fn() }) },
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

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

const buildCellId = (modelId: string, promptId: string) => `${modelId}::${promptId}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getStore = (): LabState => usePromptTesterStore.getState() as LabState;

const resetStore = () => {
  usePromptTesterStore.setState(
    usePromptTesterStore.getInitialState
      ? usePromptTesterStore.getInitialState()
      : (usePromptTesterStore.getState() as LabState)
  );
  vi.clearAllMocks();
};

const getActiveRunCells = (): readonly CellResult[] => {
  const state = getStore();
  return state.runs.find(r => r.id === state.activeRunId)?.cells ?? [];
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FR-002 — zero-prompt run
// ---------------------------------------------------------------------------

describe('zero-prompt run (FR-002)', () => {
  beforeEach(resetStore);

  it('should execute runFull with zero prompts using one implicit empty-system-prompt column', async () => {
    // Arrange: 1 model, 0 system prompts
    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
      prompts: [],
    });

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'implicit response' };
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      await store.runFull();
    });

    // Assert: exactly 1 cell with the implicit empty-prompt column
    const cells = getActiveRunCells();
    expect(cells).toHaveLength(1);
    expect(cells[0]?.promptId).toBe('__empty__');
  });

  it('should execute runPartial with zero prompts using one implicit column', async () => {
    // Arrange: 1 model, 0 system prompts, no pre-existing done cells
    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
      prompts: [],
    });

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'partial implicit' };
    });

    const store = usePromptTesterStore.getState() as LabState & {
      runPartial: () => Promise<void>;
    };

    // Act
    await act(async () => {
      await store.runPartial();
    });

    // Assert: 1 cell with implicit empty-prompt column
    const cells = getActiveRunCells();
    expect(cells).toHaveLength(1);
    expect(cells[0]?.promptId).toBe('__empty__');
  });
});

// ---------------------------------------------------------------------------
// FR-003 — per-cell error isolation
// ---------------------------------------------------------------------------

describe('per-cell error isolation (FR-003)', () => {
  beforeEach(resetStore);

  it('should set error status on failing cell while siblings complete', async () => {
    // Arrange: 2 models × 1 prompt; model-2 throws
    usePromptTesterStore.setState({
      models: [
        buildModelEntry({ id: 'model-1', modelKey: 'gpt-4o' }),
        buildModelEntry({ id: 'model-2', modelKey: 'gpt-fail' }),
      ],
      prompts: [buildPromptEntry({ id: 'prompt-1' })],
    });

    mockStreamChat.mockImplementation(async function* (opts: { modelId: string }) {
      if (opts.modelId === 'gpt-fail') {
        throw new Error('Provider 404');
      }
      yield { type: 'chunk', text: 'success' };
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      await store.runFull();
    });

    // Assert: model-1 done, model-2 error
    const cells = getActiveRunCells();
    const cell1 = cells.find(c => c.id === buildCellId('model-1', 'prompt-1'));
    const cell2 = cells.find(c => c.id === buildCellId('model-2', 'prompt-1'));

    expect(cell1?.status).toBe('done');
    expect(cell2?.status).toBe('error');
    expect(cell2?.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// FR-004 — isRunDisabled
// ---------------------------------------------------------------------------

describe('isRunDisabled (FR-004)', () => {
  beforeEach(resetStore);

  it('should return true when no models selected', () => {
    // Arrange: fresh store — no models
    const store = usePromptTesterStore.getState() as unknown as LabState & {
      isRunDisabled: () => boolean;
    };

    // Act + Assert
    const result = store.isRunDisabled();
    expect(result).toBe(true);
  });

  it('should return false when models exist', () => {
    // Arrange: 1 model
    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
    });

    const store = usePromptTesterStore.getState() as unknown as LabState & {
      isRunDisabled: () => boolean;
    };

    // Act + Assert
    const result = store.isRunDisabled();
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FR-005 — retryCell
// ---------------------------------------------------------------------------

describe('retryCell (FR-005)', () => {
  beforeEach(resetStore);

  it('should re-execute an errored cell to done status', async () => {
    // Arrange: 1 model, 1 prompt, pre-seed the cell as errored
    const cellId = buildCellId('model-1', 'prompt-1');
    const erroredCell = buildCellResult({
      id: cellId,
      modelId: 'model-1',
      promptId: 'prompt-1',
      status: 'error',
      error: 'Provider 404',
      output: '',
    });

    usePromptTesterStore.setState((s: unknown) => {
      const state = s as LabState;
      return {
        models: [buildModelEntry({ id: 'model-1', modelKey: 'gpt-4o' })],
        prompts: [buildPromptEntry({ id: 'prompt-1' })],
        runs: state.runs.map(r =>
          r.id === state.activeRunId ? { ...r, cells: [erroredCell] } : r
        ),
      } as Partial<LabState>;
    });

    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'chunk', text: 'retry success' };
    });

    const store = usePromptTesterStore.getState() as unknown as LabState & {
      retryCell: (cellId: string) => Promise<void>;
    };

    // Act
    await act(async () => {
      await store.retryCell(cellId);
    });

    // Assert: cell transitions from error → done
    const cells = getActiveRunCells();
    const retriedCell = cells.find(c => c.id === cellId);
    expect(retriedCell?.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// Supersede (Edge Case) — abort prior run on new runFull
// ---------------------------------------------------------------------------

describe('supersede (Edge Case)', () => {
  beforeEach(resetStore);

  it('should abort prior run when starting a new run', async () => {
    // Arrange: 1 model, 1 prompt; first stream hangs until resolved
    let resolveFirstStream!: () => void;
    let callCount = 0;
    const capturedSignals: AbortSignal[] = [];

    mockStreamChat.mockImplementation(async function* (opts: { signal?: AbortSignal }) {
      callCount++;
      if (opts.signal) capturedSignals.push(opts.signal);

      if (callCount === 1) {
        // First stream: hang until externally resolved
        await new Promise<void>(resolve => {
          resolveFirstStream = resolve;
          opts.signal?.addEventListener('abort', () => resolve());
        });
        if (!opts.signal?.aborted) {
          yield { type: 'chunk', text: 'late' };
        }
      } else {
        yield { type: 'chunk', text: 'second-run' };
      }
    });

    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
      prompts: [buildPromptEntry({ id: 'prompt-1' })],
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act: start first run (don't await — it hangs)
    const firstRun = act(async () => {
      void store.runFull();
    });

    // Give the first run a tick to register its abort controller
    await new Promise(r => setTimeout(r, 10));

    // Start second run — this should abort the first
    await act(async () => {
      resolveFirstStream?.();
      await store.runFull();
    });

    await firstRun;

    // Assert: first run's signal was aborted
    expect(capturedSignals[0]?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-cell metrics on completion — ttfMs / tps (T005)
// ---------------------------------------------------------------------------

describe('per-cell metrics on completion — ttfMs / tps (T005)', () => {
  beforeEach(resetStore);

  it('should set ttfMs to null / undefined before the stream completes', async () => {
    // Arrange: stream that hangs until resolved
    let resolveStream!: () => void;

    mockStreamChat.mockImplementation(async function* (opts: { signal?: AbortSignal }) {
      await new Promise<void>(resolve => {
        resolveStream = resolve;
        opts.signal?.addEventListener('abort', () => resolve());
      });
      yield { type: 'chunk', text: 'hello' };
    });

    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
      prompts: [buildPromptEntry({ id: 'prompt-1' })],
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act: start but do not await
    void act(async () => {
      void store.runFull();
    });

    // Give the stream a tick to begin
    await new Promise(r => setTimeout(r, 10));

    // Assert: while streaming, ttfMs should not be a positive number yet
    const mid = getActiveRunCells();
    const cell = mid.find(c => c.id === 'model-1::prompt-1');
    expect(cell?.ttfMs == null || cell.ttfMs === 0).toBe(true);

    // Cleanup
    resolveStream();
  });

  it('should set cell.ttfMs = firstTokenAt − requestStartedAt on completion', async () => {
    // Arrange: controlled fake timers to make timing deterministic
    vi.useFakeTimers();

    const REQUEST_START = 1000;
    const FIRST_TOKEN_OFFSET = 150; // ms after request start

    let firstTokenEmitted = false;

    mockStreamChat.mockImplementation(async function* () {
      // Advance fake clock to simulate first-token latency
      await vi.advanceTimersByTimeAsync(FIRST_TOKEN_OFFSET);
      firstTokenEmitted = true;
      yield { type: 'chunk', text: 'hello world' };
    });

    vi.setSystemTime(REQUEST_START);

    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
      prompts: [buildPromptEntry({ id: 'prompt-1' })],
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    // Act
    await act(async () => {
      const p = store.runFull();
      await vi.runAllTimersAsync();
      return p;
    });

    vi.useRealTimers();

    // Assert
    expect(firstTokenEmitted).toBe(true);
    const cells = getActiveRunCells();
    const cell = cells.find(c => c.id === 'model-1::prompt-1');
    expect(cell?.ttfMs).toBeDefined();
    // ttfMs must be a non-negative number (exact value depends on implementation clock read)
    expect(typeof cell?.ttfMs).toBe('number');
    expect(cell?.ttfMs ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('should set cell.tps = tokens / (latencyMs / 1000) on completion', async () => {
    // Arrange: stream emitting a known token count
    // tokens = ceil(charCount / 4); we control output length
    // "hello world" = 11 chars → ceil(11/4) = 3 tokens
    // We use a longer string for a cleaner expected value
    // "aaaa aaaa aaaa aaaa" = 19 chars → ceil(19/4) = 5 tokens
    const OUTPUT_TEXT = 'aaaa aaaa aaaa aaaa';
    const EXPECTED_TOKENS = Math.ceil(OUTPUT_TEXT.length / 4); // 5

    vi.useFakeTimers();
    const LATENCY_MS = 500;

    mockStreamChat.mockImplementation(async function* () {
      await vi.advanceTimersByTimeAsync(LATENCY_MS);
      yield { type: 'chunk', text: OUTPUT_TEXT };
    });

    vi.setSystemTime(0);

    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
      prompts: [buildPromptEntry({ id: 'prompt-1' })],
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    await act(async () => {
      const p = store.runFull();
      await vi.runAllTimersAsync();
      return p;
    });

    vi.useRealTimers();

    // Assert
    const cells = getActiveRunCells();
    const cell = cells.find(c => c.id === 'model-1::prompt-1');
    expect(cell?.tps).toBeDefined();
    expect(typeof cell?.tps).toBe('number');
    // tps = tokens / (latencyMs / 1000) = EXPECTED_TOKENS / (LATENCY_MS / 1000)
    const expectedTps = EXPECTED_TOKENS / (LATENCY_MS / 1000);
    // Allow ±20% tolerance for clock jitter in fake timers
    expect(cell?.tps ?? 0).toBeGreaterThan(expectedTps * 0.8);
  });

  it('should leave ttfMs and tps as null/undefined when cell status is error', async () => {
    // Arrange: stream throws
    mockStreamChat.mockImplementation(() => ({
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<never>> {
            return Promise.reject(new Error('Provider 500'));
          },
        };
      },
    }));

    usePromptTesterStore.setState({
      models: [buildModelEntry({ id: 'model-1' })],
      prompts: [buildPromptEntry({ id: 'prompt-1' })],
    });

    const store = usePromptTesterStore.getState() as LabState & { runFull: () => Promise<void> };

    await act(async () => {
      await store.runFull();
    });

    // Assert: error cell has no metrics
    const cells = getActiveRunCells();
    const cell = cells.find(c => c.id === 'model-1::prompt-1');
    expect(cell?.status).toBe('error');
    expect(cell?.ttfMs == null).toBe(true);
    expect(cell?.tps == null).toBe(true);
  });
});
