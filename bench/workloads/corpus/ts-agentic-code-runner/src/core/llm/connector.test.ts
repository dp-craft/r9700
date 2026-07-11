import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelProfile } from '../profiles/profiles';
import type { GenerateRequest } from './connector';
import {
  compactionStep,
  createModel,
  DEFAULT_GENERATE_MAX_TOTAL_MS,
  DEFAULT_GENERATE_TIMEOUT_MS,
  DEFAULT_OLLAMA_NUM_CTX,
  generate,
  MAX_IDENTICAL_TOOL_CALLS,
  ollamaDispatcherOptions,
  repeatedToolCallStop,
  resolveAllowFallbacks,
  resolveCacheControl,
  resolveGenerateMaxTotalMs,
  resolveGenerateTimeoutMs,
  resolveOllamaIdleTimeoutMs,
  resolveOllamaNumCtx,
  resolveOllamaSampling,
  resolveOllamaThink,
  resolveReasoning,
  resolveSampling
} from './connector';

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: vi.fn() };
});

const { streamText } = await import('ai');
const streamTextMock = vi.mocked(streamText);

const ollamaProfile: ModelProfile = {
  name: 'p-ollama',
  backend: 'ollama',
  modelId: 'Qwen3-Coder-30B-A3B',
};
const openRouterProfile: ModelProfile = {
  name: 'p-openrouter',
  backend: 'openrouter',
  modelId: 'qwen/qwen3-coder',
};
const compatProfile: ModelProfile = {
  name: 'p-vllm',
  backend: 'openai-compatible',
  modelId: 'Qwen3-Coder-30B-A3B',
  baseUrl: 'http://127.0.0.1:8000/v1',
};

describe('createModel', () => {
  it('should build an ollama LanguageModel when backend is ollama', () => {
    const model = createModel(ollamaProfile);

    expect(model).toBeDefined();
    expect((model as { provider: string }).provider).toContain('ollama');
  });

  it('should build an ollama LanguageModel honoring profile.baseUrl when set', () => {
    const remoteOllamaProfile: ModelProfile = {
      name: 'p-ollama-remote',
      backend: 'ollama',
      modelId: 'Qwen3-Coder-30B-A3B',
      baseUrl: 'http://192.168.10.104:11434',
    };

    const model = createModel(remoteOllamaProfile);

    expect(model).toBeDefined();
    expect((model as { provider: string }).provider).toContain('ollama');
    const host = (model as unknown as { config: { client: { config: { host: string } } } })
      .config.client.config.host;
    expect(host).toBe('http://192.168.10.104:11434');
  });

  describe('openrouter backend', () => {
    const original = process.env.OPENROUTER_API_KEY;

    beforeEach(() => {
      process.env.OPENROUTER_API_KEY = 'sk-test-key';
    });

    afterEach(() => {
      if (original === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = original;
      }
    });

    it('should build an openrouter LanguageModel when OPENROUTER_API_KEY is present', () => {
      const model = createModel(openRouterProfile);

      expect(model).toBeDefined();
      expect((model as { provider: string }).provider).toContain('openrouter');
    });

    it('should throw when an openrouter profile has no OPENROUTER_API_KEY', () => {
      delete process.env.OPENROUTER_API_KEY;

      expect(() => createModel(openRouterProfile)).toThrow(/OPENROUTER_API_KEY/);
    });
  });

  it('should build an openai-compatible LanguageModel bound to baseUrl', () => {
    const model = createModel(compatProfile);

    expect(model).toBeDefined();
    expect((model as { modelId: string }).modelId).toBe(compatProfile.modelId);
  });

  it('should throw when an openai-compatible profile has no baseUrl', () => {
    const noBase: ModelProfile = {
      name: 'p-bad',
      backend: 'openai-compatible',
      modelId: 'x',
    };

    expect(() => createModel(noBase)).toThrow();
  });
});

const fakeModel = {} as LanguageModel;
const fakeTools = {} as ToolSet;
const messages: readonly ModelMessage[] = [{ role: 'user', content: 'hello' }];
const request: GenerateRequest = {
  system: 'sys',
  messages,
  tools: fakeTools,
  maxSteps: 7,
};

describe('compactionStep', () => {
  const callMsg = (id: string, path: string): ModelMessage => ({
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: id, toolName: 'read', input: { path } }],
  });
  const resultMsg = (id: string, value: string): ModelMessage => ({
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: id, toolName: 'read', output: { type: 'text', value } }],
  });

  it('should return compacted messages that elide a superseded large read', () => {
    const huge = 'y'.repeat(5000);
    const stepMessages: ModelMessage[] = [
      callMsg('c1', 'src/a.ts'),
      resultMsg('c1', huge),
      callMsg('c2', 'src/a.ts'),
      resultMsg('c2', `${huge}-v2`),
    ];

    const out = compactionStep({ messages: stepMessages });

    const firstResult = (out.messages[1].content as ReadonlyArray<{ output: { value: string } }>)[0];
    expect(firstResult.output.value).toContain('runner-compacted');
  });
});

describe('resolveCacheControl', () => {
  it('should return undefined when RUNNER_OPENROUTER_CACHE_CONTROL is unset', () => {
    expect(resolveCacheControl({})).toBeUndefined();
  });

  it('should return an ephemeral directive when enabled', () => {
    expect(resolveCacheControl({ RUNNER_OPENROUTER_CACHE_CONTROL: '1' })).toEqual({ type: 'ephemeral' });
  });

  it('should treat true/yes as enabled', () => {
    expect(resolveCacheControl({ RUNNER_OPENROUTER_CACHE_CONTROL: 'true' })).toEqual({
      type: 'ephemeral',
    });
  });

  it('should return undefined when explicitly disabled with 0 or false', () => {
    expect(resolveCacheControl({ RUNNER_OPENROUTER_CACHE_CONTROL: '0' })).toBeUndefined();
    expect(resolveCacheControl({ RUNNER_OPENROUTER_CACHE_CONTROL: 'false' })).toBeUndefined();
  });
});

