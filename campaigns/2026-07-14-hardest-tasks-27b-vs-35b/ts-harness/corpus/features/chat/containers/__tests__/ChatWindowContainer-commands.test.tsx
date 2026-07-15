import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/db/idb';
import { useSessionStore } from '@/features/sessions';

// -- Boundary mocks --

let capturedOnSelectCommand: ((prefix: string) => void) | null = null;

vi.mock('@/features/sessions', () => ({
  useSessionStore: vi.fn(),
}));

vi.mock('@/features/settings', () => ({
  useSettingsStore: vi.fn(() => 'md'),
  useFeatureFlagStore: vi.fn(() => false),
}));

vi.mock('@/features/skills', () => ({
  CommandAutocompleteContainer: (props: {
    onSelectCommand: (prefix: string) => void;
    inputValue: string;
  }) => {
    capturedOnSelectCommand = props.onSelectCommand;
    return <div data-testid="autocomplete" />;
  },
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
  clearSessionMessages: () => Promise<void>;
  createSession: () => Promise<void>;
};

// -- Builders --

const buildSession = () => ({
  id: 'session-1',
  providerId: 'ollama',
  model: 'llama3',
  skillSnapshot: null,
});

// -- Store helper --

const mockSessionStore = (overrides: Partial<SessionState> = {}): SessionState => {
  const state: SessionState = {
    activeSessionId: 'session-1',
    messages: [],
    sessionList: [buildSession()],
    clearSessionMessages: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  (useSessionStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: SessionState) => unknown) => selector(state)
  );
  return state;
};

// -- Helpers --

/**
 * Seeds sessionStorage so the container initialises inputValue with '/',
 * making CommandAutocompleteContainer render immediately on first render.
 */
const seedSlashInput = (): void => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('/');
};

// -- Setup --

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnSelectCommand = null;
  sessionStorage.clear();
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

describe('arrow navigation (FR NEW:chat.command-arrow-nav)', () => {
  it('should gate arrow keys away from input history and keep input value unchanged when chooser is open', async () => {
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
    mockSessionStore();
    seedSlashInput();

    // Act — render with chooser open (inputValue starts with '/')
    render(<ChatWindowContainer />);

    // Assert: chooser is open (autocomplete stub rendered)
    const { getByTestId } = screen;
    expect(getByTestId('autocomplete')).toBeInTheDocument();

    // Assert: ChatInput receives onArrowDown=undefined while chooser is open
    // (arrow gating — ↓ drives chooser selection, NOT history navigation)
    const calls = vi.mocked(ChatInput).mock.calls;
    const latestProps = calls[calls.length - 1]?.[0];
    expect(latestProps?.onArrowDown).toBeUndefined();

    // Assert: input value is still '/' (unchanged — no command was selected)
    expect(latestProps?.value).toBe('/');

    // Assert: history navigation was never invoked (arrow gated away)
    expect(navigateDown).not.toHaveBeenCalled();
  });
});

