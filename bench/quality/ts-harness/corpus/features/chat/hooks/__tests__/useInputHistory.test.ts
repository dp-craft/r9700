import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useInputHistory } from '../useInputHistory';

// -- Helpers --

const createMockTextarea = (overrides?: Partial<HTMLTextAreaElement>): HTMLTextAreaElement =>
  ({
    value: '',
    selectionStart: 0,
    ...overrides,
  }) as HTMLTextAreaElement;

// -- Tests --

describe('useInputHistory', () => {
  describe('navigateUp', () => {
    it('should recall most recent entry when input is empty (FR-001)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('first message');
      });

      let handled = false;
      act(() => {
        handled = result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      expect(handled).toBe(true);
      expect(result.current.isNavigating).toBe(true);
      expect(result.current.currentEntry).toBe('first message');
    });

    it('should navigate to progressively older entries on consecutive Up presses (FR-002)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('oldest');
        result.current.addEntry('middle');
        result.current.addEntry('newest');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });
      expect(result.current.currentEntry).toBe('newest');

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: 'newest' }));
      });
      expect(result.current.currentEntry).toBe('middle');

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: 'middle' }));
      });
      expect(result.current.currentEntry).toBe('oldest');
    });

    it('should save draft on first Up press and restore it on Down past newest (FR-006)', () => {
      const { result } = renderHook(() => useInputHistory('my draft'));

      act(() => {
        result.current.addEntry('sent message');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: 'my draft' }));
      });
      expect(result.current.currentEntry).toBe('sent message');

      act(() => {
        result.current.navigateDown(createMockTextarea({ value: 'sent message' }));
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();
    });

    it('should stay at oldest entry when already at index 0 and returns true', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('only entry');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      let handled = false;
      act(() => {
        handled = result.current.navigateUp(createMockTextarea({ value: 'only entry' }));
      });

      expect(handled).toBe(true);
      expect(result.current.currentEntry).toBe('only entry');
    });

    it('should return false when there are no entries (FR-001 negative)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      let handled = false;
      act(() => {
        handled = result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      expect(handled).toBe(false);
      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();
    });

    it('should return false when cursor is not on the first line of a multiline textarea (FR-007)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('some entry');
      });

      const multilineTextarea = createMockTextarea({
        value: 'line one\nline two',
        selectionStart: 15,
      });

      let handled = false;
      act(() => {
        handled = result.current.navigateUp(multilineTextarea);
      });

      expect(handled).toBe(false);
      expect(result.current.isNavigating).toBe(false);
    });

    it('should return true when cursor is on the first line of a multiline textarea (FR-007)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('some entry');
      });

      const multilineTextarea = createMockTextarea({
        value: 'line one\nline two',
        selectionStart: 4,
      });

      let handled = false;
      act(() => {
        handled = result.current.navigateUp(multilineTextarea);
      });

      expect(handled).toBe(true);
    });
  });

  describe('navigateDown', () => {
    it('should navigate to a newer entry when navigating (FR-003)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('older');
        result.current.addEntry('newer');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
        result.current.navigateUp(createMockTextarea({ value: 'newer' }));
      });
      expect(result.current.currentEntry).toBe('older');

      act(() => {
        result.current.navigateDown(createMockTextarea({ value: 'older' }));
      });

      expect(result.current.currentEntry).toBe('newer');
      expect(result.current.isNavigating).toBe(true);
    });

    it('should restore empty state and stop navigating when pressing Down past newest entry (FR-004)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('only entry');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      act(() => {
        result.current.navigateDown(createMockTextarea({ value: 'only entry' }));
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();
    });

    it('should return false when not currently navigating', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('some entry');
      });

      let handled = false;
      act(() => {
        handled = result.current.navigateDown(createMockTextarea({ value: '' }));
      });

      expect(handled).toBe(false);
    });

    it('should return false when cursor is not on the first line (FR-007)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('entry one');
        result.current.addEntry('entry two');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      const multilineTextarea = createMockTextarea({
        value: 'line one\nline two',
        selectionStart: 15,
      });

      let handled = false;
      act(() => {
        handled = result.current.navigateDown(multilineTextarea);
      });

      expect(handled).toBe(false);
    });
  });

  describe('dismiss', () => {
    it('should restore draft and stop navigating when called (FR-008)', () => {
      const { result } = renderHook(() => useInputHistory('my draft'));

      act(() => {
        result.current.addEntry('sent message');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: 'my draft' }));
      });
      expect(result.current.isNavigating).toBe(true);

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();
    });

    it('should be a no-op when not navigating', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();
    });
  });

  describe('addEntry', () => {
    it('should append a new entry to history (FR-005)', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('first');
        result.current.addEntry('second');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      expect(result.current.currentEntry).toBe('second');

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: 'second' }));
      });

      expect(result.current.currentEntry).toBe('first');
    });

    it('should not add a duplicate of the last entry', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('repeated');
        result.current.addEntry('repeated');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });
      expect(result.current.currentEntry).toBe('repeated');

      let stuckAtOldest = false;
      act(() => {
        stuckAtOldest = result.current.navigateUp(createMockTextarea({ value: 'repeated' }));
      });

      expect(stuckAtOldest).toBe(true);
      expect(result.current.currentEntry).toBe('repeated');
    });

    it('should cap history at 50 entries', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        for (let i = 0; i < 55; i++) {
          result.current.addEntry(`message ${i}`);
        }
      });

      // First Up → newest surviving entry (message 54)
      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });
      expect(result.current.currentEntry).toBe('message 54');

      // Navigate all the way to oldest
      let navigations = 0;
      while (result.current.isNavigating) {
        const previous = result.current.currentEntry;
        act(() => {
          result.current.navigateUp(createMockTextarea({ value: previous ?? '' }));
        });
        if (result.current.currentEntry === previous) break;
        navigations++;
        if (navigations > 60) break;
      }

      // Oldest surviving entry is message 5 (0-4 dropped by cap)
      expect(result.current.currentEntry).toBe('message 5');
      // Exactly 49 navigations from newest to oldest (50 entries total)
      expect(navigations).toBe(49);
    });

    it('should reset navigation state when addEntry is called while navigating', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('original entry');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });
      expect(result.current.isNavigating).toBe(true);

      act(() => {
        result.current.addEntry('new entry after edit');
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();
    });
  });

  describe('reset', () => {
    it('should clear all entries and stop navigation when called with no arguments', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('entry one');
        result.current.addEntry('entry two');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });
      expect(result.current.isNavigating).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();

      let handled = false;
      act(() => {
        handled = result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      expect(handled).toBe(false);
    });

    it('should replace entries with provided array and stop navigation', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.addEntry('old entry');
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      act(() => {
        result.current.reset(['restored one', 'restored two']);
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });

      expect(result.current.currentEntry).toBe('restored two');
    });

    it('should allow navigation from the beginning after reset with new entries', () => {
      const { result } = renderHook(() => useInputHistory(''));

      act(() => {
        result.current.reset(['alpha', 'beta', 'gamma']);
      });

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: '' }));
      });
      expect(result.current.currentEntry).toBe('gamma');

      act(() => {
        result.current.navigateUp(createMockTextarea({ value: 'gamma' }));
      });
      expect(result.current.currentEntry).toBe('beta');
    });
  });

  describe('initial state', () => {
    it('should start with isNavigating false and currentEntry null', () => {
      const { result } = renderHook(() => useInputHistory(''));

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.currentEntry).toBeNull();
    });
  });
});
