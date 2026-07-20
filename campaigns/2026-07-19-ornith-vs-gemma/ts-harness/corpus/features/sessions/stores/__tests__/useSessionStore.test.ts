import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, ChatSession, SkillSnapshot } from '@/domain/entities';

vi.mock('@/db/sessions', () => ({
  getAllSessions: vi.fn(),
  putSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('@/db/messages', () => ({
  getMessages: vi.fn(),
  putMessage: vi.fn(),
}));

import * as messageDb from '@/db/messages';
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
  ...overrides,
});

const buildMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: 'message-1',
  sessionId: 'session-1',
  role: 'user',
  content: 'Hello',
  createdAt: FIXED_TIMESTAMP,
  ...overrides,
});

const buildSnapshot = (overrides?: Partial<SkillSnapshot>): SkillSnapshot => ({
  containerId: 'container-1',
  containerName: 'My Container',
  skillNames: ['Test Skill'],
  composedPrompt: 'Do something',
  ...overrides,
});

// -- Mock aliases --

const mockGetAllSessions = sessionDb.getAllSessions as ReturnType<typeof vi.fn>;
const mockPutSession = sessionDb.putSession as ReturnType<typeof vi.fn>;
const mockDeleteSession = sessionDb.deleteSession as ReturnType<typeof vi.fn>;
const mockGetMessages = messageDb.getMessages as ReturnType<typeof vi.fn>;
const mockPutMessage = messageDb.putMessage as ReturnType<typeof vi.fn>;

