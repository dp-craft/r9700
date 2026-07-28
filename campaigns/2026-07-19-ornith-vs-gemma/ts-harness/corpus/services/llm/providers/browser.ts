import { BROWSER_CHAT_MODEL_ID, streamBrowserChat } from '@/lib/browser-chat';

import type { ChatOptions, LLMProvider, Model, ProviderConfig } from '../types';

const BROWSER_MODELS: readonly Model[] = [
  { id: BROWSER_CHAT_MODEL_ID, name: 'SmolLM2 360M Instruct' },
];

export const browserProvider: LLMProvider = {
  name: 'Browser',

  async* chat(options: ChatOptions): AsyncGenerator<string, void, undefined> {
    const messages = options.messages.map(m => ({ role: m.role, content: m.content }));
    yield* streamBrowserChat(messages);
  },

  async listModels(config: ProviderConfig): Promise<readonly Model[]> {
    void config;
    return BROWSER_MODELS;
  },

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    void config;
    return true;
  },
} satisfies LLMProvider;