describe('resolveProviderRouting', () => {
  it('should return provider order with allow_fallbacks true when RUNNER_OPENROUTER_PROVIDER is set', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({ RUNNER_OPENROUTER_PROVIDER: 'atlas-cloud' });

    expect(result).toEqual({ order: ['atlas-cloud'], allow_fallbacks: true });
  });

  it('should include quantizations when both PROVIDER and QUANTIZATION are set', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({
      RUNNER_OPENROUTER_PROVIDER: 'atlas-cloud',
      RUNNER_OPENROUTER_QUANTIZATION: 'fp8',
    });

    expect(result).toEqual({
      order: ['atlas-cloud'],
      quantizations: ['fp8'],
      allow_fallbacks: true,
    });
  });

  it('should return quantizations only without allow_fallbacks when only QUANTIZATION is set', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({ RUNNER_OPENROUTER_QUANTIZATION: 'fp8' });

    expect(result).toEqual({ quantizations: ['fp8'] });
  });

  it('should return undefined when neither env var is set', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({});

    expect(result).toBeUndefined();
  });

  it('should trim whitespace and split comma-separated provider slugs', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({ RUNNER_OPENROUTER_PROVIDER: 'atlas-cloud, deepinfra' });

    expect(result).toEqual({ order: ['atlas-cloud', 'deepinfra'], allow_fallbacks: true });
  });

  it('should treat empty string env values as unset and return undefined', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({
      RUNNER_OPENROUTER_PROVIDER: '',
      RUNNER_OPENROUTER_QUANTIZATION: '',
    });

    expect(result).toBeUndefined();
  });
});

describe('resolveSampling', () => {
  it('should return undefined when no sampling env var is set', () => {
    expect(resolveSampling({})).toBeUndefined();
  });

  it('should map a subset of keys to snake_case', () => {
    expect(
      resolveSampling({ RUNNER_OPENROUTER_TEMPERATURE: '0.7', RUNNER_OPENROUTER_TOP_K: '40' })
    ).toEqual({ temperature: 0.7, top_k: 40 });
  });

  it('should map all five sampling keys', () => {
    expect(
      resolveSampling({
        RUNNER_OPENROUTER_TEMPERATURE: '0.8',
        RUNNER_OPENROUTER_TOP_P: '0.95',
        RUNNER_OPENROUTER_TOP_K: '50',
        RUNNER_OPENROUTER_MIN_P: '0.05',
        RUNNER_OPENROUTER_REPETITION_PENALTY: '1.1',
      })
    ).toEqual({
      temperature: 0.8,
      top_p: 0.95,
      top_k: 50,
      min_p: 0.05,
      repetition_penalty: 1.1,
    });
  });

  it('should omit empty and NaN values', () => {
    expect(
      resolveSampling({
        RUNNER_OPENROUTER_TEMPERATURE: '',
        RUNNER_OPENROUTER_TOP_P: 'abc',
        RUNNER_OPENROUTER_TOP_K: '40',
      })
    ).toEqual({ top_k: 40 });
  });

  it('should return undefined when all values are empty or NaN', () => {
    expect(
      resolveSampling({ RUNNER_OPENROUTER_TEMPERATURE: '', RUNNER_OPENROUTER_TOP_P: 'x' })
    ).toBeUndefined();
  });
});

describe('resolveReasoning', () => {
  it('should return undefined when no reasoning env var is set', () => {
    expect(resolveReasoning({})).toBeUndefined();
  });

  it('should map a valid effort to an enabled effort setting', () => {
    expect(resolveReasoning({ RUNNER_OPENROUTER_REASONING_EFFORT: 'high' })).toEqual({
      enabled: true,
      effort: 'high',
    });
  });

  it('should return undefined for an invalid effort value', () => {
    expect(resolveReasoning({ RUNNER_OPENROUTER_REASONING_EFFORT: 'banana' })).toBeUndefined();
  });

  it('should return undefined for an empty effort value', () => {
    expect(resolveReasoning({ RUNNER_OPENROUTER_REASONING_EFFORT: '' })).toBeUndefined();
  });

  it('should map a numeric max_tokens when effort is unset', () => {
    expect(resolveReasoning({ RUNNER_OPENROUTER_REASONING_MAX_TOKENS: '2048' })).toEqual({
      enabled: true,
      max_tokens: 2048,
    });
  });

  it('should prefer effort over max_tokens when both are set', () => {
    expect(
      resolveReasoning({
        RUNNER_OPENROUTER_REASONING_EFFORT: 'low',
        RUNNER_OPENROUTER_REASONING_MAX_TOKENS: '2048',
      })
    ).toEqual({ enabled: true, effort: 'low' });
  });

  it('should map effort "none" to an explicit reasoning-disable setting', () => {
    expect(resolveReasoning({ RUNNER_OPENROUTER_REASONING_EFFORT: 'none' })).toEqual({
      enabled: false,
      effort: 'none',
    });
  });

  it('should prefer a "none" disable over max_tokens when both are set', () => {
    expect(
      resolveReasoning({
        RUNNER_OPENROUTER_REASONING_EFFORT: 'none',
        RUNNER_OPENROUTER_REASONING_MAX_TOKENS: '2048',
      })
    ).toEqual({ enabled: false, effort: 'none' });
  });

  it('should ignore a non-numeric max_tokens value', () => {
    expect(resolveReasoning({ RUNNER_OPENROUTER_REASONING_MAX_TOKENS: 'lots' })).toBeUndefined();
  });
});

