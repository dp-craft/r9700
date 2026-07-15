import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Boundary mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: vi.fn().mockResolvedValue(undefined),
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

import { archiveRun } from '@/db/archivedRuns';
import { putLabRun } from '@/db/labRuns';
import type { TestInLabPayload } from '@/domain/cross-mf';
import { streamRegistry } from '@/services/streaming/streamRegistry';

import type { ArchivedRunInput, ModelEntry, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildRunTab = (id: number, overrides?: Partial<RunTab>): RunTab => ({
  id,
  label: `Futtatás ${id}`,
  createdAt: 1000 + id,
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'diff' as const,
  sort: 'mean' as const,
  group: 'model' as const,
  gridCols: 3 as const,
  viewMode: 'list' as const,
  ...overrides,
});

const buildModelEntry = (overrides?: Partial<ModelEntry>): ModelEntry => ({
  id: 'model-1',
  providerId: 'openrouter',
  modelKey: 'gpt-4o',
  name: 'GPT-4o',
  params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
  thinking: false,
  supportsThinking: false,
  expanded: true,
  accent: true,
  ...overrides,
});

const buildArchivedRun = (overrides?: Partial<ArchivedRunInput>): ArchivedRunInput =>
  ({
    id: 'archived-1',
    label: 'Archived Run',
    configSnapshot: {
      models: [buildModelEntry()],
      prompts: [],
      userPrompt: 'Test prompt',
    },
    ...overrides,
  }) as ArchivedRunInput;

const buildPayload = (overrides?: Partial<TestInLabPayload>): TestInLabPayload => ({
  source: 'chat-deep-link',
  userPrompt: 'Explain TDD',
  systemPrompts: ['You are helpful.'],
  model: 'gpt-4o',
  providerId: 'openai',
  sourceSessionId: 'session-abc',
  ...overrides,
});

// ---------------------------------------------------------------------------
// T011 — openArchivedRun: focus existing tab if run.id matches
// ---------------------------------------------------------------------------

describe('T011 — openArchivedRun focus existing tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should focus existing tab when a tab with matching archived run.id already exists', () => {
    // Arrange: seed with a tab whose id matches the archived run numeric id
    const archived = buildArchivedRun({ id: '5' });
    const tab = buildRunTab(5, { label: 'Existing tab' });
    usePromptTesterStore.setState({ runs: [buildRunTab(1), tab], activeRunId: 1 });

    // Act
    usePromptTesterStore.getState().openArchivedRun(archived);

    // Assert: focus switched to existing tab, no new tab added
    const { runs, activeRunId } = usePromptTesterStore.getState();
    expect(activeRunId).toBe(5);
    expect(runs).toHaveLength(2); // no new tab
  });

  it('should push and hydrate a new tab when no existing tab matches', () => {
    // Arrange
    const archived = buildArchivedRun({ id: '99' });
    usePromptTesterStore.setState({ runs: [buildRunTab(1)], activeRunId: 1 });

    // Act
    usePromptTesterStore.getState().openArchivedRun(archived);

    // Assert: new tab added, focused
    const { runs, activeRunId } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(2);
    expect(activeRunId).not.toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T024 — resolvedModel snapshot capture at run time
// ---------------------------------------------------------------------------

describe('T024 — resolvedModel snapshot in cells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should populate resolvedModel on cells after runFull completes', async () => {
    // Arrange: one model, streamChat returns immediately
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'chunk' as const, text: 'hello' };
      })()
    );

    const model = buildModelEntry({ id: 'model-a', providerId: 'openrouter', modelKey: 'gpt-4o' });
    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [model], prompts: [], userPrompt: 'test' },
        }),
      ],
      activeRunId: 1,
      models: [model],
      prompts: [],
      userPrompt: 'test',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert
    const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
    const cell = run?.cells[0];
    expect(cell?.resolvedModel).toBeDefined();
    expect(cell?.resolvedModel?.modelKey).toBe('gpt-4o');
    expect(cell?.resolvedModel?.providerId).toBe('openrouter');
    expect(cell?.resolvedModel?.params).toEqual(model.params);
  });
});

// ---------------------------------------------------------------------------
// T029 — closeTab creates fresh empty tab when closing last/only tab
// ---------------------------------------------------------------------------

