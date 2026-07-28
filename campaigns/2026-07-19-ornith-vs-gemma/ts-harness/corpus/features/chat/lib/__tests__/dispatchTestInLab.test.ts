import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, ChatSession } from '@/db/idb';
import type { TestInLabPayload } from '@/domain/cross-mf';
import { usePromptTesterStore } from '@/features/prompt-tester';
import { useUIStore } from '@/stores/useUIStore';

import { dispatchTestInLab } from '../dispatchTestInLab';

// -- Builders --

const buildSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: 'session-001',
  title: 'Test Session',
  createdAt: 1_000_000,
  updatedAt: 1_000_001,
  model: 'gpt-4o',
  providerId: 'openai',
  skillSnapshot: null,
  ...overrides,
});

const buildMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-001',
  sessionId: 'session-001',
  role: 'user',
  content: 'Hello, world!',
  createdAt: 1_000_000,
  ...overrides,
});

// -- Spies --

let openScratchTabSpy: ReturnType<typeof vi.fn>;
let requestWorkspacePanelSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openScratchTabSpy = vi.fn();
  requestWorkspacePanelSpy = vi.fn();

  vi.spyOn(usePromptTesterStore, 'getState').mockReturnValue({
    ...usePromptTesterStore.getState(),
    openScratchTab: openScratchTabSpy as (payload: TestInLabPayload) => void,
  });
  vi.spyOn(useUIStore, 'getState').mockReturnValue({
    ...useUIStore.getState(),
    requestWorkspacePanel: requestWorkspacePanelSpy as (ws: string, panel: string) => void,
  });
});

// -- Tests --

describe('dispatchTestInLab — single-message variant', () => {
  it('should set payload.userPrompt to user message content (FR-033)', () => {
    const session = buildSession();
    const message = buildMessage({ role: 'user', content: 'What is TypeScript?' });

    dispatchTestInLab(session, message);

    const payload: TestInLabPayload = openScratchTabSpy.mock.calls[0][0];
    expect(payload.userPrompt).toBe('What is TypeScript?');
  });

  it('should set payload.userPrompt to assistant message content (FR-034)', () => {
    const session = buildSession();
    const message = buildMessage({
      role: 'assistant',
      content: 'TypeScript is a typed superset of JS.',
    });

    dispatchTestInLab(session, message);

    const payload: TestInLabPayload = openScratchTabSpy.mock.calls[0][0];
    expect(payload.userPrompt).toBe('TypeScript is a typed superset of JS.');
  });

  it('should set payload.model to session model (FR-035)', () => {
    const session = buildSession({ model: 'claude-3-5-sonnet' });
    const message = buildMessage();

    dispatchTestInLab(session, message);

    const payload: TestInLabPayload = openScratchTabSpy.mock.calls[0][0];
    expect(payload.model).toBe('claude-3-5-sonnet');
  });

  it('should carry only the single message text — no concatenated history (FR-036)', () => {
    const session = buildSession();
    const message = buildMessage({ content: 'Just this message' });

    dispatchTestInLab(session, message);

    const payload: TestInLabPayload = openScratchTabSpy.mock.calls[0][0];
    expect(payload.userPrompt).toBe('Just this message');
    expect(typeof payload.userPrompt).toBe('string');
  });

  it('should call openScratchTab with the built payload', () => {
    const session = buildSession();
    const message = buildMessage();

    dispatchTestInLab(session, message);

    expect(openScratchTabSpy).toHaveBeenCalledTimes(1);
    expect(openScratchTabSpy.mock.calls[0][0]).toMatchObject({
      userPrompt: 'Hello, world!',
      model: 'gpt-4o',
      providerId: 'openai',
      sourceSessionId: 'session-001',
      source: 'chat-deep-link',
    });
  });

  it('should call requestWorkspacePanel with prompt-lab and tester after dispatching', () => {
    const session = buildSession();
    const message = buildMessage();

    dispatchTestInLab(session, message);

    expect(requestWorkspacePanelSpy).toHaveBeenCalledWith('prompt-lab', 'tester');
  });

  it('should not dispatch when session is null', () => {
    const message = buildMessage();

    dispatchTestInLab(null, message);

    expect(openScratchTabSpy).not.toHaveBeenCalled();
    expect(requestWorkspacePanelSpy).not.toHaveBeenCalled();
  });

  it('should not dispatch when session is undefined', () => {
    const message = buildMessage();

    dispatchTestInLab(undefined, message);

    expect(openScratchTabSpy).not.toHaveBeenCalled();
    expect(requestWorkspacePanelSpy).not.toHaveBeenCalled();
  });
});
