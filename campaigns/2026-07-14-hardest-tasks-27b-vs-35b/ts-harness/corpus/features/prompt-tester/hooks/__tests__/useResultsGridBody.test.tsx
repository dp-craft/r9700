import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResultsGrid } from '../../components/ResultsGrid';
import { ResultsGridView } from '../../components/ResultsGridView';
import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import type { RunTab } from '../../types';

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

// -- Helpers --

const ACTIVE_RUN_ID = 1;

const buildRunTab = (overrides?: Partial<RunTab>): RunTab => ({
  id: ACTIVE_RUN_ID,
  label: 'Run 1',
  createdAt: 0,
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'both',
  sort: 'mean',
  group: 'model',
  gridCols: 3,
  viewMode: 'list',
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  usePromptTesterStore.setState({
    runs: [buildRunTab()],
    activeRunId: ACTIVE_RUN_ID,
  });
});

describe('useResultsGridBody', () => {
  it('should return body of type ResultsGrid when viewMode is list', async () => {
    // Given: active run in list mode
    usePromptTesterStore.setState({
      runs: [buildRunTab({ viewMode: 'list' })],
      activeRunId: ACTIVE_RUN_ID,
    });

    // When
    const { useResultsGridBody } = await import('../useResultsGridBody');
    const { result } = renderHook(() => useResultsGridBody());

    // Then: body element type is ResultsGrid
    expect(result.current.body.type).toBe(ResultsGrid);
  });

  it('should return body of type ResultsGridView when viewMode is grid', async () => {
    // Given: active run in grid mode
    usePromptTesterStore.setState({
      runs: [buildRunTab({ viewMode: 'grid' })],
      activeRunId: ACTIVE_RUN_ID,
    });

    // When
    const { useResultsGridBody } = await import('../useResultsGridBody');
    const { result } = renderHook(() => useResultsGridBody());

    // Then: body element type is ResultsGridView
    expect(result.current.body.type).toBe(ResultsGridView);
  });

  it('should wire grid onCellClick to toggleCellSelection', async () => {
    // Given: grid mode, one selected cell
    usePromptTesterStore.setState({
      runs: [buildRunTab({ viewMode: 'grid', selectedCellIds: [] })],
      activeRunId: ACTIVE_RUN_ID,
    });

    const { useResultsGridBody } = await import('../useResultsGridBody');
    const { result } = renderHook(() => useResultsGridBody());

    // When: retrieve the onCellClick prop from the grid body
    const props = result.current.body.props as {
      onCellClick: (id: string) => void;
      onSelectToggle: (id: string) => void;
    };

    // Then: both onCellClick and onSelectToggle are the same function (toggleCellSelection)
    expect(props.onCellClick).toBe(props.onSelectToggle);
  });

  it('should pass a GridTableVM table and onCellDelete to grid body', async () => {
    // Given: grid mode
    usePromptTesterStore.setState({
      runs: [buildRunTab({ viewMode: 'grid' })],
      activeRunId: ACTIVE_RUN_ID,
    });

    const { useResultsGridBody } = await import('../useResultsGridBody');
    const { result } = renderHook(() => useResultsGridBody());

    // When: inspect grid body props
    const props = result.current.body.props as {
      table: { modelColumns: readonly unknown[]; skillRows: readonly unknown[] };
      onCellDelete: (id: string) => void;
      cornerLabel: string;
    };

    // Then: table has GridTableVM shape and onCellDelete is wired
    expect(Array.isArray(props.table.modelColumns)).toBe(true);
    expect(Array.isArray(props.table.skillRows)).toBe(true);
    expect(typeof props.onCellDelete).toBe('function');
    expect(props.cornerLabel).toBe('lab.grid.cornerLabel');
    expect('cells' in (result.current.body.props as object)).toBe(false);
  });

  it('should not pass diffLabel to list body', async () => {
    // Given: list mode
    usePromptTesterStore.setState({
      runs: [buildRunTab({ viewMode: 'list' })],
      activeRunId: ACTIVE_RUN_ID,
    });

    const { useResultsGridBody } = await import('../useResultsGridBody');
    const { result } = renderHook(() => useResultsGridBody());

    // Then: diffLabel prop absent
    expect('diffLabel' in (result.current.body.props as object)).toBe(false);
  });

  it('should wire grid onSelectToggle so clicking adds cellId to selectedCellIds', async () => {
    // Given: grid mode with no selections
    usePromptTesterStore.setState({
      runs: [buildRunTab({ viewMode: 'grid', selectedCellIds: [] })],
      activeRunId: ACTIVE_RUN_ID,
    });

    const { useResultsGridBody } = await import('../useResultsGridBody');
    const { result } = renderHook(() => useResultsGridBody());

    const props = result.current.body.props as { onSelectToggle: (id: string) => void };

    // When: invoke the wired callback
    props.onSelectToggle('cell-abc');

    // Then: store selectedCellIds updated
    const activeRun = usePromptTesterStore.getState().runs.find(r => r.id === ACTIVE_RUN_ID);
    expect(activeRun?.selectedCellIds).toContain('cell-abc');
  });

  it('should wire list onSelectToggle to toggleCellSelection', async () => {
    // Given: list mode
    usePromptTesterStore.setState({
      runs: [buildRunTab({ viewMode: 'list', selectedCellIds: [] })],
      activeRunId: ACTIVE_RUN_ID,
    });

    const { useResultsGridBody } = await import('../useResultsGridBody');
    const { result } = renderHook(() => useResultsGridBody());

    const props = result.current.body.props as { onSelectToggle: (id: string) => void };

    // When: invoke the wired callback
    props.onSelectToggle('cell-xyz');

    // Then: store selectedCellIds updated
    const activeRun = usePromptTesterStore.getState().runs.find(r => r.id === ACTIVE_RUN_ID);
    expect(activeRun?.selectedCellIds).toContain('cell-xyz');
  });
});
