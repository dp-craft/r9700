import { castDraft } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { CreateContainerInput, UpdateContainerInput } from '@/db/containers';
import {
  createContainer as dbCreateContainer,
  deleteContainer as dbDeleteContainer,
  getAllContainers,
  removeSkillFromAllContainers,
  updateContainer as dbUpdateContainer } from '@/db/containers';
import type { CreateSkillInput, UpdateSkillInput } from '@/db/skills';
import {
  createSkill as dbCreateSkill,
  deleteSkill as dbDeleteSkill,
  duplicateSkill as dbDuplicateSkill,
  getAllSkills,
  updateSkill as dbUpdateSkill } from '@/db/skills';
import type { AtomicSkillDTO, SkillContainerDTO } from '@/domain/entities';
import type { ComposedPrompt, OrderingIssue } from '@/lib/prompt-composer';
import { composePrompt, detectOrderingIssues, EMPTY_COMPOSED_PROMPT } from '@/lib/prompt-composer';

import type { SkillsTab } from '../types';

interface SkillStoreState {
  readonly activeTab: SkillsTab;
  readonly selectedSkillId: string | null;
  readonly selectedContainerId: string | null;
  readonly skills: readonly AtomicSkillDTO[];
  readonly containers: readonly SkillContainerDTO[];

  setActiveTab: (tab: SkillsTab) => void;
  selectSkill: (id: string | null) => void;
  selectContainer: (id: string | null) => void;

  loadSkills: () => Promise<void>;
  createSkill: (input: CreateSkillInput) => Promise<void>;
  updateSkill: (id: string, input: UpdateSkillInput) => Promise<void>;
  deleteSkill: (id: string) => Promise<readonly string[]>;
  duplicateSkill: (id: string) => Promise<void>;

  loadContainers: () => Promise<void>;
  createContainer: (input: CreateContainerInput) => Promise<void>;
  updateContainer: (id: string, input: UpdateContainerInput) => Promise<void>;
  deleteContainer: (id: string) => Promise<void>;

  resolveContainerSkills: (containerId: string) => readonly AtomicSkillDTO[];
  getComposedPrompt: (containerId: string) => ComposedPrompt;
  getOrderingIssues: (containerId: string) => readonly OrderingIssue[];
}

function resolveSkills(
  container: SkillContainerDTO | undefined,
  skills: readonly AtomicSkillDTO[]
): readonly AtomicSkillDTO[] {
  if (!container) return [];
  const skillMap = new Map(skills.map(s => [s.id, s]));
  return container.skillIds.flatMap(id => {
    const skill = skillMap.get(id);
    return skill ? [skill] : [];
  });
}

function findContainer(
  containers: readonly SkillContainerDTO[],
  containerId: string
): SkillContainerDTO | undefined {
  return containers.find(c => c.id === containerId);
}

export const useSkillStore = create<SkillStoreState>()(
  immer((set, get) => ({
    activeTab: 'containers',
    selectedSkillId: null,
    selectedContainerId: null,
    skills: [],
    containers: [],

    setActiveTab: (tab: SkillsTab): void => {
      set(state => {
        state.activeTab = tab;
      });
    },

    selectSkill: (id: string | null): void => {
      set(state => {
        state.selectedSkillId = id;
      });
    },

    selectContainer: (id: string | null): void => {
      set(state => {
        state.selectedContainerId = id;
      });
    },

    loadSkills: async (): Promise<void> => {
      const skills = await getAllSkills();
      set(state => {
        state.skills = [...skills];
      });
    },

    createSkill: async (input: CreateSkillInput): Promise<void> => {
      await dbCreateSkill(input);
      await get().loadSkills();
    },

    updateSkill: async (id: string, input: UpdateSkillInput): Promise<void> => {
      await dbUpdateSkill(id, input);
      await get().loadSkills();
    },

    deleteSkill: async (id: string): Promise<readonly string[]> => {
      const wasSelected = get().selectedSkillId === id;
      const affectedContainerNames = await removeSkillFromAllContainers(id);
      await dbDeleteSkill(id);
      await get().loadSkills();
      await get().loadContainers();
      if (wasSelected) {
        set(state => {
          state.selectedSkillId = null;
        });
      }
      return affectedContainerNames;
    },

    duplicateSkill: async (id: string): Promise<void> => {
      await dbDuplicateSkill(id);
      await get().loadSkills();
    },

    loadContainers: async (): Promise<void> => {
      const containers = await getAllContainers();
      set(state => {
        state.containers = castDraft(containers);
      });
    },

    createContainer: async (input: CreateContainerInput): Promise<void> => {
      await dbCreateContainer(input);
      await get().loadContainers();
    },

    updateContainer: async (id: string, input: UpdateContainerInput): Promise<void> => {
      await dbUpdateContainer(id, input);
      await get().loadContainers();
    },

    deleteContainer: async (id: string): Promise<void> => {
      const wasSelected = get().selectedContainerId === id;
      await dbDeleteContainer(id);
      await get().loadContainers();
      if (wasSelected) {
        set(state => {
          state.selectedContainerId = null;
        });
      }
    },

    resolveContainerSkills: (containerId: string): readonly AtomicSkillDTO[] => {
      const { containers, skills } = get();
      return resolveSkills(findContainer(containers, containerId), skills);
    },

    getComposedPrompt: (containerId: string): ComposedPrompt => {
      const resolved = get().resolveContainerSkills(containerId);
      return resolved.length === 0 ? EMPTY_COMPOSED_PROMPT : composePrompt(resolved);
    },

    getOrderingIssues: (containerId: string): readonly OrderingIssue[] => {
      const resolved = get().resolveContainerSkills(containerId);
      return detectOrderingIssues(resolved);
    },
  }))
);
