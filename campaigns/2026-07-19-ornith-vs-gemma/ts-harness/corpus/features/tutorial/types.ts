import type { Workspace } from '@/stores/useUIStore';

export type TutorialGoalId =
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
  | 'explore-sidebar';

export interface AppStateSnapshot {
  readonly activeDialog: string | null;
  readonly workspace: Workspace;
  readonly activeProviderId: string | null;
  readonly activeModelId: string | null;
  readonly defaultContainerId: string | null;
  readonly hasUserMessage: boolean;
  readonly sessionCount: number;
  readonly hasCustomSkill: boolean;
  readonly hasPopulatedContainer: boolean;
  readonly interactionFlags: Readonly<Record<string, boolean>>;
}

export interface TutorialGoal {
  readonly id: TutorialGoalId;
  readonly title: string;
  readonly description: string;
  readonly order: number;
  readonly predicate: (snapshot: AppStateSnapshot) => boolean;
}

export interface TutorialProgress {
  readonly completedGoalIds: readonly string[];
  readonly interactionFlags: Readonly<Record<string, boolean>>;
  readonly isActive: boolean;
  readonly isFabExpanded: boolean;
  readonly isCompleted: boolean;
  readonly isDismissed: boolean;
}
