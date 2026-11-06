// In-browser TRUE chat via transformers.js (onnxruntime-web WASM).
// `@huggingface/transformers` is loaded ONLY through a dynamic import inside the
// functions below so the model runtime never enters the main bundle — it is
// fetched lazily, gated by the `lab-perplexity-enabled` flag at the call site.
// Network model download is consent-gated by the CALLER, not this module.
//
// Mirrors lib/perplexity.ts (module-scoped singleton + load-timeout) but drives
// a `text-generation` pipeline + TextStreamer to yield decoded text chunks as an
// AsyncGenerator. SmolLM2-360M-Instruct (<=200MB, q4f16) is a chat-capable model.

export const BROWSER_CHAT_MODEL_ID = 'HuggingFaceTB/SmolLM2-360M-Instruct';
export const BROWSER_CHAT_QUANTIZATION = 'q4f16';

// Best-effort budget for the lazy transformers import + model load; the browser
// dynamic import / weight download can hang indefinitely with no error.
// Sized for the ONE-TIME model + ONNX WASM download on first use; transformers.js
// caches weights in the browser, so subsequent loads resolve fast. The timeout
// still bounds a genuine hang (offline / blocked CDN), just with a realistic budget.
const BROWSER_CHAT_MODEL_LOAD_TIMEOUT_MS = 120_000;

// Upper bound on generated tokens per turn — keeps a runaway local generation
// from streaming unbounded text.
const BROWSER_CHAT_MAX_NEW_TOKENS = 512;

// Minimal structural contract over the transformers.js boundary.
type ChatMessage = { readonly role: string; readonly content: string };

type StreamerOptions = { readonly callback_function: (text: string) => void };

type GenerateOptions = {
  readonly max_new_tokens: number;
  readonly streamer: unknown;
};

type TextGenerator = (
  messages: readonly ChatMessage[],
  options: GenerateOptions
) => Promise<unknown>;

// Module-scoped mutable singleton — the documented infra-state exception
// (an external-handle cache for the loaded pipeline + an in-flight load promise).
let generatorPromise: Promise<TextGenerator> | null = null;
let ready = false;

const loadGenerator = async (): Promise<TextGenerator> => {
  const { pipeline } = await import('@huggingface/transformers');
  const generator = (await pipeline('text-generation', BROWSER_CHAT_MODEL_ID, {
    dtype: BROWSER_CHAT_QUANTIZATION,
  })) as unknown as TextGenerator;
  return generator;
};

const rejectOnTimeout = (ms: number): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error('browser chat model load timed out')), ms);
  });

/**
 * Triggers the (consent-gated) model download; resolves when ready. Caller MUST have consent.
 * Best-effort: the browser dynamic import / weight download can hang, so the load races a
 * timeout. On timeout the in-flight promise is cleared so a later call may retry.
 */
export const ensureBrowserChatModel = async (): Promise<void> => {
  if (generatorPromise === null) {
    generatorPromise = loadGenerator();
  }
  try {
    await Promise.race([generatorPromise, rejectOnTimeout(BROWSER_CHAT_MODEL_LOAD_TIMEOUT_MS)]);
  } catch (error) {
    generatorPromise = null;
    ready = false;
    throw error;
  }
  ready = true;
};

/** True once the model weights are cached/loaded. */
export const isBrowserChatModelReady = (): boolean => ready;

// Bridges the imperative TextStreamer callback into an async pull queue: each
// decoded chunk is pushed; the generator awaits the next chunk or completion.
type ChunkQueue = {
  readonly push: (text: string) => void;
  readonly close: () => void;
  readonly fail: (error: unknown) => void;
  readonly next: () => Promise<{ readonly value: string; readonly done: boolean }>;
};

const createChunkQueue = (): ChunkQueue => {
  const buffer: string[] = [];
  let done = false;
  let failure: unknown = null;
  let notify: (() => void) | null = null;

  const wake = (): void => {
    const resolve = notify;
    notify = null;
    resolve?.();
  };

  return {
    push: (text: string): void => {
      buffer.push(text);
      wake();
    },
    close: (): void => {
      done = true;
      wake();
    },
    fail: (error: unknown): void => {
      failure = error;
      done = true;
      wake();
    },
    next: async (): Promise<{ readonly value: string; readonly done: boolean }> => {
      while (buffer.length === 0 && !done) {
        await new Promise<void>(resolve => {
          notify = resolve;
        });
      }
      if (buffer.length > 0) {
        return { value: buffer.shift() as string, done: false };
      }
      if (failure !== null) {
        throw failure instanceof Error ? failure : new Error(String(failure));
      }
      return { value: '', done: true };
    },
  };
};

/**
 * Lazy-loads @huggingface/transformers (SmolLM2-360M-Instruct, q4f16) on first call,
 * then streams decoded text chunks from a `text-generation` pipeline turn.
 */
export async function* streamBrowserChat(messages: readonly ChatMessage[]): AsyncGenerator<string> {
  await ensureBrowserChatModel();
  if (generatorPromise === null) {
    return;
  }
  const generator = await generatorPromise;
  const { TextStreamer } = await import('@huggingface/transformers');
  const queue = createChunkQueue();

  const streamerOptions: StreamerOptions = {
    callback_function: (text: string): void => queue.push(text),
  };
  const streamer = new TextStreamer(streamerOptions as never, undefined as never);

  generator(messages, { max_new_tokens: BROWSER_CHAT_MAX_NEW_TOKENS, streamer }).then(
    () => queue.close(),
    (error: unknown) => queue.fail(error)
  );

  while (true) {
    const { value, done } = await queue.next();
    if (done) {
      return;
    }
    yield value;
  }
}
