import { ENV } from '../shared';

const PROVIDER_ENV = ENV.OPENROUTER_PROVIDER;
const QUANTIZATION_ENV = ENV.OPENROUTER_QUANTIZATION;
const ALLOW_FALLBACKS_ENV = ENV.OPENROUTER_ALLOW_FALLBACKS;
const CACHE_CONTROL_ENV = ENV.OPENROUTER_CACHE_CONTROL;

// Opt-in OpenRouter prompt-caching directive. Per @openrouter/ai-sdk-provider it
// only takes effect for Anthropic-routed models (the runner's open models on
// AtlasCloud/Ollama ignore it), so it is OFF by default and never auto-applied.
export const resolveCacheControl = (
  env: NodeJS.ProcessEnv = process.env
): { readonly type: 'ephemeral' } | undefined => {
  const val = (env[CACHE_CONTROL_ENV] ?? '').trim().toLowerCase();
  return val === '' || val === 'false' || val === '0' ? undefined : { type: 'ephemeral' };
};

export type ProviderRouting = {
  readonly only?: readonly string[];
  readonly order?: readonly string[];
  readonly quantizations?: readonly string[];
  readonly allow_fallbacks?: boolean;
};

const parseList = (raw: string | undefined): readonly string[] =>
  raw === undefined
    ? []
    : raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

export const resolveAllowFallbacks = (env: NodeJS.ProcessEnv): boolean => {
  const val = (env[ALLOW_FALLBACKS_ENV] ?? '').trim().toLowerCase();
  return val !== 'false' && val !== '0';
};

export const resolveProviderRouting = (
  env: NodeJS.ProcessEnv = process.env
): ProviderRouting | undefined => {
  const providers = parseList(env[PROVIDER_ENV]);
  const quantizations = parseList(env[QUANTIZATION_ENV]);

  if (providers.length === 0 && quantizations.length === 0) return undefined;

  const quant = quantizations.length > 0 ? { quantizations } : {};

  if (providers.length === 0) return { ...quant };

  return resolveAllowFallbacks(env)
    ? { order: providers, allow_fallbacks: true, ...quant }
    : { only: providers, allow_fallbacks: false, ...quant };
};

// Boundary adapter: our ProviderRouting uses readonly arrays; the OpenRouter SDK's
// `provider` field expects mutable string[]. Copy at the single SDK call site so the
// domain type stays readonly for consumers.
interface ChatProvider {
  only?: string[];
  order?: string[];
  quantizations?: string[];
  allow_fallbacks?: boolean;
}

export const toChatProvider = (routing: ProviderRouting): ChatProvider => ({
  ...(routing.only ? { only: [...routing.only] } : {}),
  ...(routing.order ? { order: [...routing.order] } : {}),
  ...(routing.quantizations ? { quantizations: [...routing.quantizations] } : {}),
  ...(routing.allow_fallbacks !== undefined ? { allow_fallbacks: routing.allow_fallbacks } : {}),
});
