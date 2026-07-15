import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  putLabSerialAcrossModels: vi.fn().mockResolvedValue(undefined),
  putLabSerialWithinModel: vi.fn().mockResolvedValue(undefined),
  getLabSerialAcrossModels: vi.fn().mockResolvedValue(false),
  getLabSerialWithinModel: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  getLabRunById: vi.fn().mockResolvedValue(null),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn().mockResolvedValue(undefined),
  getAllPrompts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn().mockResolvedValue(undefined),
  archiveCompletedRun: vi.fn().mockResolvedValue(undefined),
  getAllArchivedRuns: vi.fn().mockResolvedValue([]),
  getArchivedRunById: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/features/prompt-history', () => ({
  usePromptHistoryStore: { getState: () => ({ refresh: vi.fn() }) },
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import type { LabState, RunTab } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getStore = (): LabState => usePromptTesterStore.getState() as LabState;

const resetStore = (): void => {
  usePromptTesterStore.setState(
    usePromptTesterStore.getInitialState
      ? usePromptTesterStore.getInitialState()
      : (usePromptTesterStore.getState() as LabState)
  );
  vi.clearAllMocks();
};

const getActiveRun = (): RunTab | undefined => {
  const state = getStore();
  return state.runs.find(r => r.id === state.activeRunId);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('viewMode slice', () => {
  beforeEach(resetStore);

  describe('default on tab create', () => {
    it('should default viewMode to grid when a new tab is created via createEmptyTab', () => {
      usePromptTesterStore.getState().createEmptyTab();

      const run = getActiveRun();
      expect(run?.viewMode).toBe('grid');
    });

    it('should default viewMode to grid on the initial tab', () => {
      const run = getActiveRun();
      expect(run?.viewMode).toBe('grid');
    });
  });

  describe('setViewMode', () => {
    it('should change the active tab viewMode to grid when setViewMode is called with grid', () => {
      usePromptTesterStore.getState().setViewMode('grid');

      const run = getActiveRun();
      expect(run?.viewMode).toBe('grid');
    });

    it('should change the active tab viewMode back to list when setViewMode is called with list', () => {
      usePromptTesterStore.getState().setViewMode('grid');
      usePromptTesterStore.getState().setViewMode('list');

      const run = getActiveRun();
      expect(run?.viewMode).toBe('list');
    });

    it('should only affect the active tab when setViewMode is called', () => {
      // Arrange: create a second tab (first tab is the initial one)
      const firstTabId = getStore().activeRunId;
      usePromptTesterStore.getState().createEmptyTab();
      const secondTabId = getStore().activeRunId;

      // Act: set viewMode on second (active) tab to list (change from grid default)
      usePromptTesterStore.getState().setViewMode('list');

      // Assert: second tab is list, first tab is still grid (unchanged default)
      const state = getStore();
      const firstTab = state.runs.find(r => r.id === firstTabId);
      const secondTab = state.runs.find(r => r.id === secondTabId);
      expect(secondTab?.viewMode).toBe('list');
      expect(firstTab?.viewMode).toBe('grid');
    });
  });
});