describe('openrouter builder provider wiring', () => {
  const SAMPLING_AND_REASONING_ENVS = [
    'RUNNER_OPENROUTER_TEMPERATURE',
    'RUNNER_OPENROUTER_TOP_P',
    'RUNNER_OPENROUTER_TOP_K',
    'RUNNER_OPENROUTER_MIN_P',
    'RUNNER_OPENROUTER_REPETITION_PENALTY',
    'RUNNER_OPENROUTER_REASONING_EFFORT',
    'RUNNER_OPENROUTER_REASONING_MAX_TOKENS',
  ] as const;
  const savedSamplingReasoning: Record<string, string | undefined> = Object.fromEntries(
    SAMPLING_AND_REASONING_ENVS.map(k => [k, process.env[k]])
  );
  // Use vi.doMock + dynamic import so the module-level mock does not break
  // the existing createModel tests that rely on the real OpenRouter SDK object.
  const savedApiKey = process.env.OPENROUTER_API_KEY;
  const savedProvider = process.env.RUNNER_OPENROUTER_PROVIDER;
  const savedQuantization = process.env.RUNNER_OPENROUTER_QUANTIZATION;

  let chatMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    chatMock = vi.fn(() => ({}));
    vi.doMock('@openrouter/ai-sdk-provider', () => ({
      createOpenRouter: vi.fn(() => ({ chat: chatMock })),
    }));
    process.env.OPENROUTER_API_KEY = 'test-key';
    SAMPLING_AND_REASONING_ENVS.forEach(k => delete process.env[k]);
  });

  afterEach(() => {
    vi.doUnmock('@openrouter/ai-sdk-provider');
    vi.resetModules();
    if (savedApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedApiKey;
    if (savedProvider === undefined) delete process.env.RUNNER_OPENROUTER_PROVIDER;
    else process.env.RUNNER_OPENROUTER_PROVIDER = savedProvider;
    if (savedQuantization === undefined) delete process.env.RUNNER_OPENROUTER_QUANTIZATION;
    else process.env.RUNNER_OPENROUTER_QUANTIZATION = savedQuantization;
    SAMPLING_AND_REASONING_ENVS.forEach(k => {
      const v = savedSamplingReasoning[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  it('should fold sampling into extraBody and reasoning into reasoning when their env vars are set', async () => {
    process.env.RUNNER_OPENROUTER_TEMPERATURE = '0.7';
    process.env.RUNNER_OPENROUTER_TOP_K = '40';
    process.env.RUNNER_OPENROUTER_REASONING_EFFORT = 'high';
    const { createModel } = await import('./connector');

    createModel({ name: 'or', backend: 'openrouter', modelId: 'qwen/x' });

    expect(chatMock).toHaveBeenCalledWith('qwen/x', {
      extraBody: { temperature: 0.7, top_k: 40 },
      reasoning: { enabled: true, effort: 'high' },
    });
  });

  it('should forward resolved provider routing into .chat when RUNNER_OPENROUTER_PROVIDER and RUNNER_OPENROUTER_QUANTIZATION are set', async () => {
    process.env.RUNNER_OPENROUTER_PROVIDER = 'atlas-cloud';
    process.env.RUNNER_OPENROUTER_QUANTIZATION = 'fp8';
    const { createModel } = await import('./connector');

    createModel({ name: 'or', backend: 'openrouter', modelId: 'qwen/x' });

    expect(chatMock).toHaveBeenCalledWith('qwen/x', {
      provider: { order: ['atlas-cloud'], quantizations: ['fp8'], allow_fallbacks: true },
    });
  });

  it('should pass undefined as the second argument to .chat when neither routing env var is set', async () => {
    delete process.env.RUNNER_OPENROUTER_PROVIDER;
    delete process.env.RUNNER_OPENROUTER_QUANTIZATION;
    const { createModel } = await import('./connector');

    createModel({ name: 'or', backend: 'openrouter', modelId: 'qwen/x' });

    expect(chatMock).toHaveBeenCalledWith('qwen/x', undefined);
  });
});

const ENV_ALLOW_FALLBACKS = 'RUNNER_OPENROUTER_ALLOW_FALLBACKS';

describe('resolveAllowFallbacks', () => {
  it('should return true when env var is unset', () => {
    expect(resolveAllowFallbacks({})).toBe(true);
  });

  it('should return true when env var is empty string', () => {
    expect(resolveAllowFallbacks({ [ENV_ALLOW_FALLBACKS]: '' })).toBe(true);
  });

  it('should return false when env var is "false"', () => {
    expect(resolveAllowFallbacks({ [ENV_ALLOW_FALLBACKS]: 'false' })).toBe(false);
  });

  it('should return false when env var is "0"', () => {
    expect(resolveAllowFallbacks({ [ENV_ALLOW_FALLBACKS]: '0' })).toBe(false);
  });

  it('should return false when env var is "FALSE" (case-insensitive)', () => {
    expect(resolveAllowFallbacks({ [ENV_ALLOW_FALLBACKS]: 'FALSE' })).toBe(false);
  });

  it('should return true when env var is "true" (explicit)', () => {
    expect(resolveAllowFallbacks({ [ENV_ALLOW_FALLBACKS]: 'true' })).toBe(true);
  });

  it('should return true when env var is any other non-falsy string', () => {
    expect(resolveAllowFallbacks({ [ENV_ALLOW_FALLBACKS]: 'yes' })).toBe(true);
  });
});

describe('resolveProviderRouting — allow_fallbacks toggle', () => {
  it('should use order and allow_fallbacks:true when ALLOW_FALLBACKS is unset (default)', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({ RUNNER_OPENROUTER_PROVIDER: 'atlas-cloud' });

    expect(result).toEqual({ order: ['atlas-cloud'], allow_fallbacks: true });
  });

  it('should use only and allow_fallbacks:false when ALLOW_FALLBACKS=false', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({
      RUNNER_OPENROUTER_PROVIDER: 'atlas-cloud',
      RUNNER_OPENROUTER_ALLOW_FALLBACKS: 'false',
    });

    expect(result).toEqual({ only: ['atlas-cloud'], allow_fallbacks: false });
  });

  it('should use only and allow_fallbacks:false when ALLOW_FALLBACKS=0', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({
      RUNNER_OPENROUTER_PROVIDER: 'atlas-cloud',
      RUNNER_OPENROUTER_ALLOW_FALLBACKS: '0',
    });

    expect(result).toEqual({ only: ['atlas-cloud'], allow_fallbacks: false });
  });

  it('should use order and allow_fallbacks:true when ALLOW_FALLBACKS=true (explicit)', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({
      RUNNER_OPENROUTER_PROVIDER: 'atlas-cloud',
      RUNNER_OPENROUTER_ALLOW_FALLBACKS: 'true',
    });

    expect(result).toEqual({ order: ['atlas-cloud'], allow_fallbacks: true });
  });

  it('should include quantizations in only-mode when ALLOW_FALLBACKS=false', async () => {
    const { resolveProviderRouting } = await import('./connector');

    const result = resolveProviderRouting({
      RUNNER_OPENROUTER_PROVIDER: 'atlas-cloud',
      RUNNER_OPENROUTER_QUANTIZATION: 'fp8',
      RUNNER_OPENROUTER_ALLOW_FALLBACKS: 'false',
    });

    expect(result).toEqual({ only: ['atlas-cloud'], quantizations: ['fp8'], allow_fallbacks: false });
  });
});

