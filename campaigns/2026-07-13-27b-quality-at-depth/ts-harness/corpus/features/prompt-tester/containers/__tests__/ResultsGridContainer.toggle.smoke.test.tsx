// Boundary mocks — declared before imports (Vitest hoisting)
vi.mock('@/features/prompt-tester/components/ResultsGrid', () => ({
  ResultsGrid: vi.fn(() => null),
}));

// NOTE: CompareStrip / CompareStripContainer / buildCompareRows are NOT mocked —
// the real components must render so tests exercise the live composition path.

vi.mock('@/features/prompt-tester/components/ResultsGridView', () => ({
  ResultsGridView: vi.fn(() => <div data-testid="results-grid-view" />),
}));

vi.mock('@/features/prompt-tester/utils/buildGridRows', () => ({
  buildGridCells: vi.fn((cells: { id: string }[], selectedCellIds: string[]) =>
    cells.map((cell: { id: string }) => ({
      id: cell.id,
      cell,
      selected: selectedCellIds.includes(cell.id),
    }))
  ),
  buildGridTable: vi.fn(
    (
      cells: { id: string }[],
      _models: unknown[],
      _prompts: unknown[],
      selectedCellIds: string[]
    ) => ({
      modelColumns: [],
      skillRows: cells.map((cell: { id: string }) => ({
        skillKey: cell.id,
        label: cell.id,
        cells: [{ id: cell.id, cell, selected: selectedCellIds.includes(cell.id) }],
      })),
    })
  ),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePromptTesterStore } from '@/features/prompt-tester/stores/usePromptTesterStore';
import type { CellRatings, CellResult, RunTab } from '@/features/prompt-tester/types';

import { ResultsGridContainer } from '../ResultsGridContainer';

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
  usePromptTesterStore.setState(
    // Partial seed for test setup — store accepts partial via setState's merge behaviour
    {
      runs: [tab],
      activeRunId: INITIAL_RUN_ID,
      models: [],
      prompts: [],
      userPrompt: '',
      activeDetailCellId: null,
    } as unknown as Parameters<typeof usePromptTesterStore.setState>[0]
  );
};

describe('ResultsGridContainer — grid-body and compare-strip L3 smoke', () => {
  beforeEach(() => {
    seedStore();
  });

  it('should render ResultsGridView when store viewMode is "grid"', () => {
    // Arrange — seed store with grid mode active
    seedStore(buildTab({ viewMode: 'grid' }));

    // Act
    render(<ResultsGridContainer />);

    // Assert — ResultsGridView is mounted
    expect(screen.getByTestId('results-grid-view')).toBeDefined();
  });

  it('should render the compare strip even when fewer than 2 cells are selected', () => {
    // Arrange — one cell present, nothing selected
    const ZERO_RATINGS: CellRatings = {
      accuracy: 0,
      style: 0,
      tone: 0,
      length: 0,
      readability: 0,
    };
    const buildCell = (id: string): CellResult => ({
      id,
      modelId: 'model-a',
      promptId: 'prompt-1',
      userPromptHash: 'hash-1',
      output: 'output text',
      latencyMs: 100,
      tokens: 10,
      cost: 0.001,
      ratings: ZERO_RATINGS,
      cached: false,
      status: 'done',
    });

    seedStore(buildTab({ cells: [buildCell('c1')], selectedCellIds: [] }));

    // Act
    render(<ResultsGridContainer />);

    // Assert — compare strip mounts unconditionally (null guard removed)
    expect(screen.getByTestId('lab-compare-strip')).toBeDefined();
  });

  it('should render the compare strip when 2 cells are selected (live render path)', () => {
    // Arrange — two cells, both selected
    const ZERO_RATINGS: CellRatings = {
      accuracy: 0,
      style: 0,
      tone: 0,
      length: 0,
      readability: 0,
    };
    const buildCell = (id: string): CellResult => ({
      id,
      modelId: 'model-a',
      promptId: 'prompt-1',
      userPromptHash: 'hash-1',
      output: 'output text',
      latencyMs: 100,
      tokens: 10,
      cost: 0.001,
      ratings: ZERO_RATINGS,
      cached: false,
      status: 'done',
    });

    seedStore(
      buildTab({
        cells: [buildCell('c1'), buildCell('c2')],
        selectedCellIds: ['c1', 'c2'],
      })
    );

    // Act
    render(<ResultsGridContainer />);

    // Assert — CompareStripContainer must mount CompareStrip (RED: orphan not yet wired)
    expect(screen.getByTestId('lab-compare-strip')).toBeDefined();
  });
});
