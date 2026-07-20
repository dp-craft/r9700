import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptHistoryEntry } from '@/db/idb';

vi.mock('@/db/prompts', () => ({
  getAllPrompts: vi.fn(),
  capturePrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: vi.fn().mockResolvedValue([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

import { getAllPrompts } from '@/db/prompts';

import { usePromptTesterStore } from '../usePromptTesterStore';

const buildPromptEntry = (overrides: Partial<PromptHistoryEntry> = {}): PromptHistoryEntry => ({
  id: 'p1',
  text: 'test prompt',
  type: 'USER',
  firstSource: 'LAB',
  useCount: 1,
  firstUsedAt: 0,
  lastUsedAt: 0,
  references: [],
  ...overrides,
});

describe('usePromptTesterStore — user prompt history', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
    vi.clearAllMocks();
  });

  it('should have userPromptHistoryOpen initially false', () => {
    const state = usePromptTesterStore.getState();
    expect(state.userPromptHistoryOpen).toBe(false);
  });

  it('should have empty userPromptHistoryItems initially', () => {
    const state = usePromptTesterStore.getState();
    expect(state.userPromptHistoryItems).toEqual([]);
  });

  it('should load user prompt history from db/prompts filtered to USER type', async () => {
    const userEntry = buildPromptEntry({ id: 'u1', text: 'user prompt', type: 'USER' });
    const systemEntry = buildPromptEntry({ id: 's1', text: 'system prompt', type: 'SYSTEM' });
    vi.mocked(getAllPrompts).mockResolvedValue([userEntry, systemEntry]);

    await usePromptTesterStore.getState().loadUserPromptHistory();

    const items = usePromptTesterStore.getState().userPromptHistoryItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'u1', text: 'user prompt', type: 'USER' });
  });

  it('should set userPrompt and close history when selectUserPromptHistory is called', async () => {
    usePromptTesterStore.setState({ userPromptHistoryOpen: true });

    await usePromptTesterStore.getState().selectUserPromptHistory('hello');

    const state = usePromptTesterStore.getState();
    expect(state.userPrompt).toBe('hello');
    expect(state.userPromptHistoryOpen).toBe(false);
  });
});