describe('openrouter builder provider wiring — only mode', () => {
  const savedApiKey = process.env.OPENROUTER_API_KEY;
  const savedProvider = process.env.RUNNER_OPENROUTER_PROVIDER;
  const savedAllowFallbacks = process.env.RUNNER_OPENROUTER_ALLOW_FALLBACKS;

  let chatMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    chatMock = vi.fn(() => ({}));
    vi.doMock('@openrouter/ai-sdk-provider', () => ({
      createOpenRouter: vi.fn(() => ({ chat: chatMock })),
    }));
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.doUnmock('@openrouter/ai-sdk-provider');
    vi.resetModules();
    if (savedApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedApiKey;
    if (savedProvider === undefined) delete process.env.RUNNER_OPENROUTER_PROVIDER;
    else process.env.RUNNER_OPENROUTER_PROVIDER = savedProvider;
    if (savedAllowFallbacks === undefined) delete process.env.RUNNER_OPENROUTER_ALLOW_FALLBACKS;
    else process.env.RUNNER_OPENROUTER_ALLOW_FALLBACKS = savedAllowFallbacks;
  });

  it('should forward only (strict) routing into .chat when ALLOW_FALLBACKS=false', async () => {
    process.env.RUNNER_OPENROUTER_PROVIDER = 'atlas-cloud';
    process.env.RUNNER_OPENROUTER_ALLOW_FALLBACKS = 'false';
    const { createModel } = await import('./connector');

    createModel({ name: 'or', backend: 'openrouter', modelId: 'qwen/x' });

    expect(chatMock).toHaveBeenCalledWith('qwen/x', {
      provider: { only: ['atlas-cloud'], allow_fallbacks: false },
    });
  });

  it('should forward order (soft) routing into .chat when ALLOW_FALLBACKS is unset', async () => {
    process.env.RUNNER_OPENROUTER_PROVIDER = 'atlas-cloud';
    delete process.env.RUNNER_OPENROUTER_ALLOW_FALLBACKS;
    const { createModel } = await import('./connector');

    createModel({ name: 'or', backend: 'openrouter', modelId: 'qwen/x' });

    expect(chatMock).toHaveBeenCalledWith('qwen/x', {
      provider: { order: ['atlas-cloud'], allow_fallbacks: true },
    });
  });
});

const ENV_TIMEOUT = 'RUNNER_GENERATE_TIMEOUT_MS';
const ENV_MAX_TOTAL = 'RUNNER_GENERATE_MAX_TOTAL_MS';

type StepLike = { toolCalls: Array<{ toolName: string; input: unknown }> };

const makeSteps = (calls: Array<{ toolName: string; input: unknown }>): StepLike[] =>
  calls.map(tc => ({ toolCalls: [tc] }));

const editCall = (overrides: Partial<{ path: string; anchor: string; replacement: string }> = {}) => ({
  toolName: 'edit',
  input: { path: 'a.ts', anchor: 'x', replacement: 'y', ...overrides },
});

describe('MAX_IDENTICAL_TOOL_CALLS', () => {
  it('should be a number greater than 1', () => {
    expect(typeof MAX_IDENTICAL_TOOL_CALLS).toBe('number');
    expect(MAX_IDENTICAL_TOOL_CALLS).toBeGreaterThan(1);
  });
});

describe('repeatedToolCallStop', () => {
  it('should return true when the last limit calls are all identical', () => {
    const limit = 3;
    const predicate = repeatedToolCallStop(limit);
    const steps = makeSteps([
      editCall({ path: 'other.ts' }),
      editCall(),
      editCall(),
      editCall(),
    ]);

    expect(predicate({ steps })).toBe(true);
  });

  it('should return false when tail calls differ in input', () => {
    const limit = 3;
    const predicate = repeatedToolCallStop(limit);
    const steps = makeSteps([
      editCall(),
      editCall({ path: 'b.ts' }),
      editCall(),
    ]);

    expect(predicate({ steps })).toBe(false);
  });

  it('should return false when fewer than limit total tool calls exist', () => {
    const limit = 3;
    const predicate = repeatedToolCallStop(limit);
    const steps = makeSteps([editCall(), editCall()]);

    expect(predicate({ steps })).toBe(false);
  });

  it('should return false when tail calls differ in toolName', () => {
    const limit = 3;
    const predicate = repeatedToolCallStop(limit);
    const steps = makeSteps([
      { toolName: 'read', input: { path: 'a.ts', anchor: 'x', replacement: 'y' } },
      editCall(),
      editCall(),
    ]);

    expect(predicate({ steps })).toBe(false);
  });

  it('should treat inputs with same keys in different order as identical', () => {
    const limit = 3;
    const predicate = repeatedToolCallStop(limit);
    const steps = makeSteps([
      { toolName: 'edit', input: { anchor: 'x', path: 'a.ts', replacement: 'y' } },
      { toolName: 'edit', input: { replacement: 'y', anchor: 'x', path: 'a.ts' } },
      { toolName: 'edit', input: { path: 'a.ts', replacement: 'y', anchor: 'x' } },
    ]);

    expect(predicate({ steps })).toBe(true);
  });

  it('should return false when steps array is empty', () => {
    const predicate = repeatedToolCallStop(3);

    expect(predicate({ steps: [] })).toBe(false);
  });

  it('should handle steps with multiple tool calls per step (flattened)', () => {
    const limit = 3;
    const predicate = repeatedToolCallStop(limit);
    const steps: StepLike[] = [
      { toolCalls: [editCall(), editCall()] },
      { toolCalls: [editCall()] },
    ];

    expect(predicate({ steps })).toBe(true);
  });
});

