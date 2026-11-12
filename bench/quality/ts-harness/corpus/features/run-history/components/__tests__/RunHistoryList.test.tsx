import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RunHistoryList,
  type RunHistoryListLabels,
  type RunHistoryListProps,
  type RunHistoryRowVM
} from '../RunHistoryList';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildRow = (overrides?: Partial<RunHistoryRowVM>): RunHistoryRowVM => ({
  id: 'run-1',
  label: 'My Test Run',
  archivedAt: new Date('2024-01-15T10:00:00Z').getTime(),
  cellCount: 4,
  pinned: false,
  selected: false,
  ...overrides,
});

const defaultLabels: RunHistoryListLabels = {
  cells: 'cells',
  open: 'Open',
  justNow: 'just now',
  minutesAgo: (m: number) => `${String(m)}m ago`,
  hoursAgo: (h: number) => `${String(h)}h ago`,
  daysAgo: (d: number) => `${String(d)}d ago`,
};

const buildProps = (overrides?: Partial<RunHistoryListProps>): RunHistoryListProps => ({
  rows: [buildRow()],
  onToggleSelect: vi.fn(),
  onOpen: vi.fn(),
  labels: defaultLabels,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RunHistoryList', () => {
  it('should match snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T10:00:00Z'));

    const { asFragment } = render(<RunHistoryList {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();

    vi.useRealTimers();
  });

  it('should render one row per archived run with label and cell count', () => {
    const rows = [
      buildRow({ id: 'run-1', label: 'Alpha Run', cellCount: 2 }),
      buildRow({ id: 'run-2', label: 'Beta Run', cellCount: 5 }),
    ];

    render(<RunHistoryList {...buildProps({ rows })} />);

    expect(screen.getByText('Alpha Run')).toBeInTheDocument();
    expect(screen.getByText('Beta Run')).toBeInTheDocument();
    expect(screen.getByText((_content, el) => el?.textContent === '2 cells')).toBeInTheDocument();
    expect(screen.getByText((_content, el) => el?.textContent === '5 cells')).toBeInTheDocument();
  });

  it('should call onOpen with the run id when a row open affordance is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const rows = [buildRow({ id: 'run-42', label: 'Open Me' })];

    render(<RunHistoryList {...buildProps({ rows, onOpen })} />);

    const openButton = screen.getByRole('button', { name: /open/i });
    await user.click(openButton);

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith('run-42');
  });

  it('should call onToggleSelect with the run id when selection affordance is clicked', async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    const rows = [buildRow({ id: 'run-7', label: 'Select Me' })];

    render(<RunHistoryList {...buildProps({ rows, onToggleSelect })} />);

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);

    expect(onToggleSelect).toHaveBeenCalledOnce();
    expect(onToggleSelect).toHaveBeenCalledWith('run-7');
  });

  it('should render no option elements when rows is empty', () => {
    render(<RunHistoryList {...buildProps({ rows: [] })} />);

    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