describe('T029 — closeTab last tab creates fresh empty tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should create a fresh empty tab when closing the last/only tab', async () => {
    // Arrange: single tab
    const solo = buildRunTab(42);
    usePromptTesterStore.setState({ runs: [solo], activeRunId: 42 });
    vi.mocked(archiveRun).mockResolvedValue({} as never);

    // Act
    await usePromptTesterStore.getState().closeTab(42);

    // Assert: still one tab, fresh unique id (maxId+1=43), empty config
    const { runs, activeRunId } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(43);
    expect(activeRunId).toBe(43);
    expect(runs[0]?.configSnapshot).toEqual({ models: [], prompts: [], userPrompt: '' });
  });

  it('should not refuse closing the last tab (no early return)', async () => {
    // Arrange
    const solo = buildRunTab(1);
    usePromptTesterStore.setState({ runs: [solo], activeRunId: 1 });
    vi.mocked(archiveRun).mockResolvedValue({} as never);

    // Act
    await usePromptTesterStore.getState().closeTab(1);

    // Assert: archiveRun was called (tab was not refused)
    expect(archiveRun).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T031 — new model section starts collapsed (expanded: false)
// ---------------------------------------------------------------------------

describe('T031 — addModel sets expanded: false on non-first models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should set expanded: false on newly added model when not first', () => {
    // Arrange: one model already exists
    const existingModel = buildModelEntry({ id: 'model-1' });
    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [existingModel], prompts: [], userPrompt: '' },
        }),
      ],
      activeRunId: 1,
      models: [existingModel],
    });

    // Act
    usePromptTesterStore.getState().addModel({
      providerId: 'claude',
      modelKey: 'claude-3',
      name: 'Claude 3',
      supportsThinking: true,
    });

    // Assert
    const { models } = usePromptTesterStore.getState();
    const added = models.find(m => m.modelKey === 'claude-3');
    expect(added?.expanded).toBe(false);
  });

  it('should set expanded: false on confirmModelPicker when not first', () => {
    // Arrange: one model already exists
    const existingModel = buildModelEntry({ id: 'model-1' });
    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [existingModel], prompts: [], userPrompt: '' },
        }),
      ],
      activeRunId: 1,
      models: [existingModel],
    });

    // Act
    usePromptTesterStore.getState().confirmModelPicker({
      providerId: 'claude',
      modelKey: 'claude-3',
      name: 'Claude 3',
      supportsThinking: true,
    });

    // Assert
    const { models } = usePromptTesterStore.getState();
    const added = models.find(m => m.modelKey === 'claude-3');
    expect(added?.expanded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T034 — streamRegistry registration
// ---------------------------------------------------------------------------

describe('T034 — streamRegistry integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should call streamRegistry.register when a stream starts during runFull', async () => {
    // Arrange
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'chunk' as const, text: 'hello' };
      })()
    );

    const model = buildModelEntry({ id: 'model-a' });
    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [model], prompts: [], userPrompt: 'test' },
        }),
      ],
      activeRunId: 1,
      models: [model],
      prompts: [],
      userPrompt: 'test',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert
    expect(streamRegistry.register).toHaveBeenCalled();
  });

  it('should call streamRegistry.unregister after stream completes', async () => {
    // Arrange
    const { streamChat } = await import('@/services/llm/stream');
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'chunk' as const, text: 'hello' };
      })()
    );

    const model = buildModelEntry({ id: 'model-a' });
    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [model], prompts: [], userPrompt: 'test' },
        }),
      ],
      activeRunId: 1,
      models: [model],
      prompts: [],
      userPrompt: 'test',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert
    expect(streamRegistry.unregister).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T012 — openScratchTab pushes a NEW tab
// ---------------------------------------------------------------------------

