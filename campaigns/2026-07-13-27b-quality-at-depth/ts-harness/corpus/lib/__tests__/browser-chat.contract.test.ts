import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BROWSER_CHAT_MODEL_ID, streamBrowserChat } from '../browser-chat';

// ---------------------------------------------------------------------------
// Fake TextStreamer that immediately invokes callback_function for each chunk
// ---------------------------------------------------------------------------
class FakeTextStreamer {
  private readonly callback: (text: string) => void;
  constructor(opts: { callback_function: (text: string) => void }) {
    this.callback = opts.callback_function;
  }

  emit(chunks: readonly string[]): void {
    for (const chunk of chunks) {
      this.callback(chunk);
    }
  }
}

const FIXTURE_CHUNKS = ['Hello', ', ', 'world', '!'] as const;

const makeFakePipeline = (chunks: readonly string[]) =>
  vi.fn().mockImplementation((_messages: unknown, opts: { streamer: FakeTextStreamer }) => {
    // drive the streamer synchronously then resolve
    opts.streamer.emit(chunks);
    return Promise.resolve();
  });

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  TextStreamer: FakeTextStreamer,
}));

describe('streamBrowserChat (contract — mocked transformers)', () => {
  // Access the mocked module helpers after vi.mock hoisting
  let pipelineMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset module-scoped singleton between tests
    vi.resetModules();
    const transformers = await import('@huggingface/transformers');
    pipelineMock = vi.mocked(transformers.pipeline);
    pipelineMock.mockResolvedValue(makeFakePipeline(FIXTURE_CHUNKS) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should yield each text chunk in order when given a user message', async () => {
    // Re-import after resetModules so singleton is fresh
    const { streamBrowserChat: stream } = await import('../browser-chat');
    const chunks: string[] = [];

    for await (const chunk of stream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([...FIXTURE_CHUNKS]);
  });

  it('should yield only string values from each chunk', async () => {
    const { streamBrowserChat: stream } = await import('../browser-chat');

    for await (const chunk of stream([{ role: 'user', content: 'hi' }])) {
      expect(typeof chunk).toBe('string');
    }
  });

  it('should call pipeline with the correct model id and dtype', async () => {
    const { streamBrowserChat: stream } = await import('../browser-chat');
    // consume the generator

    for await (const _ of stream([{ role: 'user', content: 'hi' }])) {
      // drain
    }

    expect(pipelineMock).toHaveBeenCalledWith('text-generation', BROWSER_CHAT_MODEL_ID, {
      dtype: 'q4f16',
    });
  });

  it('should complete the generator when the pipeline resolves', async () => {
    const { streamBrowserChat: stream } = await import('../browser-chat');
    const gen = stream([{ role: 'user', content: 'hi' }]);
    const results: IteratorResult<string>[] = [];

    let next = await gen.next();
    while (!next.done) {
      results.push(next);
      next = await gen.next();
    }

    expect(results).toHaveLength(FIXTURE_CHUNKS.length);
    expect(next.done).toBe(true);
  });

  it('should propagate a pipeline rejection as a thrown error', async () => {
    const { streamBrowserChat: stream } = await import('../browser-chat');
    // Override pipeline to return a generator that errors
    pipelineMock.mockResolvedValue(
      vi.fn().mockImplementation((_messages: unknown, opts: { streamer: FakeTextStreamer }) => {
        opts.streamer.emit(['partial']);
        return Promise.reject(new Error('model exploded'));
      }) as never
    );

    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of stream([{ role: 'user', content: 'hi' }])) {
        chunks.push(chunk);
      }
    }).rejects.toThrow('model exploded');

    // partial chunk was still yielded before the error
    expect(chunks).toEqual(['partial']);
  });
});

// ---------------------------------------------------------------------------
// Real-execution variant — skipped unless RUN_MODEL_TESTS=1
// ---------------------------------------------------------------------------
describe.skipIf(!process.env['RUN_MODEL_TESTS'])('streamBrowserChat (real model)', () => {
  it('should yield non-empty string chunks for a simple greeting', async () => {
    const chunks: string[] = [];

    for await (const chunk of streamBrowserChat([{ role: 'user', content: 'Say hello.' }])) {
      expect(typeof chunk).toBe('string');
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toBeTruthy();
  }, 180_000);
});
