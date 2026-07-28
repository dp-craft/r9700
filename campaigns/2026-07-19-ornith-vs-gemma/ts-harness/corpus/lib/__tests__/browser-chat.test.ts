import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOrRecordContract, readContract } from '@/test/contract';

// -- Boundary mock: @huggingface/transformers (lazy-loaded inside the lib) --
// The fakes reproduce the REAL transformers.js text-generation shapes:
// `pipeline('text-generation', id, opts)` resolves to a callable generator;
// calling generator(messages, { streamer }) invokes the TextStreamer's
// `callback_function(text)` once per decoded chunk. `TextStreamer` is a class
// constructed with `{ callback_function }`. Both pinned to the recorded contract.

const pipelineFn = vi.fn();
const textStreamerCtor = vi.fn();

vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineFn,
  TextStreamer: textStreamerCtor,
}));

// -- Contract-pinned fixture (ADR-018 L4) -----------------------------------
interface BrowserChatContract {
  readonly recorded: boolean;
  readonly modelId: string;
  readonly quantization: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly chunks: readonly string[];
  readonly text: string;
}

const CONTRACT_PATH = resolve(process.cwd(), 'src/lib/__tests__/browser-chat.contract.json');
const CONTRACT = readContract<BrowserChatContract>(CONTRACT_PATH);

interface StreamerLike {
  readonly callback_function: (text: string) => void;
}

// A fake generator: pushes each recorded chunk into the streamer's callback,
// then resolves with the standard text-generation output array shape.
const createFakeGenerator = (): ReturnType<typeof vi.fn> =>
  vi.fn(async (_messages: unknown, options: { readonly streamer: StreamerLike }) => {
    for (const chunk of CONTRACT.chunks) {
      options.streamer.callback_function(chunk);
    }
    return [{ generated_text: CONTRACT.text }];
  });

type BrowserChatModule = typeof import('@/lib/browser-chat');

const loadFreshModule = async (): Promise<BrowserChatModule> => {
  vi.resetModules();
  return import('@/lib/browser-chat');
};

const collect = async (gen: AsyncGenerator<string>): Promise<string[]> => {
  const out: string[] = [];
  for await (const chunk of gen) {
    out.push(chunk);
  }
  return out;
};

beforeEach(() => {
  vi.clearAllMocks();
  pipelineFn.mockResolvedValue(createFakeGenerator());
  // TextStreamer stores the passed options so the generator can fire callbacks.
  // Constructed with `new` in the lib, so the mock must be `function`-shaped.
  textStreamerCtor.mockImplementation(function (
    this: { callback_function: (text: string) => void },
    opts: StreamerLike
  ) {
    this.callback_function = opts.callback_function;
  });
});

