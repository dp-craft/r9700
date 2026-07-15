// Boundary mocks — declared before imports (Vitest hoisting)

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
  useLocale: () => 'en',
}));

const mockDownloadJson = vi.fn();
vi.mock('@/lib/download', () => ({
  downloadJson: (...args: unknown[]) => mockDownloadJson(...args),
}));

vi.mock('@/db/archivedRuns', () => ({
  getArchivedRuns: vi.fn().mockResolvedValue([]),
  deleteArchivedRuns: vi.fn().mockResolvedValue(undefined),
  buildRunExport: vi.fn(),
  getArchivedRunById: vi.fn(),
}));

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ArchivedLabRun, getArchivedRuns } from '@/db/archivedRuns';
import type { LabRunRow } from '@/db/labRuns';

import { useRunHistoryStore } from '../../stores/useRunHistoryStore';
import { RunHistoryContentContainer } from '../RunHistoryContentContainer';

const resetStore = (): void => {
  useRunHistoryStore.setState({
    runs: [],
    selectedIds: [],
    search: '',
    detailId: null,
    page: 0,
    hasMore: false,
  });
};

const buildLabRunRow = (overrides?: Partial<LabRunRow>): LabRunRow => ({
  id: 'run-1',
  label: 'Alpha Run',
  createdAt: new Date('2024-01-01').getTime(),
  updatedAt: new Date('2024-01-01').getTime(),
  configSnapshot: { models: [], prompts: [], userPrompt: 'test' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'table',
  sort: 'mean',
  group: 'none',
  gridCols: 2,
  ...overrides,
});

const buildArchivedRun = (overrides?: Partial<ArchivedLabRun>): ArchivedLabRun => ({
  ...buildLabRunRow(),
  archivedAt: new Date('2024-01-01').getTime(),
  archivedReason: 'tab-close',
  ...overrides,
});

describe('RunHistoryContentContainer — smoke', () => {
  beforeEach(() => {
    resetStore();
    mockDownloadJson.mockClear();
  });

  it('should render the list when runs are present', async () => {
    vi.mocked(getArchivedRuns).mockResolvedValue([buildArchivedRun()]);

    await act(async () => render(<RunHistoryContentContainer />));

    expect(screen.queryByText('runHistory.empty.headline')).not.toBeInTheDocument();
    expect(screen.getByText('Alpha Run')).toBeInTheDocument();
  });

  it('should render EmptyState when no runs', async () => {
    vi.mocked(getArchivedRuns).mockResolvedValue([]);

    await act(async () => render(<RunHistoryContentContainer />));

    expect(screen.getByText('runHistory.empty.headline')).toBeInTheDocument();
  });

  it('should NOT render an MFRail (shell owns navigation)', async () => {
    await act(async () => render(<RunHistoryContentContainer />));

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="mf-rail"]')).toBeNull();
    expect(document.querySelector('[data-testid="mf-rail"]')).toBeNull();
  });

  it('should call downloadJson when bulk export is triggered', async () => {
    const user = userEvent.setup();
    vi.mocked(getArchivedRuns).mockResolvedValue([buildArchivedRun({ id: 'run-99' })]);

    await act(async () => render(<RunHistoryContentContainer />));

    act(() => {
      useRunHistoryStore.setState({ selectedIds: ['run-99'] });
    });

    const exportButton = screen.getByRole('button', { name: /export/i });
    await user.click(exportButton);

    expect(mockDownloadJson).toHaveBeenCalledTimes(1);
    expect(mockDownloadJson.mock.calls[0][0]).toBe('run-history-export.json');
  });
});
