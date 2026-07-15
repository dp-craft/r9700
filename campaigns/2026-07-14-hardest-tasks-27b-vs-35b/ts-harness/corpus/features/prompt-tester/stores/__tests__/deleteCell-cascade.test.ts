// L3 integration test — deleteCell cascade:
//   - removes cell from active run's `cells`
//   - drops cell id from `selectedCellIds` (compare-selection cascade)
//   - preserves surviving cells and their selections
// Store-level only — no component rendering.

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  getLabSerialAcrossModels: vi.fn().mockResolvedValue(true),
  putLabSerialAcrossModels: vi.fn().mockResolvedValue(undefined),
  getLabSerialWithinModel: vi.fn().mockResolvedValue(false),
  putLabSerialWithinModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import type { CellResult, LabState, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildCellResult = (overrides?: Partial<CellResult>): CellResult => ({
  id: 'model-1::prompt-1',
  modelId: 'model-1',
  promptId: 'prompt-1',
  userPromptHash: 'abc123',
  output: 'Some output',
  latencyMs: 500,
  tokens: 100,
  cost: 0.001,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getStore = (): LabState => usePromptTesterStore.getState() as LabState;

const getActiveRun = (): RunTab | undefined => {
  const s = getStore();
  return (s.runs as readonly RunTab[]).find(r => r.id === s.activeRunId);
};

const getCellIds = (): readonly string[] => getActiveRun()?.cells.map(c => c.id) ?? [];

const getSelectedCellIds = (): readonly string[] => getActiveRun()?.selectedCellIds ?? [];

/** Seed cells AND mark the given ids as selected on the active run. */
const seedRunWithSelections = (
  cellIds: readonly string[],
  selectedIds: readonly string[]
): void => {
  usePromptTesterStore.setState((s: unknown) => {
    const state = s as LabState;
    return {
      runs: state.runs.map(r =>
        r.id === state.activeRunId
          ? {
              ...r,
              cells: cellIds.map(id =>
                buildCellResult({
                  id,
                  modelId: id.split('::')[0] ?? 'model',
                  promptId: id.split('::')[1] ?? 'prompt',
                })
              ),
              selectedCellIds: [...selectedIds],
            }
          : r
      ),
    } as Partial<LabState>;
  });
};

const deleteCell = async (cellId: string): Promise<void> => {
  const store = usePromptTesterStore.getState() as LabState & {
    deleteCell: (cellId: string) => Promise<void>;
  };
  await store.deleteCell(cellId);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deleteCell cascade — cells array + selectedCellIds', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should remove the deleted cell from the active run cells array', async () => {
    seedRunWithSelections(['a::1', 'b::2'], []);

    await deleteCell('a::1');

    expect(getCellIds()).not.toContain('a::1');
    expect(getCellIds()).toContain('b::2');
  });

  it('should drop the deleted cell id from selectedCellIds when it was selected', async () => {
    seedRunWithSelections(['a::1', 'b::2'], ['a::1', 'b::2']);

    await deleteCell('a::1');

    expect(getSelectedCellIds()).not.toContain('a::1');
  });

  it('should preserve the surviving cell selection after deleting a selected cell', async () => {
    seedRunWithSelections(['a::1', 'b::2'], ['a::1', 'b::2']);

    await deleteCell('a::1');

    expect(getSelectedCellIds()).toContain('b::2');
    expect(getSelectedCellIds()).toHaveLength(1);
  });

  it('should leave selectedCellIds unchanged when deleting an unselected cell', async () => {
    seedRunWithSelections(['a::1', 'b::2', 'c::3'], ['b::2', 'c::3']);

    await deleteCell('a::1');

    expect(getSelectedCellIds()).toHaveLength(2);
    expect(getSelectedCellIds()).toContain('b::2');
    expect(getSelectedCellIds()).toContain('c::3');
  });
});