describe('resolveOllamaNumCtx', () => {
  const ENV_NUM_CTX = 'RUNNER_OLLAMA_NUM_CTX';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_NUM_CTX];
    delete process.env[ENV_NUM_CTX];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_NUM_CTX];
    } else {
      process.env[ENV_NUM_CTX] = saved;
    }
  });

  it('should default to 64k (65536) tokens of context', () => {
    expect(DEFAULT_OLLAMA_NUM_CTX).toBe(65536);
  });

  it('should return the parsed number when RUNNER_OLLAMA_NUM_CTX is set', () => {
    process.env[ENV_NUM_CTX] = '131072';

    expect(resolveOllamaNumCtx()).toBe(131072);
  });

  it('should fall back to DEFAULT_OLLAMA_NUM_CTX when RUNNER_OLLAMA_NUM_CTX is unset', () => {
    expect(resolveOllamaNumCtx({})).toBe(DEFAULT_OLLAMA_NUM_CTX);
  });

  it('should fall back to DEFAULT_OLLAMA_NUM_CTX when RUNNER_OLLAMA_NUM_CTX is empty', () => {
    expect(resolveOllamaNumCtx({ RUNNER_OLLAMA_NUM_CTX: '' })).toBe(DEFAULT_OLLAMA_NUM_CTX);
  });

  it('should fall back to DEFAULT_OLLAMA_NUM_CTX when RUNNER_OLLAMA_NUM_CTX is NaN', () => {
    expect(resolveOllamaNumCtx({ RUNNER_OLLAMA_NUM_CTX: 'abc' })).toBe(DEFAULT_OLLAMA_NUM_CTX);
  });

  it('should let an explicit RUNNER_OLLAMA_NUM_CTX override the default', () => {
    expect(resolveOllamaNumCtx({ RUNNER_OLLAMA_NUM_CTX: '131072' })).toBe(131072);
  });
});

describe('ollama builder num_ctx threading', () => {
  const ENV_NUM_CTX = 'RUNNER_OLLAMA_NUM_CTX';
  const saved = process.env[ENV_NUM_CTX];

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_NUM_CTX];
    else process.env[ENV_NUM_CTX] = saved;
  });

  it('should build an ollama model without throwing when RUNNER_OLLAMA_NUM_CTX is set', () => {
    process.env[ENV_NUM_CTX] = '131072';

    const model = createModel(ollamaProfile);

    expect(model).toBeDefined();
    expect((model as { provider: string }).provider).toContain('ollama');
  });
});

describe('ollamaDispatcherOptions', () => {
  const ENV_IDLE = 'RUNNER_OLLAMA_IDLE_TIMEOUT_MS';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_IDLE];
    delete process.env[ENV_IDLE];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_IDLE];
    else process.env[ENV_IDLE] = saved;
  });

  it('should apply the default 20-minute finite idle timeout as the per-step watchdog', () => {
    expect(ollamaDispatcherOptions()).toEqual({
      headersTimeout: 1_200_000,
      bodyTimeout: 1_200_000,
    });
  });

  it('should let RUNNER_OLLAMA_IDLE_TIMEOUT_MS override the default', () => {
    process.env[ENV_IDLE] = '60000';

    expect(ollamaDispatcherOptions()).toEqual({ headersTimeout: 60000, bodyTimeout: 60000 });
  });
});

describe('resolveOllamaIdleTimeoutMs', () => {
  it('should return the 20-minute default when RUNNER_OLLAMA_IDLE_TIMEOUT_MS is unset', () => {
    expect(resolveOllamaIdleTimeoutMs({})).toBe(1_200_000);
  });

  it('should return the parsed value when RUNNER_OLLAMA_IDLE_TIMEOUT_MS is set', () => {
    expect(resolveOllamaIdleTimeoutMs({ RUNNER_OLLAMA_IDLE_TIMEOUT_MS: '60000' })).toBe(60000);
  });
});

describe('resolveOllamaThink', () => {
  it('should return undefined when RUNNER_OLLAMA_THINK is unset', () => {
    expect(resolveOllamaThink({})).toBeUndefined();
  });

  it('should return true for "1"', () => {
    expect(resolveOllamaThink({ RUNNER_OLLAMA_THINK: '1' })).toBe(true);
  });

  it('should return true for "true" case-insensitively', () => {
    expect(resolveOllamaThink({ RUNNER_OLLAMA_THINK: 'TRUE' })).toBe(true);
  });

  it('should return false for "false"', () => {
    expect(resolveOllamaThink({ RUNNER_OLLAMA_THINK: 'false' })).toBe(false);
  });

  it('should return false for an unrecognized value', () => {
    expect(resolveOllamaThink({ RUNNER_OLLAMA_THINK: 'yes' })).toBe(false);
  });
});

describe('resolveOllamaSampling', () => {
  it('should return an empty object when no sampling envs are set', () => {
    expect(resolveOllamaSampling({})).toEqual({});
  });

  it('should pick up the four numeric sampling envs', () => {
    expect(
      resolveOllamaSampling({
        RUNNER_OLLAMA_TEMPERATURE: '0.7',
        RUNNER_OLLAMA_TOP_P: '0.9',
        RUNNER_OLLAMA_TOP_K: '40',
        RUNNER_OLLAMA_REPEAT_PENALTY: '1.1',
      })
    ).toEqual({ temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.1 });
  });

  it('should map RUNNER_OLLAMA_NUM_PREDICT to num_predict when set', () => {
    expect(
      resolveOllamaSampling({ RUNNER_OLLAMA_NUM_PREDICT: '10000' })
    ).toEqual({ num_predict: 10000 });
  });

  it('should omit num_predict when RUNNER_OLLAMA_NUM_PREDICT is unset', () => {
    expect(resolveOllamaSampling({})).not.toHaveProperty('num_predict');
  });

  it('should omit num_predict when RUNNER_OLLAMA_NUM_PREDICT is an empty string', () => {
    expect(
      resolveOllamaSampling({ RUNNER_OLLAMA_NUM_PREDICT: '' })
    ).not.toHaveProperty('num_predict');
  });

  it('should omit num_predict when RUNNER_OLLAMA_NUM_PREDICT is non-numeric', () => {
    expect(
      resolveOllamaSampling({ RUNNER_OLLAMA_NUM_PREDICT: 'abc' })
    ).not.toHaveProperty('num_predict');
  });

  it('should keep num_predict and temperature independent when both are set', () => {
    expect(
      resolveOllamaSampling({
        RUNNER_OLLAMA_NUM_PREDICT: '512',
        RUNNER_OLLAMA_TEMPERATURE: '0.3',
      })
    ).toEqual({ num_predict: 512, temperature: 0.3 });
  });
});

