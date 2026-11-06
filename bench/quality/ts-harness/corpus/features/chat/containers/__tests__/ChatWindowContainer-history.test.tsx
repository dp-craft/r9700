import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/db/idb';
import { useSessionStore } from '@/features/sessions';

// -- Boundary mocks --

vi.mock('@/features/sessions', () => ({
  useSessionStore: vi.fn(),
}));

vi.mock('@/features/settings', () => ({
  useSettingsStore: vi.fn(() => 'md'),
  useFeatureFlagStore: vi.fn(() => false),
}));

vi.mock('@/features/skills', () => ({
  CommandAutocompleteContainer: () => null,
  SessionSkillIndicatorContainer: () => null,
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn(() => true),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('../../hooks/useChat', () => ({
  useChat: vi.fn(() => ({
    sendMessage: vi.fn(),
    isStreaming: false,
    streamingContent: '',
    abort: vi.fn(),
  })),
}));

vi.mock('../../hooks/useScrollToBottom', () => ({
  useScrollToBottom: vi.fn(() => ({ current: null })),
}));

const mockChatState = {
  pipelineProgress: {
    isActive: false,
    currentStepId: null,
    currentStepLabel: '',
    completedSteps: [],
  },
  error: '',
  clearStreamError: vi.fn(),
};

vi.mock('../../stores/useChatStore', () => ({
  useChatStore: vi.fn((selector: (s: typeof mockChatState) => unknown) => selector(mockChatState)),
}));

vi.mock('../../components/ChatInput', () => ({
  ChatInput: vi.fn(() => null),
}));

vi.mock('../../components/MessageList', () => ({
  MessageList: vi.fn(() => null),
}));

vi.mock('../../components/PipelineProgress', () => ({
  PipelineProgress: vi.fn(() => null),
}));

vi.mock('../ChatHeaderContainer', () => ({
  ChatHeaderContainer: vi.fn(() => null),
}));

vi.mock('../ChatModelChooserContainer', () => ({
  ChatModelChooserContainer: vi.fn(() => null),
}));

vi.mock('../../hooks/useInputHistory', () => ({
  useInputHistory: vi.fn(() => ({
    isNavigating: false,
    currentEntry: null,
    navigateUp: vi.fn(() => false),
    navigateDown: vi.fn(() => false),
    dismiss: vi.fn(),
    addEntry: vi.fn(),
    reset: vi.fn(),
  })),
}));

// -- Imports under test (after all mocks) --

import { ChatInput } from '../../components/ChatInput';
import { useInputHistory } from '../../hooks/useInputHistory';
import { ChatWindowContainer } from '../ChatWindowContainer';

// -- Types --

type SessionState = {
  activeSessionId: string | null;
  messages: readonly ChatMessage[];
  sessionList: readonly {
    id: string;
    providerId: string;
    model: string;
    skillSnapshot: null;
  }[];
};

// -- Builders --

const FIXED_TS = 1_700_000_000_000;

const buildMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: `msg-${Math.random().toString(36).slice(2)}`,
  sessionId: 'session-1',
  role: 'user',
  content: 'hello',
  createdAt: FIXED_TS,
  ...overrides,
});

const buildSession = () => ({
  id: 'session-1',
  providerId: 'ollama',
  model: 'llama3',
  skillSnapshot: null,
});

// -- Store helper --

const mockSessionStore = (overrides: Partial<SessionState> = {}): void => {
  const defaultState: SessionState = {
    activeSessionId: 'session-1',
    messages: [],
    sessionList: [buildSession()],
    ...overrides,
  };
  (useSessionStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: SessionState) => unknown) => selector(defaultState)
  );
};

// -- Setup --

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionStore();
  (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
    isNavigating: false,
    currentEntry: null,
    navigateUp: vi.fn(() => false),
    navigateDown: vi.fn(() => false),
    dismiss: vi.fn(),
    addEntry: vi.fn(),
    reset: vi.fn(),
  });
});

// -- Tests --

