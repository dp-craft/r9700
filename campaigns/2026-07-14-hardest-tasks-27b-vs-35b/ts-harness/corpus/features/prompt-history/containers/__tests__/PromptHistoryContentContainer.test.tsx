// Boundary mocks — declared before imports (Vitest hoisting)

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('@/db/prompts', () => ({
  getAllPrompts: vi.fn().mockResolvedValue([]),
  deletePrompts: vi.fn().mockResolvedValue(undefined),
}));

const mockDownloadJson = vi.fn();

vi.mock('@/lib/download', () => ({
  downloadJson: (filename: string, data: unknown) => mockDownloadJson(filename, data),
}));

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PromptHistoryEntry, usePromptHistoryStore } from '../../stores/usePromptHistoryStore';
import { PromptHistoryContentContainer } from '../PromptHistoryContentContainer';

const ENTRY: PromptHistoryEntry = {
  id: 'p1',
  text: 'First prompt',
  type: 'USER',
  firstSource: 'CHAT',
  useCount: 1,
  firstUsedAt: 1000,
  lastUsedAt: 2000,
  references: [],
};

const resetStore = (): void => {
  usePromptHistoryStore.setState({
    entries: [],
    selectedIds: [],
    search: '',
    typeFilter: 'ALL',
    sourceFilter: 'ALL',
    sort: 'last-used',
    detailId: null,
    loadError: null,
  });
};

describe('PromptHistoryContentContainer — smoke', () => {
  beforeEach(() => {
    resetStore();
    mockDownloadJson.mockClear();
    // Stub mount-load so it does not clobber seeded entries
    vi.spyOn(usePromptHistoryStore.getState(), 'loadEntries').mockResolvedValue(undefined);
  });

  it('should render the PromptHistoryList when entries are present', async () => {
    usePromptHistoryStore.setState({ entries: [ENTRY] });

    await act(async () => render(<PromptHistoryContentContainer />));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('First prompt')).toBeInTheDocument();
  });

  it('should not render an MFRail', async () => {
    const { container } = await act(async () => render(<PromptHistoryContentContainer />));

    expect(container.querySelector('[data-slot="mf-rail"]')).toBeNull();
    expect(container.querySelector('[data-slot="mf-header"]')).toBeNull();
  });

  it('should call downloadJson when the bulk-export handler fires', async () => {
    usePromptHistoryStore.setState({ entries: [ENTRY], selectedIds: ['p1'] });

    await act(async () => render(<PromptHistoryContentContainer />));

    const exportBtn = screen.getByRole('button', { name: /export/i });
    act(() => {
      exportBtn.click();
    });

    expect(mockDownloadJson).toHaveBeenCalledOnce();
    expect(mockDownloadJson.mock.calls[0][0]).toBe('prompt-history-export.json');
  });
});
