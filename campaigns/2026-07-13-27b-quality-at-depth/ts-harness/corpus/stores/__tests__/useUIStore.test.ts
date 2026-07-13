import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UIState } from '../useUIStore';
import {
  isSettingsDialogPayload,
  sanitizeWorkspace,
  useDialogPayload,
  useUIStore
} from '../useUIStore';

// -- Boundary mocks --

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
}));

import * as appSettingsDb from '@/db/appSettings';

const mockPutAppSetting = appSettingsDb.putAppSetting as ReturnType<typeof vi.fn>;

describe('useUIStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    act(() => {
      useUIStore.setState({
        workspace: 'chat',
        chatPanel: 'conversations',
        labPanel: 'tester',
        activeDialog: null,
        dialogPayload: null,
        inFlightCalls: 0,
      });
    });
  });

  // =========================================================================
  // Locked cases (7)
  // =========================================================================

  it('should initialize with workspace=chat, chatPanel=conversations, labPanel=tester', () => {
    // Given: fresh store state (set in beforeEach)
    // When: state is read
    const state = useUIStore.getState();
    // Then: initial nav state matches spec
    expect(state.workspace).toBe('chat');
    expect(state.chatPanel).toBe('conversations');
    expect(state.labPanel).toBe('tester');
  });

  it('should change only workspace when setWorkspace is called', () => {
    // Given: initial state with chatPanel=conversations, labPanel=tester
    act(() => {
      useUIStore.getState().setWorkspace('prompt-lab');
    });

    const state = useUIStore.getState();
    expect(state.workspace).toBe('prompt-lab');
    // panels untouched
    expect(state.chatPanel).toBe('conversations');
    expect(state.labPanel).toBe('tester');
  });

  it('should change only chatPanel when setChatPanel is called', () => {
    // Given: workspace is chat
    act(() => {
      useUIStore.getState().setChatPanel('skills');
    });

    const state = useUIStore.getState();
    expect(state.chatPanel).toBe('skills');
    // workspace and labPanel untouched
    expect(state.workspace).toBe('chat');
    expect(state.labPanel).toBe('tester');
  });

  it('should set workspace=chat AND chatPanel=skills atomically when requestWorkspacePanel is called', () => {
    // Given: initial state
    act(() => {
      useUIStore.getState().requestWorkspacePanel('chat', 'skills');
    });

    const state = useUIStore.getState();
    expect(state.workspace).toBe('chat');
    expect(state.chatPanel).toBe('skills');
    // labPanel untouched
    expect(state.labPanel).toBe('tester');
  });

  it('should update only labPanel and leave workspace unchanged when setLabPanel is called', () => {
    // Given: workspace=prompt-lab
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
      useUIStore.getState().setLabPanel('run-history');
    });

    const state = useUIStore.getState();
    expect(state.labPanel).toBe('run-history');
    expect(state.workspace).toBe('prompt-lab');
  });

  it('should remember per-workspace panel when navigating chat→lab→chat', () => {
    // Given: set chat panel to skills
    act(() => {
      useUIStore.getState().setChatPanel('skills');
    });
    // And: navigate to lab, set lab panel
    act(() => {
      useUIStore.getState().requestWorkspacePanel('prompt-lab', 'run-history');
    });
    // When: navigate back to chat
    act(() => {
      useUIStore.getState().setWorkspace('chat');
    });

    const state = useUIStore.getState();
    expect(state.workspace).toBe('chat');
    expect(state.chatPanel).toBe('skills');
    expect(state.labPanel).toBe('run-history');
  });

  it('should return chat for any unknown value passed to sanitizeWorkspace', () => {
    expect(sanitizeWorkspace('run-history')).toBe('chat');
    expect(sanitizeWorkspace(null)).toBe('chat');
    expect(sanitizeWorkspace(undefined)).toBe('chat');
    expect(sanitizeWorkspace(42)).toBe('chat');
    expect(sanitizeWorkspace('chat')).toBe('chat');
    expect(sanitizeWorkspace('prompt-lab')).toBe('prompt-lab');
  });

  // =========================================================================
  // workspace IDB persistence (debounced)
  // =========================================================================

  describe('workspace IDB persistence', () => {
    it('should write workspace to IDB via putAppSetting after setWorkspace', async () => {
      // Given: fake timers installed
      vi.useFakeTimers();

      // When: setWorkspace('prompt-lab') is called
      act(() => {
        useUIStore.getState().setWorkspace('prompt-lab');
      });

      // And: the 250 ms debounce fires
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      // Then: putAppSetting was called with the new workspace
      expect(mockPutAppSetting).toHaveBeenCalledTimes(1);
      expect(mockPutAppSetting).toHaveBeenCalledWith('active-page', 'prompt-lab');
    });

    it('should produce ONE putAppSetting call with the final value when two rapid setWorkspace calls occur within 250ms', async () => {
      // Given: fake timers installed
      vi.useFakeTimers();

      // When: two rapid setWorkspace calls happen within the debounce window
      act(() => {
        useUIStore.getState().setWorkspace('prompt-lab');
      });
      act(() => {
        useUIStore.getState().setWorkspace('chat');
      });

      // And: the 250 ms debounce fires once
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      // Then: only ONE IDB write occurs, with the final value
      expect(mockPutAppSetting).toHaveBeenCalledTimes(1);
      expect(mockPutAppSetting).toHaveBeenCalledWith('active-page', 'chat');
    });

    it('should not call putAppSetting before the 250ms debounce window elapses', async () => {
      // Given: fake timers installed
      vi.useFakeTimers();

      // When: setWorkspace is called
      act(() => {
        useUIStore.getState().setWorkspace('prompt-lab');
      });

      // And: only 100 ms have elapsed (debounce not yet fired)
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Then: no IDB write has occurred yet
      expect(mockPutAppSetting).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // openDialog
  // =========================================================================

  describe('openDialog', () => {
    it('should set activeDialog to settings when openDialog is called with settings', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openDialog('settings');
      });

      expect(result.current.activeDialog).toBe('settings');
    });

    it('should set activeDialog to skills when openDialog is called with skills', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openDialog('skills');
      });

      expect(result.current.activeDialog).toBe('skills');
    });

    it('should set activeDialog to prompt-tester when openDialog is called with prompt-tester', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openDialog('prompt-tester');
      });

      expect(result.current.activeDialog).toBe('prompt-tester');
    });

    it('should replace the existing open dialog when openDialog is called while another dialog is open', () => {
      const { result } = renderHook(() => useUIStore());
      act(() => {
        result.current.openDialog('settings');
      });

      act(() => {
        result.current.openDialog('skills');
      });

      expect(result.current.activeDialog).toBe('skills');
    });

    it('should not change workspace when openDialog is called', () => {
      // Given: the store has workspace 'prompt-lab'
      act(() => {
        useUIStore.setState({ workspace: 'prompt-lab' });
      });
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openDialog('settings');
      });

      expect(result.current.workspace).toBe('prompt-lab');
    });
  });

  // =========================================================================
  // closeDialog
  // =========================================================================

  describe('closeDialog', () => {
    it('should set activeDialog to null when closeDialog is called while a dialog is open', () => {
      const { result } = renderHook(() => useUIStore());
      act(() => {
        result.current.openDialog('settings');
      });

      act(() => {
        result.current.closeDialog();
      });

      expect(result.current.activeDialog).toBeNull();
    });

    it('should keep activeDialog as null when closeDialog is called when no dialog is open', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.closeDialog();
      });

      expect(result.current.activeDialog).toBeNull();
    });

    it('should not change workspace when closeDialog is called', () => {
      act(() => {
        useUIStore.setState({ workspace: 'prompt-lab', activeDialog: 'settings' });
      });
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.closeDialog();
      });

      expect(result.current.workspace).toBe('prompt-lab');
    });
  });

  // =========================================================================
  // subscribeWithSelector
  // =========================================================================

  describe('subscribeWithSelector', () => {
    it('should fire listener only when activeDialog changes when subscribed with dialog selector', () => {
      const listener = vi.fn();
      const unsubscribe = useUIStore.subscribe((state: UIState) => state.activeDialog, listener);

      try {
        act(() => {
          useUIStore.getState().openDialog('settings');
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith('settings', null);
      } finally {
        unsubscribe();
      }
    });

    it('should not fire dialog listener when only workspace changes', () => {
      const listener = vi.fn();
      const unsubscribe = useUIStore.subscribe((state: UIState) => state.activeDialog, listener);

      try {
        act(() => {
          useUIStore.getState().setWorkspace('prompt-lab');
        });

        expect(listener).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
      }
    });

    it('should fire listener with updated value and previous value when activeDialog transitions', () => {
      act(() => {
        useUIStore.setState({ activeDialog: 'settings' });
      });

      const listener = vi.fn();
      const unsubscribe = useUIStore.subscribe((state: UIState) => state.activeDialog, listener);

      try {
        act(() => {
          useUIStore.getState().closeDialog();
        });

        expect(listener).toHaveBeenCalledWith(null, 'settings');
      } finally {
        unsubscribe();
      }
    });

    it('should allow reading state via getState without a hook', () => {
      const state = useUIStore.getState();

      expect(state.workspace).toBe('chat');
      expect(state.activeDialog).toBeNull();
    });
  });

  // =========================================================================
  // dialogPayload
  // =========================================================================

  describe('dialogPayload', () => {
    it('should initialize dialogPayload as null', () => {
      const { result } = renderHook(() => useUIStore());

      expect(result.current.dialogPayload).toStrictEqual(null);
    });

    it('should set dialogPayload to tab-only object when openDialog is called with tab payload', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openDialog('settings', { tab: 'advanced' });
      });

      expect(result.current.dialogPayload).toEqual({ tab: 'advanced' });
    });

    it('should set dialogPayload to full payload object when openDialog is called with tab and section', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openDialog('settings', { tab: 'advanced', section: 'feature-flags' });
      });

      expect(result.current.dialogPayload).toEqual({ tab: 'advanced', section: 'feature-flags' });
    });

    it('should set dialogPayload to null when openDialog is called without a payload', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openDialog('settings');
      });

      expect(result.current.dialogPayload).toStrictEqual(null);
    });

    it('should replace dialogPayload with null when a second openDialog call omits the payload', () => {
      const { result } = renderHook(() => useUIStore());
      act(() => {
        result.current.openDialog('settings', { tab: 'a' });
      });

      act(() => {
        result.current.openDialog('skills');
      });

      expect(result.current.dialogPayload).toStrictEqual(null);
    });

    it('should clear dialogPayload to null when closeDialog is called', () => {
      const { result } = renderHook(() => useUIStore());
      act(() => {
        result.current.openDialog('settings', { tab: 'advanced' });
      });

      act(() => {
        result.current.closeDialog();
      });

      expect(result.current.dialogPayload).toStrictEqual(null);
    });
  });

  // =========================================================================
  // useDialogPayload
  // =========================================================================

  describe('useDialogPayload', () => {
    it('should return current dialogPayload and fire listener only when dialogPayload changes not when workspace changes', () => {
      const listener = vi.fn();
      const unsubscribe = useUIStore.subscribe((state: UIState) => state.dialogPayload, listener);

      try {
        // When: workspace changes (dialogPayload stays null)
        act(() => {
          useUIStore.getState().setWorkspace('prompt-lab');
        });

        expect(listener).not.toHaveBeenCalled();

        // When: dialogPayload changes via openDialog with payload
        act(() => {
          useUIStore.getState().openDialog('settings', { tab: 'advanced' });
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({ tab: 'advanced' }, null);
      } finally {
        unsubscribe();
      }
    });

    it('should return the current dialogPayload value from the useDialogPayload hook', () => {
      const { result } = renderHook(() => useDialogPayload());

      expect(result.current).toBeNull();

      act(() => {
        useUIStore.getState().openDialog('settings', { tab: 'advanced', section: 'feature-flags' });
      });

      expect(result.current).toEqual({ tab: 'advanced', section: 'feature-flags' });
    });
  });

  // =========================================================================
  // inFlightCalls — in-flight LLM call counter (NEW:chat.llm-background-call-counter)
  // =========================================================================

  describe('inFlightCalls', () => {
    it('should initialize inFlightCalls to 0', () => {
      expect(useUIStore.getState().inFlightCalls).toBe(0);
    });

    it('should increment inFlightCalls by 1 when beginInFlightCall is called', () => {
      act(() => {
        useUIStore.getState().beginInFlightCall();
      });

      expect(useUIStore.getState().inFlightCalls).toBe(1);
    });

    it('should accumulate concurrent calls when beginInFlightCall is called multiple times', () => {
      act(() => {
        useUIStore.getState().beginInFlightCall();
        useUIStore.getState().beginInFlightCall();
        useUIStore.getState().beginInFlightCall();
      });

      expect(useUIStore.getState().inFlightCalls).toBe(3);
    });

    it('should decrement inFlightCalls by 1 when endInFlightCall is called', () => {
      act(() => {
        useUIStore.setState({ inFlightCalls: 2 });
        useUIStore.getState().endInFlightCall();
      });

      expect(useUIStore.getState().inFlightCalls).toBe(1);
    });

    it('should return to baseline 0 when every begin is matched by an end', () => {
      act(() => {
        useUIStore.getState().beginInFlightCall();
        useUIStore.getState().beginInFlightCall();
      });
      act(() => {
        useUIStore.getState().endInFlightCall();
        useUIStore.getState().endInFlightCall();
      });

      expect(useUIStore.getState().inFlightCalls).toBe(0);
    });

    it('should floor at 0 and never go negative when endInFlightCall is called at zero', () => {
      act(() => {
        useUIStore.getState().endInFlightCall();
      });

      expect(useUIStore.getState().inFlightCalls).toBe(0);
    });

    it('should floor at 0 on a double-end that would otherwise drive it negative', () => {
      act(() => {
        useUIStore.getState().beginInFlightCall();
      });
      act(() => {
        useUIStore.getState().endInFlightCall();
        useUIStore.getState().endInFlightCall();
      });

      expect(useUIStore.getState().inFlightCalls).toBe(0);
    });

    it('should NOT persist inFlightCalls to IDB when the counter changes', async () => {
      vi.useFakeTimers();

      act(() => {
        useUIStore.getState().beginInFlightCall();
      });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(mockPutAppSetting).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// isSettingsDialogPayload — narrowed sections (FR-053)
// =============================================================================

describe('isSettingsDialogPayload — narrowed sections (FR-053)', () => {
  describe('valid narrowed sections', () => {
    it('should return true when section is general', () => {
      expect(isSettingsDialogPayload({ section: 'general' })).toBe(true);
    });

    it('should return true when section is api-models', () => {
      expect(isSettingsDialogPayload({ section: 'api-models' })).toBe(true);
    });

    it('should return true when section is appearance', () => {
      expect(isSettingsDialogPayload({ section: 'appearance' })).toBe(true);
    });

    it('should return true when section is defaults', () => {
      expect(isSettingsDialogPayload({ section: 'defaults' })).toBe(true);
    });
  });

  describe('legacy sections (removed in FR-051)', () => {
    it('should return false when section is legacy global:workspace', () => {
      expect(isSettingsDialogPayload({ section: 'global:workspace' })).toBe(false);
    });

    it('should return false when section is legacy mf-lab:retention', () => {
      expect(isSettingsDialogPayload({ section: 'mf-lab:retention' })).toBe(false);
    });

    it('should return false when section is legacy global:account', () => {
      expect(isSettingsDialogPayload({ section: 'global:account' })).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return true when payload is an empty object (section is undefined)', () => {
      expect(isSettingsDialogPayload({})).toBe(true);
    });

    it('should return false when value is null', () => {
      expect(isSettingsDialogPayload(null)).toBe(false);
    });

    it('should return false when value is a number', () => {
      expect(isSettingsDialogPayload(42)).toBe(false);
    });

    it('should return false when value is a string', () => {
      expect(isSettingsDialogPayload('general')).toBe(false);
    });
  });
});

// =============================================================================
// isSettingsDialogPayload — anchor validation (FR-055)
// =============================================================================

describe('isSettingsDialogPayload — anchor validation (FR-055)', () => {
  describe('valid anchors', () => {
    it('should return true when anchor is chat-defaults', () => {
      expect(isSettingsDialogPayload({ section: 'defaults', anchor: 'chat-defaults' })).toBe(true);
    });

    it('should return true when anchor is lab-defaults', () => {
      expect(isSettingsDialogPayload({ section: 'defaults', anchor: 'lab-defaults' })).toBe(true);
    });

    it('should return true when anchor is lab-retention', () => {
      expect(isSettingsDialogPayload({ section: 'defaults', anchor: 'lab-retention' })).toBe(true);
    });
  });

  describe('backward compatibility — no anchor', () => {
    it('should return true when section is present and anchor is absent', () => {
      expect(isSettingsDialogPayload({ section: 'general' })).toBe(true);
    });

    it('should return true when anchor is explicitly undefined', () => {
      expect(isSettingsDialogPayload({ section: 'defaults', anchor: undefined })).toBe(true);
    });
  });

  describe('invalid anchors', () => {
    it('should return false when anchor is an unknown string', () => {
      expect(isSettingsDialogPayload({ section: 'defaults', anchor: 'bogus' })).toBe(false);
    });

    it('should return false when anchor is a non-string value', () => {
      expect(isSettingsDialogPayload({ section: 'defaults', anchor: 123 })).toBe(false);
    });
  });
});
