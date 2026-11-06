import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, ChatSession } from '@/domain/entities';

vi.mock('@/db/sessions', () => ({
  getAllSessions: vi.fn().mockResolvedValue([]),
  putSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/messages', () => ({
  getMessages: vi.fn().mockResolvedValue([]),
  putMessage: vi.fn().mockResolvedValue(undefined),
  deleteMessagesBySession: vi.fn().mockResolvedValue(undefined),
}));

import * as messagesDb from '@/db/messages';

import { useSessionStore } from '../useSessionStore';

// -- Constants --

const FIXED_TIMESTAMP = 1_700_000_000_000;

// -- Builders --

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
  id: 'session-1',
  title: 'Test Session',
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  model: 'llama3',
  providerId: 'ollama',
  skillSnapshot: null,
  webSearchEnabled: false,
  ...overrides,
});

const buildMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: 'msg-1',
  sessionId: 'session-1',
  role: 'user',
  content: 'hello',
  createdAt: FIXED_TIMESTAMP,
  ...overrides,
});

// -- Mock aliases --

const mockDeleteMessagesBySession = messagesDb.deleteMessagesBySession as ReturnType<typeof vi.fn>;
const mockGetMessages = messagesDb.getMessages as ReturnType<typeof vi.fn>;

describe('useSessionStore — clearSessionMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useSessionStore.setState({
        sessionList: [],
        activeSessionId: null,
        messages: [],
      });
    });
  });

  // =========================================================================
  // clearSessionMessages — DB call
  // =========================================================================

  describe('clearSessionMessages — DB call', () => {
    it('should call deleteMessagesBySession with the session ID', async () => {
      // Given
      const session = buildSession({ id: 'session-1' });
      const message = buildMessage({ id: 'msg-1', sessionId: 'session-1' });

      act(() => {
        useSessionStore.setState({
          sessionList: [session],
          activeSessionId: 'session-1',
          messages: [message],
        });
      });

      mockDeleteMessagesBySession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.clearSessionMessages('session-1');
      });

      // Then
      expect(mockDeleteMessagesBySession).toHaveBeenCalledOnce();
      expect(mockDeleteMessagesBySession).toHaveBeenCalledWith('session-1');
    });
  });

  // =========================================================================
  // clearSessionMessages — state update
  // =========================================================================

  describe('clearSessionMessages — state update', () => {
    it('should reload messages after deletion so state.messages becomes empty', async () => {
      // Given
      const session = buildSession({ id: 'session-1' });
      const message = buildMessage({ id: 'msg-1', sessionId: 'session-1' });

      act(() => {
        useSessionStore.setState({
          sessionList: [session],
          activeSessionId: 'session-1',
          messages: [message],
        });
      });

      mockDeleteMessagesBySession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.clearSessionMessages('session-1');
      });

      // Then
      expect(result.current.messages).toHaveLength(0);
    });

    it('should call getMessages to reload after deletion', async () => {
      // Given
      const session = buildSession({ id: 'session-1' });
      const message = buildMessage({ id: 'msg-1', sessionId: 'session-1' });

      act(() => {
        useSessionStore.setState({
          sessionList: [session],
          activeSessionId: 'session-1',
          messages: [message],
        });
      });

      mockDeleteMessagesBySession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.clearSessionMessages('session-1');
      });

      // Then
      expect(mockGetMessages).toHaveBeenCalledWith('session-1');
    });
  });

  // =========================================================================
  // clearSessionMessages — side-effect isolation
  // =========================================================================

  describe('clearSessionMessages — side-effect isolation', () => {
    it('should not modify sessionList when clearing messages', async () => {
      // Given
      const session = buildSession({ id: 'session-1' });
      const message = buildMessage({ id: 'msg-1', sessionId: 'session-1' });

      act(() => {
        useSessionStore.setState({
          sessionList: [session],
          activeSessionId: 'session-1',
          messages: [message],
        });
      });

      mockDeleteMessagesBySession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.clearSessionMessages('session-1');
      });

      // Then
      expect(result.current.sessionList).toHaveLength(1);
      expect(result.current.sessionList[0].id).toBe('session-1');
    });

    it('should not modify activeSessionId when clearing messages', async () => {
      // Given
      const session = buildSession({ id: 'session-1' });
      const message = buildMessage({ id: 'msg-1', sessionId: 'session-1' });

      act(() => {
        useSessionStore.setState({
          sessionList: [session],
          activeSessionId: 'session-1',
          messages: [message],
        });
      });

      mockDeleteMessagesBySession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.clearSessionMessages('session-1');
      });

      // Then
      expect(result.current.activeSessionId).toBe('session-1');
    });
  });
});