describe('ChatWindowContainer — command execution', () => {
  describe('/clear command', () => {
    it('should insert /clear into input when /clear prefix is selected', async () => {
      // Arrange
      mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);
      expect(capturedOnSelectCommand).not.toBeNull();

      await act(async () => {
        capturedOnSelectCommand?.('clear');
      });

      // Assert — selecting a command inserts text, does NOT execute
      const calls = vi.mocked(ChatInput).mock.calls;
      const latestProps = calls[calls.length - 1]?.[0];
      expect(latestProps?.value).toBe('/clear ');
    });

    it('should not call clearSessionMessages when /clear prefix is selected via chooser', async () => {
      // Arrange
      const state = mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);
      expect(capturedOnSelectCommand).not.toBeNull();

      await act(async () => {
        capturedOnSelectCommand?.('clear');
      });

      // Assert — command select inserts text only; execution happens on submit
      expect(state.clearSessionMessages).not.toHaveBeenCalled();
    });
  });

  describe('/new command', () => {
    it('should insert /new into input when /new prefix is selected', async () => {
      // Arrange
      mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);
      expect(capturedOnSelectCommand).not.toBeNull();

      await act(async () => {
        capturedOnSelectCommand?.('new');
      });

      // Assert — selecting a command inserts text, does NOT execute
      const calls = vi.mocked(ChatInput).mock.calls;
      const latestProps = calls[calls.length - 1]?.[0];
      expect(latestProps?.value).toBe('/new ');
    });

    it('should not call createSession when /new prefix is selected via chooser', async () => {
      // Arrange
      const state = mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);
      expect(capturedOnSelectCommand).not.toBeNull();

      await act(async () => {
        capturedOnSelectCommand?.('new');
      });

      // Assert — command select inserts text only; execution happens on submit
      expect(state.createSession).not.toHaveBeenCalled();
    });
  });

  describe('/help command', () => {
    it('should insert /help into input when /help prefix is selected', async () => {
      // Arrange
      mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);
      expect(capturedOnSelectCommand).not.toBeNull();

      await act(async () => {
        capturedOnSelectCommand?.('help');
      });

      // Assert — selecting a command inserts text, does NOT execute
      const calls = vi.mocked(ChatInput).mock.calls;
      const latestProps = calls[calls.length - 1]?.[0];
      expect(latestProps?.value).toBe('/help ');
    });

    it('should not show ephemeral help content on command select (only on submit)', async () => {
      // Arrange
      mockSessionStore();
      seedSlashInput();

      // Act
      const { baseElement } = render(<ChatWindowContainer />);
      expect(capturedOnSelectCommand).not.toBeNull();

      await act(async () => {
        capturedOnSelectCommand?.('help');
      });

      // Assert — /help select inserts text; ephemeral message only fires on submit
      expect(baseElement.textContent).not.toContain('chat.helpContent');
    });
  });

  describe('non-builtin command prefix (skill commands)', () => {
    it('should set input to /prefix format for unknown prefixes', async () => {
      // Arrange
      mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);
      expect(capturedOnSelectCommand).not.toBeNull();

      await act(async () => {
        capturedOnSelectCommand?.('someSkillPrefix');
      });

      // Assert — skill command preserves the existing behaviour
      const calls = vi.mocked(ChatInput).mock.calls;
      const latestProps = calls[calls.length - 1]?.[0];
      expect(latestProps?.value).toBe('/someSkillPrefix ');
    });

    it('should not call clearSessionMessages for unknown prefixes', async () => {
      // Arrange
      const state = mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);

      await act(async () => {
        capturedOnSelectCommand?.('someSkillPrefix');
      });

      // Assert
      expect(state.clearSessionMessages).not.toHaveBeenCalled();
    });
  });

  describe('history reset after built-in command', () => {
    it('should not call history.reset when /clear is selected via chooser (insert-only)', async () => {
      // Arrange — new contract: command select inserts text, does not execute the command
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
      mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);
      expect(capturedOnSelectCommand).not.toBeNull();

      await act(async () => {
        capturedOnSelectCommand?.('clear');
      });

      // Assert — reset is called once on mount (session seed), but NOT a second time for command select
      expect(reset).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenCalledWith([]);
    });
  });

  describe('ephemeral message display', () => {
    it('should not call clearSessionMessages when /help is selected via chooser', async () => {
      // Arrange
      const state = mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);

      await act(async () => {
        capturedOnSelectCommand?.('help');
      });

      // Assert — /help select inserts text only; never wipes session messages
      expect(state.clearSessionMessages).not.toHaveBeenCalled();
    });

    it('should not call createSession when /help is selected via chooser', async () => {
      // Arrange
      const state = mockSessionStore();
      seedSlashInput();

      // Act
      render(<ChatWindowContainer />);

      await act(async () => {
        capturedOnSelectCommand?.('help');
      });

      // Assert — /help select inserts text only; never creates a session
      expect(state.createSession).not.toHaveBeenCalled();
    });
  });

  describe('ephemeral message lifetime', () => {
    it('should show ephemeral message only after /help and not on initial render', () => {
      // Arrange
      mockSessionStore();
      seedSlashInput();

      // Act — render but do NOT call any command
      const { baseElement } = render(<ChatWindowContainer />);

      // Assert — help content must NOT appear before command is triggered
      expect(baseElement.textContent).not.toContain('chat.helpContent');
    });
  });
});
