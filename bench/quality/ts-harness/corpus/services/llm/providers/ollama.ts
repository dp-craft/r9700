import { OLLAMA_DEFAULT_BASE_URL } from '@/config';
import { getProxyUrl } from '@/lib/proxy-url';

import { filterChatModels, sortModels } from '../model-utils';
import type { ChatOptions, LLMProvider, Model, ProviderConfig, StreamEvent } from '../types';

interface OllamaChatChunk {
  readonly message: {
    readonly role: 'assistant';
    readonly content: string;
    readonly thinking?: string;
  };
  readonly done: boolean;
}

interface OllamaModel {
  readonly name: string;
  readonly details: { readonly parameter_size: string };
}

interface OllamaTagsResponse {
  readonly models: readonly OllamaModel[];
}

interface OllamaShowResponse {
  readonly capabilities?: readonly string[];
}

const OLLAMA_HEALTH_TIMEOUT_MS = 3000;
const DETECT_THINKING_TIMEOUT_MS = 5000;
const GPT_OSS_PATTERN = /gpt-oss/i;

const resolveThinkValue = (
  model: string,
  thinkingEnabled: boolean | undefined
): { readonly think?: true | string } => {
  if (!thinkingEnabled) return {};
  return GPT_OSS_PATTERN.test(model) ? { think: 'medium' } : { think: true };
};

async function* readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<OllamaChatChunk, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        yield JSON.parse(line) as OllamaChatChunk;
      }
    }
  } finally {
    reader.cancel();
  }
}

const enrichModelsWithThinking = (
  models: readonly Model[],
  thinkingCapableModels: Readonly<Record<string, boolean>> | undefined
): readonly Model[] =>
  thinkingCapableModels
    ? models.map(m =>
        m.id in thinkingCapableModels ? { ...m, supportsThinking: thinkingCapableModels[m.id] } : m
      )
    : models;

export const detectThinkingCapability = async (
  baseUrl: string,
  modelId: string
): Promise<boolean> => {
  try {
    const response = await fetch(getProxyUrl(`${baseUrl}/api/show`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(DETECT_THINKING_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const data: OllamaShowResponse = await response.json();
    return data.capabilities?.includes('thinking') ?? false;
  } catch {
    return false;
  }
};

export const ollamaProvider: LLMProvider = {
  name: 'ollama',

  async* chat(options: ChatOptions): AsyncGenerator<string | StreamEvent, void, undefined> {
    const { model, messages, signal, baseUrl: rawBaseUrl } = options;
    const baseUrl = rawBaseUrl || OLLAMA_DEFAULT_BASE_URL;

    const response = await fetch(getProxyUrl(`${baseUrl}/api/chat`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...resolveThinkValue(model, options.thinkingEnabled),
        ...(options.temperature !== undefined ||
        options.topP !== undefined ||
        options.maxTokens !== undefined ||
        options.contextSize !== undefined
          ? {
              options: {
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.topP !== undefined ? { top_p: options.topP } : {}),
                ...(options.maxTokens !== undefined ? { num_predict: options.maxTokens } : {}),
                ...(options.contextSize !== undefined ? { num_ctx: options.contextSize } : {}),
              },
            }
          : {}),
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama chat error: ${response.status} ${response.statusText}`);
    }

    for await (const chunk of readNdjsonStream(response.body, signal)) {
      if (chunk.message?.thinking) {
        yield { type: 'reasoning', text: chunk.message.thinking };
      }
      if (chunk.message?.content) yield chunk.message.content;
      if (chunk.done) return;
    }
  },

  async listModels(config: ProviderConfig): Promise<readonly Model[]> {
    const base = config.baseUrl || OLLAMA_DEFAULT_BASE_URL;
    const response = await fetch(getProxyUrl(`${base}/api/tags`));
    if (!response.ok) {
      throw new Error(`Ollama listModels error: ${response.status} ${response.statusText}`);
    }
    const data: OllamaTagsResponse = await response.json();
    const models = sortModels(
      filterChatModels(
        data.models.map(m => ({
          id: m.name,
          name: `${m.name} (${m.details.parameter_size})`,
        }))
      )
    );
    return enrichModelsWithThinking(models, config.thinkingCapableModels);
  },

  detectThinkingCapability: (config: ProviderConfig, modelId: string): Promise<boolean> =>
    detectThinkingCapability(config.baseUrl || OLLAMA_DEFAULT_BASE_URL, modelId),

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const base = config.baseUrl || OLLAMA_DEFAULT_BASE_URL;
      const response = await fetch(getProxyUrl(`${base}/`), {
        signal: AbortSignal.timeout(OLLAMA_HEALTH_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  },
} satisfies LLMProvider;
