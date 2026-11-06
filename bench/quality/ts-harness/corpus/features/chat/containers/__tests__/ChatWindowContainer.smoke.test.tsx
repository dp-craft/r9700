// Boundary mocks — declared before imports (Vitest hoisting)
// useChatStore is the REAL store; seeded via setState in beforeEach (ADR-018 L3 real-store rule).

vi.mock('@/features/settings', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/settings')>();
  return {
    ...actual,
    useFeatureFlagStore: vi.fn(),
    useSettingsStore: vi.fn(),
  };
});

vi.mock('@/features/sessions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/sessions')>();
  return {
    ...actual,
    useSessionStore: vi.fn(),
  };
});

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn().mockReturnValue(true),
}));

vi.mock('@/features/chat/hooks/useChat', () => ({
  useChat: vi.fn(),
}));

vi.mock('@/features/chat/hooks/useScrollToBottom', () => ({
  useScrollToBottom: vi.fn().mockReturnValue({ current: null }),
}));

vi.mock('@/features/chat/hooks/useInputHistory', () => ({
  useInputHistory: vi.fn(),
}));

vi.mock('@/features/chat/lib/dispatchTestInLab', () => ({
  dispatchTestInLab: vi.fn(),
}));

// Mock child containers to isolate ChatWindowContainer behavior
vi.mock('@/features/chat/containers/ChatHeaderContainer', () => ({
  ChatHeaderContainer: () => null,
}));

vi.mock('@/features/chat/containers/ChatModelChooserContainer', () => ({
  ChatModelChooserContainer: () => null,
}));

vi.mock('@/features/skills', () => ({
  CommandAutocompleteContainer: () => null,
  SessionSkillIndicatorContainer: () => null,
}));

// Capture MessageList props for assertion
let capturedMessageListProps: Record<string, unknown> = {};
vi.mock('@/features/chat/components/MessageList', () => ({
  MessageList: (props: Record<string, unknown>) => {
    capturedMessageListProps = props;
    return null;
  },
}));

vi.mock('@/features/chat/components/PipelineProgress', () => ({
  PipelineProgress: () => null,
}));

vi.mock('@/features/chat/components/ChatInput', () => ({
  ChatInput: () => null,
}));

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, ChatSession } from '@/db/idb';
import { ChatWindowContainer } from '@/features/chat/containers/ChatWindowContainer';
import { useChat } from '@/features/chat/hooks/useChat';
import { useInputHistory } from '@/features/chat/hooks/useInputHistory';
import { dispatchTestInLab } from '@/features/chat/lib/dispatchTestInLab';
import { useChatStore } from '@/features/chat/stores/useChatStore';
import type { MessageViewModel } from '@/features/chat/types';
import { useSessionStore } from '@/features/sessions';
import { useFeatureFlagStore, useSettingsStore } from '@/features/settings';

// ─── Builders ────────────────────────────────────────────────────────────────

function buildSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-1',
    title: 'Test Session',
    createdAt: 1000,
    updatedAt: 1000,
    model: 'gpt-4o',
    providerId: 'openai',
    skillSnapshot: null,
    ...overrides,
  };
}

function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello',
    createdAt: 1000,
    ...overrides,
  };
}

