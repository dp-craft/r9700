import { beforeEach, describe, expect, it, vi } from 'vitest';

// Boundary mocks — hoisted before imports (Vitest hoisting)

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn(),
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
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn().mockResolvedValue(undefined),
  getAllPrompts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

import { archiveRun } from '@/db/archivedRuns';

import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildRunTab = (id: number) => ({
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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePromptTesterStore — createEmptyTab (FR-026)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should add a new run tab when createEmptyTab is called', () => {
    // Arrange
    const before = usePromptTesterStore.getState().runs;
    expect(before).toHaveLength(1);

    // Act
    usePromptTesterStore.getState().createEmptyTab();

    // Assert
    const { runs } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(2);
  });

  it('should assign id = max(existing ids) + 1 to the new tab', () => {
    // Arrange: initial state has one tab with id=1
    // Act
    usePromptTesterStore.getState().createEmptyTab();

    // Assert
    const { runs } = usePromptTesterStore.getState();
    const newTab = runs[runs.length - 1];
    expect(newTab?.id).toBe(2);
  });

  it('should activate the new tab after createEmptyTab', () => {
    // Act
    usePromptTesterStore.getState().createEmptyTab();

    // Assert
    const { activeRunId, runs } = usePromptTesterStore.getState();
    const newTab = runs[runs.length - 1];
    expect(activeRunId).toBe(newTab?.id);
  });

  it('should create the new tab with empty configSnapshot (no models, prompts, userPrompt)', () => {
    // Act
    usePromptTesterStore.getState().createEmptyTab();

    // Assert
    const { runs } = usePromptTesterStore.getState();
    const newTab = runs[runs.length - 1];
    expect(newTab?.configSnapshot).toEqual({ models: [], prompts: [], userPrompt: '' });
  });

  it('should increment ids correctly when multiple tabs already exist', () => {
    // Arrange: seed store with tabs 1, 5, 10
    usePromptTesterStore.setState({
      runs: [buildRunTab(1), buildRunTab(5), buildRunTab(10)],
      activeRunId: 10,
    });

    // Act
    usePromptTesterStore.getState().createEmptyTab();

    // Assert: new id = max(1,5,10) + 1 = 11
    const { runs } = usePromptTesterStore.getState();
    const newTab = runs[runs.length - 1];
    expect(newTab?.id).toBe(11);
    expect(usePromptTesterStore.getState().activeRunId).toBe(11);
  });
});

describe('usePromptTesterStore — closeTab (FR-031, FR-036)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should call archiveRun with the closed tab data (happy path)', async () => {
    // Arrange: two tabs, close tab 1
    const tab1 = buildRunTab(1);
    const tab2 = buildRunTab(2);
    usePromptTesterStore.setState({ runs: [tab1, tab2], activeRunId: 2 });
    vi.mocked(archiveRun).mockResolvedValue({} as never);

    // Act
    await usePromptTesterStore.getState().closeTab(1);

    // Assert: archiveRun called once
    expect(archiveRun).toHaveBeenCalledTimes(1);
    // The argument should reflect the closed tab (id converted to string at boundary)
    const callArg = vi.mocked(archiveRun).mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
  });

  it('should remove the closed tab from runs on success', async () => {
    // Arrange
    const tab1 = buildRunTab(1);
    const tab2 = buildRunTab(2);
    usePromptTesterStore.setState({ runs: [tab1, tab2], activeRunId: 2 });
    vi.mocked(archiveRun).mockResolvedValue({} as never);

    // Act
    await usePromptTesterStore.getState().closeTab(1);

    // Assert
    const { runs } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(1);
    expect(runs.find(r => r.id === 1)).toBeUndefined();
  });

  it('should activate another tab when the non-active tab is closed', async () => {
    // Arrange: active tab is 2, close tab 1
    const tab1 = buildRunTab(1);
    const tab2 = buildRunTab(2);
    usePromptTesterStore.setState({ runs: [tab1, tab2], activeRunId: 2 });
    vi.mocked(archiveRun).mockResolvedValue({} as never);

    // Act
    await usePromptTesterStore.getState().closeTab(1);

    // Assert: active tab is still 2
    expect(usePromptTesterStore.getState().activeRunId).toBe(2);
  });

  it('should activate a remaining tab when the active tab is closed', async () => {
    // Arrange: active tab is 1, close it — tab 2 remains
    const tab1 = buildRunTab(1);
    const tab2 = buildRunTab(2);
    usePromptTesterStore.setState({ runs: [tab1, tab2], activeRunId: 1 });
    vi.mocked(archiveRun).mockResolvedValue({} as never);

    // Act
    await usePromptTesterStore.getState().closeTab(1);

    // Assert: activeRunId switched to remaining tab
    const { activeRunId, runs } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(1);
    expect(activeRunId).toBe(2);
  });

  it('should create a fresh empty tab with a new unique id when the last tab is closed', async () => {
    // Arrange: only one tab
    const solo = buildRunTab(42);
    usePromptTesterStore.setState({ runs: [solo], activeRunId: 42 });
    vi.mocked(archiveRun).mockResolvedValue({} as never);

    // Act
    await usePromptTesterStore.getState().closeTab(42);

    // Assert: still exactly one tab, id = maxId+1 = 43, empty config
    const { runs, activeRunId } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(43);
    expect(activeRunId).toBe(43);
    expect(runs[0]?.configSnapshot).toEqual({ models: [], prompts: [], userPrompt: '' });
  });

  it('should NOT remove the tab when archiveRun rejects (rollback on failure)', async () => {
    // Arrange
    const tab1 = buildRunTab(1);
    const tab2 = buildRunTab(2);
    usePromptTesterStore.setState({ runs: [tab1, tab2], activeRunId: 1 });
    vi.mocked(archiveRun).mockRejectedValue(new Error('IDB write failed'));

    // Act
    await usePromptTesterStore.getState().closeTab(1);

    // Assert: runs unchanged, tab1 still present
    const { runs } = usePromptTesterStore.getState();
    expect(runs).toHaveLength(2);
    expect(runs.find(r => r.id === 1)).toBeDefined();
  });

  it('should preserve activeRunId when archiveRun rejects', async () => {
    // Arrange
    const tab1 = buildRunTab(1);
    const tab2 = buildRunTab(2);
    usePromptTesterStore.setState({ runs: [tab1, tab2], activeRunId: 1 });
    vi.mocked(archiveRun).mockRejectedValue(new Error('IDB write failed'));

    // Act
    await usePromptTesterStore.getState().closeTab(1);

    // Assert: activeRunId unchanged
    expect(usePromptTesterStore.getState().activeRunId).toBe(1);
  });
});
