// Boundary mocks — declared before imports (Vitest hoisting)
// usePromptTesterStore is the REAL store; seeded via setState in beforeEach (ADR-018 L3 real-store rule).

vi.mock('@/features/prompt-tester/components/ResultsGrid', () => ({
  ResultsGrid: vi.fn(() => null),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('../CompareStripContainer', () => ({
  CompareStripContainer: vi.fn(() => <div data-testid="compare-strip-container-stub" />),
}));

vi.mock('../../hooks/useCompareSplit', () => ({
  useCompareSplit: vi.fn(() => ({
    ratio: 0.5,
    onResizeStart: vi.fn(),
  })),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn(),
  putLabSectionCollapse: vi.fn(),
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
  getLabRunParallel: vi.fn(),
  putLabRunParallel: vi.fn(),
  getLabParallelismMode: vi.fn(),
  putLabParallelismMode: vi.fn(),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: vi.fn(),
  putLabRun: vi.fn(),
  deleteLabRun: vi.fn(),
  getLabRunById: vi.fn(),
}));

vi.mock('@/db/archivedRuns', () => ({
  getArchivedRuns: vi.fn(),
  archiveRun: vi.fn(),
  deleteArchivedRuns: vi.fn(),
  buildRunExport: vi.fn(),
  archiveCompletedRun: vi.fn(),
  getArchivedRunById: vi.fn(),
}));

vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn(),
  getAllPrompts: vi.fn(),
}));

import { render } from '@testing-library/react';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResultCellVM } from '@/features/prompt-tester/components/ResultsGrid';
import { ResultsGrid } from '@/features/prompt-tester/components/ResultsGrid';
import { usePromptTesterStore } from '@/features/prompt-tester/stores/usePromptTesterStore';
import type { CellResult, CellStatus } from '@/features/prompt-tester/types';

import { ResultsGridContainer } from '../ResultsGridContainer';

const EMPTY_CONFIG_SNAPSHOT = { models: [], prompts: [], userPrompt: '' };

const buildCell = (overrides: Partial<CellResult> & { status: CellStatus }): CellResult => ({
  id: 'cell-1',
  modelId: 'model-a',
  promptId: 'prompt-1',
  userPromptHash: 'hash-1',
  output: 'sample output',
  latencyMs: 1200,
  tokens: 42,
  cost: 0.001,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  ...overrides,
});

const seedStore = (
  cells: readonly CellResult[],
  activeDetailCellId: string | null = null
): void => {
  usePromptTesterStore.setState({
    runs: [
      {
        id: 1,
        label: 'Run 1',
        createdAt: 0,
        cells: cells as CellResult[],
        configSnapshot: EMPTY_CONFIG_SNAPSHOT,
        selectedCellIds: [],
        compareMode: 'both' as const,
        sort: 'mean' as const,
        group: 'model' as const,
        gridCols: 3 as const,
        viewMode: 'list' as const,
      },
    ],
    activeRunId: 1,
    models: [],
    prompts: [],
    userPrompt: '',
    activeDetailCellId,
  });
};

const lastCall = (): Record<string, unknown> => {
  const calls = (vi.mocked(ResultsGrid) as Mock).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
};

const capturedCells = (): readonly ResultCellVM[] => (lastCall().cells as ResultCellVM[]) ?? [];

const capturedActiveCellId = (): string | null =>
  (lastCall().activeCellId as string | null) ?? null;

const capturedOnCellClick = (): ((cellId: string) => void) =>
  lastCall().onCellClick as (cellId: string) => void;

const capturedOnCellDelete = (): ((cellId: string) => void) =>
  lastCall().onCellDelete as (cellId: string) => void;

