import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/prompts', () => ({
  getAllPrompts: vi.fn().mockResolvedValue([]),
  deletePrompts: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  putAppSetting: vi.fn().mockResolvedValue(undefined),
}));

import { useUIStore } from '@/stores/useUIStore';

import { usePromptHistoryStore } from '../usePromptHistoryStore';

describe('usePromptHistoryStore — openInNewChat deep-link', () => {
  beforeEach(() => {
    useUIStore.setState({
      workspace: 'prompt-lab',
      chatPanel: 'conversations',
      activeDialog: null,
      dialogPayload: null,
      mfError: null,
    });
  });

  it('should set workspace to chat when openInNewChat is called', () => {
    // Arrange
    const store = usePromptHistoryStore.getState() as {
      openInNewChat: (text: string) => void;
    };

    // Act
    store.openInNewChat('Hello');

    // Assert: requestWorkspacePanel('chat','conversations') sets workspace to chat
    expect(useUIStore.getState().workspace).toBe('chat');
  });

  it('should set chatPanel to conversations when openInNewChat is called', () => {
    // Arrange: set chatPanel to something else first
    useUIStore.setState({ chatPanel: 'skills' });
    const store = usePromptHistoryStore.getState() as {
      openInNewChat: (text: string) => void;
    };

    // Act
    store.openInNewChat('Hello');

    // Assert: requestWorkspacePanel('chat','conversations') resets chatPanel
    expect(useUIStore.getState().chatPanel).toBe('conversations');
  });

  it('should set chatInputPrefill on UIStore when openInNewChat is called', () => {
    // Arrange
    const store = usePromptHistoryStore.getState() as {
      openInNewChat: (text: string) => void;
    };

    // Act
    store.openInNewChat('Hello world');

    // Assert
    expect(useUIStore.getState().chatInputPrefill).toBe('Hello world');
  });
});
