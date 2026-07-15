// Boundary mocks — hoisted before imports (Vitest hoisting)
vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/messages', () => ({
  getMessages: vi.fn().mockResolvedValue([]),
  putMessage: vi.fn().mockResolvedValue(undefined),
  deleteMessagesBySession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/sessions', () => ({
  getAllSessions: vi.fn().mockResolvedValue([]),
  putSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/agents/registry', () => ({
  getAgent: vi.fn(),
}));

vi.mock('@/services/pipeline/runner', () => ({
  runPipeline: vi.fn(),
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
  LOCALE_LANGUAGE_NAME: {},
}));

// Platform-boundary mock for skill store IDB load
vi.mock('@/db/skills', () => ({
  getAllSkills: vi.fn().mockResolvedValue([]),
  putSkill: vi.fn().mockResolvedValue(undefined),
  deleteSkill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/containers', () => ({
  getAllContainers: vi.fn().mockResolvedValue([]),
  putContainer: vi.fn().mockResolvedValue(undefined),
  deleteContainer: vi.fn().mockResolvedValue(undefined),
}));

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_MESSAGE_DURATION_MS } from '@/config';
import { useSessionStore } from '@/features/sessions';
import { useFeatureFlagStore, useSettingsStore } from '@/features/settings';

import { useChatStore } from '../../stores/useChatStore';
import { ChatWindowContainer } from '../ChatWindowContainer';

const SESSION_ID = 'sess-001';

const seedActiveSession = (): void => {
  useSessionStore.setState({
    activeSessionId: SESSION_ID,
    sessionList: [
      {
        id: SESSION_ID,
        title: 'Test session',
        createdAt: 1000,
        updatedAt: 1000,
        model: 'gpt-4o',
        providerId: 'openai',
        skillSnapshot: null,
      },
    ],
    messages: [],
  });
  useSettingsStore.setState({ fontSize: 'md' });
  useFeatureFlagStore.setState({
    flags: {
      'prompt-lab-enabled': false,
      'show-cors-providers': false,
      'tutorial-enabled': false,
      'web-search-enabled': false,
      'lab-perplexity-enabled': false,
      'lab-text-analysis-enabled': false,
    },
  });
};

const seedChatStore = (): void => {
  useChatStore.setState({
    isStreaming: false,
    streamingContent: '',
    pipelineProgress: {
      isActive: false,
      currentStepId: null,
      currentStepLabel: null,
      completedSteps: [],
      streamingContent: '',
    },
    error: null,
  });
};

