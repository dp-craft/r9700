import { describe, expect, it, vi } from 'vitest';

import { BROWSER_CHAT_MODEL_ID } from '@/lib/browser-chat';

import { browserProvider } from '../providers/browser';
import { unslothProvider } from '../providers/unsloth';
import { getProvider, providerRegistry } from '../registry';
import type { ProviderKey } from '../types';

// browser-chat dynamically imports @huggingface/transformers; stub it so
// registry imports don't trigger model loading in the test environment.
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  TextStreamer: class {
    constructor(_opts: unknown) {}
  },
}));

const ALL_PROVIDER_KEYS: readonly ProviderKey[] = [
  'ollama',
  'openrouter',
  'chatgpt',
  'claude',
  'kimi',
  'perplexity',
  'gemini',
  'copilot',
  'unsloth',
  'browser',
];

describe('providerRegistry', () => {
  it('should wire unslothProvider when key is unsloth', () => {
    expect(providerRegistry.unsloth).toBe(unslothProvider);
  });

  it('should resolve unslothProvider via getProvider when key is unsloth', () => {
    expect(getProvider('unsloth')).toBe(unslothProvider);
  });

  it('should have a registry entry for every ProviderKey', () => {
    for (const key of ALL_PROVIDER_KEYS) {
      expect(providerRegistry[key]).toBeDefined();
    }
  });

  it('should wire browserProvider when key is browser', () => {
    expect(providerRegistry.browser).toBe(browserProvider);
  });

  it('should resolve browserProvider via getProvider when key is browser', () => {
    expect(getProvider('browser')).toBe(browserProvider);
  });
});

describe('browserProvider', () => {
  it('should resolve to a single model with id equal to BROWSER_CHAT_MODEL_ID', async () => {
    const models = await browserProvider.listModels({} as never);

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe(BROWSER_CHAT_MODEL_ID);
  });

  it('should resolve healthCheck to true', async () => {
    const result = await browserProvider.healthCheck({} as never);

    expect(result).toBe(true);
  });
});
