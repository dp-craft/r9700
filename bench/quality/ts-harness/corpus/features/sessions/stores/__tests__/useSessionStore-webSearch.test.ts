import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSession } from '@/domain/entities';

vi.mock('@/db/sessions', () => ({
  getAllSessions: vi.fn().mockResolvedValue([]),
  putSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/messages', () => ({
  getMessages: vi.fn().mockResolvedValue([]),
  putMessage: vi.fn().mockResolvedValue(undefined),
}));

import * as sessionDb from '@/db/sessions';

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

// -- Mock aliases --

const mockGetAllSessions = sessionDb.getAllSessions as ReturnType<typeof vi.fn>;
const mockPutSession = sessionDb.putSession as ReturnType<typeof vi.fn>;

describe('useSessionStore — webSearch', () => {
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
  // createSession — webSearchEnabled default
  // =========================================================================

  describe('createSession — webSearchEnabled default', () => {
    it('should default webSearchEnabled to false when a new session is created', async () => {
      // Given
      mockGetAllSessions.mockResolvedValueOnce([]);
      mockPutSession.mockResolvedValueOnce(undefined);
      // setActiveSession triggers loadMessages
      vi.mocked(sessionDb.getAllSessions); // already set above

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.createSession('ollama', 'llama3', null);
      });

      // Then
      expect(mockPutSession).toHaveBeenCalledOnce();
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.webSearchEnabled).toBe(false);
    });
  });

  // =========================================================================
  // setSessionWebSearch — enable
  // =========================================================================

  describe('setSessionWebSearch — enable', () => {
    it('should set webSearchEnabled to true when called with enabled=true', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', webSearchEnabled: false });
      const updatedSession = buildSession({ id: 'session-1', webSearchEnabled: true });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.setSessionWebSearch('session-1', true);
      });

      // Then
      expect(result.current.sessionList[0].webSearchEnabled).toBe(true);
    });
  });

  // =========================================================================
  // setSessionWebSearch — disable
  // =========================================================================

  describe('setSessionWebSearch — disable', () => {
    it('should set webSearchEnabled to false when called with enabled=false after being enabled', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', webSearchEnabled: true });
      const updatedSession = buildSession({ id: 'session-1', webSearchEnabled: false });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.setSessionWebSearch('session-1', false);
      });

      // Then
      expect(result.current.sessionList[0].webSearchEnabled).toBe(false);
    });
  });

  // =========================================================================
  // setSessionWebSearch — IDB persistence
  // =========================================================================

  describe('setSessionWebSearch — IDB persistence', () => {
    it('should call putSession with webSearchEnabled=true when enabling web search', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', webSearchEnabled: false });
      const updatedSession = buildSession({ id: 'session-1', webSearchEnabled: true });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.setSessionWebSearch('session-1', true);
      });

      // Then
      expect(mockPutSession).toHaveBeenCalledOnce();
      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', webSearchEnabled: true })
      );
    });

    it('should reload sessions from IDB after persisting the updated session', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', webSearchEnabled: false });
      const reloadedSessions = [
        buildSession({ id: 'session-1', webSearchEnabled: true }),
        buildSession({ id: 'session-2', title: 'Other Session' }),
      ];

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce(reloadedSessions);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.setSessionWebSearch('session-1', true);
      });

      // Then
      expect(mockGetAllSessions).toHaveBeenCalledOnce();
      expect(result.current.sessionList).toEqual(reloadedSessions);
    });
  });

  // =========================================================================
  // setSessionWebSearch — non-existent session
  // =========================================================================

  describe('setSessionWebSearch — non-existent session', () => {
    it('should not call putSession and should not throw when sessionId does not match any session', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', webSearchEnabled: false });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      // When / Then
      await act(async () => {
        await expect(
          result.current.setSessionWebSearch('non-existent-id', true)
        ).resolves.toBeUndefined();
      });

      expect(mockPutSession).not.toHaveBeenCalled();
    });

    it('should leave sessionList unchanged when sessionId does not match any session', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', webSearchEnabled: false });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.setSessionWebSearch('non-existent-id', true);
      });

      // Then
      expect(result.current.sessionList).toHaveLength(1);
      expect(result.current.sessionList[0].webSearchEnabled).toBe(false);
    });
  });
});