describe('ResultsGridContainer — L3 smoke', () => {
  beforeEach(() => {
    vi.mocked(ResultsGrid).mockClear();
    seedStore([]);
  });

  it('should map active tab cells to ResultCellVM[] and pass to ResultsGrid', () => {
    seedStore([
      buildCell({ id: 'c1', status: 'done', output: 'hello', latencyMs: 800, tokens: 10 }),
      buildCell({ id: 'c2', status: 'streaming', output: '', latencyMs: 0, tokens: 0 }),
    ]);

    render(<ResultsGridContainer />);

    const cells = capturedCells();
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ id: 'c1', status: 'done', latencyMs: 800, tokens: 10 });
    expect(cells[1]).toMatchObject({ id: 'c2', status: 'streaming' });
  });

  it('should map every live CellStatus value to a ResultCellVM.status without dropping any', () => {
    const allStatuses: readonly CellStatus[] = ['idle', 'streaming', 'done', 'error', 'aborted'];
    const cells = allStatuses.map((status, idx) => buildCell({ id: `c${idx}`, status }));
    seedStore(cells);

    render(<ResultsGridContainer />);

    const vmStatuses = capturedCells().map(c => c.status);
    expect(vmStatuses).toEqual(allStatuses);
  });

  it('should reflect store activeDetailCellId as activeCellId prop on ResultsGrid', () => {
    seedStore([buildCell({ id: 'c1', status: 'done' })], 'c1');

    render(<ResultsGridContainer />);

    expect(capturedActiveCellId()).toBe('c1');
  });

  it('should dispatch openDetailFor when onCellClick is called', () => {
    seedStore([buildCell({ id: 'c1', status: 'done' })]);

    render(<ResultsGridContainer />);

    capturedOnCellClick()('c1');
    expect(usePromptTesterStore.getState().activeDetailCellId).toBe('c1');
  });

  it('should surface ttfMs and tps on ResultCellVM when set on CellResult', () => {
    // Given a cell with ttfMs and tps values
    seedStore([buildCell({ id: 'c1', status: 'done', ttfMs: 350, tps: 42.5 })]);

    // When the container renders
    render(<ResultsGridContainer />);

    // Then the VM exposes those values
    const vm = capturedCells()[0];
    expect(vm.ttfMs).toBe(350);
    expect(vm.tps).toBe(42.5);
  });

  it('should surface null ttfMs and tps on ResultCellVM when omitted from CellResult', () => {
    // Given a cell without ttfMs / tps
    seedStore([buildCell({ id: 'c1', status: 'done' })]);

    // When the container renders
    render(<ResultsGridContainer />);

    // Then the VM nullifies both fields
    const vm = capturedCells()[0];
    expect(vm.ttfMs).toBeNull();
    expect(vm.tps).toBeNull();
  });

  it('should carry an isOutdated boolean on each ResultCellVM', () => {
    // Given any cell
    seedStore([buildCell({ id: 'c1', status: 'done' })]);

    // When the container renders
    render(<ResultsGridContainer />);

    // Then isOutdated is a boolean (value depends on isCellOutdated logic, not tested here)
    const vm = capturedCells()[0];
    expect(typeof vm.isOutdated).toBe('boolean');
  });

  it('should dispatch deleteCell with the cellId when onCellDelete is called', () => {
    // Given a rendered container with a cell
    seedStore([buildCell({ id: 'c1', status: 'done' })]);

    render(<ResultsGridContainer />);

    // When onCellDelete is invoked with a cell id
    capturedOnCellDelete()('c1');

    // Then the cell is removed from the store
    const state = usePromptTesterStore.getState();
    const activeRun = state.runs.find(r => r.id === state.activeRunId);
    expect(activeRun?.cells.find(c => c.id === 'c1')).toBeUndefined();
  });
});

describe('ResultsGridContainer — vertical resizable split (NEW:compare-strip-sizing, NEW:app-container-fit)', () => {
  beforeEach(() => {
    vi.mocked(ResultsGrid).mockClear();
    seedStore([buildCell({ id: 'c1', status: 'done' })]);
  });

  it('should render a drag handle with data-testid="strip-resize-handle"', () => {
    // Given the container renders with the resizable split
    const { getByTestId } = render(<ResultsGridContainer />);

    // Then the resize handle is present
    expect(getByTestId('strip-resize-handle')).toBeInTheDocument();
  });

  it('should render CompareStripContainer unconditionally regardless of selected cells', () => {
    // Given a store with no selected cells
    seedStore([]);

    const { getByTestId } = render(<ResultsGridContainer />);

    // Then the compare strip is always mounted
    expect(getByTestId('compare-strip-container-stub')).toBeInTheDocument();
  });

  it('should render results body region and CompareStrip region as siblings under a flex-column root', () => {
    // Given the container renders
    const { getByTestId } = render(<ResultsGridContainer />);

    // Then both the body region and the compare strip are present
    const bodyRegion = getByTestId('results-body-region');
    const compareStrip = getByTestId('compare-strip-container-stub');

    // And the resize handle sits between them under the same parent
    const resizeHandle = getByTestId('strip-resize-handle');

    expect(bodyRegion).toBeInTheDocument();
    expect(compareStrip).toBeInTheDocument();
    expect(resizeHandle).toBeInTheDocument();

    // Body region and resize handle share the same flex-column root parent
    expect(bodyRegion.parentElement).toBe(resizeHandle.parentElement);

    // Resize handle's immediately-following sibling is the bottom wrapper region
    const bottomRegion = resizeHandle.nextElementSibling as HTMLElement;
    expect(bottomRegion).not.toBeNull();

    // Bottom region contains CompareStrip (not a direct sibling of the handle)
    expect(bottomRegion).toContainElement(compareStrip);

    // Bottom region is also a flex child of the same root (handle and bottom share parent)
    expect(bodyRegion.parentElement).toBe(bottomRegion.parentElement);

    // Bottom region carries the complementary flex basis (sum ≈ 100%), locking in split layout
    const bodyBasis = parseFloat(bodyRegion.style.flexBasis);
    const bottomBasis = parseFloat(bottomRegion.style.flexBasis);
    expect(bodyBasis + bottomBasis).toBeCloseTo(100, 1);
  });
});
