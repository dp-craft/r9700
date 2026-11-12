import { useEffect } from 'react';

import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { useSkillStore } from '@/features/skills';
import { useUIStore } from '@/stores/useUIStore';

import { TUTORIAL_GOALS } from '../constants';
import { useTutorialStore } from '../stores/useTutorialStore';
import type { AppStateSnapshot } from '../types';

function buildSnapshot(): AppStateSnapshot {
  const ui = useUIStore.getState();
  const settings = useSettingsStore.getState();
  const sessions = useSessionStore.getState();
  const skills = useSkillStore.getState();
  const tutorial = useTutorialStore.getState();

  const hasExplicitProviderConfig = Object.keys(settings.providerConfigs).length > 0;

  return {
    activeDialog: ui.activeDialog,
    workspace: ui.workspace,
    activeProviderId: hasExplicitProviderConfig ? settings.activeProviderId : null,
    activeModelId: settings.activeModelId || null,
    defaultContainerId: settings.defaultContainerId,
    hasUserMessage: sessions.messages.some(m => m.role === 'user'),
    sessionCount: sessions.sessionList.length,
    hasCustomSkill: skills.skills.some(s => s.type === 'custom'),
    hasPopulatedContainer: skills.containers.some(c => c.skillIds.length > 0),
    interactionFlags: tutorial.interactionFlags,
  };
}

function evaluateGoals(): void {
  const { completedGoalIds, isActive, isDismissed, markGoalComplete } = useTutorialStore.getState();

  if (!isActive || isDismissed) return;

  const snapshot = buildSnapshot();

  const goalsToComplete = TUTORIAL_GOALS.filter(goal => !completedGoalIds.includes(goal.id)).filter(
    goal => goal.predicate(snapshot)
  );
  for (const goal of goalsToComplete) {
    markGoalComplete(goal.id);
  }
}

function createTutorialObserver(): () => void {
  // Capture initial language to detect explicit user changes (not default locale)
  const initialUiLanguage = useSettingsStore.getState().uiLanguage;

  const detectInteractionFlags = (): void => {
    const { isActive, isDismissed } = useTutorialStore.getState();
    if (!isActive || isDismissed) return;

    const settings = useSettingsStore.getState();
    const sessions = useSessionStore.getState();
    const { interactionFlags, setInteractionFlag } = useTutorialStore.getState();

    if (!interactionFlags['set-language'] && settings.uiLanguage !== initialUiLanguage) {
      setInteractionFlag('set-language');
    }

    if (
      !interactionFlags['explore-sidebar'] &&
      sessions.activeSessionId !== null &&
      sessions.sessionList.length > 1
    ) {
      setInteractionFlag('explore-sidebar');
    }
  };

  const unsubUI = useUIStore.subscribe(
    s => s.activeDialog,
    () => evaluateGoals()
  );

  const unsubUIPage = useUIStore.subscribe(
    s => s.workspace,
    () => evaluateGoals()
  );

  const unsubSettings = useSettingsStore.subscribe(() => {
    detectInteractionFlags();
    evaluateGoals();
  });

  const unsubSessions = useSessionStore.subscribe(() => {
    detectInteractionFlags();
    evaluateGoals();
  });

  const unsubSkills = useSkillStore.subscribe(() => evaluateGoals());

  // Initial evaluation for pre-existing state
  detectInteractionFlags();
  evaluateGoals();

  return (): void => {
    unsubUI();
    unsubUIPage();
    unsubSettings();
    unsubSessions();
    unsubSkills();
  };
}

export function useTutorialObserver(): void {
  const isActive = useTutorialStore(s => s.isActive);
  const isDismissed = useTutorialStore(s => s.isDismissed);

  // useEffect: subscribe — attach Zustand cross-store observer (UI/settings/sessions/skills) when tutorial is active; cleanup unsubscribes all four listeners
  useEffect(() => {
    if (!isActive || isDismissed) return undefined;

    const cleanup = createTutorialObserver();
    return cleanup;
  }, [isActive, isDismissed]);
}
