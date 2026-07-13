import type { SkillCategory, SkillType } from '@/domain/entities';

export type { SkillCategory };

/** View model for a skill list item */
export interface SkillListItemVM {
  readonly id: string;
  readonly name: string;
  readonly type: SkillType;
  readonly category: SkillCategory | null;
  readonly commandPrefix: string | null;
  readonly description: string | null;
}

/** View model for the skill editor form */
export interface SkillEditorVM {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly type: SkillType;
  readonly category: SkillCategory | null;
  readonly commandPrefix: string | null;
  readonly description: string | null;
}

/** View model for a container list item */
export interface ContainerListItemVM {
  readonly id: string;
  readonly name: string;
  readonly skillCount: number;
}

/** View model for a sortable skill item in the container editor */
export interface SortableSkillItemVM {
  readonly id: string;
  readonly name: string;
  readonly category: SkillCategory | null;
  readonly hasOrderingIssue: boolean;
}

/** View model for composed prompt preview */
export interface ComposedPromptVM {
  readonly text: string;
  readonly tokenCount: number;
  readonly exceedsSoftLimit: boolean;
  readonly exceedsHardLimit: boolean;
}

/** View model for session skill indicator */
export interface SessionSkillIndicatorVM {
  readonly containerName: string | null;
  readonly skillNames: readonly string[];
  readonly tokenCount: number;
  readonly hasSkills: boolean;
}

/** View model for command autocomplete suggestion */
export interface CommandSuggestionVM {
  readonly prefix: string;
  readonly skillName: string;
  readonly skillId: string;
}

/** Active tab on the Skills page */
export type SkillsTab = 'skills' | 'containers';