describe('browser-chat lib', () => {
  it('should use a dynamic import of @huggingface/transformers, never a static top-level import', () => {
    const sourcePath = resolve(process.cwd(), 'src/lib/browser-chat.ts');
    const source = readFileSync(sourcePath, 'utf8');
    const staticImport = /^\s*import[^\n]*from\s+['"]@huggingface\/transformers['"]/m;
    const dynamicImport = /import\(\s*['"]@huggingface\/transformers['"]\s*\)/;
    expect(staticImport.test(source)).toBe(false);
    expect(dynamicImport.test(source)).toBe(true);
  });

  it('should export the model id and quantization constants', async () => {
    const { BROWSER_CHAT_MODEL_ID, BROWSER_CHAT_QUANTIZATION } = await loadFreshModule();
    expect(BROWSER_CHAT_MODEL_ID).toBe(CONTRACT.modelId);
    expect(BROWSER_CHAT_QUANTIZATION).toBe(CONTRACT.quantization);
  });

  it('should report not-ready before ensure, ready after ensureBrowserChatModel', async () => {
    const { ensureBrowserChatModel, isBrowserChatModelReady } = await loadFreshModule();
    expect(isBrowserChatModelReady()).toBe(false);
    await ensureBrowserChatModel();
    expect(isBrowserChatModelReady()).toBe(true);
  });

  it('should be idempotent: two sequential ensureBrowserChatModel calls build the pipeline at most once', async () => {
    const { ensureBrowserChatModel } = await loadFreshModule();
    await ensureBrowserChatModel();
    await ensureBrowserChatModel();
    expect(pipelineFn).toHaveBeenCalledTimes(1);
  });

  it('should stream the contract-pinned text chunks from streamBrowserChat', async () => {
    const { streamBrowserChat } = await loadFreshModule();
    const chunks = await collect(streamBrowserChat(CONTRACT.messages));
    expect(chunks).toEqual([...CONTRACT.chunks]);
    expect(chunks.join('')).toBe(CONTRACT.text);
  });

  it('mock pins to the recorded real-model contract', () => {
    expect(CONTRACT).toMatchObject({
      modelId: expect.any(String),
      quantization: expect.any(String),
      text: expect.any(String),
    });
    expect(typeof CONTRACT.recorded).toBe('boolean');
    expect(CONTRACT.chunks.length).toBeGreaterThanOrEqual(1);
    expect(CONTRACT.chunks.join('')).toBe(CONTRACT.text);
  });
});

// ---------------------------------------------------------------------------
// Graceful-degradation: timeout branch
// ---------------------------------------------------------------------------
describe('ensureBrowserChatModel — timeout graceful degradation', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should reject when pipeline build exceeds BROWSER_CHAT_MODEL_LOAD_TIMEOUT_MS', async () => {
    vi.clearAllMocks();
    pipelineFn.mockReturnValue(new Promise<never>(() => {}));

    const { ensureBrowserChatModel } = await loadFreshModule();

    vi.useFakeTimers();
    const loadPromise = ensureBrowserChatModel();
    const caught = loadPromise.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(120_100);
    const result = await caught;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('browser chat model load timed out');
  });

  it('should clear the in-flight promise and reset ready to false after timeout', async () => {
    vi.clearAllMocks();
    pipelineFn.mockReturnValue(new Promise<never>(() => {}));

    const { ensureBrowserChatModel, isBrowserChatModelReady } = await loadFreshModule();

    vi.useFakeTimers();
    const settled = ensureBrowserChatModel().catch(() => {});
    await vi.advanceTimersByTimeAsync(120_100);
    await settled;

    expect(isBrowserChatModelReady()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Opt-in smoke: loads the REAL SmolLM2-360M-Instruct weights (network download).
// Skipped in default `test:ci`; runs only when RUN_MODEL_TESTS is set and is NOT
// subject to the @huggingface mock. Records the live output-shape into the
// contract fixture (RECORD_CONTRACTS=1) so the mock above pins to real output.
// ---------------------------------------------------------------------------
describe.skipIf(!process.env.RUN_MODEL_TESTS)('browser-chat lib — real-model smoke', () => {
  it('should stream finite non-empty text for a real chat prompt', async () => {
    vi.doUnmock('@huggingface/transformers');
    const { streamBrowserChat } = await loadFreshModule();
    const chunks = await collect(streamBrowserChat(CONTRACT.messages));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('').length).toBeGreaterThan(0);
  }, 120_000);

  it('records the real-model output shape into the contract fixture', async () => {
    vi.doUnmock('@huggingface/transformers');
    const { streamBrowserChat } = await loadFreshModule();

    const recorded: BrowserChatContract = await loadOrRecordContract<BrowserChatContract>(
      CONTRACT_PATH,
      async (): Promise<BrowserChatContract> => {
        const chunks = await collect(streamBrowserChat(CONTRACT.messages));
        return {
          recorded: true,
          modelId: CONTRACT.modelId,
          quantization: CONTRACT.quantization,
          messages: CONTRACT.messages,
          chunks,
          text: chunks.join(''),
        };
      }
    );

    expect(recorded.recorded).toBe(true);
    expect(recorded.chunks.length).toBeGreaterThan(0);
  }, 120_000);
});
