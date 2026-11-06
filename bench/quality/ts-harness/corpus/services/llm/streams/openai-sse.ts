import type { OpenAISseStreamParams, StreamEvent } from '../types';

interface SseErrorResponse {
  readonly error?: { readonly message: string };
}

interface SseDelta {
  readonly content?: string;
  readonly reasoning?: string;
  readonly reasoning_content?: string;
}

interface SseChunk {
  readonly choices?: readonly [{ readonly delta: SseDelta }];
  readonly error?: { readonly message: string };
}

const SSE_DATA_PREFIX = 'data: ';
const SSE_DONE_SIGNAL = '[DONE]';

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(SSE_DATA_PREFIX)) return null;
  return trimmed.slice(SSE_DATA_PREFIX.length);
}

interface ExtractResult {
  readonly yields: ReadonlyArray<string | StreamEvent>;
  readonly done: boolean;
}

const extractYields = (data: string): ExtractResult => {
  if (data === SSE_DONE_SIGNAL) return { yields: [], done: true };

  try {
    const chunk: SseChunk = JSON.parse(data);
    if (chunk.error) throw new Error(chunk.error.message);
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return { yields: [], done: false };

    const results: Array<string | StreamEvent> = [];
    const reasoning = delta.reasoning ?? delta.reasoning_content;
    if (reasoning) results.push({ type: 'reasoning', text: reasoning });
    if (delta.content) results.push(delta.content);

    return { yields: results, done: false };
  } catch (e) {
    if (e instanceof SyntaxError) return { yields: [], done: false };
    throw e;
  }
};

export async function* openAiSseStream(
  params: OpenAISseStreamParams
): AsyncGenerator<string | StreamEvent, void, undefined> {
  const response = await fetch(params.url, {
    method: 'POST',
    headers: { ...params.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(params.body),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    const err: SseErrorResponse = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `SSE stream error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const data = parseSseLine(line);
        if (data === null) continue;

        const result = extractYields(data);
        if (result.done) return;
        for (const item of result.yields) {
          yield item;
        }
      }
    }
  } finally {
    reader.cancel();
  }
}
