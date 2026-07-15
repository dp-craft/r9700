import { create } from 'zustand';

import {
  getAppSetting,
  getTutorialResetV024,
  putAppSetting,
  putTutorialResetV024
} from '@/db/appSettings';

import { TUTORIAL_GOAL_COUNT, TUTORIAL_STORAGE_KEY } from '../constants';
import type { TutorialProgress } from '../types';

interface TutorialActions {
  readonly markGoalComplete: (goalId: string) => void;
  readonly setInteractionFlag: (goalId: string) => void;
  readonly startTutorial: () => void;
  readonly dismissTutorial: () => void;
  readonly resetTutorial: () => void;
  readonly toggleFab: () => void;
  readonly loadTutorialProgress: () => Promise<void>;
}

export type TutorialState = TutorialProgress & TutorialActions;

const buildDefaultState = (): TutorialProgress => ({
  completedGoalIds: [],
  interactionFlags: {},
  isActive: true,
  isFabExpanded: false,
  isCompleted: false,
  isDismissed: false,
});

const saveTutorialProgress = (state: TutorialProgress): void => {
  const json = JSON.stringify({
    completedGoalIds: state.completedGoalIds,
    interactionFlags: state.interactionFlags,
    isActive: state.isActive,
    isFabExpanded: state.isFabExpanded,
    isCompleted: state.isCompleted,
    isDismissed: state.isDismissed,
  });
  void putAppSetting(TUTORIAL_STORAGE_KEY, json);
};

const parseProgressField = <T>(value: unknown, guard: (v: unknown) => v is T, fallback: T): T =>
  guard(value) ? value : fallback;

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

const isStringArray = (v: unknown): v is readonly string[] => Array.isArray(v);

const isRecord = (v: unknown): v is Readonly<Record<string, boolean>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const useTutorialStore = create<TutorialState>()((set, get) => ({
  ...buildDefaultState(),

  markGoalComplete: (goalId: string): void => {
    const { completedGoalIds } = get();
    if (completedGoalIds.includes(goalId)) return;

    const updated = [...completedGoalIds, goalId];
    set({
      completedGoalIds: updated,
      isCompleted: updated.length >= TUTORIAL_GOAL_COUNT,
    });
    saveTutorialProgress(get());
  },

  setInteractionFlag: (goalId: string): void => {
    const { interactionFlags } = get();
    if (interactionFlags[goalId] === true) return;

    set({
      interactionFlags: { ...interactionFlags, [goalId]: true },
    });
    saveTutorialProgress(get());
  },

  startTutorial: (): void => {
    set({
      ...buildDefaultState(),
      isActive: true,
    });
    saveTutorialProgress(get());
  },

  dismissTutorial: (): void => {
    set({ isDismissed: true, isFabExpanded: false });
    saveTutorialProgress(get());
  },

  resetTutorial: (): void => {
    set(buildDefaultState());
    saveTutorialProgress(get());
  },

  toggleFab: (): void => {
    set({ isFabExpanded: !get().isFabExpanded });
    saveTutorialProgress(get());
  },

  loadTutorialProgress: async (): Promise<void> => {
    try {
      const resetDone = await getTutorialResetV024();
      if (!resetDone) {
        set({ completedGoalIds: [], interactionFlags: {} });
        await putTutorialResetV024(true);
        return;
      }

      const raw = await getAppSetting(TUTORIAL_STORAGE_KEY);
      if (raw === null) return;

      const parsed = JSON.parse(raw) as Partial<TutorialProgress>;
      set({
        completedGoalIds: parseProgressField(parsed.completedGoalIds, isStringArray, []),
        interactionFlags: parseProgressField(parsed.interactionFlags, isRecord, {}),
        isActive: parseProgressField(parsed.isActive, isBoolean, true),
        isFabExpanded: parseProgressField(parsed.isFabExpanded, isBoolean, false),
        isCompleted: parseProgressField(parsed.isCompleted, isBoolean, false),
        isDismissed: parseProgressField(parsed.isDismissed, isBoolean, false),
      });
    } catch {
      // Malformed JSON or IDB error — use defaults
    }
  },
}));
