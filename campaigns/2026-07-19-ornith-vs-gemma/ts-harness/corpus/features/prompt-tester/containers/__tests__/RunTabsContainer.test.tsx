// Boundary mocks — declared before imports (Vitest hoisting)

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
  getLabRunById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi
    .fn()
    .mockResolvedValue({ modellek: false, systemSkill: false, userPrompt: false }),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(undefined),
  putAppSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/archivedRuns', () => ({
  getArchivedRuns: vi.fn().mockResolvedValue([]),
  archiveRun: vi.fn().mockResolvedValue(undefined),
  deleteArchivedRuns: vi.fn().mockResolvedValue(undefined),
  buildRunExport: vi.fn().mockReturnValue([]),
}));

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { RunTabsContainer } from '../RunTabsContainer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRun(id: number, label: string) {
  return {
    id,
    label,
    createdAt: 0,
    configSnapshot: { models: [], prompts: [], userPrompt: '' },
    cells: [],
    selectedCellIds: [],
    compareMode: 'diff' as const,
    sort: 'mean' as const,
    group: 'model' as const,
    gridCols: 3 as const,
    viewMode: 'list' as const,
  };
}

const resetStore = (
  overrides: Partial<ReturnType<typeof usePromptTesterStore.getState>> = {}
): void => {
  usePromptTesterStore.setState({
    runs: [buildRun(1, 'Run 1'), buildRun(2, 'Run 2')],
    activeRunId: 1,
    editingRunId: null,
    models: [],
    prompts: [],
    userPrompt: '',
    sectionCollapse: { modellek: false, systemSkill: false, userPrompt: false },
    streaming: { runId: null, cellIds: [] },
    ...overrides,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunTabsContainer', () => {
  beforeEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // TC-1: add-tab triggers createEmptyTab (FR-012, FR-025)
  // -------------------------------------------------------------------------

  it('should call createEmptyTab (not archiveAndCreateEmptyTab) when add-tab button is clicked', async () => {
    const user = userEvent.setup();
    const createMock = vi.fn();
    const archiveMock = vi.fn().mockResolvedValue(undefined);
    resetStore();
    usePromptTesterStore.setState({
      createEmptyTab: createMock,
      archiveAndCreateEmptyTab: archiveMock,
    });

    await act(async () => {
      render(<RunTabsContainer />);
    });

    const addButton = screen.getByText('lab.tabs.new-test');
    await user.click(addButton);

    expect(createMock, 'createEmptyTab must be called on add').toHaveBeenCalledOnce();
    expect(archiveMock, 'archiveAndCreateEmptyTab must NOT be called').not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TC-2: tab switch during rename commits the edit (FR-011)
  // -------------------------------------------------------------------------

  it('should commit pending rename and clear editingRunId when another tab is activated', async () => {
    const user = userEvent.setup();
    const renameMock = vi.fn();
    const setEditingMock = vi.fn();
    resetStore({ activeRunId: 1, editingRunId: '1' });
    usePromptTesterStore.setState({ renameRun: renameMock, setEditingRun: setEditingMock });

    await act(async () => {
      render(<RunTabsContainer />);
    });

    const input = screen.getByRole('textbox', { name: /rename run 1/i });
    await user.clear(input);
    await user.type(input, 'Updated Name');

    const tab2 = screen.getByRole('tab', { name: 'Run 2' });
    await user.click(tab2);

    expect(
      renameMock,
      'renameRun must be called to commit before switching tab'
    ).toHaveBeenCalled();
    expect(setEditingMock, 'setEditingRun(null) must clear edit state').toHaveBeenCalledWith(null);
  });

  // -------------------------------------------------------------------------
  // TC-3: empty/whitespace rename is rejected — renameRun not called (FR-013)
  // -------------------------------------------------------------------------

  it('should not call renameRun and should cancel edit when rename is committed with empty string', async () => {
    const user = userEvent.setup();
    const renameMock = vi.fn();
    const setEditingMock = vi.fn();
    resetStore({ activeRunId: 1, editingRunId: '1' });
    usePromptTesterStore.setState({ renameRun: renameMock, setEditingRun: setEditingMock });

    await act(async () => {
      render(<RunTabsContainer />);
    });

    const input = screen.getByRole('textbox', { name: /rename run 1/i });
    await user.clear(input);
    await user.keyboard('{Enter}');

    expect(renameMock, 'renameRun must NOT be called for empty commit').not.toHaveBeenCalled();
    expect(
      setEditingMock,
      'setEditingRun(null) must still be called to cancel'
    ).toHaveBeenCalledWith(null);
  });

  // -------------------------------------------------------------------------
  // TC-4: menuSlot renders a Rename item for each tab (FR-010)
  // -------------------------------------------------------------------------

  it('should render a Rename menu item for each tab via menuSlot', async () => {
    await act(async () => {
      render(<RunTabsContainer />);
    });

    const renameItems = screen.queryAllByRole('button', { name: /rename/i });
    expect(
      renameItems.length,
      'each tab must have a Rename button in its menuSlot'
    ).toBeGreaterThanOrEqual(2);
  });
});
