import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GridCellVM, GridTableVM, ResultCellVM, StarMetricId, StarRow } from '../../types';
import { ResultsGridView, type ResultsGridViewProps } from '../ResultsGridView';

// -- Builders --

const buildResultCellVM = (overrides?: Partial<ResultCellVM>): ResultCellVM => ({
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

const buildGridCellVM = (overrides?: Partial<GridCellVM>): GridCellVM => ({
  id: 'cell-1',
  cell: buildResultCellVM(),
  selected: false,
  starRows: [],
  tps: null,
  timeToFirstTokenMs: null,
  ...overrides,
});

const buildTable = (cells: (GridCellVM | null)[] = [buildGridCellVM()]): GridTableVM => ({
  modelColumns: [{ modelId: 'model-a', label: 'gpt-4o' }],
  skillRows: [
    {
      skillKey: 'skill-1',
      label: 'Skill 1',
      cells,
    },
  ],
});

const buildEmptyTable = (): GridTableVM => ({
  modelColumns: [],
  skillRows: [],
});

// Quality-metric star rows (StarMetricId categories, scores 1-5)
const ALL_STAR_ROWS: readonly StarRow[] = [
  { category: 'fluency', score: 5 },
  { category: 'readability', score: 4 },
  { category: 'vocabulary', score: 3 },
];

const CRITERION_LABEL: Record<StarMetricId, string> = {
  fluency: 'Fluency',
  readability: 'Readability',
  vocabulary: 'Vocabulary',
};

const buildProps = (overrides?: Partial<ResultsGridViewProps>): ResultsGridViewProps => ({
  table: buildTable(),
  cornerLabel: 'Skill / Model',
  emptyLabel: 'No results yet',
  deleteCellAriaLabel: 'Delete cell',
  statusLabels: {
    idle: 'Idle',
    streaming: 'Streaming',
    done: 'Done',
    error: 'Error',
    aborted: 'Aborted',
  },
  resultAriaLabel: (label: string) => `${label} result`,
  selectAriaLabel: (label: string) => `Select ${label}`,
  ratingAriaLabel: (mean: number) => `Rating: ${mean} of 5`,
  criterionLabel: (category: StarMetricId) => CRITERION_LABEL[category],
  tpsLabel: 'TPS',
  ttsLabel: 'TTS',
  metricEmpty: '—',
  onCellClick: vi.fn(),
  onCellDelete: vi.fn(),
  onSelectToggle: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResultsGridView', () => {
  it('should render table headers: cornerLabel and model column labels', () => {
    // Given
    render(<ResultsGridView {...buildProps()} />);

    // Then: corner header and model column header
    expect(screen.getByText('Skill / Model')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
  });

  it('should render one cell card per non-null table cell using data-testid', () => {
    // Given: two cells in separate skill rows
    const table: GridTableVM = {
      modelColumns: [
        { modelId: 'model-a', label: 'gpt-4o' },
        { modelId: 'model-b', label: 'claude-3' },
      ],
      skillRows: [
        {
          skillKey: 'skill-1',
          label: 'Skill 1',
          cells: [
            buildGridCellVM({
              id: 'c1',
              cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o' }),
            }),
            buildGridCellVM({
              id: 'c2',
              cell: buildResultCellVM({ id: 'c2', modelLabel: 'claude-3' }),
            }),
          ],
        },
      ],
    };

    // When
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);

    // Then: one card per cell, identified by data-testid
    expect(container.querySelector('[data-testid="result-cell-c1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="result-cell-c2"]')).toBeInTheDocument();
  });

  it('should render emptyLabel when table has no columns or rows', () => {
    // Given: empty table
    render(
      <ResultsGridView
        {...buildProps({ table: buildEmptyTable(), emptyLabel: 'No results yet' })}
      />
    );

    // Then: empty label is shown
    expect(screen.getByText('No results yet')).toBeInTheDocument();
  });

  it('should render a muted placeholder for null cells', () => {
    // Given: table with a null cell (no result for that model×skill combo)
    const table: GridTableVM = {
      modelColumns: [{ modelId: 'model-a', label: 'gpt-4o' }],
      skillRows: [
        {
          skillKey: 'skill-1',
          label: 'Skill 1',
          cells: [null],
        },
      ],
    };

    // When
    render(<ResultsGridView {...buildProps({ table })} />);

    // Then: placeholder dash is rendered
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('should call onCellClick with cellId when a card is clicked', async () => {
    // Given
    const user = userEvent.setup();
    const onCellClick = vi.fn();
    const table = buildTable([
      buildGridCellVM({ id: 'c1', cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o' }) }),
    ]);

    render(<ResultsGridView {...buildProps({ table, onCellClick })} />);

    // When: user clicks the card button
    const card = screen.getByRole('button', { name: 'gpt-4o result' });
    await user.click(card);

    // Then
    expect(onCellClick).toHaveBeenCalledWith('c1');
  });

  it('should reflect cell.selected in checkbox checked state', () => {
    // Given: cell marked as selected
    const table = buildTable([
      buildGridCellVM({
        id: 'c1',
        selected: true,
        cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o' }),
      }),
    ]);

    // When
    render(<ResultsGridView {...buildProps({ table })} />);

    // Then: the checkbox inside the card is checked
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('should call onSelectToggle with cellId when checkbox is toggled', async () => {
    // Given
    const user = userEvent.setup();
    const onSelectToggle = vi.fn();
    const table = buildTable([
      buildGridCellVM({
        id: 'c1',
        selected: false,
        cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o' }),
      }),
    ]);

    render(<ResultsGridView {...buildProps({ table, onSelectToggle })} />);

    // When: user clicks the checkbox
    await user.click(screen.getByRole('checkbox'));

    // Then
    expect(onSelectToggle).toHaveBeenCalledWith('c1');
  });

  it('should call onCellDelete with cellId when the delete button is clicked', async () => {
    // Given
    const user = userEvent.setup();
    const onCellDelete = vi.fn();
    const table = buildTable([
      buildGridCellVM({ id: 'c1', cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o' }) }),
    ]);

    render(
      <ResultsGridView
        {...buildProps({ table, onCellDelete, deleteCellAriaLabel: 'Delete cell' })}
      />
    );

    // When: user clicks the delete button
    await user.click(screen.getByRole('button', { name: 'Delete cell' }));

    // Then
    expect(onCellDelete).toHaveBeenCalledWith('c1');
  });

  it('should render grid-card-ratings block with all 3 quality metric star rows and TPS/TTS footer', () => {
    // Given: cell with all three quality metric star rows and metric values
    const table = buildTable([
      buildGridCellVM({
        id: 'c1',
        cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o' }),
        starRows: ALL_STAR_ROWS,
        tps: 142,
        timeToFirstTokenMs: 178,
      }),
    ]);

    // When
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);

    // Then: ratings block present with all three quality metric labels
    const ratingsBlock = container.querySelector('[data-testid="grid-card-ratings"]');
    expect(ratingsBlock).toBeInTheDocument();
    expect(screen.getByText('Fluency')).toBeInTheDocument();
    expect(screen.getByText('Readability')).toBeInTheDocument();
    expect(screen.getByText('Vocabulary')).toBeInTheDocument();

    // Then: TPS and TTS footer values rendered
    const tpsEl = container.querySelector('[data-testid="grid-card-tps"]');
    const ttsEl = container.querySelector('[data-testid="grid-card-tts"]');
    expect(tpsEl).toBeInTheDocument();
    expect(ttsEl).toBeInTheDocument();
    expect(tpsEl?.textContent).toContain('142');
    expect(ttsEl?.textContent).toContain('178');
  });

  it('should render metricEmpty placeholder when TPS and TTS values are null', () => {
    // Given: cell with null tps and timeToFirstTokenMs
    const table = buildTable([
      buildGridCellVM({
        id: 'c1',
        cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o' }),
        starRows: ALL_STAR_ROWS,
        tps: null,
        timeToFirstTokenMs: null,
      }),
    ]);

    // When
    const { container } = render(<ResultsGridView {...buildProps({ table, metricEmpty: '—' })} />);

    // Then: both metric spans show the empty placeholder
    const tpsEl = container.querySelector('[data-testid="grid-card-tps"]');
    const ttsEl = container.querySelector('[data-testid="grid-card-tts"]');
    expect(tpsEl?.textContent).toContain('—');
    expect(ttsEl?.textContent).toContain('—');
  });

  it('should use criterionLabel prop to localise quality metric names', () => {
    // Given: custom label function returns uppercased names
    const customCriterionLabel = (cat: StarMetricId): string => cat.toUpperCase();
    const table = buildTable([
      buildGridCellVM({
        id: 'c1',
        cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o' }),
        starRows: [{ category: 'fluency', score: 5 }],
      }),
    ]);

    // When
    render(<ResultsGridView {...buildProps({ table, criterionLabel: customCriterionLabel })} />);

    // Then: custom label is shown instead of the raw metric name
    expect(screen.getByText('FLUENCY')).toBeInTheDocument();
  });

  it('should render empty star list when starRows is empty (cell with no output)', () => {
    // Given: cell with empty output — no starRows
    const table = buildTable([
      buildGridCellVM({
        id: 'c1',
        cell: buildResultCellVM({ id: 'c1', modelLabel: 'gpt-4o', meanRating: 0, output: '' }),
        starRows: [],
      }),
    ]);

    // When
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);

    // Then: ratings block present (TPS/TTS footer always shown) but no criterion li rows
    const ratingsBlock = container.querySelector('[data-testid="grid-card-ratings"]');
    expect(ratingsBlock).toBeInTheDocument();
    expect(ratingsBlock?.querySelectorAll('li')).toHaveLength(0);
  });
});
