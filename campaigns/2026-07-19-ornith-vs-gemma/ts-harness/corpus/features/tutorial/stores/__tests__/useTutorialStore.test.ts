import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Boundary mocks (declared before imports per Vitest hoisting rules) --

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
  getTutorialResetV024: vi.fn(),
  putTutorialResetV024: vi.fn(),
}));

import * as appSettingsDb from '@/db/appSettings';

import { TUTORIAL_GOAL_COUNT } from '../../constants';
import { useTutorialStore } from '../useTutorialStore';

// -- Mock accessors --

const mockGetAppSetting = appSettingsDb.getAppSetting as ReturnType<typeof vi.fn>;
const mockPutAppSetting = appSettingsDb.putAppSetting as ReturnType<typeof vi.fn>;
const mockGetTutorialResetV024 = appSettingsDb.getTutorialResetV024 as ReturnType<typeof vi.fn>;
const mockPutTutorialResetV024 = appSettingsDb.putTutorialResetV024 as ReturnType<typeof vi.fn>;

// -- Helpers --

const getState = () => useTutorialStore.getState();

const buildAllGoalIds = (): readonly string[] =>
  Array.from({ length: TUTORIAL_GOAL_COUNT }, (_, i) => `goal-${i + 1}`);

const resetStore = (): void => {
  useTutorialStore.setState({
    completedGoalIds: [],
    interactionFlags: {},
    isActive: true,
    isFabExpanded: false,
    isCompleted: false,
    isDismissed: false,
  });
};

const buildTutorialProgressJson = (
  overrides?: Partial<{
    completedGoalIds: readonly string[];
    interactionFlags: Record<string, boolean>;
    isActive: boolean;
    isFabExpanded: boolean;
    isCompleted: boolean;
    isDismissed: boolean;
  }>
): string =>
  JSON.stringify({
    completedGoalIds: [],
    interactionFlags: {},
    isActive: true,
    isFabExpanded: false,
    isCompleted: false,
    isDismissed: false,
    ...overrides,
  });

// ===========================================================================
// Test Suite
// ===========================================================================

