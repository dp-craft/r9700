// TDD Red phase — store does not exist yet; all tests MUST fail.

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

vi.mock('@/db/archivedRuns', () => ({
  getArchivedRuns: vi.fn(),
  deleteArchivedRuns: vi.fn(),
  buildRunExport: vi.fn(),
  getArchivedRunById: vi.fn(),
}));

vi.mock('@/stores/useUIStore', () => ({
  useUIStore: {
    getState: vi.fn(() => ({ openDialog: vi.fn() })),
  },
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ArchivedLabRun,
  buildRunExport,
  deleteArchivedRuns,
  getArchivedRuns
} from '@/db/archivedRuns';
import type { LabRunRow } from '@/db/labRuns';

import { useRunHistoryStore } from '../useRunHistoryStore';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

const buildLabRunRow = (overrides?: Partial<LabRunRow>): LabRunRow => ({
  id: 'run-1',
  label: 'Test Run 1',
  createdAt: new Date('2024-01-01').getTime(),
  updatedAt: new Date('2024-01-01').getTime(),
  configSnapshot: { models: [], prompts: [], userPrompt: 'test prompt' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'table',
  sort: 'mean',
  group: 'none',
  gridCols: 2,
  ...overrides,
});

const buildArchivedRun = (overrides?: Partial<ArchivedLabRun>): ArchivedLabRun => ({
  ...buildLabRunRow(),
  archivedAt: new Date('2024-01-01').getTime(),
  archivedReason: 'tab-close',
  ...overrides,
});

const buildArchivedRuns = (
  count: number,
  baseOverrides?: Partial<ArchivedLabRun>
): readonly ArchivedLabRun[] =>
  Array.from({ length: count }, (_, i) =>
    buildArchivedRun({ id: `run-${i + 1}`, label: `Run ${i + 1}`, ...baseOverrides })
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetStore = () => {
  useRunHistoryStore.setState({
    runs: [],
    selectedIds: [],
    search: '',
    detailId: null,
    page: 0,
    hasMore: false,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRunHistoryStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // loadRuns
  // -------------------------------------------------------------------------

  describe('loadRuns', () => {
    it('should populate runs from getArchivedRuns on first load', async () => {
      const mockRuns = buildArchivedRuns(3);
      vi.mocked(getArchivedRuns).mockResolvedValue([...mockRuns]);

      await act(async () => {
        await useRunHistoryStore.getState().loadRuns();
      });

      expect(useRunHistoryStore.getState().runs).toHaveLength(3);
      expect(useRunHistoryStore.getState().runs[0].id).toBe('run-1');
    });

    it('should set hasMore=true when results equal page size (20)', async () => {
      const mockRuns = buildArchivedRuns(PAGE_SIZE);
      vi.mocked(getArchivedRuns).mockResolvedValue([...mockRuns]);

      await act(async () => {
        await useRunHistoryStore.getState().loadRuns();
      });

      expect(useRunHistoryStore.getState().hasMore).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // toggleSelect
  // -------------------------------------------------------------------------

  describe('toggleSelect', () => {
    it('should add id to selectedIds when not present', () => {
      act(() => {
        useRunHistoryStore.getState().toggleSelect('run-1');
      });

      expect(useRunHistoryStore.getState().selectedIds.includes('run-1')).toBe(true);
    });

    it('should remove id from selectedIds when already present', () => {
      useRunHistoryStore.setState({ selectedIds: ['run-1'] });

      act(() => {
        useRunHistoryStore.getState().toggleSelect('run-1');
      });

      expect(useRunHistoryStore.getState().selectedIds.includes('run-1')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // setSearch
  // -------------------------------------------------------------------------

  describe('setSearch', () => {
    it('should update search string', () => {
      act(() => {
        useRunHistoryStore.getState().setSearch('hello world');
      });

      expect(useRunHistoryStore.getState().search).toBe('hello world');
    });
  });

  // -------------------------------------------------------------------------
  // setDetailId
  // -------------------------------------------------------------------------

  describe('setDetailId', () => {
    it('should set the detail pane target id', () => {
      act(() => {
        useRunHistoryStore.getState().setDetailId('run-42');
      });

      expect(useRunHistoryStore.getState().detailId).toBe('run-42');
    });
  });

  // -------------------------------------------------------------------------
  // deleteRuns
  // -------------------------------------------------------------------------

  describe('deleteRuns', () => {
    it('should call deleteArchivedRuns and remove ids from runs', async () => {
      const runs = buildArchivedRuns(3);
      useRunHistoryStore.setState({ runs: [...runs] });
      vi.mocked(deleteArchivedRuns).mockResolvedValue(undefined);

      await act(async () => {
        await useRunHistoryStore.getState().deleteRuns(['run-1', 'run-2']);
      });

      expect(deleteArchivedRuns).toHaveBeenCalledWith(['run-1', 'run-2']);
      expect(useRunHistoryStore.getState().runs.map(r => r.id)).toEqual(['run-3']);
    });

    it('should clear selectedIds after bulk delete', async () => {
      const runs = buildArchivedRuns(2);
      useRunHistoryStore.setState({
        runs: [...runs],
        selectedIds: ['run-1', 'run-2'],
      });
      vi.mocked(deleteArchivedRuns).mockResolvedValue(undefined);

      await act(async () => {
        await useRunHistoryStore.getState().deleteRuns(['run-1', 'run-2']);
      });

      expect(useRunHistoryStore.getState().selectedIds.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // exportRuns
  // -------------------------------------------------------------------------

  describe('exportRuns', () => {
    it('should call buildRunExport with matching runs', () => {
      const runs = buildArchivedRuns(2);
      useRunHistoryStore.setState({ runs: [...runs] });
      vi.mocked(buildRunExport).mockReturnValue({
        schema: 'aichatney.archived-run.v1',
        run: runs[0],
      } as ReturnType<typeof buildRunExport>);

      act(() => {
        useRunHistoryStore.getState().exportRuns(['run-1']);
      });

      expect(buildRunExport).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'run-1' })])
      );
    });
  });

  // -------------------------------------------------------------------------
  // loadMore
  // -------------------------------------------------------------------------

  describe('loadMore', () => {
    it('should append next page of runs and increment page', async () => {
      const firstPage = buildArchivedRuns(PAGE_SIZE);
      const secondPage = buildArchivedRuns(5, { id: 'run-page2' }).map((r, i) => ({
        ...r,
        id: `page2-run-${i + 1}`,
      }));

      useRunHistoryStore.setState({ runs: [...firstPage], page: 1, hasMore: true });
      vi.mocked(getArchivedRuns).mockResolvedValue(secondPage);

      await act(async () => {
        await useRunHistoryStore.getState().loadMore();
      });

      expect(useRunHistoryStore.getState().runs).toHaveLength(PAGE_SIZE + 5);
      expect(useRunHistoryStore.getState().page).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // clearSelection
  // -------------------------------------------------------------------------

  describe('clearSelection', () => {
    it('should empty selectedIds', () => {
      useRunHistoryStore.setState({ selectedIds: ['run-1', 'run-2', 'run-3'] });

      act(() => {
        useRunHistoryStore.getState().clearSelection();
      });

      expect(useRunHistoryStore.getState().selectedIds.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // loadError (US4 E1)
  // -------------------------------------------------------------------------

  describe('loadError', () => {
    it('should be null in initial state before any load', () => {
      expect((useRunHistoryStore.getState() as any).loadError).toBeNull();
    });

    it('should populate runs and clear loadError when loadRuns succeeds', async () => {
      const mockRuns = buildArchivedRuns(2);
      vi.mocked(getArchivedRuns).mockResolvedValue([...mockRuns]);

      await act(async () => {
        await useRunHistoryStore.getState().loadRuns();
      });

      expect(useRunHistoryStore.getState().runs).toHaveLength(2);

      expect((useRunHistoryStore.getState() as any).loadError).toBeNull();
    });

    it('should set loadError and leave runs empty when getArchivedRuns throws', async () => {
      vi.mocked(getArchivedRuns).mockRejectedValue(new Error('IDB read failure'));

      await act(async () => {
        await useRunHistoryStore.getState().loadRuns();
      });

      expect(useRunHistoryStore.getState().runs).toHaveLength(0);

      expect((useRunHistoryStore.getState() as any).loadError).not.toBeNull();
    });
  });
});
