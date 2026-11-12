import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GridCellVM, GridTableVM, ResultCellVM, StarMetricId, StarRow } from '../../types';
import { ResultsGridView, type ResultsGridViewProps } from '../ResultsGridView';

// -- Builders --

const buildResultCellVM = (overrides?: Partial<ResultCellVM>): ResultCellVM => ({
  id: 'cell-1',
  title: 'M1/S1',
  modelLabel: 'gpt-4o',
  phrase: 'test prompt',
  status: 'done',
  output: 'output text',
  outputPreview: 'output text',
  error: null,
  latencyMs: 0,
  tokens: 0,
  ttfMs: null,
  tps: null,
  isOutdated: false,
  meanRating: 3,
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

const buildTable = (gridCell: GridCellVM): GridTableVM => ({
  modelColumns: [{ modelId: 'model-a', label: 'gpt-4o' }],
  skillRows: [{ skillKey: 'skill-1', label: 'Skill 1', cells: [gridCell] }],
});

const CRITERION_LABEL: Record<StarMetricId, string> = {
  fluency: 'Fluency',
  readability: 'Readability',
  vocabulary: 'Vocabulary',
};

// Quality star rows: 3 rows sorted descending by score
const ALL_STAR_ROWS: readonly StarRow[] = [
  { category: 'fluency', score: 5 },
  { category: 'readability', score: 4 },
  { category: 'vocabulary', score: 3 },
];

const buildProps = (overrides?: Partial<ResultsGridViewProps>): ResultsGridViewProps => ({
  table: buildTable(buildGridCellVM()),
  cornerLabel: 'Skill / Model',
  emptyLabel: 'No results',
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

describe('ResultsGridView — grid-card-ratings block', () => {
  it('should match snapshot for the ratings block with all quality metric star rows', () => {
    const table = buildTable(buildGridCellVM({ starRows: ALL_STAR_ROWS }));
    const { asFragment } = render(<ResultsGridView {...buildProps({ table })} />);
    expect(asFragment()).toMatchSnapshot();
  });

  it('should render data-testid="grid-card-ratings" when a grid cell has star rows', () => {
    // Arrange
    const table = buildTable(buildGridCellVM({ starRows: ALL_STAR_ROWS }));

    // Act
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);

    // Assert
    expect(container.querySelector('[data-testid="grid-card-ratings"]')).toBeInTheDocument();
  });

  it('should render all 3 quality metric labels within the ratings block', () => {
    // Arrange
    const table = buildTable(buildGridCellVM({ starRows: ALL_STAR_ROWS }));

    // Act
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);
    const ratingsBlock = container.querySelector(
      '[data-testid="grid-card-ratings"]'
    ) as HTMLElement;

    // Assert — all three quality metrics are present
    expect(ratingsBlock.textContent).toContain('Fluency');
    expect(ratingsBlock.textContent).toContain('Readability');
    expect(ratingsBlock.textContent).toContain('Vocabulary');
  });

  it('should render TPS value in data-testid="grid-card-tps" below the star rows', () => {
    // Arrange
    const table = buildTable(buildGridCellVM({ starRows: ALL_STAR_ROWS, tps: 142 }));

    // Act
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);

    // Assert
    const tpsEl = container.querySelector('[data-testid="grid-card-tps"]');
    expect(tpsEl).toBeInTheDocument();
    expect(tpsEl?.textContent).toContain('142');
    expect(tpsEl?.textContent).toContain('TPS');
  });

  it('should render TTS value in data-testid="grid-card-tts" below the star rows', () => {
    // Arrange
    const table = buildTable(buildGridCellVM({ starRows: ALL_STAR_ROWS, timeToFirstTokenMs: 178 }));

    // Act
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);

    // Assert
    const ttsEl = container.querySelector('[data-testid="grid-card-tts"]');
    expect(ttsEl).toBeInTheDocument();
    expect(ttsEl?.textContent).toContain('178');
    expect(ttsEl?.textContent).toContain('TTS');
  });

  it('should render metricEmpty placeholder for TPS and TTS when values are null', () => {
    // Arrange
    const table = buildTable(
      buildGridCellVM({ starRows: ALL_STAR_ROWS, tps: null, timeToFirstTokenMs: null })
    );

    // Act
    const { container } = render(<ResultsGridView {...buildProps({ table, metricEmpty: '—' })} />);

    // Assert
    const tpsEl = container.querySelector('[data-testid="grid-card-tps"]');
    const ttsEl = container.querySelector('[data-testid="grid-card-tts"]');
    expect(tpsEl?.textContent).toContain('—');
    expect(ttsEl?.textContent).toContain('—');
  });

  it('should render exactly 3 star rows when all quality metric star rows are provided', () => {
    // Arrange
    const table = buildTable(buildGridCellVM({ starRows: ALL_STAR_ROWS }));

    // Act
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);
    const ratingsBlock = container.querySelector(
      '[data-testid="grid-card-ratings"]'
    ) as HTMLElement;
    const listItems = ratingsBlock.querySelectorAll('li');

    // Assert — one li per quality metric
    expect(listItems).toHaveLength(3);
  });

  it('should render empty star list when unjudged cell has no star rows', () => {
    // Arrange: cell with empty output — starRows empty, meanRating 0
    const table = buildTable(
      buildGridCellVM({ starRows: [], cell: buildResultCellVM({ meanRating: 0, output: '' }) })
    );

    // Act
    const { container } = render(<ResultsGridView {...buildProps({ table })} />);

    // Assert: block is present (TPS/TTS footer always shown) but contains no criterion rows
    const ratingsBlock = container.querySelector('[data-testid="grid-card-ratings"]');
    expect(ratingsBlock).toBeInTheDocument();
    expect(ratingsBlock?.querySelectorAll('li')).toHaveLength(0);
  });
});