describe('resolveGenerateTimeoutMs', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_TIMEOUT];
    delete process.env[ENV_TIMEOUT];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_TIMEOUT];
    } else {
      process.env[ENV_TIMEOUT] = saved;
    }
  });

  it('should return the default timeout when the env var is unset', () => {
    expect(resolveGenerateTimeoutMs()).toBe(DEFAULT_GENERATE_TIMEOUT_MS);
  });

  it('should return the parsed env override when RUNNER_GENERATE_TIMEOUT_MS is set', () => {
    process.env[ENV_TIMEOUT] = '12345';

    expect(resolveGenerateTimeoutMs()).toBe(12345);
  });

  it('should fall back to the default when RUNNER_GENERATE_TIMEOUT_MS is not a number', () => {
    process.env[ENV_TIMEOUT] = 'not-a-number';

    expect(resolveGenerateTimeoutMs()).toBe(DEFAULT_GENERATE_TIMEOUT_MS);
  });
});

describe('resolveGenerateMaxTotalMs', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_MAX_TOTAL];
    delete process.env[ENV_MAX_TOTAL];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_MAX_TOTAL];
    } else {
      process.env[ENV_MAX_TOTAL] = saved;
    }
  });

  it('should return 2_700_000 as the default when RUNNER_GENERATE_MAX_TOTAL_MS is unset', () => {
    expect(resolveGenerateMaxTotalMs()).toBe(DEFAULT_GENERATE_MAX_TOTAL_MS);
    expect(resolveGenerateMaxTotalMs()).toBe(2_700_000);
  });

  it('should return the parsed value when RUNNER_GENERATE_MAX_TOTAL_MS is set to 5000', () => {
    process.env[ENV_MAX_TOTAL] = '5000';

    expect(resolveGenerateMaxTotalMs()).toBe(5000);
  });
});

