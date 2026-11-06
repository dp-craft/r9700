import { browserProvider } from './providers/browser';
import { chatgptProvider } from './providers/chatgpt';
import { claudeProvider } from './providers/claude';
import { copilotProvider } from './providers/copilot';
import { geminiProvider } from './providers/gemini';
import { kimiProvider } from './providers/kimi';
import { ollamaProvider } from './providers/ollama';
import { openrouterProvider } from './providers/openrouter';
import { perplexityProvider } from './providers/perplexity';
import { unslothProvider } from './providers/unsloth';
import type { LLMProvider, ProviderKey } from './types';

export const providerRegistry: Record<ProviderKey, LLMProvider> = {
  ollama: ollamaProvider,
  openrouter: openrouterProvider,
  chatgpt: chatgptProvider,
  claude: claudeProvider,
  kimi: kimiProvider,
  perplexity: perplexityProvider,
  gemini: geminiProvider,
  copilot: copilotProvider,
  unsloth: unslothProvider,
  browser: browserProvider,
};

export function getProvider(key: ProviderKey): LLMProvider {
  return providerRegistry[key];
}

export function lookupProvider(key: string): LLMProvider {
  const p = (providerRegistry as Record<string, LLMProvider | undefined>)[key];
  if (!p) throw new Error(`Unknown provider: "${key}"`);
  return p;
}