describe('ChatWindowContainer — input history', () => {
  describe('hook wiring', () => {
    it('should pass navigateUp as onArrowUp to ChatInput', () => {
      // Arrange
      const navigateUp = vi.fn(() => false);
      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: false,
        currentEntry: null,
        navigateUp,
        navigateDown: vi.fn(() => false),
        dismiss: vi.fn(),
        addEntry: vi.fn(),
        reset: vi.fn(),
      });

      // Act
      render(<ChatWindowContainer />);

      // Assert
      const chatInputProps = vi.mocked(ChatInput).mock.calls[0]?.[0];
      expect(chatInputProps?.onArrowUp).toBe(navigateUp);
    });

    it('should pass navigateDown as onArrowDown to ChatInput', () => {
      // Arrange
      const navigateDown = vi.fn(() => false);
      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: false,
        currentEntry: null,
        navigateUp: vi.fn(() => false),
        navigateDown,
        dismiss: vi.fn(),
        addEntry: vi.fn(),
        reset: vi.fn(),
      });

      // Act
      render(<ChatWindowContainer />);

      // Assert
      const chatInputProps = vi.mocked(ChatInput).mock.calls[0]?.[0];
      expect(chatInputProps?.onArrowDown).toBe(navigateDown);
    });

    it('should pass dismiss as onEscape to ChatInput', () => {
      // Arrange
      const dismiss = vi.fn();
      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: false,
        currentEntry: null,
        navigateUp: vi.fn(() => false),
        navigateDown: vi.fn(() => false),
        dismiss,
        addEntry: vi.fn(),
        reset: vi.fn(),
      });

      // Act
      render(<ChatWindowContainer />);

      // Assert
      const chatInputProps = vi.mocked(ChatInput).mock.calls[0]?.[0];
      expect(chatInputProps?.onEscape).toBe(dismiss);
    });

    it('should update input value to currentEntry when navigating', () => {
      // Arrange
      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: true,
        currentEntry: 'recalled message',
        navigateUp: vi.fn(() => true),
        navigateDown: vi.fn(() => false),
        dismiss: vi.fn(),
        addEntry: vi.fn(),
        reset: vi.fn(),
      });

      // Act
      render(<ChatWindowContainer />);

      // Assert
      const chatInputProps = vi.mocked(ChatInput).mock.calls[0]?.[0];
      expect(chatInputProps?.value).toBe('recalled message');
    });
  });

  describe('session switch', () => {
    it('should call reset with user message contents when activeSessionId changes', () => {
      // Arrange
      const reset = vi.fn();
      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: false,
        currentEntry: null,
        navigateUp: vi.fn(() => false),
        navigateDown: vi.fn(() => false),
        dismiss: vi.fn(),
        addEntry: vi.fn(),
        reset,
      });

      const messages: readonly ChatMessage[] = [
        buildMessage({ role: 'user', content: 'user msg 1' }),
        buildMessage({ role: 'assistant', content: 'assistant response' }),
        buildMessage({ role: 'user', content: 'user msg 2' }),
      ];
      mockSessionStore({ messages });

      // Act
      render(<ChatWindowContainer />);

      // Assert
      expect(reset).toHaveBeenCalledWith(['user msg 1', 'user msg 2']);
    });

    it('should call reset with empty array when there are no user messages', () => {
      // Arrange
      const reset = vi.fn();
      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: false,
        currentEntry: null,
        navigateUp: vi.fn(() => false),
        navigateDown: vi.fn(() => false),
        dismiss: vi.fn(),
        addEntry: vi.fn(),
        reset,
      });

      mockSessionStore({ messages: [] });

      // Act
      render(<ChatWindowContainer />);

      // Assert
      expect(reset).toHaveBeenCalledWith([]);
    });

    it('should limit initial entries to last 50 user messages', () => {
      // Arrange
      const reset = vi.fn();
      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: false,
        currentEntry: null,
        navigateUp: vi.fn(() => false),
        navigateDown: vi.fn(() => false),
        dismiss: vi.fn(),
        addEntry: vi.fn(),
        reset,
      });

      const messages: readonly ChatMessage[] = Array.from({ length: 55 }, (_, i) =>
        buildMessage({ role: 'user', content: `message ${i + 1}` })
      );
      mockSessionStore({ messages });

      // Act
      render(<ChatWindowContainer />);

      // Assert
      const resetArg = reset.mock.calls[0]?.[0] as string[];
      expect(resetArg).toHaveLength(50);
      expect(resetArg[0]).toBe('message 6');
      expect(resetArg[49]).toBe('message 55');
    });
  });

  describe('message send', () => {
    it('should call addEntry after sending a message', async () => {
      // Arrange
      const addEntry = vi.fn();
      const sendMessage = vi.fn().mockResolvedValue(undefined);

      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: false,
        currentEntry: null,
        navigateUp: vi.fn(() => false),
        navigateDown: vi.fn(() => false),
        dismiss: vi.fn(),
        addEntry,
        reset: vi.fn(),
      });

      const { useChat } = await import('../../hooks/useChat');
      (useChat as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMessage,
        isStreaming: false,
        streamingContent: '',
        abort: vi.fn(),
      });

      // Act
      render(<ChatWindowContainer />);

      // Trigger submit by calling the onSubmit prop captured from ChatInput
      const chatInputProps = vi.mocked(ChatInput).mock.calls[0]?.[0];
      expect(chatInputProps?.onSubmit).toBeDefined();

      // We need input value set to something non-empty. Since the container
      // initialises inputValue from sessionStorage (which is '' in test env),
      // the test must use a pre-seeded currentEntry value via the hook to inject
      // a non-empty value before calling submit.
      // Re-render with a non-null currentEntry so inputValue gets overridden.
      (useInputHistory as ReturnType<typeof vi.fn>).mockReturnValue({
        isNavigating: true,
        currentEntry: 'my test message',
        navigateUp: vi.fn(() => false),
        navigateDown: vi.fn(() => false),
        dismiss: vi.fn(),
        addEntry,
        reset: vi.fn(),
      });

      const { rerender } = render(<ChatWindowContainer />);
      rerender(<ChatWindowContainer />);

      const calls = vi.mocked(ChatInput).mock.calls;
      const latestProps = calls[calls.length - 1]?.[0];
      expect(latestProps?.value).toBe('my test message');

      // Call submit with the input value set
      await latestProps?.onSubmit?.();

      // Assert
      expect(addEntry).toHaveBeenCalledWith('my test message');
    });
  });
});
