import { castDraft } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { deleteMessagesBySession, getMessages, putMessage } from '@/db/messages';
import { deleteSession, getAllSessions, putSession } from '@/db/sessions';
import type { ChatMessage, ChatSession, ModelParamsDTO, SkillSnapshot } from '@/domain/entities';

interface SessionState {
  readonly sessionList: readonly ChatSession[];
  readonly activeSessionId: string | null;
  readonly messages: readonly ChatMessage[];
  readonly editingSessionId: string | null;
  setEditingSession: (id: string | null) => void;
  loadSessions: () => Promise<void>;
  createSession: (
    providerId: string,
    modelId: string,
    skillSnapshot: SkillSnapshot | null
  ) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  addMessage: (message: ChatMessage) => Promise<void>;
  updateMessage: (message: ChatMessage) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  updateSessionSnapshot: (sessionId: string, snapshot: SkillSnapshot | null) => Promise<void>;
  setSessionProvider: (sessionId: string, providerId: string) => Promise<void>;
  setSessionModel: (sessionId: string, model: string) => Promise<void>;
  setSessionProviderAndModel: (
    sessionId: string,
    providerId: string,
    model: string
  ) => Promise<void>;
  setSessionWebSearch: (sessionId: string, enabled: boolean) => Promise<void>;
  setSessionModelParams: (sessionId: string, params: ModelParamsDTO) => Promise<void>;
  resetSessionModelParams: (sessionId: string) => Promise<void>;
  clearSessionMessages: (sessionId: string) => Promise<void>;
}

const DEFAULT_SESSION_TITLE = 'New Chat';
const DERIVED_TITLE_MAX_LENGTH = 50;

export const useSessionStore = create<SessionState>()(
  immer((set, get) => ({
    sessionList: [],
    activeSessionId: null,
    messages: [],
    editingSessionId: null,

    setEditingSession: (id: string | null): void => {
      set(state => {
        state.editingSessionId = id;
      });
    },

    loadSessions: async (): Promise<void> => {
      const sessions = await getAllSessions();
      set(state => {
        state.sessionList = castDraft(sessions);
      });
    },

    createSession: async (
      providerId: string,
      modelId: string,
      skillSnapshot: SkillSnapshot | null
    ): Promise<void> => {
      const now = Date.now();
      const newSession: ChatSession = {
        id: crypto.randomUUID(),
        title: DEFAULT_SESSION_TITLE,
        createdAt: now,
        updatedAt: now,
        model: modelId,
        providerId,
        skillSnapshot,
        webSearchEnabled: false,
      };
      await putSession(newSession);
      await get().loadSessions();
      await get().setActiveSession(newSession.id);
    },

    deleteSession: async (sessionId: string): Promise<void> => {
      await deleteSession(sessionId);
      await get().loadSessions();
      if (get().activeSessionId === sessionId) {
        set(state => {
          state.activeSessionId = null;
          state.messages = [];
        });
      }
    },

    setActiveSession: async (sessionId: string): Promise<void> => {
      set(state => {
        state.activeSessionId = sessionId;
      });
      await get().loadMessages(sessionId);
    },

    loadMessages: async (sessionId: string): Promise<void> => {
      const msgs = await getMessages(sessionId);
      set(state => {
        state.messages = castDraft(msgs);
      });
    },

    addMessage: async (message: ChatMessage): Promise<void> => {
      const shouldDeriveTitle = get().messages.length === 0 && message.role === 'user';
      await putMessage(message);
      set(state => {
        state.messages = castDraft([...state.messages, message]);
      });
      const activeId = get().activeSessionId;
      if (shouldDeriveTitle && activeId) {
        const derivedTitle = message.content.slice(0, DERIVED_TITLE_MAX_LENGTH);
        await get().updateSessionTitle(activeId, derivedTitle);
      }
    },

    updateMessage: async (message: ChatMessage): Promise<void> => {
      await putMessage(message);
      set(state => {
        const idx = state.messages.findIndex(m => m.id === message.id);
        if (idx !== -1) {
          state.messages[idx] = castDraft(message);
        }
      });
    },

    updateSessionTitle: async (sessionId: string, title: string): Promise<void> => {
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      const existing = get().sessionList.find(s => s.id === sessionId);
      if (!existing) return;
      const updated: ChatSession = { ...existing, title: trimmed, updatedAt: Date.now() };
      await putSession(updated);
      await get().loadSessions();
    },

    updateSessionSnapshot: async (
      sessionId: string,
      snapshot: SkillSnapshot | null
    ): Promise<void> => {
      const existing = get().sessionList.find(s => s.id === sessionId);
      if (!existing) return;
      const updated: ChatSession = { ...existing, skillSnapshot: snapshot, updatedAt: Date.now() };
      await putSession(updated);
      await get().loadSessions();
    },

    setSessionProvider: async (sessionId: string, providerId: string): Promise<void> => {
      const existing = get().sessionList.find(s => s.id === sessionId);
      if (!existing) return;
      const updated: ChatSession = { ...existing, providerId, updatedAt: Date.now() };
      await putSession(updated);
      await get().loadSessions();
    },

    setSessionModel: async (sessionId: string, model: string): Promise<void> => {
      const existing = get().sessionList.find(s => s.id === sessionId);
      if (!existing) return;
      const updated: ChatSession = {
        ...existing,
        model,
        modelParams: undefined,
        updatedAt: Date.now(),
      };
      await putSession(updated);
      await get().loadSessions();
    },

    setSessionProviderAndModel: async (
      sessionId: string,
      providerId: string,
      model: string
    ): Promise<void> => {
      const existing = get().sessionList.find(s => s.id === sessionId);
      if (!existing) return;
      const updated: ChatSession = {
        ...existing,
        providerId,
        model,
        modelParams: undefined,
        updatedAt: Date.now(),
      };
      await putSession(updated);
      await get().loadSessions();
    },

    setSessionWebSearch: async (sessionId: string, enabled: boolean): Promise<void> => {
      const existing = get().sessionList.find(s => s.id === sessionId);
      if (!existing) return;
      const updated: ChatSession = {
        ...existing,
        webSearchEnabled: enabled,
        updatedAt: Date.now(),
      };
      await putSession(updated);
      await get().loadSessions();
    },

    setSessionModelParams: async (sessionId: string, params: ModelParamsDTO): Promise<void> => {
      const existing = get().sessionList.find(s => s.id === sessionId);
      if (!existing) return;
      const updated: ChatSession = {
        ...existing,
        modelParams: params,
        updatedAt: Date.now(),
      };
      await putSession(updated);
      await get().loadSessions();
    },

    resetSessionModelParams: async (sessionId: string): Promise<void> => {
      const existing = get().sessionList.find(s => s.id === sessionId);
      if (!existing) return;
      const updated: ChatSession = {
        ...existing,
        modelParams: undefined,
        updatedAt: Date.now(),
      };
      await putSession(updated);
      await get().loadSessions();
    },

    clearSessionMessages: async (sessionId: string): Promise<void> => {
      await deleteMessagesBySession(sessionId);
      await get().loadMessages(sessionId);
    },
  }))
);
