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

import type { RunTab } from '@/features/prompt-tester/types';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { RunTabsContainer } from '../RunTabsContainer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INITIAL_RUN_ID = 1;

const buildTab = (overrides: Partial<RunTab> = {}): RunTab => ({
  id: INITIAL_RUN_ID,
  label: 'Futtatás 1',
  createdAt: 0,
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'diff',
  sort: 'mean',
  group: 'model',
  gridCols: 3,
  viewMode: 'list',
  ...overrides,
});

const seedStore = (tab: RunTab = buildTab()): void => {
  usePromptTesterStore.setState({
    runs: [tab],
    activeRunId: INITIAL_RUN_ID,
    editingRunId: null,
    models: [],
    prompts: [],
    userPrompt: '',
    sectionCollapse: { modellek: false, systemSkill: false, userPrompt: false },
    streaming: { runId: null, cellIds: [] },
  } as unknown as Parameters<typeof usePromptTesterStore.setState>[0]);
};

// ---------------------------------------------------------------------------
// L3 Smoke — view-mode toggle inside RunTabsContainer
// ---------------------------------------------------------------------------

describe('RunTabsContainer — view-mode toggle L3 smoke', () => {
  beforeEach(() => {
    seedStore();
  });

  it('should render the view-mode-toggle inside the tablist', async () => {
    // Arrange
    seedStore(buildTab({ viewMode: 'list' }));

    // Act
    await act(async () => {
      render(<RunTabsContainer />);
    });

    // Assert — toggle is rendered inside the tablist
    const tablist = screen.getByRole('tablist');
    expect(tablist).toContainElement(screen.getByTestId('view-mode-toggle'));
  });

  it('should update store viewMode to "grid" when the grid toggle button is clicked', async () => {
    // Arrange
    seedStore(buildTab({ viewMode: 'list' }));
    const user = userEvent.setup();

    await act(async () => {
      render(<RunTabsContainer />);
    });

    const gridButton = screen.getByTestId('view-mode-grid');
    const modeBefore = usePromptTesterStore
      .getState()
      .runs.find(r => r.id === INITIAL_RUN_ID)?.viewMode;

    // Act
    await user.click(gridButton);

    // Assert
    const modeAfter = usePromptTesterStore
      .getState()
      .runs.find(r => r.id === INITIAL_RUN_ID)?.viewMode;
    expect(
      modeAfter,
      `Dead handler — grid toggle did not call setViewMode (was "${modeBefore}")`
    ).toBe('grid');
  });
});
