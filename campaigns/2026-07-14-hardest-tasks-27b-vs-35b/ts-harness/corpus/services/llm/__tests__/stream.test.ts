import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamChunk } from '../stream';
import type { ChatOptions, LLMProvider, StreamEvent } from '../types';

vi.mock('@/db/providerConfigs', () => ({
  getProviderConfig: vi.fn(),
}));

vi.mock('../registry', () => ({
  lookupProvider: vi.fn(),
}));

import { getProviderConfig } from '@/db/providerConfigs';

import { lookupProvider } from '../registry';
import { streamChat } from '../stream';

const createMockProvider = (
  chunks: readonly (string | StreamEvent)[] = ['hello']
): LLMProvider => ({
  name: 'Test',
  chat: vi.fn(async function* (_opts: ChatOptions) {
    for (const c of chunks) {
      yield c;
    }
  }),
  listModels: vi.fn(async () => []),
  healthCheck: vi.fn(async () => true),
});

const collectChunks = async (
  gen: AsyncGenerator<StreamChunk, void, unknown>
): Promise<readonly StreamChunk[]> => {
  const results: StreamChunk[] = [];
  for await (const chunk of gen) {
    results.push(chunk);
  }
  return results;
};

describe('streamChat', () => {
  const mockProvider = createMockProvider();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lookupProvider).mockReturnValue(mockProvider);
    vi.mocked(getProviderConfig).mockResolvedValue(undefined);
  });

  it('should forward contextSize to provider.chat when provided', async () => {
    const gen = streamChat({
      providerId: 'test-provider',
      modelId: 'model-a',
      messages: [],
      contextSize: 4096,
    });

    await collectChunks(gen);

    expect(mockProvider.chat).toHaveBeenCalledWith(expect.objectContaining({ contextSize: 4096 }));
  });

  it('should omit contextSize from provider.chat options when undefined', async () => {
    const gen = streamChat({
      providerId: 'test-provider',
      modelId: 'model-a',
      messages: [],
    });

    await collectChunks(gen);

    const callArgs = vi.mocked(mockProvider.chat).mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('contextSize');
  });

  it('should forward thinkingEnabled to provider.chat when provided', async () => {
    const gen = streamChat({
      providerId: 'test-provider',
      modelId: 'model-a',
      messages: [],
      thinkingEnabled: true,
    });

    await collectChunks(gen);

    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingEnabled: true })
    );
  });

  it('should forward thinkingBudget to provider.chat when provided', async () => {
    const gen = streamChat({
      providerId: 'test-provider',
      modelId: 'model-a',
      messages: [],
      thinkingEnabled: true,
      thinkingBudget: 10000,
    });

    await collectChunks(gen);

    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingEnabled: true, thinkingBudget: 10000 })
    );
  });

  it('should omit thinkingEnabled and thinkingBudget from provider.chat when undefined', async () => {
    const gen = streamChat({
      providerId: 'test-provider',
      modelId: 'model-a',
      messages: [],
    });

    await collectChunks(gen);

    const callArgs = vi.mocked(mockProvider.chat).mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('thinkingEnabled');
    expect(callArgs).not.toHaveProperty('thinkingBudget');
  });

  it('should forward temperature, topP, and maxTokens to provider.chat when provided', async () => {
    const gen = streamChat({
      providerId: 'test-provider',
      modelId: 'model-a',
      messages: [],
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
    });

    await collectChunks(gen);

    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.7, topP: 0.9, maxTokens: 2048 })
    );
  });

  it('should omit temperature, topP, and maxTokens from provider.chat when undefined', async () => {
    const gen = streamChat({
      providerId: 'test-provider',
      modelId: 'model-a',
      messages: [],
    });

    await collectChunks(gen);

    const callArgs = vi.mocked(mockProvider.chat).mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('temperature');
    expect(callArgs).not.toHaveProperty('topP');
    expect(callArgs).not.toHaveProperty('maxTokens');
  });

  it('should yield reasoning chunk when provider yields reasoning event', async () => {
    const provider = createMockProvider([{ type: 'reasoning', text: 'thinking step' }]);
    vi.mocked(lookupProvider).mockReturnValue(provider);

    const chunks = await collectChunks(
      streamChat({
        providerId: 'test-provider',
        modelId: 'model-a',
        messages: [],
      })
    );

    expect(chunks).toEqual([{ type: 'reasoning', text: 'thinking step' }]);
  });

  it('should yield chunk type when provider yields plain string', async () => {
    const provider = createMockProvider(['hello', 'world']);
    vi.mocked(lookupProvider).mockReturnValue(provider);

    const chunks = await collectChunks(
      streamChat({
        providerId: 'test-provider',
        modelId: 'model-a',
        messages: [],
      })
    );

    expect(chunks).toEqual([
      { type: 'chunk', text: 'hello' },
      { type: 'chunk', text: 'world' },
    ]);
  });

  it('should drop citation events from provider', async () => {
    const provider = createMockProvider([
      'text',
      { type: 'citations', citations: [{ index: 0, title: 'T', url: 'http://x' }] },
      { type: 'reasoning', text: 'think' },
    ]);
    vi.mocked(lookupProvider).mockReturnValue(provider);

    const chunks = await collectChunks(
      streamChat({
        providerId: 'test-provider',
        modelId: 'model-a',
        messages: [],
      })
    );

    expect(chunks).toEqual([
      { type: 'chunk', text: 'text' },
      { type: 'reasoning', text: 'think' },
    ]);
  });
});
