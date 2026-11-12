import { describe, expect, it } from 'vitest';

import { TUTORIAL_GOAL_COUNT, TUTORIAL_GOALS, TUTORIAL_STORAGE_KEY } from '../constants';
import type { AppStateSnapshot, TutorialGoalId } from '../types';

// -- Builders --

const buildEmptySnapshot = (): AppStateSnapshot => ({
  activeDialog: null,
  workspace: 'chat',
  activeProviderId: null,
  activeModelId: null,
  defaultContainerId: null,
  hasUserMessage: false,
  sessionCount: 0,
  hasCustomSkill: false,
  hasPopulatedContainer: false,
  interactionFlags: {},
});

// -- Helpers --

const findGoal = (id: TutorialGoalId) => {
  const goal = TUTORIAL_GOALS.find(g => g.id === id);
  if (!goal) throw new Error(`Goal '${id}' not found in TUTORIAL_GOALS`);
  return goal;
};

// ===========================================================================
// Test Suite
// ===========================================================================

describe('tutorial constants', () => {
  // =========================================================================
  // TUTORIAL_GOAL_COUNT
  // =========================================================================

  describe('TUTORIAL_GOAL_COUNT', () => {
    it('should equal 11', () => {
      expect(TUTORIAL_GOAL_COUNT).toBe(11);
    });
  });

  // =========================================================================
  // TUTORIAL_STORAGE_KEY
  // =========================================================================

  describe('TUTORIAL_STORAGE_KEY', () => {
    it('should be tutorial-progress', () => {
      expect(TUTORIAL_STORAGE_KEY).toBe('tutorial-progress');
    });
  });

  // =========================================================================
  // TUTORIAL_GOALS — structural integrity
  // =========================================================================

  describe('TUTORIAL_GOALS', () => {
    it('should have exactly 11 entries', () => {
      expect(TUTORIAL_GOALS).toHaveLength(11);
    });

    it('should have a length matching TUTORIAL_GOAL_COUNT', () => {
      expect(TUTORIAL_GOALS).toHaveLength(TUTORIAL_GOAL_COUNT);
    });

    it('should have unique goal ids', () => {
      const ids = TUTORIAL_GOALS.map(g => g.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have non-empty title for every goal', () => {
      TUTORIAL_GOALS.forEach(goal => {
        expect(goal.title.trim().length).toBeGreaterThan(0);
      });
    });

    it('should have non-empty description for every goal', () => {
      TUTORIAL_GOALS.forEach(goal => {
        expect(goal.description.trim().length).toBeGreaterThan(0);
      });
    });

    it('should have sequential order values from 1 to 11', () => {
      const orders = TUTORIAL_GOALS.map(g => g.order).sort((a, b) => a - b);

      expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('should have a predicate function on every goal', () => {
      TUTORIAL_GOALS.forEach(goal => {
        expect(typeof goal.predicate).toBe('function');
      });
    });
  });

  // =========================================================================
  // Predicate — returns false with empty snapshot (negative case)
  // =========================================================================

  describe('predicates with empty snapshot', () => {
    it('should return false for every goal when snapshot is empty', () => {
      const empty = buildEmptySnapshot();

      TUTORIAL_GOALS.forEach(goal => {
        expect(goal.predicate(empty)).toBe(false);
      });
    });
  });

  // =========================================================================
  // Predicate — open-settings
  // =========================================================================

  describe('open-settings predicate', () => {
    it('should return true when activeDialog is settings', () => {
      const snapshot = { ...buildEmptySnapshot(), activeDialog: 'settings' };

      const result = findGoal('open-settings').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when activeDialog is a different dialog', () => {
      const snapshot = { ...buildEmptySnapshot(), activeDialog: 'prompt-tester' };

      expect(findGoal('open-settings').predicate(snapshot)).toBe(false);
    });

    it('should return false when activeDialog is null', () => {
      expect(findGoal('open-settings').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — configure-provider
  // =========================================================================

  describe('configure-provider predicate', () => {
    it('should return true when activeProviderId is non-null', () => {
      const snapshot = { ...buildEmptySnapshot(), activeProviderId: 'ollama' };

      const result = findGoal('configure-provider').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when activeProviderId is null', () => {
      expect(findGoal('configure-provider').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — select-model
  // =========================================================================

  describe('select-model predicate', () => {
    it('should return true when activeModelId is non-null', () => {
      const snapshot = { ...buildEmptySnapshot(), activeModelId: 'llama3' };

      const result = findGoal('select-model').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when activeModelId is null', () => {
      expect(findGoal('select-model').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — set-language
  // =========================================================================

  describe('set-language predicate', () => {
    it('should return true when interactionFlags[set-language] is true', () => {
      const snapshot = {
        ...buildEmptySnapshot(),
        interactionFlags: { 'set-language': true },
      };

      const result = findGoal('set-language').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when interactionFlags[set-language] is false', () => {
      const snapshot = {
        ...buildEmptySnapshot(),
        interactionFlags: { 'set-language': false },
      };

      expect(findGoal('set-language').predicate(snapshot)).toBe(false);
    });

    it('should return false when interactionFlags is empty', () => {
      expect(findGoal('set-language').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — send-message
  // =========================================================================

  describe('send-message predicate', () => {
    it('should return true when hasUserMessage is true', () => {
      const snapshot = { ...buildEmptySnapshot(), hasUserMessage: true };

      const result = findGoal('send-message').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when hasUserMessage is false', () => {
      expect(findGoal('send-message').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — create-session
  // =========================================================================

  describe('create-session predicate', () => {
    it('should return true when sessionCount is greater than 1', () => {
      const snapshot = { ...buildEmptySnapshot(), sessionCount: 2 };

      const result = findGoal('create-session').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when sessionCount is exactly 1', () => {
      const snapshot = { ...buildEmptySnapshot(), sessionCount: 1 };

      expect(findGoal('create-session').predicate(snapshot)).toBe(false);
    });

    it('should return false when sessionCount is 0', () => {
      expect(findGoal('create-session').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — create-skill
  // =========================================================================

  describe('create-skill predicate', () => {
    it('should return true when hasCustomSkill is true', () => {
      const snapshot = { ...buildEmptySnapshot(), hasCustomSkill: true };

      const result = findGoal('create-skill').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when hasCustomSkill is false', () => {
      expect(findGoal('create-skill').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — build-container
  // =========================================================================

  describe('build-container predicate', () => {
    it('should return true when hasPopulatedContainer is true', () => {
      const snapshot = { ...buildEmptySnapshot(), hasPopulatedContainer: true };

      const result = findGoal('build-container').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when hasPopulatedContainer is false', () => {
      expect(findGoal('build-container').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — test-skill-setup
  // =========================================================================

  describe('test-skill-setup predicate', () => {
    it('should return true when defaultContainerId is non-null', () => {
      const snapshot = { ...buildEmptySnapshot(), defaultContainerId: 'container-1' };

      const result = findGoal('test-skill-setup').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when defaultContainerId is null', () => {
      expect(findGoal('test-skill-setup').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — explore-prompt-tester
  // =========================================================================

  describe('explore-prompt-tester predicate', () => {
    it('should return true when workspace is prompt-lab', () => {
      // Given: workspace field is 'prompt-lab' (renamed from activePage)
      const snapshot = { ...buildEmptySnapshot(), workspace: 'prompt-lab' as const };

      const result = findGoal('explore-prompt-tester').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when workspace is chat', () => {
      const snapshot = { ...buildEmptySnapshot(), workspace: 'chat' as const };

      expect(findGoal('explore-prompt-tester').predicate(snapshot)).toBe(false);
    });

    it('should return false when workspace is chat (empty snapshot default)', () => {
      expect(findGoal('explore-prompt-tester').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — explore-sidebar
  // =========================================================================

  describe('explore-sidebar predicate', () => {
    it('should return true when interactionFlags[explore-sidebar] is true', () => {
      const snapshot = {
        ...buildEmptySnapshot(),
        interactionFlags: { 'explore-sidebar': true },
      };

      const result = findGoal('explore-sidebar').predicate(snapshot);

      expect(result).toBe(true);
    });

    it('should return false when interactionFlags[explore-sidebar] is false', () => {
      const snapshot = {
        ...buildEmptySnapshot(),
        interactionFlags: { 'explore-sidebar': false },
      };

      expect(findGoal('explore-sidebar').predicate(snapshot)).toBe(false);
    });

    it('should return false when interactionFlags is empty', () => {
      expect(findGoal('explore-sidebar').predicate(buildEmptySnapshot())).toBe(false);
    });
  });

  // =========================================================================
  // Predicate — isolation: unrelated flags do not trigger predicate
  // =========================================================================

  describe('predicate isolation', () => {
    it('should not trigger set-language predicate when only explore-sidebar flag is set', () => {
      const snapshot = {
        ...buildEmptySnapshot(),
        interactionFlags: { 'explore-sidebar': true },
      };

      expect(findGoal('set-language').predicate(snapshot)).toBe(false);
    });

    it('should not trigger open-settings predicate when activeDialog is prompt-tester', () => {
      const snapshot = { ...buildEmptySnapshot(), activeDialog: 'prompt-tester' };

      expect(findGoal('open-settings').predicate(snapshot)).toBe(false);
    });

    it('should not trigger create-session predicate when sessionCount is exactly 1', () => {
      const snapshot = { ...buildEmptySnapshot(), sessionCount: 1 };

      expect(findGoal('create-session').predicate(snapshot)).toBe(false);
    });
  });
});
