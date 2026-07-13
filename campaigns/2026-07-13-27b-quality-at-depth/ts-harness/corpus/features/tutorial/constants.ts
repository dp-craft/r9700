import type { AppStateSnapshot, TutorialGoal } from './types';

export const TUTORIAL_STORAGE_KEY = 'tutorial-progress' as const;

export const TUTORIAL_GOAL_COUNT = 11 as const;

export const TUTORIAL_GOALS: readonly TutorialGoal[] = [
  {
    id: 'open-settings',
    title: 'Open Settings',
    description: 'Click the settings icon to explore configuration options',
    order: 1,
    predicate: (s: AppStateSnapshot): boolean => s.activeDialog === 'settings',
  },
  {
    id: 'configure-provider',
    title: 'Configure a Provider',
    description: 'Select and configure an AI provider like Ollama or OpenRouter',
    order: 2,
    predicate: (s: AppStateSnapshot): boolean => s.activeProviderId !== null,
  },
  {
    id: 'select-model',
    title: 'Select a Model',
    description: 'Choose an AI model to use for conversations',
    order: 3,
    predicate: (s: AppStateSnapshot): boolean => s.activeModelId !== null,
  },
  {
    id: 'set-language',
    title: 'Change Language',
    description: 'Try switching the interface or conversation language',
    order: 4,
    predicate: (s: AppStateSnapshot): boolean => s.interactionFlags['set-language'] === true,
  },
  {
    id: 'send-message',
    title: 'Send a Message',
    description: 'Type a message and send it to the AI',
    order: 5,
    predicate: (s: AppStateSnapshot): boolean => s.hasUserMessage,
  },
  {
    id: 'create-session',
    title: 'Create a New Chat',
    description: 'Start a fresh conversation from the sidebar',
    order: 6,
    predicate: (s: AppStateSnapshot): boolean => s.sessionCount > 1,
  },
  {
    id: 'create-skill',
    title: 'Create a Skill',
    description: 'Build a custom prompt skill in the Skills manager',
    order: 7,
    predicate: (s: AppStateSnapshot): boolean => s.hasCustomSkill,
  },
  {
    id: 'build-container',
    title: 'Build a Container',
    description: 'Add skills to a container to create a skill set',
    order: 8,
    predicate: (s: AppStateSnapshot): boolean => s.hasPopulatedContainer,
  },
  {
    id: 'test-skill-setup',
    title: 'Set Default Skills',
    description: 'Choose a default skill container in Settings',
    order: 9,
    predicate: (s: AppStateSnapshot): boolean => s.defaultContainerId !== null,
  },
  {
    id: 'explore-prompt-tester',
    title: 'Open Prompt Tester',
    description: 'Explore the prompt testing and comparison tool',
    order: 10,
    predicate: (s: AppStateSnapshot): boolean => s.workspace === 'prompt-lab',
  },
  {
    id: 'explore-sidebar',
    title: 'Switch Sessions',
    description: 'Navigate between different chat sessions',
    order: 11,
    predicate: (s: AppStateSnapshot): boolean => s.interactionFlags['explore-sidebar'] === true,
  },
] as const;
