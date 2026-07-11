import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { type LanguageModel } from 'ai';
import { createOllama } from 'ai-sdk-ollama';

import type { ModelProfile } from '../profiles';
import { ollamaFetch, timeoutFetch } from './dispatchers';
import {
  DEFAULT_OLLAMA_REPEAT_PENALTY,
  DEFAULT_OLLAMA_TEMPERATURE,
  resolveOllamaNumCtx,
  resolveOllamaSampling,
  resolveOllamaThink
} from './ollama';
import { resolveCacheControl, resolveProviderRouting, toChatProvider } from './providerRouting';
import { resolveReasoning, resolveSampling } from './sampling';

const OPENROUTER_API_KEY_ENV = 'OPENROUTER_API_KEY';

const modelBuilders: Readonly<
  Record<ModelProfile['backend'], (profile: ModelProfile) => LanguageModel>
> = {
  ollama: (profile: ModelProfile): LanguageModel => {
    const numCtx = resolveOllamaNumCtx();
    const sampling = resolveOllamaSampling();
    // Low-temperature default for deterministic codegen — small open models default to
    // ~0.8, which makes a type-correct construction a coin-flip across runs. Env
    // (RUNNER_OLLAMA_TEMPERATURE) still overrides via the trailing spread.
    const options = {
      num_ctx: numCtx,
      temperature: DEFAULT_OLLAMA_TEMPERATURE,
      repeat_penalty: DEFAULT_OLLAMA_REPEAT_PENALTY,
      ...sampling,
    };
    const think = resolveOllamaThink();
    const settings = {
      options,
      ...(think !== undefined ? { think } : {}),
    };
    const provider = createOllama({
      ...(profile.baseUrl !== undefined ? { baseURL: profile.baseUrl } : {}),
      fetch: ollamaFetch,
    });
    return provider(profile.modelId, Object.keys(settings).length > 0 ? settings : undefined);
  },
  openrouter: (profile: ModelProfile): LanguageModel => {
    const routing = resolveProviderRouting();
    const cacheControl = resolveCacheControl();
    const sampling = resolveSampling();
    const reasoning = resolveReasoning();
    const settings = {
      ...(routing ? { provider: toChatProvider(routing) } : {}),
      ...(cacheControl ? { cache_control: cacheControl } : {}),
      ...(sampling ? { extraBody: sampling } : {}),
      ...(reasoning ? { reasoning } : {}),
    };
    return createOpenRouter({ apiKey: requireApiKey(profile), fetch: timeoutFetch }).chat(
      profile.modelId,
      Object.keys(settings).length > 0 ? settings : undefined
    );
  },
  'openai-compatible': (profile: ModelProfile): LanguageModel => {
    // The openai-compatible callable takes only modelId; sampling is injected into
    // every outgoing request body via transformRequestBody (the OpenAI-style chat
    // sampling shape `resolveSampling()` returns merges directly into the body).
    const sampling = resolveSampling();
    return createOpenAICompatible({
      name: profile.name,
      baseURL: requireBaseUrl(profile),
      fetch: timeoutFetch,
      ...(sampling
        ? {
            transformRequestBody: (body: Record<string, unknown>): Record<string, unknown> => ({
              ...body,
              ...sampling,
            }),
          }
        : {}),
    })(profile.modelId);
  },
};

function requireApiKey(profile: ModelProfile): string {
  const apiKey = process.env[OPENROUTER_API_KEY_ENV];
  if (apiKey === undefined || apiKey === '') {
    throw new Error(
      `Profile '${profile.name}' (${profile.backend}) requires ${OPENROUTER_API_KEY_ENV}`
    );
  }
  return apiKey;
}

function requireBaseUrl(profile: ModelProfile): string {
  if (profile.baseUrl === undefined) {
    throw new Error(`Profile '${profile.name}' (${profile.backend}) requires a baseUrl`);
  }
  return profile.baseUrl;
}

export function createModel(profile: ModelProfile): LanguageModel {
  return modelBuilders[profile.backend](profile);
}