describe('useTutorialStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    mockPutAppSetting.mockResolvedValue(undefined);
    mockGetAppSetting.mockResolvedValue(null);
    mockGetTutorialResetV024.mockResolvedValue(true);
    mockPutTutorialResetV024.mockResolvedValue(undefined);
  });

  // =========================================================================
  // Initial state
  // =========================================================================

  describe('initial state', () => {
    it('should have completedGoalIds as an empty array', () => {
      expect(getState().completedGoalIds).toEqual([]);
    });

    it('should have interactionFlags as an empty object', () => {
      expect(getState().interactionFlags).toEqual({});
    });

    it('should have isActive set to true', () => {
      expect(getState().isActive).toBe(true);
    });

    it('should have isFabExpanded set to false', () => {
      expect(getState().isFabExpanded).toBe(false);
    });

    it('should have isCompleted set to false', () => {
      expect(getState().isCompleted).toBe(false);
    });

    it('should have isDismissed set to false', () => {
      expect(getState().isDismissed).toBe(false);
    });
  });

  // =========================================================================
  // markGoalComplete
  // =========================================================================

  describe('markGoalComplete', () => {
    it('should add the goal id to completedGoalIds when a new goal is marked complete', () => {
      // Given the store starts with no completed goals
      expect(getState().completedGoalIds).toHaveLength(0);

      // When
      act(() => {
        getState().markGoalComplete('open-settings');
      });

      // Then
      expect(getState().completedGoalIds).toContain('open-settings');
    });

    it('should not duplicate the goal id when markGoalComplete is called twice with the same id', () => {
      // Given
      act(() => {
        getState().markGoalComplete('open-settings');
      });
      expect(getState().completedGoalIds).toHaveLength(1);

      // When — called again with the same id
      act(() => {
        getState().markGoalComplete('open-settings');
      });

      // Then
      expect(getState().completedGoalIds).toHaveLength(1);
      expect(getState().completedGoalIds).toEqual(['open-settings']);
    });

    it('should accumulate multiple distinct goal ids', () => {
      // When
      act(() => {
        getState().markGoalComplete('open-settings');
        getState().markGoalComplete('configure-provider');
        getState().markGoalComplete('select-model');
      });

      // Then
      expect(getState().completedGoalIds).toHaveLength(3);
      expect(getState().completedGoalIds).toContain('open-settings');
      expect(getState().completedGoalIds).toContain('configure-provider');
      expect(getState().completedGoalIds).toContain('select-model');
    });

    it('should set isCompleted to true when all 11 goals are marked complete', () => {
      // Given
      const allGoalIds = buildAllGoalIds();
      expect(getState().isCompleted).toBe(false);

      // When — mark all goals complete
      act(() => {
        for (const id of allGoalIds) {
          getState().markGoalComplete(id);
        }
      });

      // Then
      expect(getState().isCompleted).toBe(true);
    });

    it('should keep isCompleted false when fewer than 11 goals are complete', () => {
      // When — mark 10 of 11 goals
      act(() => {
        for (const id of buildAllGoalIds().slice(0, 10)) {
          getState().markGoalComplete(id);
        }
      });

      // Then
      expect(getState().completedGoalIds).toHaveLength(10);
      expect(getState().isCompleted).toBe(false);
    });

    it('should not change isCompleted when a duplicate goal is added after all goals are complete', () => {
      // Given — all goals already complete
      act(() => {
        for (const id of buildAllGoalIds()) {
          getState().markGoalComplete(id);
        }
      });
      expect(getState().isCompleted).toBe(true);

      // When — duplicate call
      act(() => {
        getState().markGoalComplete('goal-1');
      });

      // Then — still complete, no duplication
      expect(getState().completedGoalIds).toHaveLength(TUTORIAL_GOAL_COUNT);
      expect(getState().isCompleted).toBe(true);
    });
  });

  // =========================================================================
  // setInteractionFlag
  // =========================================================================

  describe('setInteractionFlag', () => {
    it('should set the specified flag to true in interactionFlags', () => {
      // When
      act(() => {
        getState().setInteractionFlag('set-language');
      });

      // Then
      expect(getState().interactionFlags['set-language']).toBe(true);
    });

    it('should not change state when setInteractionFlag is called twice with the same id', () => {
      // Given
      act(() => {
        getState().setInteractionFlag('explore-sidebar');
      });
      const flagsAfterFirst = getState().interactionFlags;

      // When
      act(() => {
        getState().setInteractionFlag('explore-sidebar');
      });

      // Then — reference identity check: no new object created on duplicate call
      expect(getState().interactionFlags).toBe(flagsAfterFirst);
    });

    it('should accumulate multiple distinct interaction flags', () => {
      // When
      act(() => {
        getState().setInteractionFlag('set-language');
        getState().setInteractionFlag('explore-sidebar');
      });

      // Then
      expect(getState().interactionFlags['set-language']).toBe(true);
      expect(getState().interactionFlags['explore-sidebar']).toBe(true);
    });

    it('should not overwrite existing flags when a new flag is set', () => {
      // Given
      act(() => {
        getState().setInteractionFlag('set-language');
      });

      // When
      act(() => {
        getState().setInteractionFlag('explore-sidebar');
      });

      // Then
      expect(getState().interactionFlags['set-language']).toBe(true);
    });
  });

  // =========================================================================
  // dismissTutorial
  // =========================================================================

  describe('dismissTutorial', () => {
    it('should set isDismissed to true', () => {
      // When
      act(() => {
        getState().dismissTutorial();
      });

      // Then
      expect(getState().isDismissed).toBe(true);
    });

    it('should collapse the FAB by setting isFabExpanded to false', () => {
      // Given — FAB is expanded
      useTutorialStore.setState({ isFabExpanded: true });
      expect(getState().isFabExpanded).toBe(true);

      // When
      act(() => {
        getState().dismissTutorial();
      });

      // Then
      expect(getState().isFabExpanded).toBe(false);
    });

    it('should leave completedGoalIds unchanged after dismiss', () => {
      // Given — some goals completed
      act(() => {
        getState().markGoalComplete('open-settings');
      });

      // When
      act(() => {
        getState().dismissTutorial();
      });

      // Then
      expect(getState().completedGoalIds).toContain('open-settings');
    });
  });

  // =========================================================================
  // resetTutorial
  // =========================================================================

  describe('resetTutorial', () => {
    it('should clear completedGoalIds to an empty array', () => {
      // Given
      act(() => {
        getState().markGoalComplete('open-settings');
      });

      // When
      act(() => {
        getState().resetTutorial();
      });

      // Then
      expect(getState().completedGoalIds).toEqual([]);
    });

    it('should clear interactionFlags to an empty object', () => {
      // Given
      act(() => {
        getState().setInteractionFlag('set-language');
      });

      // When
      act(() => {
        getState().resetTutorial();
      });

      // Then
      expect(getState().interactionFlags).toEqual({});
    });

    it('should reset isCompleted to false', () => {
      // Given — all goals completed
      act(() => {
        for (const id of buildAllGoalIds()) {
          getState().markGoalComplete(id);
        }
      });
      expect(getState().isCompleted).toBe(true);

      // When
      act(() => {
        getState().resetTutorial();
      });

      // Then
      expect(getState().isCompleted).toBe(false);
    });

    it('should reset isDismissed to false', () => {
      // Given
      act(() => {
        getState().dismissTutorial();
      });
      expect(getState().isDismissed).toBe(true);

      // When
      act(() => {
        getState().resetTutorial();
      });

      // Then
      expect(getState().isDismissed).toBe(false);
    });

    it('should reset isFabExpanded to false', () => {
      // Given
      useTutorialStore.setState({ isFabExpanded: true });

      // When
      act(() => {
        getState().resetTutorial();
      });

      // Then
      expect(getState().isFabExpanded).toBe(false);
    });

    it('should keep isActive as true after reset', () => {
      // Given
      useTutorialStore.setState({ isActive: false });

      // When
      act(() => {
        getState().resetTutorial();
      });

      // Then
      expect(getState().isActive).toBe(true);
    });
  });

  // =========================================================================
  // startTutorial
  // =========================================================================

  describe('startTutorial', () => {
    it('should clear completedGoalIds to an empty array', () => {
      // Given
      act(() => {
        getState().markGoalComplete('open-settings');
        getState().markGoalComplete('configure-provider');
      });

      // When
      act(() => {
        getState().startTutorial();
      });

      // Then
      expect(getState().completedGoalIds).toEqual([]);
    });

    it('should clear interactionFlags to an empty object', () => {
      // Given
      act(() => {
        getState().setInteractionFlag('set-language');
      });

      // When
      act(() => {
        getState().startTutorial();
      });

      // Then
      expect(getState().interactionFlags).toEqual({});
    });

    it('should set isActive to true', () => {
      // Given
      useTutorialStore.setState({ isActive: false });

      // When
      act(() => {
        getState().startTutorial();
      });

      // Then
      expect(getState().isActive).toBe(true);
    });

    it('should reset isCompleted to false', () => {
      // Given
      act(() => {
        for (const id of buildAllGoalIds()) {
          getState().markGoalComplete(id);
        }
      });
      expect(getState().isCompleted).toBe(true);

      // When
      act(() => {
        getState().startTutorial();
      });

      // Then
      expect(getState().isCompleted).toBe(false);
    });

    it('should reset isDismissed to false', () => {
      // Given
      act(() => {
        getState().dismissTutorial();
      });

      // When
      act(() => {
        getState().startTutorial();
      });

      // Then
      expect(getState().isDismissed).toBe(false);
    });

    it('should reset isFabExpanded to false', () => {
      // Given
      useTutorialStore.setState({ isFabExpanded: true });

      // When
      act(() => {
        getState().startTutorial();
      });

      // Then
      expect(getState().isFabExpanded).toBe(false);
    });
  });

  // =========================================================================
  // toggleFab
  // =========================================================================

  describe('toggleFab', () => {
    it('should set isFabExpanded to true when it is currently false', () => {
      // Given
      expect(getState().isFabExpanded).toBe(false);

      // When
      act(() => {
        getState().toggleFab();
      });

      // Then
      expect(getState().isFabExpanded).toBe(true);
    });

    it('should set isFabExpanded to false when it is currently true', () => {
      // Given
      useTutorialStore.setState({ isFabExpanded: true });

      // When
      act(() => {
        getState().toggleFab();
      });

      // Then
      expect(getState().isFabExpanded).toBe(false);
    });

    it('should toggle back to true on a second call', () => {
      // When
      act(() => {
        getState().toggleFab();
      });
      act(() => {
        getState().toggleFab();
      });

      // Then
      expect(getState().isFabExpanded).toBe(false);
    });

    it('should toggle through three consecutive calls', () => {
      // When
      act(() => {
        getState().toggleFab();
      }); // true
      expect(getState().isFabExpanded).toBe(true);

      act(() => {
        getState().toggleFab();
      }); // false
      expect(getState().isFabExpanded).toBe(false);

      act(() => {
        getState().toggleFab();
      }); // true
      expect(getState().isFabExpanded).toBe(true);
    });
  });

  // =========================================================================
  // State transitions
  // =========================================================================

  describe('state transitions', () => {
    it('should allow a dismissed tutorial to be restarted with startTutorial', () => {
      // Given — tutorial is dismissed
      act(() => {
        getState().dismissTutorial();
      });
      expect(getState().isDismissed).toBe(true);

      // When
      act(() => {
        getState().startTutorial();
      });

      // Then — tutorial is active again with clean state
      expect(getState().isDismissed).toBe(false);
      expect(getState().isActive).toBe(true);
      expect(getState().completedGoalIds).toEqual([]);
    });

    it('should reflect markGoalComplete progress before isCompleted becomes true', () => {
      // When — add goals one by one up to the threshold
      const allGoals = buildAllGoalIds();

      allGoals.slice(0, TUTORIAL_GOAL_COUNT - 1).forEach(id => {
        act(() => {
          getState().markGoalComplete(id);
        });
        expect(getState().isCompleted).toBe(false);
      });

      // When — add the final goal
      act(() => {
        getState().markGoalComplete(allGoals[TUTORIAL_GOAL_COUNT - 1]);
      });

      // Then
      expect(getState().isCompleted).toBe(true);
    });

    it('should preserve interactionFlags across markGoalComplete calls', () => {
      // Given
      act(() => {
        getState().setInteractionFlag('explore-sidebar');
      });

      // When
      act(() => {
        getState().markGoalComplete('open-settings');
      });

      // Then
      expect(getState().interactionFlags['explore-sidebar']).toBe(true);
    });

    it('should preserve completedGoalIds across setInteractionFlag calls', () => {
      // Given
      act(() => {
        getState().markGoalComplete('open-settings');
      });

      // When
      act(() => {
        getState().setInteractionFlag('set-language');
      });

      // Then
      expect(getState().completedGoalIds).toContain('open-settings');
    });
  });

  // =========================================================================
  // loadTutorialProgress
  // =========================================================================

  describe('loadTutorialProgress', () => {
    it('should load progress from IDB appSettings when a valid JSON record exists', async () => {
      // Arrange
      const storedProgress = buildTutorialProgressJson({
        completedGoalIds: ['open-settings', 'configure-provider'],
        interactionFlags: { 'set-language': true },
        isActive: true,
        isFabExpanded: true,
        isCompleted: false,
        isDismissed: false,
      });
      mockGetAppSetting.mockResolvedValue(storedProgress);

      // Act
      await act(async () => {
        await getState().loadTutorialProgress();
      });

      // Assert
      expect(mockGetAppSetting).toHaveBeenCalledWith('tutorial-progress');
      expect(getState().completedGoalIds).toEqual(['open-settings', 'configure-provider']);
      expect(getState().interactionFlags).toEqual({ 'set-language': true });
      expect(getState().isFabExpanded).toBe(true);
      expect(getState().isCompleted).toBe(false);
      expect(getState().isDismissed).toBe(false);
    });

    it('should keep default state when IDB returns null', async () => {
      // Arrange — store already at defaults from beforeEach reset
      mockGetAppSetting.mockResolvedValue(null);

      // Act
      await act(async () => {
        await getState().loadTutorialProgress();
      });

      // Assert — defaults unchanged
      expect(getState().completedGoalIds).toEqual([]);
      expect(getState().interactionFlags).toEqual({});
      expect(getState().isActive).toBe(true);
      expect(getState().isFabExpanded).toBe(false);
      expect(getState().isCompleted).toBe(false);
      expect(getState().isDismissed).toBe(false);
    });

    it('should use default state and not throw when IDB returns malformed JSON', async () => {
      // Arrange
      mockGetAppSetting.mockResolvedValue('{ not valid json <<<');

      // Act — must not throw
      await act(async () => {
        await getState().loadTutorialProgress();
      });

      // Assert — defaults applied
      expect(getState().completedGoalIds).toEqual([]);
      expect(getState().interactionFlags).toEqual({});
      expect(getState().isActive).toBe(true);
      expect(getState().isDismissed).toBe(false);
    });

    it('should clear progress and write tutorial-reset-v024=true when flag is false (one-shot reset)', async () => {
      // Arrange
      mockGetTutorialResetV024.mockResolvedValue(false);
      useTutorialStore.setState({
        completedGoalIds: ['open-settings'],
        interactionFlags: { 'set-language': true },
      });

      // Act
      await act(async () => {
        await getState().loadTutorialProgress();
      });

      // Assert — state cleared
      expect(getState().completedGoalIds).toEqual([]);
      expect(getState().interactionFlags).toEqual({});
      // reset flag written
      expect(mockPutTutorialResetV024).toHaveBeenCalledWith(true);
      // legacy load skipped — getAppSetting not called with the storage key
      expect(mockGetAppSetting).not.toHaveBeenCalledWith('tutorial-progress');
    });

    it('should follow legacy load path when tutorial-reset-v024 is already true (idempotent)', async () => {
      // Arrange
      mockGetTutorialResetV024.mockResolvedValue(true);
      mockGetAppSetting.mockResolvedValue(
        buildTutorialProgressJson({ completedGoalIds: ['open-settings'] })
      );

      // Act
      await act(async () => {
        await getState().loadTutorialProgress();
      });

      // Assert — legacy data loaded
      expect(getState().completedGoalIds).toEqual(['open-settings']);
      // reset flag NOT re-written
      expect(mockPutTutorialResetV024).not.toHaveBeenCalled();
    });

    it('should swallow errors from putTutorialResetV024 and keep defaults', async () => {
      // Arrange
      mockGetTutorialResetV024.mockResolvedValue(false);
      mockPutTutorialResetV024.mockRejectedValueOnce(new Error('IDB write fail'));

      // Act — must not throw
      await act(async () => {
        await getState().loadTutorialProgress();
      });

      // Assert — state reset to empty (the set() call happens before the failing put)
      expect(getState().completedGoalIds).toEqual([]);
      expect(getState().interactionFlags).toEqual({});
    });
  });

  // =========================================================================
  // IDB persistence
  // =========================================================================

  describe('IDB persistence', () => {
    it('should persist to IDB when marking a goal complete', () => {
      // Act
      act(() => {
        getState().markGoalComplete('open-settings');
      });

      // Assert
      expect(mockPutAppSetting).toHaveBeenCalledWith(
        'tutorial-progress',
        expect.stringContaining('"open-settings"')
      );
    });

    it('should persist to IDB when dismissing the tutorial', () => {
      // Act
      act(() => {
        getState().dismissTutorial();
      });

      // Assert
      expect(mockPutAppSetting).toHaveBeenCalledWith(
        'tutorial-progress',
        expect.stringContaining('"isDismissed":true')
      );
    });

    it('should persist to IDB when resetting the tutorial', () => {
      // Arrange — put store in dirty state so we can confirm reset is written
      useTutorialStore.setState({ isDismissed: true, completedGoalIds: ['open-settings'] });
      mockPutAppSetting.mockClear();

      // Act
      act(() => {
        getState().resetTutorial();
      });

      // Assert — persisted with cleared completedGoalIds
      expect(mockPutAppSetting).toHaveBeenCalledWith(
        'tutorial-progress',
        expect.stringContaining('"completedGoalIds":[]')
      );
    });

    it('should persist to IDB when toggling the FAB', () => {
      // Act
      act(() => {
        getState().toggleFab();
      });

      // Assert
      expect(mockPutAppSetting).toHaveBeenCalledWith(
        'tutorial-progress',
        expect.stringContaining('"isFabExpanded":true')
      );
    });

    it('should persist to IDB when starting the tutorial', () => {
      // Arrange — put store in a non-default state
      useTutorialStore.setState({ isDismissed: true, isCompleted: true });
      mockPutAppSetting.mockClear();

      // Act
      act(() => {
        getState().startTutorial();
      });

      // Assert
      expect(mockPutAppSetting).toHaveBeenCalledWith(
        'tutorial-progress',
        expect.stringContaining('"isDismissed":false')
      );
    });

    it('should persist to IDB when setting an interaction flag', () => {
      // Act
      act(() => {
        getState().setInteractionFlag('set-language');
      });

      // Assert
      expect(mockPutAppSetting).toHaveBeenCalledWith(
        'tutorial-progress',
        expect.stringContaining('"set-language":true')
      );
    });

    it('should not persist to IDB when markGoalComplete is called with a duplicate goal id', () => {
      // Arrange — goal already added
      act(() => {
        getState().markGoalComplete('open-settings');
      });
      mockPutAppSetting.mockClear();

      // Act
      act(() => {
        getState().markGoalComplete('open-settings');
      });

      // Assert — early-return branch: no write on duplicate
      expect(mockPutAppSetting).not.toHaveBeenCalled();
    });

    it('should not persist to IDB when setInteractionFlag is called with an already-set flag', () => {
      // Arrange
      act(() => {
        getState().setInteractionFlag('set-language');
      });
      mockPutAppSetting.mockClear();

      // Act
      act(() => {
        getState().setInteractionFlag('set-language');
      });

      // Assert — early-return branch: no write on duplicate
      expect(mockPutAppSetting).not.toHaveBeenCalled();
    });
  });
});
