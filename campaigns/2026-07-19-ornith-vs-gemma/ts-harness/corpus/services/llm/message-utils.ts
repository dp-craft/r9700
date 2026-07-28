import type { ChatMessage } from './types';

export function extractSystemPrompt(messages: readonly ChatMessage[]): string | undefined {
  const systemMessages = messages.filter(m => m.role === 'system');
  if (systemMessages.length === 0) return undefined;
  return systemMessages.map(m => m.content).join('\n');
}

export function filterNonSystemMessages(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return messages.filter(m => m.role !== 'system');
}