describe('openai-compatible builder sampling wiring', () => {
  const SAMPLING_ENVS = [
    'RUNNER_OPENROUTER_TEMPERATURE',
    'RUNNER_OPENROUTER_TOP_P',
    'RUNNER_OPENROUTER_TOP_K',
    'RUNNER_OPENROUTER_MIN_P',
    'RUNNER_OPENROUTER_REPETITION_PENALTY',
  ] as const;
  const saved: Record<string, string | undefined> = Object.fromEntries(
    SAMPLING_ENVS.map(k => [k, process.env[k]])
  );
  let providerMock: ReturnType<typeof vi.fn>;
  let createMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    providerMock = vi.fn(() => ({}));
    createMock = vi.fn(() => providerMock);
    vi.doMock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: createMock }));
    SAMPLING_ENVS.forEach(k => delete process.env[k]);
  });

  afterEach(() => {
    vi.doUnmock('@ai-sdk/openai-compatible');
    vi.resetModules();
    SAMPLING_ENVS.forEach(k => {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  it('should inject OpenAI-style sampling into the request body when RUNNER_OPENROUTER_* is set', async () => {
    process.env.RUNNER_OPENROUTER_TEMPERATURE = '0.4';
    process.env.RUNNER_OPENROUTER_TOP_P = '0.9';
    const { createModel: freshCreateModel } = await import('./connector');

    freshCreateModel(compatProfile);

    expect(providerMock).toHaveBeenCalledWith(compatProfile.modelId);
    const options = createMock.mock.calls[0]?.[0] as {
      transformRequestBody?: (b: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(options.transformRequestBody?.({ model: 'm' })).toEqual({
      model: 'm',
      temperature: 0.4,
      top_p: 0.9,
    });
  });

  it('should not set transformRequestBody when no sampling env is set', async () => {
    const { createModel: freshCreateModel } = await import('./connector');

    freshCreateModel(compatProfile);

    expect(providerMock).toHaveBeenCalledWith(compatProfile.modelId);
    const options = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).not.toHaveProperty('transformRequestBody');
  });
});

// ─── Streaming generate() tests ───────────────────────────────────────────────

type FakeStreamStep = { toolCalls: Array<{ toolName: string }>; usage: { inputTokens: number } };

type FakeStreamResult = {
  fullStream: AsyncIterable<never>;
  text: Promise<string>;
  steps: Promise<FakeStreamStep[]>;
  usage: Promise<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
  totalUsage: Promise<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
  toolCalls: Promise<Array<{ toolName: string }>>;
};

const makeStreamResult = (
  text: string,
  toolCalls: Array<{ toolName: string }> = [],
  totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  steps: FakeStreamStep[] = [],
  usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
): FakeStreamResult => ({
  fullStream: (async function* () {})(),
  text: Promise.resolve(text),
  steps: Promise.resolve(steps),
  usage: Promise.resolve(usage),
  totalUsage: Promise.resolve(totalUsage),
  toolCalls: Promise.resolve(toolCalls),
});

describe('generate (streaming)', () => {
  let savedTimeout: string | undefined;
  let savedMaxTotal: string | undefined;

  beforeEach(() => {
    savedTimeout = process.env[ENV_TIMEOUT];
    savedMaxTotal = process.env[ENV_MAX_TOTAL];
    delete process.env[ENV_TIMEOUT];
    delete process.env[ENV_MAX_TOTAL];
    streamTextMock.mockReset();
  });

  afterEach(() => {
    if (savedTimeout === undefined) delete process.env[ENV_TIMEOUT];
    else process.env[ENV_TIMEOUT] = savedTimeout;
    if (savedMaxTotal === undefined) delete process.env[ENV_MAX_TOTAL];
    else process.env[ENV_MAX_TOTAL] = savedMaxTotal;
  });

  it('should call streamText (not generateText) with abortSignal, stopWhen[3], system, messages, tools', async () => {
    streamTextMock.mockReturnValue(
      makeStreamResult('streamed') as unknown as ReturnType<typeof streamText>
    );

    await generate(fakeModel, request);

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: fakeModel,
        system: 'sys',
        messages: [...messages],
        tools: fakeTools,
        abortSignal: expect.any(AbortSignal),
        stopWhen: expect.arrayContaining([
          expect.anything(),
          expect.anything(),
          expect.anything(),
        ]),
      })
    );
    const call = streamTextMock.mock.calls[0]?.[0] as { stopWhen?: unknown[] };
    expect(call.stopWhen).toHaveLength(3);
  });

  it('should drain fullStream and return a GenerateResult assembled from stream text, toolCalls, and totalUsage', async () => {
    const streamUsage = { inputTokens: 500, outputTokens: 40, totalTokens: 540 };
    streamTextMock.mockReturnValue(
      makeStreamResult(
        'streamed text',
        [{ toolName: 'read' }, { toolName: 'write' }],
        streamUsage
      ) as unknown as ReturnType<typeof streamText>
    );

    const result = await generate(fakeModel, request);

    expect(result.text).toBe('streamed text');
    expect(result.toolCallCount).toBe(2);
    expect(result.usage).toEqual(streamUsage);
  });

  it('should throw an error containing generation-timeout when the stream produces no events and the idle-gap watchdog fires', async () => {
    vi.useFakeTimers();
    process.env[ENV_TIMEOUT] = '50';

    let capturedSignal: AbortSignal | undefined;
    streamTextMock.mockImplementation(
      ({ abortSignal }: { abortSignal?: AbortSignal }) => {
        capturedSignal = abortSignal;
        const fullStream: AsyncIterable<never> = {
          [Symbol.asyncIterator]() {
            return {
              next(): Promise<IteratorResult<never>> {
                return new Promise<IteratorResult<never>>((_resolve, reject) => {
                  if (capturedSignal?.aborted) {
                    reject(new DOMException('AbortError', 'AbortError'));
                    return;
                  }
                  capturedSignal?.addEventListener('abort', () => {
                    reject(new DOMException('AbortError', 'AbortError'));
                  });
                });
              },
            };
          },
        };
        return {
          fullStream,
          text: new Promise<string>((_resolve, reject) => {
            capturedSignal?.addEventListener('abort', () =>
              reject(new DOMException('AbortError', 'AbortError'))
            );
          }),
          steps: Promise.resolve([]),
          usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
          totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
          toolCalls: Promise.resolve([]),
        } as unknown as ReturnType<typeof streamText>;
      }
    );

    const generatePromise = generate(fakeModel, request);
    await vi.runAllTimersAsync();

    await expect(generatePromise).rejects.toThrow('generation-timeout');

    vi.useRealTimers();
  });

  it('should report the largest per-step prompt token count as maxStepPromptTokens', async () => {
    streamTextMock.mockReturnValue(
      makeStreamResult('ok', [], { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, [
        { toolCalls: [], usage: { inputTokens: 1000 } },
        { toolCalls: [], usage: { inputTokens: 62000 } },
        { toolCalls: [], usage: { inputTokens: 40000 } },
      ]) as unknown as ReturnType<typeof streamText>
    );

    const result = await generate(fakeModel, request);

    expect(result.maxStepPromptTokens).toBe(62000);
  });

  it('should fall back to the top-level usage inputTokens as maxStepPromptTokens when no steps are present', async () => {
    streamTextMock.mockReturnValue(
      makeStreamResult(
        'ok',
        [],
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        [],
        { inputTokens: 12345, outputTokens: 1, totalTokens: 12346 }
      ) as unknown as ReturnType<typeof streamText>
    );

    const result = await generate(fakeModel, request);

    expect(result.maxStepPromptTokens).toBe(12345);
  });

  it('should return markdown-fenced text without alteration when no parsing applies', async () => {
    const fenced = '```json\n{"kind":"tool-call"}\n```';
    streamTextMock.mockReturnValue(
      makeStreamResult(fenced) as unknown as ReturnType<typeof streamText>
    );

    const result = await generate(fakeModel, request);

    expect(result.text).toBe(fenced);
    expect(result.toolCallCount).toBe(0);
  });

  it('should pass a prepareStep hook to streamText for in-loop compaction', async () => {
    streamTextMock.mockReturnValue(
      makeStreamResult('ok') as unknown as ReturnType<typeof streamText>
    );

    await generate(fakeModel, request);

    const call = streamTextMock.mock.calls[0]?.[0] as { prepareStep?: unknown };
    expect(typeof call.prepareStep).toBe('function');
  });

  it('should reject with generation-timeout containing wall-clock when the total cap fires before the idle-gap watchdog', async () => {
    vi.useFakeTimers();
    process.env[ENV_TIMEOUT] = '100000';
    process.env[ENV_MAX_TOTAL] = '1000';

    let capturedSignal: AbortSignal | undefined;
    streamTextMock.mockImplementation(({ abortSignal }: { abortSignal?: AbortSignal }) => {
      capturedSignal = abortSignal;
      let firstEventDelivered = false;
      const fullStream: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<unknown>> {
              if (!firstEventDelivered) {
                firstEventDelivered = true;
                return Promise.resolve({ value: { type: 'text-delta', textDelta: 'x' }, done: false });
              }
              return new Promise<IteratorResult<unknown>>((_resolve, reject) => {
                if (capturedSignal?.aborted) {
                  reject(new DOMException('AbortError', 'AbortError'));
                  return;
                }
                capturedSignal?.addEventListener('abort', () => {
                  reject(new DOMException('AbortError', 'AbortError'));
                });
              });
            },
          };
        },
      };
      return {
        fullStream,
        text: new Promise<string>((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () =>
            reject(new DOMException('AbortError', 'AbortError'))
          );
        }),
        steps: Promise.resolve([]),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        toolCalls: Promise.resolve([]),
      } as unknown as ReturnType<typeof streamText>;
    });

    const generatePromise = generate(fakeModel, request);
    await vi.runAllTimersAsync();

    await expect(generatePromise).rejects.toThrow('generation-timeout');
    await expect(generatePromise).rejects.toThrow('wall-clock');

    vi.useRealTimers();
  });

  it('should reject with generation-timeout/wall-clock when a continuously-streaming runaway never honors the abort signal', async () => {
    vi.useFakeTimers();
    process.env[ENV_TIMEOUT] = '100000'; // large idle window — events keep arriving, idle never fires
    process.env[ENV_MAX_TOTAL] = '1000'; // small wall-clock cap

    const EVENT_DELAY_MS = 1;
    const MAX_EVENTS = 2000; // finite safety bound; the provider ignores abort entirely
    streamTextMock.mockImplementation(() => {
      let delivered = 0;
      const fullStream: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<unknown>> {
              if (delivered >= MAX_EVENTS) return Promise.resolve({ value: undefined, done: true });
              delivered += 1;
              // Never inspects the abort signal — simulates an ai-sdk-ollama mid-stream runaway.
              return new Promise<IteratorResult<unknown>>(resolve => {
                setTimeout(
                  () => resolve({ value: { type: 'text-delta', textDelta: 't' }, done: false }),
                  EVENT_DELAY_MS
                );
              });
            },
          };
        },
      };
      return {
        fullStream,
        text: Promise.resolve('runaway'),
        steps: Promise.resolve([]),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        toolCalls: Promise.resolve([]),
      } as unknown as ReturnType<typeof streamText>;
    });

    const generatePromise = generate(fakeModel, request);
    await vi.advanceTimersByTimeAsync(MAX_EVENTS * EVENT_DELAY_MS + 100);

    await expect(generatePromise).rejects.toThrow('generation-timeout');
    await expect(generatePromise).rejects.toThrow('wall-clock');

    vi.useRealTimers();
  });

  it('should reject with generation-timeout containing no-generation-activity (not wall-clock) when idle-gap fires before total cap', async () => {
    vi.useFakeTimers();
    process.env[ENV_TIMEOUT] = '1000';
    process.env[ENV_MAX_TOTAL] = '100000';

    let capturedSignal: AbortSignal | undefined;
    streamTextMock.mockImplementation(({ abortSignal }: { abortSignal?: AbortSignal }) => {
      capturedSignal = abortSignal;
      const fullStream: AsyncIterable<never> = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<never>> {
              return new Promise<IteratorResult<never>>((_resolve, reject) => {
                if (capturedSignal?.aborted) {
                  reject(new DOMException('AbortError', 'AbortError'));
                  return;
                }
                capturedSignal?.addEventListener('abort', () => {
                  reject(new DOMException('AbortError', 'AbortError'));
                });
              });
            },
          };
        },
      };
      return {
        fullStream,
        text: new Promise<string>((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () =>
            reject(new DOMException('AbortError', 'AbortError'))
          );
        }),
        steps: Promise.resolve([]),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        toolCalls: Promise.resolve([]),
      } as unknown as ReturnType<typeof streamText>;
    });

    const generatePromise = generate(fakeModel, request);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(generatePromise).rejects.toThrow('generation-timeout');
    await expect(generatePromise).rejects.toThrow('no generation activity');
    const error = (await generatePromise.catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain('wall-clock');

    vi.useRealTimers();
  });
});

