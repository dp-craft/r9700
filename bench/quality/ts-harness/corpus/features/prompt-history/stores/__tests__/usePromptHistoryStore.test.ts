// TDD Red phase — store does not exist yet; all tests MUST fail.

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

vi.mock('@/db/prompts', () => ({
  getAllPrompts: vi.fn(),
  deletePrompts: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptHistoryEntry } from '@/db/idb';
import { deletePrompts, getAllPrompts } from '@/db/prompts';

import { usePromptHistoryStore } from '../usePromptHistoryStore';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildEntry = (overrides?: Partial<PromptHistoryEntry>): PromptHistoryEntry => ({
  id: 'p1',
  text: 'Test prompt',
  type: 'USER',
  firstSource: 'CHAT',
  useCount: 1,
  firstUsedAt: 1000,
  lastUsedAt: 2000,
  references: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetStore = () => {
  usePromptHistoryStore.setState({
    entries: [],
    selectedIds: [],
    search: '',
    typeFilter: 'ALL',
    sourceFilter: 'ALL',
    sort: 'last-used',
    detailId: null,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePromptHistoryStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // loadEntries
  // -------------------------------------------------------------------------

  describe('loadEntries', () => {
    it('should populate entries from getAllPrompts', async () => {
      const mockEntries = [
        buildEntry({ id: 'p1' }),
        buildEntry({ id: 'p2', text: 'Second prompt' }),
        buildEntry({ id: 'p3', text: 'Third prompt' }),
      ];
      vi.mocked(getAllPrompts).mockResolvedValue(mockEntries);

      await act(async () => {
        await usePromptHistoryStore.getState().loadEntries();
      });

      expect(usePromptHistoryStore.getState().entries).toHaveLength(3);
      expect(usePromptHistoryStore.getState().entries[0].id).toBe('p1');
    });
  });

  // -------------------------------------------------------------------------
  // toggleSelect
  // -------------------------------------------------------------------------

  describe('toggleSelect', () => {
    it('should add id to selectedIds when not present', () => {
      act(() => {
        usePromptHistoryStore.getState().toggleSelect('p1');
      });

      expect(usePromptHistoryStore.getState().selectedIds.includes('p1')).toBe(true);
    });

    it('should remove id from selectedIds when already present', () => {
      usePromptHistoryStore.setState({ selectedIds: ['p1'] });

      act(() => {
        usePromptHistoryStore.getState().toggleSelect('p1');
      });

      expect(usePromptHistoryStore.getState().selectedIds.includes('p1')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // setSearch
  // -------------------------------------------------------------------------

  describe('setSearch', () => {
    it('should update search string', () => {
      act(() => {
        usePromptHistoryStore.getState().setSearch('hello world');
      });

      expect(usePromptHistoryStore.getState().search).toBe('hello world');
    });
  });

  // -------------------------------------------------------------------------
  // deleteEntries
  // -------------------------------------------------------------------------

  describe('deleteEntries', () => {
    it('should call deletePrompts and remove ids from entries, clear selectedIds', async () => {
      const entries = [
        buildEntry({ id: 'p1' }),
        buildEntry({ id: 'p2', text: 'Second' }),
        buildEntry({ id: 'p3', text: 'Third' }),
      ];
      usePromptHistoryStore.setState({ entries, selectedIds: ['p1', 'p2'] });
      vi.mocked(deletePrompts).mockResolvedValue(undefined);

      await act(async () => {
        await usePromptHistoryStore.getState().deleteEntries(['p1', 'p2']);
      });

      expect(deletePrompts).toHaveBeenCalledWith(['p1', 'p2']);
      expect(usePromptHistoryStore.getState().entries.map(e => e.id)).toEqual(['p3']);
      expect(usePromptHistoryStore.getState().selectedIds.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // setTypeFilter
  // -------------------------------------------------------------------------

  describe('setTypeFilter', () => {
    it('should update typeFilter', () => {
      act(() => {
        usePromptHistoryStore.getState().setTypeFilter('USER');
      });

      expect(usePromptHistoryStore.getState().typeFilter).toBe('USER');
    });
  });

  // -------------------------------------------------------------------------
  // setSort
  // -------------------------------------------------------------------------

  describe('setSort', () => {
    it('should update sort', () => {
      act(() => {
        usePromptHistoryStore.getState().setSort('use-count');
      });

      expect(usePromptHistoryStore.getState().sort).toBe('use-count');
    });
  });

  // -------------------------------------------------------------------------
  // clearSelection
  // -------------------------------------------------------------------------

  describe('clearSelection', () => {
    it('should empty selectedIds', () => {
      usePromptHistoryStore.setState({ selectedIds: ['p1', 'p2', 'p3'] });

      act(() => {
        usePromptHistoryStore.getState().clearSelection();
      });

      expect(usePromptHistoryStore.getState().selectedIds.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // loadError
  // -------------------------------------------------------------------------

  describe('loadError', () => {
    it('should have loadError as null in initial state', () => {
      // Arrange + Act: resetStore already applied in beforeEach
      const state = usePromptHistoryStore.getState() as unknown as Record<string, unknown>;

      // Assert: loadError must be null (not undefined) on fresh store
      expect(state.loadError).toBeNull();
    });

    it('should populate entries and clear loadError on successful loadEntries', async () => {
      const mockEntries = [buildEntry({ id: 'p1' }), buildEntry({ id: 'p2', text: 'Second' })];
      vi.mocked(getAllPrompts).mockResolvedValue(mockEntries);
      usePromptHistoryStore.setState({ loadError: 'previous error' } as unknown as Parameters<
        typeof usePromptHistoryStore.setState
      >[0]);

      await act(async () => {
        await usePromptHistoryStore.getState().loadEntries();
      });

      expect(usePromptHistoryStore.getState().entries).toHaveLength(2);
      expect(
        (usePromptHistoryStore.getState() as unknown as Record<string, unknown>).loadError
      ).toBeNull();
    });

    it('should set loadError when getAllPrompts throws', async () => {
      vi.mocked(getAllPrompts).mockRejectedValue(new Error('IDB read failure'));

      await act(async () => {
        await usePromptHistoryStore.getState().loadEntries();
      });

      expect(
        (usePromptHistoryStore.getState() as unknown as Record<string, unknown>).loadError
      ).toBeTruthy();
      expect(
        (usePromptHistoryStore.getState() as unknown as Record<string, unknown>).loadError
      ).toContain('IDB read failure');
    });
  });

  // -------------------------------------------------------------------------
  // entries.length counter selector (R-010: pre-hydration safety)
  // -------------------------------------------------------------------------

  describe('entries.length counter selector', () => {
    it('should return 0 when store is in initial pre-hydration state', () => {
      // Arrange: resetStore already called in beforeEach — store is at initial shape
      // Act: read selector immediately without any async load
      const count = usePromptHistoryStore.getState().entries.length;

      // Assert: must be exactly 0, never NaN (R-010)
      expect(count).toBe(0);
      expect(Number.isNaN(count)).toBe(false);
    });

    it('should return N after loadEntries resolves with N entries', async () => {
      // Arrange
      const mockEntries = [
        buildEntry({ id: 'p1' }),
        buildEntry({ id: 'p2', text: 'Second' }),
        buildEntry({ id: 'p3', text: 'Third' }),
      ];
      vi.mocked(getAllPrompts).mockResolvedValue(mockEntries);

      // Act
      await act(async () => {
        await usePromptHistoryStore.getState().loadEntries();
      });

      // Assert
      expect(usePromptHistoryStore.getState().entries.length).toBe(3);
    });

    it('should decrease entries.length after deleteEntries removes ids', async () => {
      // Arrange: seed 3 entries
      const entries = [
        buildEntry({ id: 'p1' }),
        buildEntry({ id: 'p2', text: 'Second' }),
        buildEntry({ id: 'p3', text: 'Third' }),
      ];
      usePromptHistoryStore.setState({ entries });
      vi.mocked(deletePrompts).mockResolvedValue(undefined);

      const countBefore = usePromptHistoryStore.getState().entries.length;

      // Act: delete 2 of the 3
      await act(async () => {
        await usePromptHistoryStore.getState().deleteEntries(['p1', 'p2']);
      });

      // Assert
      const countAfter = usePromptHistoryStore.getState().entries.length;
      expect(countAfter).toBeLessThan(countBefore);
      expect(countAfter).toBe(1);
    });
  });
});