function buildMessageViewModel(overrides: Partial<MessageViewModel> = {}): MessageViewModel {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello',
    createdAt: 1000,
    ...overrides,
  };
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const seedStores = ({
  flagEnabled = false,
  session = buildSession() as ChatSession | null,
  messages = [] as readonly ChatMessage[],
}: {
  flagEnabled?: boolean;
  session?: ChatSession | null;
  messages?: readonly ChatMessage[];
} = {}): void => {
  // Use `as unknown as Parameters` to avoid enumerating full store state shapes in tests
  vi.mocked(useFeatureFlagStore).mockImplementation(

    (selector: (s: any) => unknown) =>
      selector({
        getFlag: (key: string) => (key === 'prompt-lab-enabled' ? flagEnabled : false),
        flags: {
          'prompt-lab-enabled': flagEnabled,
          'show-cors-providers': false,
          'tutorial-enabled': false,
          'web-search-enabled': false,
        },
      })
  );

  vi.mocked(useSettingsStore).mockImplementation((selector: (s: any) => unknown) =>
    selector({ fontSize: 'md' })
  );

  vi.mocked(useSessionStore).mockImplementation((selector: (s: any) => unknown) =>
    selector({
      activeSessionId: session?.id ?? null,
      messages,
      sessionList: session ? [session] : [],
      clearSessionMessages: vi.fn(),
      createSession: vi.fn(),
    })
  );

  // Seed the REAL useChatStore — no vi.mock for this store (ADR-018 L3 real-store rule)
  useChatStore.setState({
    isStreaming: false,
    streamingContent: '',
    streamingReasoning: '',
    error: null,
    pipelineProgress: {
      isActive: false,
      currentStepId: null,
      currentStepLabel: null,
      completedSteps: [],
      streamingContent: '',
    },
  });

  vi.mocked(useChat).mockReturnValue({
    sendMessage: vi.fn().mockResolvedValue(undefined),
    isStreaming: false,
    streamingContent: '',
    abort: vi.fn(),
    error: null,
    clearError: vi.fn(),
  });

  vi.mocked(useInputHistory).mockReturnValue({
    currentEntry: null,
    isNavigating: false,
    navigateUp: vi.fn(),
    navigateDown: vi.fn(),
    dismiss: vi.fn(),
    addEntry: vi.fn(),
    reset: vi.fn(),
  });
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChatWindowContainer — Test-in-Lab wiring (L3 smoke)', () => {
  beforeEach(() => {
    capturedMessageListProps = {};
    vi.mocked(dispatchTestInLab).mockClear();
    seedStores();
  });

  describe('when prompt-lab-enabled flag is true', () => {
    it('should pass showTestInLab=true to MessageList', () => {
      seedStores({ flagEnabled: true });
      render(<ChatWindowContainer />);

      expect(capturedMessageListProps.showTestInLab).toBe(true);
    });

    it('should pass localized testInLabLabel to MessageList', () => {
      seedStores({ flagEnabled: true });
      render(<ChatWindowContainer />);

      // useTranslation returns (key) => key, so label equals the i18n key
      expect(capturedMessageListProps.testInLabLabel).toBe('chat.testInLab');
    });

    it('should call dispatchTestInLab with activeSession and per-message MessageViewModel when onTestInLab fires', () => {
      const session = buildSession();
      const message = buildMessage({ id: 'msg-42', content: 'Test me' });
      seedStores({ flagEnabled: true, session, messages: [message] });

      render(<ChatWindowContainer />);

      const onTestInLab = capturedMessageListProps.onTestInLab as
        | ((msg: MessageViewModel) => void)
        | undefined;
      expect(onTestInLab).toBeDefined();

      const vm = buildMessageViewModel({ id: 'msg-42', content: 'Test me' });
      onTestInLab?.(vm);

      expect(dispatchTestInLab).toHaveBeenCalledOnce();
      expect(dispatchTestInLab).toHaveBeenCalledWith(session, vm);
    });
  });

  describe('when prompt-lab-enabled flag is false', () => {
    it('should pass showTestInLab=false to MessageList', () => {
      seedStores({ flagEnabled: false });
      render(<ChatWindowContainer />);

      expect(capturedMessageListProps.showTestInLab).toBe(false);
    });

    it('should not provide onTestInLab to MessageList when flag is off', () => {
      seedStores({ flagEnabled: false });
      render(<ChatWindowContainer />);

      expect(capturedMessageListProps.onTestInLab).toBeUndefined();
    });
  });

  describe('R-010: undefined guard on useFeatureFlagStore', () => {
    it('should treat missing flag as false when flags record has no prompt-lab-enabled key', () => {
      vi.mocked(useFeatureFlagStore).mockImplementation((selector: (s: any) => unknown) =>
        selector({
          getFlag: (_key: string) => false,
          flags: {
            'show-cors-providers': false,
            'tutorial-enabled': false,
            'web-search-enabled': false,
          },
        })
      );

      vi.mocked(useSettingsStore).mockImplementation((selector: (s: any) => unknown) =>
        selector({ fontSize: 'md' })
      );

      vi.mocked(useSessionStore).mockImplementation((selector: (s: any) => unknown) =>
        selector({
          activeSessionId: 'session-1',
          messages: [],
          sessionList: [buildSession()],
          clearSessionMessages: vi.fn(),
          createSession: vi.fn(),
        })
      );
      useChatStore.setState({
        isStreaming: false,
        streamingContent: '',
        streamingReasoning: '',
        error: null,
        pipelineProgress: {
          isActive: false,
          currentStepId: null,
          currentStepLabel: null,
          completedSteps: [],
          streamingContent: '',
        },
      });
      vi.mocked(useChat).mockReturnValue({
        sendMessage: vi.fn().mockResolvedValue(undefined),
        isStreaming: false,
        streamingContent: '',
        abort: vi.fn(),
        error: null,
        clearError: vi.fn(),
      });
      vi.mocked(useInputHistory).mockReturnValue({
        currentEntry: null,
        isNavigating: false,
        navigateUp: vi.fn(),
        navigateDown: vi.fn(),
        dismiss: vi.fn(),
        addEntry: vi.fn(),
        reset: vi.fn(),
      });

      expect(() => render(<ChatWindowContainer />)).not.toThrow();
      expect(capturedMessageListProps.showTestInLab).toBe(false);
    });
  });
});