describe('T012 — openScratchTab pushes new tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should push a new tab when openScratchTab is called', () => {
    // Arrange: initial has one tab
    const payload = buildPayload();
    const before = usePromptTesterStore.getState().runs.length;

    // Act
    usePromptTesterStore.getState().openScratchTab(payload);

    // Assert
    const { runs } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(before + 1);
  });

  it('should activate the new tab after openScratchTab', () => {
    // Arrange
    const payload = buildPayload();
    const beforeId = usePromptTesterStore.getState().activeRunId;

    // Act
    usePromptTesterStore.getState().openScratchTab(payload);

    // Assert: activeRunId changed to new tab
    const { activeRunId } = usePromptTesterStore.getState();
    expect(activeRunId).not.toBe(beforeId);
  });

  it('should hydrate the new tab with payload data', () => {
    // Arrange
    const payload = buildPayload({
      userPrompt: 'TDD prompt',
      systemPrompts: ['Be helpful.'],
      model: 'gpt-4o',
    });

    // Act
    usePromptTesterStore.getState().openScratchTab(payload);

    // Assert
    const { userPrompt, prompts, models } = usePromptTesterStore.getState();
    expect(userPrompt).toBe('TDD prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.text).toBe('Be helpful.');
    expect(models.some(m => m.modelKey === 'gpt-4o')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T035 — closeTab/deleteCell unregister streamRegistry + completion no-op guard
// ---------------------------------------------------------------------------

describe('T035 — closeTab/deleteCell unregister streamRegistry entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should call streamRegistry.unregister for each cell of the closed tab', async () => {
    // Arrange: a tab with cells
    const tab = buildRunTab(5, {
      cells: [
        {
          id: 'model-1::prompt-1',
          modelId: 'model-1',
          promptId: 'prompt-1',
          userPromptHash: '123',
          output: 'done',
          latencyMs: 100,
          tokens: 10,
          cost: 0,
          ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
          cached: false,
          status: 'done',
        },
        {
          id: 'model-2::prompt-1',
          modelId: 'model-2',
          promptId: 'prompt-1',
          userPromptHash: '123',
          output: 'done',
          latencyMs: 100,
          tokens: 10,
          cost: 0,
          ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
          cached: false,
          status: 'done',
        },
      ],
    });
    usePromptTesterStore.setState({
      runs: [buildRunTab(1), tab],
      activeRunId: 1,
    });
    vi.mocked(archiveRun).mockResolvedValue({} as never);

    // Act
    await usePromptTesterStore.getState().closeTab(5);

    // Assert: unregister called for each cell
    expect(streamRegistry.unregister).toHaveBeenCalledWith('lab-5-model-1::prompt-1');
    expect(streamRegistry.unregister).toHaveBeenCalledWith('lab-5-model-2::prompt-1');
  });

  it('should call streamRegistry.unregister for the deleted cell', async () => {
    // Arrange: a tab with one cell
    const tab = buildRunTab(1, {
      cells: [
        {
          id: 'model-1::prompt-1',
          modelId: 'model-1',
          promptId: 'prompt-1',
          userPromptHash: '123',
          output: 'streaming...',
          latencyMs: 0,
          tokens: 0,
          cost: 0,
          ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
          cached: false,
          status: 'streaming',
        },
      ],
    });
    usePromptTesterStore.setState({
      runs: [tab],
      activeRunId: 1,
      streaming: { runId: 1, cellIds: ['model-1::prompt-1'] },
    });

    // Act
    await usePromptTesterStore.getState().deleteCell('model-1::prompt-1');

    // Assert
    expect(streamRegistry.unregister).toHaveBeenCalledWith('lab-1-model-1::prompt-1');
  });

  it('should no-op in streamSingleCell when run is removed mid-stream', async () => {
    // Arrange: set up a stream that yields, then the run is removed before completion
    const { streamChat } = await import('@/services/llm/stream');

    let resolveYield: (() => void) | null = null;
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { type: 'chunk' as const, text: 'first' };
        // Wait for test to remove the run
        await new Promise<void>(r => {
          resolveYield = r;
        });
        yield { type: 'chunk' as const, text: 'second' };
      })()
    );

    const model = buildModelEntry({ id: 'model-a' });
    usePromptTesterStore.setState({
      runs: [
        buildRunTab(1, {
          configSnapshot: { models: [model], prompts: [], userPrompt: 'test' },
        }),
      ],
      activeRunId: 1,
      models: [model],
      prompts: [],
      userPrompt: 'test',
    });

    // Act: start runFull, then remove run mid-stream
    const runPromise = usePromptTesterStore.getState().runFull();

    // Wait for first chunk to be processed
    await vi.waitFor(() => {
      const run = usePromptTesterStore.getState().runs.find(r => r.id === 1);
      expect(run?.cells[0]?.output).toBe('first');
    });

    // Remove the run (simulate close)
    usePromptTesterStore.setState({ runs: [] });

    // Continue stream
    (resolveYield as (() => void) | null)?.();
    await runPromise;

    // Assert: no crash, run is gone, cell wasn't updated after removal
    expect(usePromptTesterStore.getState().runs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FR-032 T001 — openScratchTab synchronous seed + _pendingScratch neutralization
// ---------------------------------------------------------------------------

describe('FR-032 T001 — openScratchTab synchronous seed with ≥1 existing tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should increase tab count by exactly one when ≥1 tab is already open', () => {
    // Arrange: seed two existing tabs so there is definitely ≥1 already open
    const tab1 = buildRunTab(1);
    const tab2 = buildRunTab(2);
    usePromptTesterStore.setState({ runs: [tab1, tab2], activeRunId: 1 });
    const countBefore = usePromptTesterStore.getState().runs.length;

    // Act
    usePromptTesterStore.getState().openScratchTab({
      source: 'chat-deep-link',
      userPrompt: 'HELLO',
      systemPrompts: [],
      model: '',
      providerId: '',
      sourceSessionId: '',
    });

    // Assert: exactly one new tab added
    expect(usePromptTesterStore.getState().runs).toHaveLength(countBefore + 1);
  });

  it('should expose the new tab userPrompt === "HELLO" synchronously (no loadRunHistory needed)', () => {
    // Arrange: two tabs already open
    const tab1 = buildRunTab(1);
    const tab2 = buildRunTab(2);
    usePromptTesterStore.setState({ runs: [tab1, tab2], activeRunId: 2 });

    // Act — synchronous, no await
    usePromptTesterStore.getState().openScratchTab({
      source: 'chat-deep-link',
      userPrompt: 'HELLO',
      systemPrompts: [],
      model: '',
      providerId: '',
      sourceSessionId: '',
    });

    // Assert: top-level userPrompt is immediately 'HELLO' (synced from new active tab)
    expect(usePromptTesterStore.getState().userPrompt).toBe('HELLO');
  });

  it('should NOT set _pendingScratch after openScratchTab (seed is fully synchronous)', () => {
    // Arrange
    const tab1 = buildRunTab(1);
    usePromptTesterStore.setState({ runs: [tab1], activeRunId: 1 });

    // Act
    usePromptTesterStore.getState().openScratchTab({
      source: 'chat-deep-link',
      userPrompt: 'HELLO',
      systemPrompts: [],
      model: '',
      providerId: '',
      sourceSessionId: '',
    });

    // Assert: _pendingScratch must be null — seed was applied to the tab synchronously
    // and no deferred re-application is needed.
    // FAILS against current impl because openScratchTab sets _pendingScratch = payload.
    expect(
      (usePromptTesterStore.getState() as { _pendingScratch: unknown })._pendingScratch
    ).toBeNull();
  });

  it('should persist the new scratch tab to IDB synchronously via putLabRun', () => {
    // Arrange
    const tab1 = buildRunTab(1);
    usePromptTesterStore.setState({ runs: [tab1], activeRunId: 1 });
    vi.mocked(putLabRun).mockResolvedValue(undefined);

    // Act
    usePromptTesterStore.getState().openScratchTab({
      source: 'chat-deep-link',
      userPrompt: 'HELLO',
      systemPrompts: [],
      model: '',
      providerId: '',
      sourceSessionId: '',
    });

    // Assert: putLabRun was called to persist the new tab immediately.
    // FAILS against current impl because openScratchTab defers persistence via _pendingScratch.
    expect(putLabRun).toHaveBeenCalled();
  });
});

describe('FR-032 T001 — loadRunHistory does not re-apply _pendingScratch after openScratchTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should leave _pendingScratch as null before loadRunHistory is called', async () => {
    // Arrange: one base tab
    const baseTab = buildRunTab(1);
    usePromptTesterStore.setState({ runs: [baseTab], activeRunId: 1 });

    // Act: call openScratchTab — corrected impl must NOT set _pendingScratch
    usePromptTesterStore.getState().openScratchTab({
      source: 'chat-deep-link',
      userPrompt: 'HELLO',
      systemPrompts: [],
      model: '',
      providerId: '',
      sourceSessionId: '',
    });

    // Assert: _pendingScratch is null without needing loadRunHistory to clear it.
    // FAILS against current impl: _pendingScratch is set to payload here.
    expect(
      (usePromptTesterStore.getState() as { _pendingScratch: unknown })._pendingScratch
    ).toBeNull();
  });

  it('should preserve the scratch tab userPrompt after loadRunHistory with empty IDB', async () => {
    // Arrange: one base tab; getAllLabRuns returns empty (scratch tab not yet in IDB)
    const { getAllLabRuns } = await import('@/db/labRuns');
    vi.mocked(getAllLabRuns).mockResolvedValue([]);
    const baseTab = buildRunTab(1);
    usePromptTesterStore.setState({ runs: [baseTab], activeRunId: 1 });

    // Act
    usePromptTesterStore.getState().openScratchTab({
      source: 'chat-deep-link',
      userPrompt: 'HELLO',
      systemPrompts: [],
      model: '',
      providerId: '',
      sourceSessionId: '',
    });
    const scratchTabId = usePromptTesterStore.getState().activeRunId;
    await usePromptTesterStore.getState().loadRunHistory();

    // Assert: scratch tab userPrompt is preserved after loadRunHistory
    const activeTab = usePromptTesterStore.getState().runs.find(r => r.id === scratchTabId);
    expect(activeTab?.configSnapshot.userPrompt).toBe('HELLO');
    expect(usePromptTesterStore.getState().userPrompt).toBe('HELLO');
  });
});
