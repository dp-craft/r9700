import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResultCellVM } from '../../types';
import { ResultsGrid, type ResultsGridProps } from '../ResultsGrid';

// -- Builders --

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
  selectAriaLabel: 'Select for comparison',
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResultsGrid', () => {
  it('should render formatted TTF in seconds when cell has ttfMs', () => {
    // Arrange: cell with 1500ms TTF — should format to "1.50" seconds
    const cell = buildCell({ ttfMs: 1500 });

    // Act
    render(<ResultsGrid {...buildProps({ cells: [cell] })} />);

    // Assert: formatted value "1.50" appears (not raw "1500")
    expect(screen.getByText(/1\.50/)).toBeInTheDocument();
    expect(screen.queryByText('1500')).not.toBeInTheDocument();
  });

  it('should render formatted TPS when cell has tps', () => {
    // Arrange: cell with tps 12.345 — should format to "12.35"
    const cell = buildCell({ tps: 12.345 });

    // Act
    render(<ResultsGrid {...buildProps({ cells: [cell] })} />);

    // Assert: formatted value "12.35" appears (not raw "12.345")
    expect(screen.getByText(/12\.35/)).toBeInTheDocument();
    expect(screen.queryByText('12.345')).not.toBeInTheDocument();
  });

  it('should not render TTF/TPS row when both ttfMs and tps are null', () => {
    // Arrange: cell with both metrics null
    const cell = buildCell({ ttfMs: null, tps: null });

    // Act
    render(<ResultsGrid {...buildProps({ cells: [cell], ttfLabel: 'TTF', tpsLabel: 'TPS' })} />);

    // Assert: neither label appears in the document
    expect(screen.queryByText(/TTF/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TPS/)).not.toBeInTheDocument();
  });

  it('should NOT apply opacity-50 class to cell button when isOutdated is true', () => {
    // Arrange: cell with isOutdated: true
    const cell = buildCell({ isOutdated: true });

    // Act
    const { container } = render(<ResultsGrid {...buildProps({ cells: [cell] })} />);

    // Assert: no button has the opacity-50 class
    const button = container.querySelector('button[aria-label]');
    expect(button).not.toBeNull();
    expect(button?.className).not.toContain('opacity-50');
  });

  it('should NOT render outdated warning icon when isOutdated is true', () => {
    // Arrange: cell with isOutdated: true
    const cell = buildCell({ isOutdated: true });

    // Act
    render(<ResultsGrid {...buildProps({ cells: [cell] })} />);

    // Assert: no element with aria-label "Outdated" is rendered
    expect(screen.queryByLabelText('Outdated')).not.toBeInTheDocument();
  });

  it('should render comparison checkbox with selectAriaLabel when a cell is present', () => {
    // Arrange
    const cell = buildCell({ id: 'cell-99' });

    // Act
    render(
      <ResultsGrid {...buildProps({ cells: [cell], selectAriaLabel: 'Select for comparison' })} />
    );

    // Assert: checkbox with the aria-label text exists
    expect(screen.getByLabelText('Select for comparison')).toBeInTheDocument();
  });

  it('should call onSelectToggle with cellId when comparison checkbox is clicked', async () => {
    // Arrange
    const user = userEvent.setup();
    const onSelectToggle = vi.fn();
    const cell = buildCell({ id: 'cell-99' });

    render(
      <ResultsGrid
        {...buildProps({ cells: [cell], onSelectToggle, selectAriaLabel: 'Select for comparison' })}
      />
    );

    // Act
    await user.click(screen.getByLabelText('Select for comparison'));

    // Assert
    expect(onSelectToggle).toHaveBeenCalledWith('cell-99');
  });

  it('should call onSelectToggle with cellId when compare-select-toggle checkbox is clicked', async () => {
    // Arrange
    const user = userEvent.setup();
    const onSelectToggle = vi.fn();
    const cell = buildCell({ id: 'cell-99' });

    render(
      <ResultsGrid
        {...buildProps({ cells: [cell], onSelectToggle, selectAriaLabel: 'Select for comparison' })}
      />
    );

    // Act
    await user.click(screen.getByTestId('compare-select-toggle'));

    // Assert
    expect(onSelectToggle).toHaveBeenCalledWith('cell-99');
  });
});
