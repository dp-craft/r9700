import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useFeatureFlagStore } from '@/features/settings';
import { useTranslation } from '@/i18n';

import { TutorialChecklist } from '../components/TutorialChecklist';
import type { TutorialChecklistItemProps } from '../components/TutorialChecklistItem';
import { TutorialFab } from '../components/TutorialFab';
import { TUTORIAL_GOAL_COUNT, TUTORIAL_GOALS } from '../constants';
import { useTutorialObserver } from '../hooks/useTutorialObserver';
import { useTutorialStore } from '../stores/useTutorialStore';

const CELEBRATION_AUTO_HIDE_MS = 3000;

function buildChecklistItems(
  completedGoalIds: readonly string[]
): readonly TutorialChecklistItemProps[] {
  const firstIncompleteId = TUTORIAL_GOALS.find(g => !completedGoalIds.includes(g.id))?.id;

  return TUTORIAL_GOALS.map(goal => ({
    id: goal.id,
    title: goal.title,
    description: goal.description,
    isCompleted: completedGoalIds.includes(goal.id),
    isHighlighted: goal.id === firstIncompleteId,
  }));
}

export function TutorialContainer(): React.ReactElement | null {
  const t = useTranslation();
  const isFlagEnabled = useFeatureFlagStore(s => s.getFlag('tutorial-enabled'));
  const isActive = useTutorialStore(s => s.isActive);
  const isDismissed = useTutorialStore(s => s.isDismissed);
  const isCompleted = useTutorialStore(s => s.isCompleted);
  const isFabExpanded = useTutorialStore(s => s.isFabExpanded);
  const completedGoalIds = useTutorialStore(s => s.completedGoalIds);
  const toggleFab = useTutorialStore(s => s.toggleFab);
  const dismissTutorial = useTutorialStore(s => s.dismissTutorial);
  const resetTutorial = useTutorialStore(s => s.resetTutorial);

  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useTutorialObserver();

  // Auto-hide after celebration
  // useEffect: cleanup — celebration auto-hide timer with clear on unmount
  useEffect(() => {
    if (isCompleted && isFabExpanded) {
      celebrationTimerRef.current = setTimeout(() => {
        dismissTutorial();
      }, CELEBRATION_AUTO_HIDE_MS);
    }

    return (): void => {
      if (celebrationTimerRef.current !== null) {
        clearTimeout(celebrationTimerRef.current);
        celebrationTimerRef.current = null;
      }
    };
  }, [isCompleted, isFabExpanded, dismissTutorial]);

  const handleClose = useCallback((): void => {
    toggleFab();
  }, [toggleFab]);

  const checklistLabels = useMemo(
    () => ({
      closeTutorial: t('tutorial.closeTutorial'),
      tutorialGoals: t('tutorial.tutorialGoals'),
      allGoalsCompleted: t('tutorial.allGoalsCompleted'),
      dismiss: t('tutorial.dismiss'),
      restart: t('tutorial.restart'),
      checklistAria: t('tutorial.checklistAria'),
      title: t('tutorial.title'),
      itemCompleted: t('tutorial.itemCompleted'),
      itemPending: t('tutorial.itemPending'),
    }),
    [t]
  );

  if (!isFlagEnabled || isDismissed) return null;
  if (!isActive) return null;

  const completedCount = completedGoalIds.length;
  const items = buildChecklistItems(completedGoalIds);

  if (isFabExpanded) {
    return (
      <div className="fixed right-4 top-20 z-40">
        <TutorialChecklist
          items={items}
          completedCount={completedCount}
          totalCount={TUTORIAL_GOAL_COUNT}
          isCompleted={isCompleted}
          onDismiss={dismissTutorial}
          onRestart={resetTutorial}
          onClose={handleClose}
          labels={checklistLabels}
        />
      </div>
    );
  }

  return (
    <TutorialFab
      completedCount={completedCount}
      totalCount={TUTORIAL_GOAL_COUNT}
      onToggle={toggleFab}
      ariaLabel={t('tutorial.fabAria', {
        completed: completedCount,
        total: TUTORIAL_GOAL_COUNT,
      })}
    />
  );
}
