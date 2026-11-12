import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSession, ModelParamsDTO } from '@/domain/entities';

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

const buildModelParams = (overrides?: Partial<ModelParamsDTO>): ModelParamsDTO => ({
  temperature: 0.7,
  maxTokens: 2048,
  topP: 0.9,
  thinkingEnabled: false,
  thinkingBudget: 0,
  contextSize: 4096,
  ...overrides,
});

// -- Mock aliases --

const mockGetAllSessions = sessionDb.getAllSessions as ReturnType<typeof vi.fn>;
const mockPutSession = sessionDb.putSession as ReturnType<typeof vi.fn>;

// =========================================================================
// Unit tests — setSessionModelParams
// =========================================================================

describe('useSessionStore — setSessionModelParams', () => {
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

  describe('setSessionModelParams — persists params', () => {
    it('should persist modelParams on the session via putSession', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1' });
      const params = buildModelParams();

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([existingSession]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.setSessionModelParams('session-1', params);
      });

      // Then
      expect(mockPutSession).toHaveBeenCalledOnce();
      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', modelParams: params })
      );
    });

    it('should reload sessions from IDB after persisting modelParams', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1' });
      const params = buildModelParams();
      const reloadedSession = buildSession({ id: 'session-1', modelParams: params });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([reloadedSession]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.setSessionModelParams('session-1', params);
      });

      // Then
      expect(mockGetAllSessions).toHaveBeenCalledOnce();
      expect(result.current.sessionList[0].modelParams).toEqual(params);
    });

    it('should not call putSession when sessionId does not match any session', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1' });
      const params = buildModelParams();

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      // When / Then
      await act(async () => {
        await expect(
          result.current.setSessionModelParams('non-existent-id', params)
        ).resolves.toBeUndefined();
      });

      expect(mockPutSession).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// Unit tests — resetSessionModelParams
// =========================================================================

describe('useSessionStore — resetSessionModelParams', () => {
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

  describe('resetSessionModelParams — clears params', () => {
    it('should set modelParams to undefined via putSession', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', modelParams: buildModelParams() });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([existingSession]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.resetSessionModelParams('session-1');
      });

      // Then
      expect(mockPutSession).toHaveBeenCalledOnce();
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.modelParams).toBeUndefined();
    });

    it('should reload sessions from IDB after resetting modelParams', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', modelParams: buildModelParams() });
      const reloadedSession = buildSession({ id: 'session-1' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([reloadedSession]);

      const { result } = renderHook(() => useSessionStore());

      // When
      await act(async () => {
        await result.current.resetSessionModelParams('session-1');
      });

      // Then
      expect(mockGetAllSessions).toHaveBeenCalledOnce();
      expect(result.current.sessionList[0].modelParams).toBeUndefined();
    });

    it('should not call putSession when sessionId does not match any session', async () => {
      // Given
      const existingSession = buildSession({ id: 'session-1', modelParams: buildModelParams() });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      // When / Then
      await act(async () => {
        await expect(
          result.current.resetSessionModelParams('non-existent-id')
        ).resolves.toBeUndefined();
      });

      expect(mockPutSession).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// Integration tests — modelParams persistence round-trip
// =========================================================================

describe('useSessionStore — modelParams integration (IDB round-trip)', () => {
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

  it('should persist modelParams and reflect them after reload via mocked IDB', async () => {
    // Given
    const session = buildSession({ id: 'session-1' });
    const params = buildModelParams({ temperature: 0.3, maxTokens: 512 });

    act(() => {
      useSessionStore.setState({ sessionList: [session] });
    });

    mockPutSession.mockImplementationOnce(async (s: ChatSession) => {
      mockGetAllSessions.mockResolvedValueOnce([s]);
    });

    const { result } = renderHook(() => useSessionStore());

    // When
    await act(async () => {
      await result.current.setSessionModelParams('session-1', params);
    });

    // Then — IDB returned the session that putSession received
    expect(result.current.sessionList[0].modelParams).toEqual(params);
    expect(result.current.sessionList[0].modelParams?.temperature).toBe(0.3);
    expect(result.current.sessionList[0].modelParams?.maxTokens).toBe(512);
  });

  it('should verify a newly built session has modelParams=undefined by default', async () => {
    // Given — session without modelParams (FR-013 default)
    const freshSession = buildSession({ id: 'session-fresh' });

    act(() => {
      useSessionStore.setState({ sessionList: [freshSession] });
    });

    const { result } = renderHook(() => useSessionStore());

    // Then
    expect(result.current.sessionList[0].modelParams).toBeUndefined();
  });

  it('should restore modelParams from the target session after a session switch', async () => {
    // Given — two sessions: one with params, one without
    const params = buildModelParams({
      temperature: 0.9,
      thinkingEnabled: true,
      thinkingBudget: 1000,
    });
    const sessionA = buildSession({ id: 'session-a', modelParams: params });
    const sessionB = buildSession({ id: 'session-b' });

    mockGetAllSessions.mockResolvedValueOnce([sessionA, sessionB]);

    const { result } = renderHook(() => useSessionStore());

    // Initialize store with both sessions
    await act(async () => {
      await result.current.loadSessions();
    });

    // Then — session-a carries modelParams, session-b does not
    const storedA = result.current.sessionList.find(s => s.id === 'session-a');
    const storedB = result.current.sessionList.find(s => s.id === 'session-b');

    expect(storedA?.modelParams).toEqual(params);
    expect(storedA?.modelParams?.thinkingEnabled).toBe(true);
    expect(storedB?.modelParams).toBeUndefined();
  });
});