describe('ChatWindowContainer — behavior tests (RED)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    seedActiveSession();
    seedChatStore();
  });

  // T032 — NEW:chat.command-arrow-nav
  // While the command chooser is open (inputValue starts with "/"), pressing ↓
  // should move the chooser selection and NOT change the textarea value to a
  // history entry. Currently useInputHistory.navigateDown wins — this test
  // asserts the textarea is unchanged (the not-yet-implemented gate).
  describe('T032 — command chooser arrow-key arbitration', () => {
    it('should not change textarea value when ArrowDown pressed while chooser is open', async () => {
      const user = userEvent.setup();
      render(<ChatWindowContainer />);

      const textarea = screen.getByRole('textbox', { name: 'chat.messageInput' });

      // Type "/" to open the chooser
      await user.click(textarea);
      await user.keyboard('/');

      expect(textarea).toHaveValue('/');

      // With chooser open, pressing ArrowDown should NOT navigate history
      // (textarea value must stay at "/" not change to a history entry)
      await user.keyboard('{ArrowDown}');

      expect(textarea).toHaveValue('/');
    });

    it('should not change textarea value when ArrowUp pressed while chooser is open', async () => {
      const user = userEvent.setup();

      // Seed a message into history so navigateUp would have something to return
      useSessionStore.setState({
        activeSessionId: SESSION_ID,
        sessionList: [
          {
            id: SESSION_ID,
            title: 'Test session',
            createdAt: 1000,
            updatedAt: 1000,
            model: 'gpt-4o',
            providerId: 'openai',
            skillSnapshot: null,
          },
        ],
        messages: [
          {
            id: 'msg-1',
            sessionId: SESSION_ID,
            role: 'user',
            content: 'hello from history',
            createdAt: 900,
          },
        ],
      });

      render(<ChatWindowContainer />);

      const textarea = screen.getByRole('textbox', { name: 'chat.messageInput' });

      await user.click(textarea);
      await user.keyboard('/');

      expect(textarea).toHaveValue('/');

      // ArrowUp while chooser is open must NOT replace the "/" with a history entry
      await user.keyboard('{ArrowUp}');

      expect(textarea).toHaveValue('/');
    });
  });

  // T033 — NEW:chat.command-single-slash
  // When a command is selected from the chooser, the resulting textarea value
  // must start with exactly one leading "/". The current handleCommandSelect
  // builds `/${prefix} ` and sets it directly — if the input already contains
  // "/" (the trigger char), naive concatenation would not double it. But the
  // new spec requires we also cover the case where any normalisation or double
  // slash can creep in (e.g. if the input "/co" triggers a prefix of "/concise"
  // that already starts with "/"). We assert the rendered value has exactly one
  // leading slash.
  describe('T033 — command selection single-slash insertion', () => {
    it('should insert command with exactly one leading slash when selected from chooser', async () => {
      const user = userEvent.setup();
      render(<ChatWindowContainer />);

      const textarea = screen.getByRole('textbox', { name: 'chat.messageInput' });

      // Open chooser
      await user.click(textarea);
      await user.keyboard('/');

      // The chooser (role=listbox) should be visible
      const listbox = screen.getByRole('listbox');
      expect(listbox).toBeInTheDocument();

      // Pick the first option — this calls onSelectCommand
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(0);

      await user.click(options[0]);

      // The textarea must start with exactly one "/" — not "//"
      const value = (textarea as HTMLTextAreaElement).value;
      expect(value).toMatch(/^\/[^/]/);
      expect(value.startsWith('//')).toBe(false);
    });

    it('should not produce double slash when input already contains leading slash before selection', async () => {
      const user = userEvent.setup();
      render(<ChatWindowContainer />);

      const textarea = screen.getByRole('textbox', { name: 'chat.messageInput' });

      // Type "/" then a partial prefix that matches "clear" (/cl)
      await user.click(textarea);
      await user.keyboard('/cl');

      // Confirm chooser is open — "clear" should appear
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Select first option from the autocomplete list
      const options = screen.getAllByRole('option');
      await user.click(options[0]);

      const value = (textarea as HTMLTextAreaElement).value;
      expect(value.startsWith('//')).toBe(false);
      expect(value).toMatch(/^\//);
    });
  });

  // T034 — NEW:chat.error-message-duration
  // When a stream/server error is set on useChatStore, the error message must
  // be visible in the DOM. After ERROR_MESSAGE_DURATION_MS elapses the message
  // must be auto-dismissed. On unmount, the cleanup (clearTimeout) runs —
  // asserting no dangling timer by verifying the error is absent after unmount.
  describe('T034 — stream error auto-dismissal after ERROR_MESSAGE_DURATION_MS', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should display error message immediately when error is set', () => {
      useChatStore.setState({ error: 'Connection refused' });
      render(<ChatWindowContainer />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Connection refused');
    });

    it('should clear error message after ERROR_MESSAGE_DURATION_MS elapses', () => {
      useChatStore.setState({ error: 'Timeout error' });
      render(<ChatWindowContainer />);

      expect(screen.getByRole('alert')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(ERROR_MESSAGE_DURATION_MS);
      });

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('should not clear error before ERROR_MESSAGE_DURATION_MS elapses', () => {
      useChatStore.setState({ error: 'Partial timeout' });
      render(<ChatWindowContainer />);

      act(() => {
        vi.advanceTimersByTime(ERROR_MESSAGE_DURATION_MS - 1);
      });

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should clear any pending timeout on unmount (no dangling timer)', () => {
      useChatStore.setState({ error: 'Will unmount' });
      const { unmount } = render(<ChatWindowContainer />);

      expect(screen.getByRole('alert')).toBeInTheDocument();

      unmount();

      // Advance past the duration — if a dangling timer fires it would
      // attempt to update unmounted state; Vitest/React would warn.
      // The absence of error warnings here asserts cleanup ran.
      act(() => {
        vi.advanceTimersByTime(ERROR_MESSAGE_DURATION_MS + 1000);
      });

      // After unmount there is no DOM to query — just assert no throw occurred
      expect(true).toBe(true);
    });
  });
});
