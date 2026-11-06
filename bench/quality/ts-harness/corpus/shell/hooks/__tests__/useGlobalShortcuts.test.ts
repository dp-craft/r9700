import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
  getAllAppSettings: vi.fn(),
}));

import { useUIStore } from '@/stores/useUIStore';

import { useGlobalShortcuts } from '../useGlobalShortcuts';

const dispatchKey = (key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  document.dispatchEvent(event);
  return event;
};

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    useUIStore.setState({ workspace: 'chat', activeDialog: null, dialogPayload: null });
    vi.clearAllMocks();
  });

  describe('Alt+1 shortcut', () => {
    it('should set workspace to chat when Alt+1 is pressed', () => {
      // Given: hook is mounted, workspace is prompt-lab
      renderHook(() => useGlobalShortcuts());
      useUIStore.setState({ workspace: 'prompt-lab' });

      // When: Alt+1 keydown is dispatched
      act(() => {
        dispatchKey('1', { altKey: true });
      });

      // Then: workspace becomes 'chat'
      expect(useUIStore.getState().workspace).toBe('chat');
    });
  });

  describe('Alt+2 shortcut', () => {
    it('should set workspace to prompt-lab when Alt+2 is pressed', () => {
      // Given: hook is mounted, workspace is chat
      renderHook(() => useGlobalShortcuts());
      useUIStore.setState({ workspace: 'chat' });

      // When: Alt+2 keydown is dispatched
      act(() => {
        dispatchKey('2', { altKey: true });
      });

      // Then: workspace becomes 'prompt-lab'
      expect(useUIStore.getState().workspace).toBe('prompt-lab');
    });
  });

  describe('Ctrl+, shortcut (FR-048)', () => {
    it('should open settings dialog when Ctrl+, is pressed and dialog is closed', () => {
      // Given: hook is mounted, no dialog open
      renderHook(() => useGlobalShortcuts());
      useUIStore.setState({ activeDialog: null });

      // When: Ctrl+, keydown is dispatched
      act(() => {
        dispatchKey(',', { ctrlKey: true });
      });

      // Then: settings dialog opens
      expect(useUIStore.getState().activeDialog).toBe('settings');
    });
  });

  describe('Ctrl+, while settings open (FR-050)', () => {
    it('should not close the settings dialog when Ctrl+, is pressed while already open', () => {
      // Given: hook is mounted, settings dialog already open
      renderHook(() => useGlobalShortcuts());
      useUIStore.setState({ activeDialog: 'settings' });

      // When: Ctrl+, keydown is dispatched again
      act(() => {
        dispatchKey(',', { ctrlKey: true });
      });

      // Then: settings dialog remains open
      expect(useUIStore.getState().activeDialog).toBe('settings');
    });
  });

  describe('unmount cleanup', () => {
    it('should not change state after unmount when a shortcut key is pressed', () => {
      // Given: hook is mounted then unmounted
      const { unmount } = renderHook(() => useGlobalShortcuts());
      useUIStore.setState({ workspace: 'prompt-lab' });
      unmount();

      // When: Alt+1 is dispatched after unmount
      act(() => {
        dispatchKey('1', { altKey: true });
      });

      // Then: workspace remains unchanged
      expect(useUIStore.getState().workspace).toBe('prompt-lab');
    });
  });

  describe('preventDefault', () => {
    it('should call preventDefault on the event when a handled shortcut fires', () => {
      // Given: hook is mounted
      renderHook(() => useGlobalShortcuts());

      // When: Alt+1 keydown is dispatched
      let event!: KeyboardEvent;
      act(() => {
        event = dispatchKey('1', { altKey: true });
      });

      // Then: the event has been prevented
      expect(event.defaultPrevented).toBe(true);
    });
  });
});
