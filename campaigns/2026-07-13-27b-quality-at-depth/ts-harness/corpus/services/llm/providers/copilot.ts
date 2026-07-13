import { getProxyUrl } from '@/lib/proxy-url';
import { getSessionToken } from '@/services/copilot-auth';

import { filterChatModels, sortModels } from '../model-utils';
import { openAiSseStream } from '../streams/openai-sse';
import type { ChatOptions, LLMProvider, Model, ProviderConfig, StreamEvent } from '../types';

export const COPILOT_HEADERS: Readonly<Record<string, string>> = {
  'Copilot-Integration-Id': 'vscode-chat',
  'editor-version': 'vscode/1.85.1',
  'editor-plugin-version': 'copilot/1.155.0',
};

export const buildCopilotHeaders = (sessionToken: string): Record<string, string> => ({
  Authorization: `Bearer ${sessionToken}`,
  ...COPILOT_HEADERS,
});

interface CopilotModelEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: { readonly type: string };
  readonly model_picker_enabled: boolean;
}

interface CopilotModelsResponse {
  readonly data: readonly CopilotModelEntry[];
}

// Copilot proxies OpenAI reasoning families: o1/o3/o4 series.
const COPILOT_THINKING_PREFIXES = ['o1', 'o3', 'o4'] as const;

const copilotSupportsThinking = (id: string): boolean =>
  COPILOT_THINKING_PREFIXES.some(prefix => id.startsWith(prefix));

const mapCopilotModel = (entry: CopilotModelEntry): Model => ({
  id: entry.id,
  name: entry.name,
  supportsThinking: copilotSupportsThinking(entry.id),
});

export const copilotProvider: LLMProvider = {
  name: 'copilot',

  async* chat(options: ChatOptions): AsyncGenerator<string | StreamEvent, void, undefined> {
    const sessionToken = await getSessionToken();
    if (!sessionToken) throw new Error('Not authenticated');
    const { model, messages, signal } = options;
    yield* openAiSseStream({
      url: getProxyUrl(`${options.baseUrl ?? 'https://api.githubcopilot.com'}/chat/completions`),
      headers: {
        ...buildCopilotHeaders(sessionToken),
        'Content-Type': 'application/json',
      },
      body: {
        model,
        messages,
        stream: true,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(options.topP !== undefined ? { top_p: options.topP } : {}),
      },
      signal,
    });
  },

  async listModels(config: ProviderConfig): Promise<readonly Model[]> {
    const sessionToken = await getSessionToken();
    if (!sessionToken) throw new Error('Not authenticated');
    const response = await fetch(getProxyUrl(`${config.baseUrl}/models`), {
      headers: buildCopilotHeaders(sessionToken),
    });
    if (!response.ok) throw new Error(`Copilot /models: ${response.status}`);
    const json: CopilotModelsResponse = await response.json();
    const allModels: readonly Model[] = json.data.map(mapCopilotModel);
    return sortModels(filterChatModels(allModels));
  },

  async healthCheck(_config: ProviderConfig): Promise<boolean> {
    try {
      const sessionToken = await getSessionToken();
      return sessionToken !== null;
    } catch {
      return false;
    }
  },
} satisfies LLMProvider;