// ─── Ollama builder repeat_penalty tests ──────────────────────────────────────

describe('ollama builder repeat_penalty', () => {
  const ENV_REPEAT_PENALTY = 'RUNNER_OLLAMA_REPEAT_PENALTY';
  let savedRepeatPenalty: string | undefined;
  let ollamaProviderMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    savedRepeatPenalty = process.env[ENV_REPEAT_PENALTY];
    delete process.env[ENV_REPEAT_PENALTY];
    vi.resetModules();
    ollamaProviderMock = vi.fn(() => ({}));
    vi.doMock('ai-sdk-ollama', () => ({
      createOllama: vi.fn(() => ollamaProviderMock),
    }));
  });

  afterEach(() => {
    vi.doUnmock('ai-sdk-ollama');
    vi.resetModules();
    if (savedRepeatPenalty === undefined) delete process.env[ENV_REPEAT_PENALTY];
    else process.env[ENV_REPEAT_PENALTY] = savedRepeatPenalty;
  });

  it('should export DEFAULT_OLLAMA_REPEAT_PENALTY as 1.1', async () => {
    const mod = await import('./connector');

    expect((mod as Record<string, unknown>)['DEFAULT_OLLAMA_REPEAT_PENALTY']).toBe(1.1);
  });

  it('should include repeat_penalty: 1.1 in ollama model options when no env override is set', async () => {
    const { createModel: freshCreateModel } = await import('./connector');

    freshCreateModel(ollamaProfile);

    const settings = ollamaProviderMock.mock.calls[0]?.[1] as
      | { options?: Record<string, unknown> }
      | undefined;
    expect(settings?.options?.['repeat_penalty']).toBe(1.1);
  });

  it('should override repeat_penalty to 1.3 when RUNNER_OLLAMA_REPEAT_PENALTY=1.3', async () => {
    process.env[ENV_REPEAT_PENALTY] = '1.3';
    const { createModel: freshCreateModel } = await import('./connector');

    freshCreateModel(ollamaProfile);

    const settings = ollamaProviderMock.mock.calls[0]?.[1] as
      | { options?: Record<string, unknown> }
      | undefined;
    expect(settings?.options?.['repeat_penalty']).toBe(1.3);
  });
});
