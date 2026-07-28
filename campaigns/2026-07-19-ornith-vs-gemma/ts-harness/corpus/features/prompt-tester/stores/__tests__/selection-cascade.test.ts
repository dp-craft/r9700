// L3 integration test — selection cascade: toggleCellSelection → selectedCellIds
// → CompareStripContainer visibility contract (hidden < 2, visible ≥ 2)
// Store-level only — no component rendering.

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

import { act } from '@testing-library/react';
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
// Constants — mirror CompareStripContainer visibility contract
// ---------------------------------------------------------------------------

const MIN_SELECTED = 2;

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

const getSelectedCellIds = (): readonly string[] => getActiveRun()?.selectedCellIds ?? [];

const isCompareStripVisible = (): boolean => getSelectedCellIds().length >= MIN_SELECTED;

const seedCells = (ids: readonly string[]): void => {
  usePromptTesterStore.setState((s: unknown) => {
    const state = s as LabState;
    return {
      runs: state.runs.map(r =>
        r.id === state.activeRunId
          ? {
              ...r,
              cells: ids.map(id =>
                buildCellResult({
                  id,
                  modelId: id.split('::')[0] ?? 'model',
                  promptId: id.split('::')[1] ?? 'prompt',
                })
              ),
              selectedCellIds: [],
            }
          : r
      ),
    } as Partial<LabState>;
  });
};

const toggleCell = (cellId: string): boolean => {
  const store = usePromptTesterStore.getState() as LabState & {
    toggleCellSelection: (cellId: string) => boolean;
  };
  let result!: boolean;
  act(() => {
    result = store.toggleCellSelection(cellId);
  });
  return result;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selection cascade — toggleCellSelection → CompareStrip visibility', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  describe('progressive selection 0→1→2→3', () => {
    it('should start with 0 selections and CompareStrip hidden', () => {
      seedCells(['a::1', 'b::2', 'c::3']);

      expect(getSelectedCellIds()).toHaveLength(0);
      expect(isCompareStripVisible()).toBe(false);
    });

    it('should have 1 selection and CompareStrip hidden after selecting 1 cell', () => {
      seedCells(['a::1', 'b::2', 'c::3']);

      expect(toggleCell('a::1')).toBe(true);

      expect(getSelectedCellIds()).toHaveLength(1);
      expect(getSelectedCellIds()).toContain('a::1');
      expect(isCompareStripVisible()).toBe(false);
    });

    it('should have 2 selections and CompareStrip visible after selecting 2 cells', () => {
      seedCells(['a::1', 'b::2', 'c::3']);

      toggleCell('a::1');
      expect(toggleCell('b::2')).toBe(true);

      expect(getSelectedCellIds()).toHaveLength(2);
      expect(isCompareStripVisible()).toBe(true);
    });

    it('should have 3 selections and CompareStrip visible after selecting 3 cells', () => {
      seedCells(['a::1', 'b::2', 'c::3']);

      toggleCell('a::1');
      toggleCell('b::2');
      expect(toggleCell('c::3')).toBe(true);

      expect(getSelectedCellIds()).toHaveLength(3);
      expect(isCompareStripVisible()).toBe(true);
    });
  });

  describe('unbounded selection', () => {
    it('should add a 4th cell when selected — returns true and length reaches 4', () => {
      seedCells(['a::1', 'b::2', 'c::3', 'd::4']);

      toggleCell('a::1');
      toggleCell('b::2');
      toggleCell('c::3');

      expect(toggleCell('d::4')).toBe(true);
      expect(getSelectedCellIds()).toHaveLength(4);
      expect(getSelectedCellIds()).toContain('d::4');
      expect(isCompareStripVisible()).toBe(true);
    });

    it('should add a 5th cell when selected — returns true and length reaches 5', () => {
      seedCells(['a::1', 'b::2', 'c::3', 'd::4', 'e::5']);

      toggleCell('a::1');
      toggleCell('b::2');
      toggleCell('c::3');
      toggleCell('d::4');

      expect(toggleCell('e::5')).toBe(true);
      expect(getSelectedCellIds()).toHaveLength(5);
      expect(getSelectedCellIds()).toContain('e::5');
    });

    it('should deselect an already-selected cell when toggled again — returns true, removes id', () => {
      seedCells(['a::1', 'b::2', 'c::3', 'd::4']);

      toggleCell('a::1');
      toggleCell('b::2');
      toggleCell('c::3');
      toggleCell('d::4');

      expect(toggleCell('c::3')).toBe(true);
      expect(getSelectedCellIds()).toHaveLength(3);
      expect(getSelectedCellIds()).not.toContain('c::3');
    });
  });

  describe('deselection cascade', () => {
    it('should hide CompareStrip when deselecting from 2 to 1', () => {
      seedCells(['a::1', 'b::2']);

      toggleCell('a::1');
      toggleCell('b::2');
      expect(isCompareStripVisible()).toBe(true);

      expect(toggleCell('a::1')).toBe(true);

      expect(getSelectedCellIds()).toHaveLength(1);
      expect(getSelectedCellIds()).not.toContain('a::1');
      expect(isCompareStripVisible()).toBe(false);
    });

    it('should keep CompareStrip visible when deselecting from 3 to 2', () => {
      seedCells(['a::1', 'b::2', 'c::3']);

      toggleCell('a::1');
      toggleCell('b::2');
      toggleCell('c::3');

      expect(toggleCell('b::2')).toBe(true);

      expect(getSelectedCellIds()).toHaveLength(2);
      expect(isCompareStripVisible()).toBe(true);
    });

    it('should hide CompareStrip when deselecting all cells from 2', () => {
      seedCells(['a::1', 'b::2']);

      toggleCell('a::1');
      toggleCell('b::2');

      toggleCell('a::1');
      toggleCell('b::2');

      expect(getSelectedCellIds()).toHaveLength(0);
      expect(isCompareStripVisible()).toBe(false);
    });
  });
});
