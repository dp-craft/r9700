import type { ChatMessage, ChatSession } from '@/db/idb';
import type { TestInLabPayload } from '@/domain/cross-mf';

export interface PayloadTruncationResult {
  readonly payload: TestInLabPayload;
  readonly truncated: boolean;
  readonly droppedSystemPromptCount: number;
}

const resolveSystemPrompts = (session: ChatSession): readonly string[] => {
  const composed = session.skillSnapshot?.composedPrompt;
  return composed ? [composed] : [];
};

export function buildTestInLabPayload(
  session: ChatSession | null | undefined,
  message: ChatMessage
): TestInLabPayload | null {
  if (!session) return null;
  return {
    systemPrompts: resolveSystemPrompts(session),
    userPrompt: message.content,
    model: session.model,
    providerId: session.providerId,
    sourceSessionId: session.id,
    source: 'chat-deep-link',
  };
}

const payloadSize = (payload: TestInLabPayload): number => JSON.stringify(payload).length;

const dropTailUntilFits = (payload: TestInLabPayload, cap: number): TestInLabPayload => {
  if (payloadSize(payload) <= cap || payload.systemPrompts.length === 0) {
    return payload;
  }
  const next: TestInLabPayload = {
    ...payload,
    systemPrompts: payload.systemPrompts.slice(0, -1),
  };
  return dropTailUntilFits(next, cap);
};

export function truncatePayload(payload: TestInLabPayload, cap: number): PayloadTruncationResult {
  const originalCount = payload.systemPrompts.length;
  if (payloadSize(payload) <= cap) {
    return { payload, truncated: false, droppedSystemPromptCount: 0 };
  }
  const truncatedPayload = dropTailUntilFits(payload, cap);
  const droppedSystemPromptCount = originalCount - truncatedPayload.systemPrompts.length;
  return {
    payload: truncatedPayload,
    truncated: true,
    droppedSystemPromptCount,
  };
}
