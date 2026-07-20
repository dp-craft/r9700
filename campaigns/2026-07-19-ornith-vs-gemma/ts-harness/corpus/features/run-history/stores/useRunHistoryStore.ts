import { castDraft } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import {
  type ArchivedLabRun,
  buildRunExport,
  deleteArchivedRuns,
  getArchivedRuns,
  type RunExport
} from '@/db/archivedRuns';
import { useUIStore } from '@/stores/useUIStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunHistoryState {
  readonly runs: readonly ArchivedLabRun[];
  readonly selectedIds: readonly string[];
  readonly search: string;
  readonly detailId: string | null;
  readonly page: number;
  readonly hasMore: boolean;
  readonly loadError: string | null;
}

interface RunHistoryActions {
  readonly loadRuns: () => Promise<void>;
  readonly loadMore: () => Promise<void>;
  readonly deleteRuns: (ids: readonly string[]) => Promise<void>;
  readonly exportRuns: (ids: readonly string[]) => RunExport | readonly RunExport[];
  readonly openInLab: (id: string) => Promise<void>;
  readonly toggleSelect: (id: string) => void;
  readonly setSearch: (query: string) => void;
  readonly setDetailId: (id: string | null) => void;
  readonly clearSelection: () => void;
}

export type RunHistoryStore = RunHistoryState & RunHistoryActions;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useRunHistoryStore = create<RunHistoryStore>()(
  immer((set, get) => ({
    runs: [],
    selectedIds: [] as readonly string[],
    search: '',
    detailId: null,
    page: 1,
    hasMore: false,
    loadError: null,

    loadRuns: async () => {
      try {
        const results = (await getArchivedRuns({ limit: PAGE_SIZE })) ?? [];
        set(state => {
          state.runs = castDraft(results);
          state.page = 1;
          state.hasMore = results.length === PAGE_SIZE;
          state.loadError = null;
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        set(state => {
          state.runs = [];
          state.loadError = message;
        });
      }
    },

    loadMore: async () => {
      const { runs } = get();
      const last = runs[runs.length - 1];
      if (!last) return;

      const results = await getArchivedRuns({
        limit: PAGE_SIZE,
        beforeArchivedAt: last.archivedAt,
      });
      set(state => {
        state.runs = castDraft([...state.runs, ...results]);
        state.page = state.page + 1;
        state.hasMore = results.length === PAGE_SIZE;
      });
    },

    deleteRuns: async (ids: readonly string[]): Promise<void> => {
      await deleteArchivedRuns(ids);
      const idSet = new Set(ids);
      set(state => {
        state.runs = castDraft(
          (state.runs as readonly ArchivedLabRun[]).filter(r => !idSet.has(r.id))
        );
        state.selectedIds = [];
        if (state.detailId !== null && idSet.has(state.detailId)) {
          state.detailId = null;
        }
      });
    },

    exportRuns: (ids: readonly string[]): RunExport | readonly RunExport[] => {
      const { runs } = get();
      const idSet = new Set(ids);
      const matched = runs.filter(r => idSet.has(r.id));
      return buildRunExport(matched);
    },

    openInLab: async (id: string): Promise<void> => {
      useUIStore.getState().setPendingLabRunId(id);
      useUIStore.getState().requestWorkspacePanel('prompt-lab', 'tester');
    },

    toggleSelect: (id: string): void => {
      set(state => {
        const current = state.selectedIds as readonly string[];
        state.selectedIds = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
      });
    },

    setSearch: (query: string): void => {
      set(state => {
        state.search = query;
      });
    },

    setDetailId: (id: string | null): void => {
      set(state => {
        state.detailId = id;
      });
    },

    clearSelection: () => {
      set(state => {
        state.selectedIds = [];
      });
    },
  }))
);
