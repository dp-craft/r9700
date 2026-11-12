import { describe, expectTypeOf, it } from 'vitest';

import type { AppStateSnapshot, TutorialGoal, TutorialGoalId, TutorialProgress } from '../types';

describe('tutorial goal types', () => {
  it('should accept valid TutorialGoalId string literals', () => {
    expectTypeOf<TutorialGoalId>().toEqualTypeOf<
      | 'open-settings'
      | 'configure-provider'
      | 'select-model'
      | 'set-language'
      | 'send-message'
      | 'create-session'
      | 'create-skill'
      | 'build-container'
      | 'test-skill-setup'
      | 'explore-prompt-tester'
      | 'explore-sidebar'
    >();
  });

  it('should have correct field types on AppStateSnapshot', () => {
    expectTypeOf<AppStateSnapshot>().toHaveProperty('activeDialog').toEqualTypeOf<string | null>();
    expectTypeOf<AppStateSnapshot>()
      .toHaveProperty('activeProviderId')
      .toEqualTypeOf<string | null>();
    expectTypeOf<AppStateSnapshot>().toHaveProperty('activeModelId').toEqualTypeOf<string | null>();
    expectTypeOf<AppStateSnapshot>()
      .toHaveProperty('defaultContainerId')
      .toEqualTypeOf<string | null>();
    expectTypeOf<AppStateSnapshot>().toHaveProperty('hasUserMessage').toEqualTypeOf<boolean>();
    expectTypeOf<AppStateSnapshot>().toHaveProperty('sessionCount').toEqualTypeOf<number>();
    expectTypeOf<AppStateSnapshot>().toHaveProperty('hasCustomSkill').toEqualTypeOf<boolean>();
    expectTypeOf<AppStateSnapshot>()
      .toHaveProperty('hasPopulatedContainer')
      .toEqualTypeOf<boolean>();
    expectTypeOf<AppStateSnapshot>()
      .toHaveProperty('interactionFlags')
      .toEqualTypeOf<Readonly<Record<string, boolean>>>();
  });

  it('should have all required fields on TutorialGoal', () => {
    expectTypeOf<TutorialGoal>().toHaveProperty('id').toEqualTypeOf<TutorialGoalId>();
    expectTypeOf<TutorialGoal>().toHaveProperty('title').toEqualTypeOf<string>();
    expectTypeOf<TutorialGoal>().toHaveProperty('description').toEqualTypeOf<string>();
    expectTypeOf<TutorialGoal>().toHaveProperty('order').toEqualTypeOf<number>();
  });

  it('should have a predicate function mapping AppStateSnapshot to boolean on TutorialGoal', () => {
    expectTypeOf<TutorialGoal>()
      .toHaveProperty('predicate')
      .toEqualTypeOf<(snapshot: AppStateSnapshot) => boolean>();
  });

  it('should have all required fields with correct types on TutorialProgress', () => {
    expectTypeOf<TutorialProgress>()
      .toHaveProperty('completedGoalIds')
      .toEqualTypeOf<readonly string[]>();
    expectTypeOf<TutorialProgress>()
      .toHaveProperty('interactionFlags')
      .toEqualTypeOf<Readonly<Record<string, boolean>>>();
    expectTypeOf<TutorialProgress>().toHaveProperty('isActive').toEqualTypeOf<boolean>();
    expectTypeOf<TutorialProgress>().toHaveProperty('isFabExpanded').toEqualTypeOf<boolean>();
    expectTypeOf<TutorialProgress>().toHaveProperty('isCompleted').toEqualTypeOf<boolean>();
    expectTypeOf<TutorialProgress>().toHaveProperty('isDismissed').toEqualTypeOf<boolean>();
  });
});