describe('useSessionStore', () => {
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
  // Initial state
  // =========================================================================

  it('should initialize with empty sessionList and null activeSessionId', () => {
    const { result } = renderHook(() => useSessionStore());

    expect(result.current.sessionList).toEqual([]);
    expect(result.current.activeSessionId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  // =========================================================================
  // loadSessions
  // =========================================================================

  it('should load sessions from db when loadSessions is called', async () => {
    const sessions = [
      buildSession({ id: 'session-1' }),
      buildSession({ id: 'session-2', title: 'Another Session' }),
    ];
    mockGetAllSessions.mockResolvedValueOnce(sessions);

    const { result } = renderHook(() => useSessionStore());

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(mockGetAllSessions).toHaveBeenCalledOnce();
    expect(result.current.sessionList).toEqual(sessions);
  });

  // =========================================================================
  // createSession — existing behaviour (regression)
  // =========================================================================

  describe('createSession — existing behaviour', () => {
    it('should create a new session with correct title, model, and providerId when createSession is called', async () => {
      mockGetAllSessions.mockResolvedValueOnce([]);
      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.createSession('ollama', 'llama3', null);
      });

      expect(mockPutSession).toHaveBeenCalledOnce();
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.providerId).toBe('ollama');
      expect(savedSession.model).toBe('llama3');
      expect(typeof savedSession.id).toBe('string');
      expect(savedSession.id.length).toBeGreaterThan(0);
      expect(typeof savedSession.createdAt).toBe('number');
      expect(typeof savedSession.updatedAt).toBe('number');
      expect(savedSession.title).toBe('New Chat');
    });
  });

  // =========================================================================
  // createSession — skillSnapshot integration
  // =========================================================================

  describe('createSession — skillSnapshot', () => {
    it('should store skillSnapshot as null when null is passed', async () => {
      // Arrange
      mockGetAllSessions.mockResolvedValueOnce([]);
      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.createSession('ollama', 'llama3', null);
      });

      // Assert
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.skillSnapshot).toBeNull();
    });

    it('should store the provided snapshot when a valid snapshot is passed', async () => {
      // Arrange
      const snapshot = buildSnapshot({ containerId: 'c1', containerName: 'My Container' });

      mockGetAllSessions.mockResolvedValueOnce([]);
      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.createSession('ollama', 'llama3', snapshot);
      });

      // Assert
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.skillSnapshot).toEqual(snapshot);
    });
  });

  // =========================================================================
  // createSession — default model per provider
  // =========================================================================

  describe('createSession — default model per provider', () => {
    it('should store the active provider selected model as the session model', async () => {
      // Arrange
      mockGetAllSessions.mockResolvedValueOnce([]);
      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.createSession('ollama', 'gemma3:4b', null);
      });

      // Assert
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.model).toBe('gemma3:4b');
    });

    it('should create session with empty model when provider has no default model set', async () => {
      // Arrange
      mockGetAllSessions.mockResolvedValueOnce([]);
      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetMessages.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.createSession('ollama', '', null);
      });

      // Assert
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.model).toBe('');
    });
  });

  // =========================================================================
  // updateSessionSnapshot
  // =========================================================================

  describe('updateSessionSnapshot', () => {
    it('should update the session record in IDB with the new snapshot and reload sessions', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', skillSnapshot: null });
      const newSnapshot = buildSnapshot({ containerId: 'c2', containerName: 'Updated Container' });
      const updatedSession = buildSession({ id: 'session-1', skillSnapshot: newSnapshot });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateSessionSnapshot('session-1', newSnapshot);
      });

      // Assert
      expect(mockPutSession).toHaveBeenCalledOnce();
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.id).toBe('session-1');
      expect(savedSession.skillSnapshot).toEqual(newSnapshot);
      expect(mockGetAllSessions).toHaveBeenCalledOnce();
    });

    it('should update the session record with null snapshot when updateSessionSnapshot is called with null', async () => {
      // Arrange
      const existingSnapshot = buildSnapshot();
      const existingSession = buildSession({ id: 'session-1', skillSnapshot: existingSnapshot });
      const updatedSession = buildSession({ id: 'session-1', skillSnapshot: null });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateSessionSnapshot('session-1', null);
      });

      // Assert
      expect(mockPutSession).toHaveBeenCalledOnce();
      const [savedSession] = mockPutSession.mock.calls[0] as [ChatSession];
      expect(savedSession.id).toBe('session-1');
      expect(savedSession.skillSnapshot).toBeNull();
      expect(result.current.sessionList).toEqual([updatedSession]);
    });

    it('should reload sessions after updateSessionSnapshot so the store reflects the persisted state', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', skillSnapshot: null });
      const newSnapshot = buildSnapshot();
      const reloadedSessions = [
        buildSession({ id: 'session-1', skillSnapshot: newSnapshot }),
        buildSession({ id: 'session-2', title: 'Other Session' }),
      ];

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce(reloadedSessions);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateSessionSnapshot('session-1', newSnapshot);
      });

      // Assert
      expect(result.current.sessionList).toEqual(reloadedSessions);
    });
  });

  // =========================================================================
  // setActiveSession
  // =========================================================================

  it('should set active session and load messages when setActiveSession is called', async () => {
    const messages = [
      buildMessage({ id: 'msg-1', sessionId: 'session-1' }),
      buildMessage({ id: 'msg-2', sessionId: 'session-1', role: 'assistant', content: 'Hi' }),
    ];
    mockGetMessages.mockResolvedValueOnce(messages);

    const { result } = renderHook(() => useSessionStore());

    await act(async () => {
      await result.current.setActiveSession('session-1');
    });

    expect(result.current.activeSessionId).toBe('session-1');
    expect(mockGetMessages).toHaveBeenCalledWith('session-1');
    expect(result.current.messages).toEqual(messages);
  });

  // =========================================================================
  // deleteSession
  // =========================================================================

  it('should delete session and clear active session when deleteSession is called with active session', async () => {
    mockDeleteSession.mockResolvedValueOnce(undefined);
    const sessions = [buildSession({ id: 'session-1' })];
    mockGetAllSessions.mockResolvedValueOnce([]);

    act(() => {
      useSessionStore.setState({
        sessionList: sessions,
        activeSessionId: 'session-1',
        messages: [buildMessage()],
      });
    });

    const { result } = renderHook(() => useSessionStore());

    await act(async () => {
      await result.current.deleteSession('session-1');
    });

    expect(mockDeleteSession).toHaveBeenCalledWith('session-1');
    expect(result.current.activeSessionId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionList.find(s => s.id === 'session-1')).toBeUndefined();
  });

  it('should delete session without clearing active when deleteSession is called with non-active session', async () => {
    mockDeleteSession.mockResolvedValueOnce(undefined);
    const sessions = [
      buildSession({ id: 'session-1' }),
      buildSession({ id: 'session-2', title: 'Other' }),
    ];
    const messages = [buildMessage()];
    mockGetAllSessions.mockResolvedValueOnce([buildSession({ id: 'session-1' })]);

    act(() => {
      useSessionStore.setState({
        sessionList: sessions,
        activeSessionId: 'session-1',
        messages,
      });
    });

    const { result } = renderHook(() => useSessionStore());

    await act(async () => {
      await result.current.deleteSession('session-2');
    });

    expect(mockDeleteSession).toHaveBeenCalledWith('session-2');
    expect(result.current.activeSessionId).toBe('session-1');
    expect(result.current.messages).toEqual(messages);
    expect(result.current.sessionList.find(s => s.id === 'session-2')).toBeUndefined();
  });

  // =========================================================================
  // loadMessages
  // =========================================================================

  it('should load messages for a session when loadMessages is called', async () => {
    const messages = [
      buildMessage({ id: 'msg-1' }),
      buildMessage({ id: 'msg-2', role: 'assistant', content: 'Reply' }),
    ];
    mockGetMessages.mockResolvedValueOnce(messages);

    const { result } = renderHook(() => useSessionStore());

    await act(async () => {
      await result.current.loadMessages('session-1');
    });

    expect(mockGetMessages).toHaveBeenCalledWith('session-1');
    expect(result.current.messages).toEqual(messages);
  });

  // =========================================================================
  // setSessionProvider
  // =========================================================================

  describe('setSessionProvider', () => {
    it('should update the session providerId in the store when sessionId matches', async () => {
      const existingSession = buildSession({ id: 'session-1', providerId: 'ollama' });
      const updatedSession = buildSession({ id: 'session-1', providerId: 'openrouter' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.setSessionProvider('session-1', 'openrouter');
      });

      expect(result.current.sessionList[0].providerId).toBe('openrouter');
    });

    it('should call putSession with the updated session when providerId changes', async () => {
      const existingSession = buildSession({ id: 'session-1', providerId: 'ollama' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([
        buildSession({ id: 'session-1', providerId: 'openrouter' }),
      ]);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.setSessionProvider('session-1', 'openrouter');
      });

      expect(mockPutSession).toHaveBeenCalledOnce();
      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', providerId: 'openrouter' })
      );
    });

    it('should reload sessions after updating the provider', async () => {
      const existingSession = buildSession({ id: 'session-1', providerId: 'ollama' });
      const reloadedSessions = [
        buildSession({ id: 'session-1', providerId: 'openrouter' }),
        buildSession({ id: 'session-2', title: 'Other Session' }),
      ];

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce(reloadedSessions);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.setSessionProvider('session-1', 'openrouter');
      });

      expect(mockGetAllSessions).toHaveBeenCalledOnce();
      expect(result.current.sessionList).toEqual(reloadedSessions);
    });

    it('should not throw when sessionId does not match any session', async () => {
      const existingSession = buildSession({ id: 'session-1', providerId: 'ollama' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await expect(
          result.current.setSessionProvider('non-existent-id', 'openrouter')
        ).resolves.toBeUndefined();
      });

      expect(mockPutSession).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // setSessionModel
  // =========================================================================

  describe('setSessionModel', () => {
    it('should update the session model in the store when sessionId matches', async () => {
      const existingSession = buildSession({ id: 'session-1', model: 'llama3' });
      const updatedSession = buildSession({ id: 'session-1', model: 'gpt-4o' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.setSessionModel('session-1', 'gpt-4o');
      });

      expect(result.current.sessionList[0].model).toBe('gpt-4o');
    });

    it('should call putSession with the updated session when model changes', async () => {
      const existingSession = buildSession({ id: 'session-1', model: 'llama3' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([
        buildSession({ id: 'session-1', model: 'gpt-4o' }),
      ]);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.setSessionModel('session-1', 'gpt-4o');
      });

      expect(mockPutSession).toHaveBeenCalledOnce();
      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', model: 'gpt-4o' })
      );
    });

    it('should reload sessions after updating the model', async () => {
      const existingSession = buildSession({ id: 'session-1', model: 'llama3' });
      const reloadedSessions = [
        buildSession({ id: 'session-1', model: 'gpt-4o' }),
        buildSession({ id: 'session-2', title: 'Other Session' }),
      ];

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce(reloadedSessions);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.setSessionModel('session-1', 'gpt-4o');
      });

      expect(mockGetAllSessions).toHaveBeenCalledOnce();
      expect(result.current.sessionList).toEqual(reloadedSessions);
    });

    it('should not throw when sessionId does not match any session', async () => {
      const existingSession = buildSession({ id: 'session-1', model: 'llama3' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await expect(
          result.current.setSessionModel('non-existent-id', 'gpt-4o')
        ).resolves.toBeUndefined();
      });

      expect(mockPutSession).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // setSessionProviderAndModel
  // =========================================================================

  describe('setSessionProviderAndModel', () => {
    it('should update both providerId and model atomically in a single putSession call', async () => {
      const existingSession = buildSession({
        id: 'session-1',
        providerId: 'ollama',
        model: 'llama3',
      });
      const updatedSession = buildSession({
        id: 'session-1',
        providerId: 'openrouter',
        model: 'gpt-4',
      });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.setSessionProviderAndModel('session-1', 'openrouter', 'gpt-4');
      });

      expect(mockPutSession).toHaveBeenCalledOnce();
      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', providerId: 'openrouter', model: 'gpt-4' })
      );
    });

    it('should reload sessions after updating provider and model', async () => {
      const existingSession = buildSession({
        id: 'session-1',
        providerId: 'ollama',
        model: 'llama3',
      });
      const reloadedSessions = [
        buildSession({ id: 'session-1', providerId: 'openrouter', model: 'gpt-4' }),
      ];

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce(reloadedSessions);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.setSessionProviderAndModel('session-1', 'openrouter', 'gpt-4');
      });

      expect(mockGetAllSessions).toHaveBeenCalledOnce();
      expect(result.current.sessionList).toEqual(reloadedSessions);
    });

    it('should not throw when sessionId does not match any session', async () => {
      const existingSession = buildSession({ id: 'session-1' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await expect(
          result.current.setSessionProviderAndModel('non-existent-id', 'openrouter', 'gpt-4')
        ).resolves.toBeUndefined();
      });

      expect(mockPutSession).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateSessionTitle
  // =========================================================================

  describe('updateSessionTitle', () => {
    it('should update session title and persist when valid title is provided', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', title: 'Old Title' });
      const updatedSession = buildSession({ id: 'session-1', title: 'New Title' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([updatedSession]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateSessionTitle('session-1', 'New Title');
      });

      // Assert
      expect(mockPutSession).toHaveBeenCalledOnce();
      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', title: 'New Title' })
      );
    });

    it('should reject whitespace-only title and not call putSession', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', title: 'Old Title' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateSessionTitle('session-1', '   ');
      });

      // Assert
      expect(mockPutSession).not.toHaveBeenCalled();
    });

    it('should reject empty title and not call putSession', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', title: 'Old Title' });

      act(() => {
        useSessionStore.setState({ sessionList: [existingSession] });
      });

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateSessionTitle('session-1', '');
      });

      // Assert
      expect(mockPutSession).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // addMessage auto-title derivation
  // =========================================================================

  describe('addMessage auto-title', () => {
    it('should derive title from first user message when messages list is empty', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', title: 'Chat 2026-01-01 10:00' });
      const longContent = 'A'.repeat(80);
      const userMessage = buildMessage({
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: longContent,
      });

      act(() => {
        useSessionStore.setState({
          sessionList: [existingSession],
          activeSessionId: 'session-1',
          messages: [],
        });
      });

      mockPutMessage.mockResolvedValueOnce(undefined);
      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([
        buildSession({ id: 'session-1', title: longContent.slice(0, 50) }),
      ]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.addMessage(userMessage);
      });

      // Assert
      expect(mockPutSession).toHaveBeenCalledOnce();
      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', title: longContent.slice(0, 50) })
      );
    });

    it('should not derive title when messages already exist', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', title: 'Original Title' });
      const existingMessage = buildMessage({
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'Earlier message',
      });
      const newMessage = buildMessage({
        id: 'msg-2',
        sessionId: 'session-1',
        role: 'user',
        content: 'New message content',
      });

      act(() => {
        useSessionStore.setState({
          sessionList: [existingSession],
          activeSessionId: 'session-1',
          messages: [existingMessage],
        });
      });

      mockPutMessage.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.addMessage(newMessage);
      });

      // Assert
      expect(mockPutSession).not.toHaveBeenCalled();
    });

    it('should not derive title for assistant messages', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', title: 'Chat 2026-01-01 10:00' });
      const assistantMessage = buildMessage({
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'I am the assistant response',
      });

      act(() => {
        useSessionStore.setState({
          sessionList: [existingSession],
          activeSessionId: 'session-1',
          messages: [],
        });
      });

      mockPutMessage.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.addMessage(assistantMessage);
      });

      // Assert
      expect(mockPutSession).not.toHaveBeenCalled();
    });

    it('should use full content as title when content is shorter than 50 chars', async () => {
      // Arrange
      const existingSession = buildSession({ id: 'session-1', title: 'Chat 2026-01-01 10:00' });
      const shortContent = 'Hello there';
      const userMessage = buildMessage({
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: shortContent,
      });

      act(() => {
        useSessionStore.setState({
          sessionList: [existingSession],
          activeSessionId: 'session-1',
          messages: [],
        });
      });

      mockPutMessage.mockResolvedValueOnce(undefined);
      mockPutSession.mockResolvedValueOnce(undefined);
      mockGetAllSessions.mockResolvedValueOnce([
        buildSession({ id: 'session-1', title: shortContent }),
      ]);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.addMessage(userMessage);
      });

      // Assert
      expect(mockPutSession).toHaveBeenCalledOnce();
      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', title: shortContent })
      );
    });
  });

  // =========================================================================
  // updateMessage
  // =========================================================================

  describe('updateMessage', () => {
    it('should call putMessage with the updated message', async () => {
      // Arrange
      const originalMessage = buildMessage({ id: 'msg-1', content: 'Hello' });
      const updatedMessage = buildMessage({ id: 'msg-1', content: 'Hello updated' });

      act(() => {
        useSessionStore.setState({ messages: [originalMessage] });
      });

      mockPutMessage.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateMessage(updatedMessage);
      });

      // Assert
      expect(mockPutMessage).toHaveBeenCalledOnce();
      expect(mockPutMessage).toHaveBeenCalledWith(updatedMessage);
    });

    it('should update the message in the in-memory messages array when message ID matches', async () => {
      // Arrange
      const message1 = buildMessage({ id: 'msg-1', content: 'First' });
      const message2 = buildMessage({ id: 'msg-2', content: 'Second', role: 'assistant' });
      const updatedMessage1 = buildMessage({ id: 'msg-1', content: 'First updated' });

      act(() => {
        useSessionStore.setState({ messages: [message1, message2] });
      });

      mockPutMessage.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateMessage(updatedMessage1);
      });

      // Assert
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]).toEqual(updatedMessage1);
      expect(result.current.messages[1]).toEqual(message2);
    });

    it('should not modify messages array when message ID is not found', async () => {
      // Arrange
      const existingMessage = buildMessage({ id: 'msg-1', content: 'Hello' });
      const unknownMessage = buildMessage({ id: 'msg-unknown', content: 'Ghost' });

      act(() => {
        useSessionStore.setState({ messages: [existingMessage] });
      });

      mockPutMessage.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useSessionStore());

      // Act
      await act(async () => {
        await result.current.updateMessage(unknownMessage);
      });

      // Assert
      expect(mockPutMessage).toHaveBeenCalledOnce();
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]).toEqual(existingMessage);
    });
  });
});
