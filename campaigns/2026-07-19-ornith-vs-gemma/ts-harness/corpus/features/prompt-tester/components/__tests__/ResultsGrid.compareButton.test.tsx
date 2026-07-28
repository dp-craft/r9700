import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResultCellVM } from '../../types';
import { ResultsGrid, type ResultsGridProps } from '../ResultsGrid';

const buildCell = (overrides?: Partial<ResultCellVM>): ResultCellVM => ({
  id: 'cell-1',
  title: 'M1/S1',
  modelLabel: 'gpt-4o',
  phrase: 'test prompt',
  status: 'done',
  output: 'some output',
  outputPreview: 'some output',
  error: null,
  latencyMs: 0,
  tokens: 0,
  ttfMs: null,
  tps: null,
  isOutdated: false,
  meanRating: 4,
  ...overrides,
});

const buildProps = (overrides?: Partial<ResultsGridProps>): ResultsGridProps => ({
  cells: [buildCell()],
  activeCellId: null,
  emptyLabel: 'No results',
  errorLabel: 'Error',
  deleteCellAriaLabel: 'Delete cell',
  selectAriaLabel: 'Select for comparison',
  compareLabel: 'Compare',
  ttfLabel: 'TTF',
  tpsLabel: 'TPS',
  listAriaLabel: 'Results list',
  unresolvedAriaLabel: 'Unresolved model',
  selectedCellIds: [],
  statusLabels: {
    idle: 'Idle',
    streaming: 'Streaming',
    done: 'Done',
    error: 'Error',
    aborted: 'Aborted',
  },
  onCellClick: vi.fn(),
  onCellDelete: vi.fn(),
  onSelectToggle: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResultsGrid compare toggle button', () => {
  it('should render an unpressed compare button when the cell is not selected', () => {
    const { asFragment } = render(
      <ResultsGrid {...buildProps({ cells: [buildCell({ id: 'cell-1' })], selectedCellIds: [] })} />
    );

    const button = screen.getByTestId('compare-select-toggle');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('Compare');
    expect(asFragment()).toMatchSnapshot();
  });

  it('should render a pressed compare button when the cell is selected', () => {
    const { asFragment } = render(
      <ResultsGrid
        {...buildProps({ cells: [buildCell({ id: 'cell-1' })], selectedCellIds: ['cell-1'] })}
      />
    );

    expect(screen.getByTestId('compare-select-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(asFragment()).toMatchSnapshot();
  });

  it('should call onSelectToggle with the cell id when the compare button is clicked', async () => {
    const user = userEvent.setup();
    const onSelectToggle = vi.fn();

    render(
      <ResultsGrid {...buildProps({ cells: [buildCell({ id: 'cell-99' })], onSelectToggle })} />
    );

    await user.click(screen.getByTestId('compare-select-toggle'));

    expect(onSelectToggle).toHaveBeenCalledWith('cell-99');
  });
});
