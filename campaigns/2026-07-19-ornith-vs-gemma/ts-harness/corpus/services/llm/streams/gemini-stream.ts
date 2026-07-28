import type { GeminiStreamParams } from '../types';

interface GeminiStreamChunk {
  readonly candidates?: readonly [
    {
      readonly content?: { readonly parts?: readonly [{ readonly text?: string }] };
      readonly finishReason?: string;
    }
  ];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly error?: { readonly code?: number; readonly message: string; readonly status?: string };
}

interface GeminiErrorResponse {
  readonly error?: { readonly message: string };
}

type StreamFormat = 'sse' | 'json-array';

interface ParseResult {
  readonly chunks: readonly GeminiStreamChunk[];
  readonly remaining: string;
}

const NORMAL_FINISH_REASONS: ReadonlyArray<string> = ['STOP', 'MAX_TOKENS', 'SAFETY'];
const SSE_DATA_PREFIX = 'data: ';
const SSE_DONE_SIGNAL = 'data: [DONE]';

function extractToken(chunk: GeminiStreamChunk): string | null {
  const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
  return text !== undefined && text !== '' ? text : null;
}

function getFinishReason(chunk: GeminiStreamChunk): string | undefined {
  return chunk.candidates?.[0]?.finishReason;
}

function checkChunkErrors(chunk: GeminiStreamChunk): void {
  if (chunk.error?.message) {
    throw new Error(chunk.error.message);
  }
  if (chunk.promptFeedback?.blockReason) {
    throw new Error(`Prompt blocked: ${chunk.promptFeedback.blockReason}`);
  }
}

function processChunk(chunk: GeminiStreamChunk): {
  readonly token: string | null;
  readonly done: boolean;
} {
  checkChunkErrors(chunk);

  const token = extractToken(chunk);
  const finishReason = getFinishReason(chunk);

  if (finishReason) {
    if (NORMAL_FINISH_REASONS.includes(finishReason)) {
      return { token, done: true };
    }
    throw new Error(`Generation stopped: ${finishReason}`);
  }

  return { token, done: false };
}

function detectFormat(buffer: string): StreamFormat | null {
  const trimmed = buffer.trimStart();
  if (trimmed.startsWith(SSE_DATA_PREFIX)) return 'sse';
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json-array';
  return null;
}

function tryParseJson(text: string): GeminiStreamChunk | null {
  try {
    return JSON.parse(text) as GeminiStreamChunk;
  } catch {
    return null;
  }
}

function parseSSELines(buffer: string): ParseResult {
  const lines = buffer.split('\n');
  const remaining = lines.pop() ?? '';
  const chunks: GeminiStreamChunk[] = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === SSE_DONE_SIGNAL) return;
    if (!trimmed.startsWith(SSE_DATA_PREFIX)) return;

    const json = trimmed.slice(SSE_DATA_PREFIX.length);
    const chunk = tryParseJson(json);
    if (chunk) chunks.push(chunk);
  });

  return { chunks, remaining };
}

function findObjectBoundaries(buffer: string): {
  readonly end: number;
  readonly start: number;
} | null {
  const start = buffer.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let i = start;
  while (i < buffer.length) {
    if (buffer[i] === '"') {
      i++;
      while (i < buffer.length && buffer[i] !== '"') {
        if (buffer[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (buffer[i] === '{') depth++;
    if (buffer[i] === '}') depth--;
    if (depth === 0) return { start, end: i + 1 };
    i++;
  }

  return null;
}

function parseJsonArrayChunks(buffer: string): ParseResult {
  const chunks: GeminiStreamChunk[] = [];
  let remaining = buffer;

  while (true) {
    const boundary = findObjectBoundaries(remaining);
    if (!boundary) break;

    const json = remaining.slice(boundary.start, boundary.end);
    const chunk = tryParseJson(json);
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(boundary.end);
  }

  return { chunks, remaining };
}

function* yieldChunkResults(
  chunks: readonly GeminiStreamChunk[]
): Generator<{ readonly token: string | null; readonly done: boolean }> {
  for (const chunk of chunks) {
    yield processChunk(chunk);
  }
}

export async function* geminiStream(
  params: GeminiStreamParams
): AsyncGenerator<string, void, undefined> {
  const response = await fetch(params.url, {
    method: 'POST',
    headers: { ...params.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(params.body),
    signal: params.signal,
  });

  if (!response.ok) {
    const err: GeminiErrorResponse = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gemini stream error: ${response.status}`);
  }

  if (!response.body) {
    throw new Error(`Gemini stream error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let format: StreamFormat | null = null;

  try {
    while (true) {
      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (!format) {
        format = detectFormat(buffer);
        if (!format) continue;
      }

      const parseResult = format === 'sse' ? parseSSELines(buffer) : parseJsonArrayChunks(buffer);

      buffer = parseResult.remaining;

      for (const result of yieldChunkResults(parseResult.chunks)) {
        if (result.token) yield result.token;
        if (result.done) return;
      }
    }

    if (buffer.trim() && format) {
      const finalResult =
        format === 'sse' ? parseSSELines(`${buffer}\n`) : parseJsonArrayChunks(buffer);

      for (const result of yieldChunkResults(finalResult.chunks)) {
        if (result.token) yield result.token;
        if (result.done) return;
      }
    }
  } finally {
    reader.cancel();
  }
}
