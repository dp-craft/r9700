import { castDraft } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { PromptHistoryEntry, PromptSource, PromptType } from '@/db/idb';

export type { PromptHistoryEntry, PromptSource, PromptType };

import { deletePrompts, getAllPrompts } from '@/db/prompts';
import { useUIStore } from '@/stores/useUIStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptSortKey = 'last-used' | 'first-used' | 'use-count' | 'length';

interface PromptHistoryState {
  readonly entries: readonly PromptHistoryEntry[];
  readonly selectedIds: readonly string[];
  readonly search: string;
  readonly typeFilter: PromptType | 'ALL';
  readonly sourceFilter: PromptSource | 'ALL';
  readonly sort: PromptSortKey;
  readonly detailId: string | null;
  readonly loadError: string | null;
}

interface PromptHistoryActions {
  readonly loadEntries: () => Promise<void>;
  readonly deleteEntries: (ids: readonly string[]) => Promise<void>;
  readonly exportEntries: (ids: readonly string[]) => readonly PromptHistoryEntry[];
  readonly filteredEntries: () => readonly PromptHistoryEntry[];
  readonly toggleSelect: (id: string) => void;
  readonly setSearch: (query: string) => void;
  readonly setTypeFilter: (type: PromptType | 'ALL') => void;
  readonly setSourceFilter: (source: PromptSource | 'ALL') => void;
  readonly setSort: (sort: PromptSortKey) => void;
  readonly setDetailId: (id: string | null) => void;
  readonly clearSelection: () => void;
  readonly openInNewChat: (text: string) => void;
}

export type PromptHistoryStore = PromptHistoryState & PromptHistoryActions;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePromptHistoryStore = create<PromptHistoryStore>()(
  immer((set, get) => ({
    entries: [],
    selectedIds: [] as readonly string[],
    search: '',
    typeFilter: 'ALL' as PromptType | 'ALL',
    sourceFilter: 'ALL' as PromptSource | 'ALL',
    sort: 'last-used' as PromptSortKey,
    detailId: null,
    loadError: null,

    loadEntries: async (): Promise<void> => {
      try {
        const results = await getAllPrompts();
        set(state => {
          state.entries = castDraft(results);
          state.loadError = null;
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        set(state => {
          state.entries = [];
          state.loadError = message;
        });
      }
    },

    deleteEntries: async (ids: readonly string[]): Promise<void> => {
      await deletePrompts(ids);
      const idSet = new Set(ids);
      set(state => {
        state.entries = castDraft(
          (state.entries as readonly PromptHistoryEntry[]).filter(e => !idSet.has(e.id))
        );
        state.selectedIds = [];
        if (state.detailId !== null && idSet.has(state.detailId)) {
          state.detailId = null;
        }
      });
    },

    exportEntries: (ids: readonly string[]): readonly PromptHistoryEntry[] => {
      const { entries } = get();
      const idSet = new Set(ids);
      return entries.filter(e => idSet.has(e.id));
    },

    filteredEntries: (): readonly PromptHistoryEntry[] => {
      const { entries, search, typeFilter, sourceFilter, sort } = get();
      const lowerSearch = search.toLowerCase();
      const filtered = (entries as readonly PromptHistoryEntry[]).filter(e => {
        const matchesSearch = lowerSearch === '' || e.text.toLowerCase().includes(lowerSearch);
        const matchesType = typeFilter === 'ALL' || e.type === typeFilter;
        const matchesSource = sourceFilter === 'ALL' || e.firstSource === sourceFilter;
        return matchesSearch && matchesType && matchesSource;
      });
      return [...filtered].sort((a, b) => {
        if (sort === 'first-used') return a.firstUsedAt - b.firstUsedAt;
        if (sort === 'use-count') return b.useCount - a.useCount;
        if (sort === 'length') return b.text.length - a.text.length;
        return b.lastUsedAt - a.lastUsedAt;
      });
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

    setTypeFilter: (type: PromptType | 'ALL'): void => {
      set(state => {
        state.typeFilter = type;
      });
    },

    setSourceFilter: (source: PromptSource | 'ALL'): void => {
      set(state => {
        state.sourceFilter = source;
      });
    },

    setSort: (sort: PromptSortKey): void => {
      set(state => {
        state.sort = sort;
      });
    },

    setDetailId: (id: string | null): void => {
      set(state => {
        state.detailId = id;
      });
    },

    clearSelection: (): void => {
      set(state => {
        state.selectedIds = [];
      });
    },

    openInNewChat: (text: string): void => {
      const ui = useUIStore.getState();
      ui.setChatInputPrefill(text);
      ui.requestWorkspacePanel('chat', 'conversations');
    },
  }))
);
