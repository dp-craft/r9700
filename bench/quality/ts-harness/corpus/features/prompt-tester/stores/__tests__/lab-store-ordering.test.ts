/**
 * Integration tests: concurrent mutation ordering guarantee (FR-015, FR-042).
 *
 * Verifies that `setCellScore` ratings keyed by stable cell id
 * (`${modelId}::${promptId}`) survive a subsequent `runFull()` call,
 * and that ratings for removed models do NOT carry over (no phantom data).
 *
 * Also verifies `deleteCell` ordering contract (FR-NEW:prompt-tester.cell-delete-action):
 *   abort (in-flight stream) → state mutation (cell removed) → putLabRun (persist)
 *   with no archiveCompletedRun call.
 *
 * These tests are intentionally RED — the `usePromptTesterStore` does not exist yet.
 * They target the contract defined in specs/025-design-spec-alignment/contracts/lab-store.ts.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Inlined from specs/025-design-spec-alignment/contracts/lab-store.ts (not compiled into app)
type RatingCategoryId = 'accuracy' | 'style' | 'tone' | 'length' | 'readability';

// ---------------------------------------------------------------------------
// Boundary mocks — hoisted before any imports
// ---------------------------------------------------------------------------

vi.mock('@/services/llm/registry', () => ({
  lookupProvider: vi.fn(),
}));

vi.mock('@/db/providerConfigs', () => ({
  getProviderConfig: vi.fn(),
}));

vi.mock('@/db/idb', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: vi.fn().mockResolvedValue([]),
  getLabRunById: vi.fn().mockResolvedValue(undefined),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/archivedRuns', () => ({
  archiveCompletedRun: vi.fn().mockResolvedValue(undefined),
  archiveRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/streaming/streamRegistry', () => {
  const unregister = vi.fn();
  const register = vi.fn();
  return {
    streamRegistry: {
      register,
      unregister,
      list: vi.fn(() => []),
      abort: vi.fn(),
      subscribe: vi.fn(),
    },
  };
});

vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn().mockResolvedValue(undefined),
  getAllPrompts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/prompt-history', () => ({
  usePromptHistoryStore: { getState: () => ({ loadEntries: vi.fn() }) },
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/concurrency-pool', () => ({
  runPool: vi.fn(async (tasks: Array<() => Promise<unknown>>) => {
    for (const task of tasks) await task();
  }),
}));

vi.mock('@/config', () => ({
  LAB_RUN_CONCURRENCY: 3,
}));

// Minimal LLM stream mock — yields a single chunk then completes
vi.mock('@/services/llm/', () => ({
  streamChat: vi.fn(async function* () {
    yield { type: 'chunk', content: 'hello' };
  }),
}));

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(async function* () {
    yield { type: 'chunk', content: 'hello' };
  }),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { archiveCompletedRun, archiveRun } from '@/db/archivedRuns';
import { putLabRun } from '@/db/labRuns';
import { streamChat } from '@/services/llm/stream';
import { streamRegistry } from '@/services/streaming/streamRegistry';

// NOTE: this import will fail (RED) until usePromptTesterStore is created at this path.
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROMPT_ID = 'prompt1';

const ACCURACY: RatingCategoryId = 'accuracy';

function setupStoreWithOneCell() {
  const { result } = renderHook(() => usePromptTesterStore());
  act(() => {
    result.current.addModel({
      providerId: 'openrouter',
      modelKey: 'gpt-4o',
      name: 'GPT-4o',
      supportsThinking: false,
    });
    result.current.addPrompt({
      id: PROMPT_ID,
      kind: 'custom',
      text: 'Hello world',
      edited: false,
    });
    result.current.setUserPrompt('Compare these');
  });
  const actualModelId = result.current.models[0]!.id;
  const actualCellId = `${actualModelId}::${PROMPT_ID}`;
  return { result, actualCellId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lab store — setCellScore × runFull ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state between tests
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should preserve prior rating on a cell whose id re-appears after runFull', async () => {
    // Arrange: store with 1 model + 1 prompt, run completes
    const { result, actualCellId } = setupStoreWithOneCell();

    await act(async () => {
      await result.current.runFull();
    });

    // Act: user rates the cell, then triggers a full re-run
    act(() => {
      result.current.setCellScore(actualCellId, ACCURACY, 4);
    });

    await act(async () => {
      await result.current.runFull();
    });

    // Assert: same cell id re-appears with its rating intact
    const activeRun = result.current.runs.find(r => r.id === result.current.activeRunId);
    const cell = activeRun?.cells.find(c => c.id === actualCellId);

    expect(cell).toBeDefined();
    expect(cell?.ratings[ACCURACY]).toBe(4);
  });

  it('should not reset an unrelated rating category when only one category is scored', async () => {
    // Arrange
    const { result, actualCellId } = setupStoreWithOneCell();

    await act(async () => {
      await result.current.runFull();
    });

    act(() => {
      result.current.setCellScore(actualCellId, ACCURACY, 3);
      result.current.setCellScore(actualCellId, 'style', 5);
    });

    await act(async () => {
      await result.current.runFull();
    });

    // Assert: both categories survived the re-run
    const activeRun = result.current.runs.find(r => r.id === result.current.activeRunId);
    const cell = activeRun?.cells.find(c => c.id === actualCellId);

    expect(cell?.ratings[ACCURACY]).toBe(3);
    expect(cell?.ratings.style).toBe(5);
  });

  it('should NOT carry over ratings when the model is removed before runFull', async () => {
    // Arrange: run completes, user rates cell
    const { result, actualCellId } = setupStoreWithOneCell();
    const originalModelId = result.current.models[0]!.id;

    await act(async () => {
      await result.current.runFull();
    });

    act(() => {
      result.current.setCellScore(actualCellId, ACCURACY, 5);
    });

    // Act: model removed → different cell ids in next run
    act(() => {
      result.current.removeModel(originalModelId);
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-3.5-turbo',
        name: 'GPT-3.5',
        supportsThinking: false,
      });
    });

    await act(async () => {
      await result.current.runFull();
    });

    // Assert: new run has no cell with the old actualCellId (no phantom ratings)
    const activeRun = result.current.runs.find(r => r.id === result.current.activeRunId);
    const phantomCell = activeRun?.cells.find(c => c.id === actualCellId);

    expect(phantomCell).toBeUndefined();
  });

  it('should clear a rating when setCellScore is called with value 0', async () => {
    // Arrange
    const { result, actualCellId } = setupStoreWithOneCell();

    await act(async () => {
      await result.current.runFull();
    });

    act(() => {
      result.current.setCellScore(actualCellId, ACCURACY, 4);
    });

    // Act: clear the rating
    act(() => {
      result.current.setCellScore(actualCellId, ACCURACY, 0);
    });

    await act(async () => {
      await result.current.runFull();
    });

    // Assert: rating is 0 (unrated) after the re-run
    const activeRun = result.current.runs.find(r => r.id === result.current.activeRunId);
    const cell = activeRun?.cells.find(c => c.id === actualCellId);

    expect(cell?.ratings[ACCURACY]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteCell ordering contract (FR-NEW:prompt-tester.cell-delete-action)
// ---------------------------------------------------------------------------

describe('lab store — deleteCell ordering contract', () => {
  // Shared call log for ordering assertions across all mocked boundaries
  const callLog: string[] = [];

  // Deferred that we resolve to unblock the hanging stream on abort
  let resolveStreamAbort: () => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    callLog.length = 0;

    // Replace the stream mock with a never-resolving generator that unblocks on abort signal
    vi.mocked(streamChat).mockImplementation(async function* ({
      signal,
    }: {
      signal?: AbortSignal;
    }) {
      await new Promise<void>(resolve => {
        resolveStreamAbort = resolve;
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      // Generator completes without yielding (stream was aborted)
    });

    // Wire putLabRun to record its position in the call log
    vi.mocked(putLabRun).mockImplementation(async () => {
      callLog.push('putLabRun');
    });

    // Spy on AbortController.prototype.abort to record abort position
    vi.spyOn(AbortController.prototype, 'abort').mockImplementation(function (
      this: AbortController
    ) {
      callLog.push('abort');
      // Trigger the real abort so the signal fires and the stream unblocks
      Object.defineProperty(this.signal, 'aborted', { value: true, configurable: true });
      resolveStreamAbort();
    });

    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should abort the in-flight stream BEFORE removing the cell from state when deleteCell is called on a streaming cell', async () => {
    // Arrange: store with one model + one prompt; kick off runPartial (does not complete)
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const modelId = result.current.models[0]!.id;
    const cellId = `${modelId}::${PROMPT_ID}`;

    // Start runPartial but do NOT await — the stream hangs, cell enters streaming state
    let runPartialPromise: Promise<void>;
    act(() => {
      runPartialPromise = result.current.runPartial();
    });

    // Yield to let the async generator start and the streaming state settle
    await act(async () => {
      await Promise.resolve();
    });

    // Verify the cell is actually streaming before we delete it
    expect(result.current.streaming.cellIds).toContain(cellId);

    // Act: delete the streaming cell
    await act(async () => {
      await result.current.deleteCell(cellId);
    });

    // Allow runPartial to settle after abort
    await act(async () => {
      await runPartialPromise!;
    });

    // Assert 1: abort was recorded BEFORE putLabRun (strict ordering)
    const abortIdx = callLog.indexOf('abort');
    const putIdx = callLog.indexOf('putLabRun');
    expect(abortIdx).toBeGreaterThanOrEqual(0);
    expect(putIdx).toBeGreaterThanOrEqual(0);
    expect(abortIdx).toBeLessThan(putIdx);
  });

  it('should call putLabRun exactly once (from deleteCell itself, before runPartial settles) when deleteCell removes a streaming cell', async () => {
    // Arrange
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const modelId = result.current.models[0]!.id;
    const cellId = `${modelId}::${PROMPT_ID}`;

    act(() => {
      void result.current.runPartial();
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Act: deleteCell resolves; runPartial is NOT awaited so only deleteCell's putLabRun is counted
    await act(async () => {
      await result.current.deleteCell(cellId);
    });

    // Assert: deleteCell contributes exactly one putLabRun call
    expect(callLog.filter(e => e === 'putLabRun')).toHaveLength(1);
  });

  it('should NOT call archiveCompletedRun within the deleteCell call itself (archivedRuns contract)', async () => {
    // Arrange
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const modelId = result.current.models[0]!.id;
    const cellId = `${modelId}::${PROMPT_ID}`;

    act(() => {
      void result.current.runPartial();
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Act: deleteCell resolves; runPartial is NOT awaited so its post-run archive does not fire
    await act(async () => {
      await result.current.deleteCell(cellId);
    });

    // Assert: archiveCompletedRun not called by deleteCell (runPartial not yet settled)
    expect(vi.mocked(archiveCompletedRun)).not.toHaveBeenCalled();
  });

  it('should remove the cell from the active RunTab after deleteCell completes', async () => {
    // Arrange
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const modelId = result.current.models[0]!.id;
    const cellId = `${modelId}::${PROMPT_ID}`;

    let runPartialPromise: Promise<void>;
    act(() => {
      runPartialPromise = result.current.runPartial();
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Act
    await act(async () => {
      await result.current.deleteCell(cellId);
    });

    await act(async () => {
      await runPartialPromise!;
    });

    // Assert: cell is no longer present in the active run
    const activeRun = result.current.runs.find(r => r.id === result.current.activeRunId);
    const deletedCell = activeRun?.cells.find(c => c.id === cellId);
    expect(deletedCell).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// abort-before-close ordering contract
// ---------------------------------------------------------------------------

describe('lab store — abort-before-close ordering', () => {
  let resolveStreamAbort: () => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(streamChat).mockImplementation(async function* ({
      signal,
    }: {
      signal?: AbortSignal;
    }) {
      await new Promise<void>(resolve => {
        resolveStreamAbort = resolve;
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    vi.spyOn(AbortController.prototype, 'abort').mockImplementation(function (
      this: AbortController
    ) {
      Object.defineProperty(this.signal, 'aborted', { value: true, configurable: true });
      resolveStreamAbort();
    });

    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should unregister the cell stream entry when closeTab is called on a tab with a streaming cell', async () => {
    // Arrange: one model + one prompt, stream hanging
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const tabId = result.current.activeRunId!;
    const modelId = result.current.models[0]!.id;
    const cellId = `${modelId}::${PROMPT_ID}`;

    act(() => {
      void result.current.runPartial();
    });

    // Let the async generator start
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.streaming.cellIds).toContain(cellId);

    // Act: close the tab while stream is in-flight
    await act(async () => {
      await result.current.closeTab(tabId);
    });

    // Allow hanging stream to settle
    await act(async () => {
      await Promise.resolve();
    });

    // Assert: streamRegistry.unregister was called for the cell's stream entry
    expect(vi.mocked(streamRegistry.unregister)).toHaveBeenCalled();
    const unregisterCalls = vi.mocked(streamRegistry.unregister).mock.calls.map(c => c[0]);
    expect(unregisterCalls.some(id => id.includes(cellId))).toBe(true);
  });

  it('should not leave the closed tab in the run list after closeTab completes', async () => {
    // Arrange: hanging stream on active tab; open a second tab so store doesn't recreate same id
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const tabId = result.current.activeRunId!;

    // Create a second tab so closing tabId does not trigger fresh-tab creation
    act(() => {
      result.current.createEmptyTab();
      // Switch back to first tab so runPartial runs on tabId
      result.current.setActiveRun(tabId);
    });

    act(() => {
      void result.current.runPartial();
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Act
    await act(async () => {
      await result.current.closeTab(tabId);
    });

    // Assert: tab is removed from the run list
    const closedTab = result.current.runs.find(r => r.id === tabId);
    expect(closedTab).toBeUndefined();
  });

  it('should not throw when closeTab is called and archiveRun completes cleanly', async () => {
    // Arrange
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const tabId = result.current.activeRunId!;

    act(() => {
      void result.current.runPartial();
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Act + Assert: closeTab must not throw
    await expect(
      act(async () => {
        await result.current.closeTab(tabId);
      })
    ).resolves.not.toThrow();

    expect(vi.mocked(archiveRun)).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// completion-after-close no-op contract
// ---------------------------------------------------------------------------

describe('lab store — completion-after-close is a no-op', () => {
  let resolveStream: () => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();

    // Stream that yields one chunk, then waits for manual resolution
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: 'chunk' as const, text: 'partial' };
      await new Promise<void>(resolve => {
        resolveStream = resolve;
      });
    });

    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  afterEach(async () => {
    // Drain any pending async work from hung generators before the next test
    resolveStream();
    // Multiple microtick flushes to let async generators settle fully
    await new Promise(resolve => setTimeout(resolve, 0));
    vi.restoreAllMocks();
  });

  it('should not write to the store when the stream completes after the tab has been closed', async () => {
    // Arrange: start a run, close the tab, then let the generator finish
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const tabId = result.current.activeRunId!;

    // Open a second tab so closing tabId does not trigger fresh-tab creation with same id
    act(() => {
      result.current.createEmptyTab();
      result.current.setActiveRun(tabId);
    });

    let runPartialPromise: Promise<void>;
    act(() => {
      runPartialPromise = result.current.runPartial();
    });

    // Let stream yield its first chunk and pause
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Close the tab before the stream finishes
    await act(async () => {
      await result.current.closeTab(tabId);
    });

    const runsAfterClose = result.current.runs.map(r => r.id);
    expect(runsAfterClose).not.toContain(tabId);

    // Act: now let the generator complete
    await act(async () => {
      resolveStream();
      await runPartialPromise!;
    });

    // Assert: no new run was added for the closed tab
    const tabAfterCompletion = result.current.runs.find(r => r.id === tabId);
    expect(tabAfterCompletion).toBeUndefined();
  });

  it('should not throw when the stream generator finishes after the tab has been closed', async () => {
    // Arrange
    const { result } = renderHook(() => usePromptTesterStore());

    act(() => {
      result.current.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      result.current.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      result.current.setUserPrompt('Compare these');
    });

    const tabId = result.current.activeRunId!;

    // Open a second tab so closing tabId does not trigger fresh-tab creation with same id
    act(() => {
      result.current.createEmptyTab();
      result.current.setActiveRun(tabId);
    });

    let runPartialPromise: Promise<void>;
    act(() => {
      runPartialPromise = result.current.runPartial();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.closeTab(tabId);
    });

    // Act + Assert: resolving the generator after close must not throw
    await expect(
      act(async () => {
        resolveStream();
        await runPartialPromise!;
      })
    ).resolves.not.toThrow();
  });

  it('should call archiveRun at most once (from closeTab) and not again when the stream finishes late', async () => {
    // Arrange — access store directly to avoid renderHook contamination from prior test
    const store = usePromptTesterStore.getState();

    act(() => {
      store.addModel({
        providerId: 'openrouter',
        modelKey: 'gpt-4o',
        name: 'GPT-4o',
        supportsThinking: false,
      });
      store.addPrompt({
        id: PROMPT_ID,
        kind: 'custom',
        text: 'Hello world',
        edited: false,
      });
      store.setUserPrompt('Compare these');
    });

    const tabId = usePromptTesterStore.getState().activeRunId!;

    // Open a second tab so closing tabId does not trigger fresh-tab creation with same id
    act(() => {
      usePromptTesterStore.getState().createEmptyTab();
      usePromptTesterStore.getState().setActiveRun(tabId);
    });

    let runPartialPromise: Promise<void>;
    act(() => {
      runPartialPromise = usePromptTesterStore.getState().runPartial();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await usePromptTesterStore.getState().closeTab(tabId);
    });

    const archiveCallsAtClose = vi.mocked(archiveRun).mock.calls.length;

    // Act: stream finishes late
    await act(async () => {
      resolveStream();
      await runPartialPromise!;
    });

    // Assert: archiveRun call count did not increase after late completion
    expect(vi.mocked(archiveRun).mock.calls.length).toBe(archiveCallsAtClose);
  });
});
