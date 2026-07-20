import type { ClaudeSseStreamParams } from '../types';

interface ClaudeErrorResponse {
  readonly error?: { readonly message: string };
}

interface ClaudeContentBlockDelta {
  readonly type: 'content_block_delta';
  readonly delta: { readonly type: 'text_delta'; readonly text: string };
}

interface ClaudeErrorEvent {
  readonly type: 'error';
  readonly error: { readonly type: string; readonly message: string };
}

const EVENT_PREFIX = 'event: ';
const DATA_PREFIX = 'data: ';

const EVENT_CONTENT_BLOCK_DELTA = 'content_block_delta';
const EVENT_MESSAGE_STOP = 'message_stop';
const EVENT_ERROR = 'error';

function parseEventLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(EVENT_PREFIX)) return null;
  return trimmed.slice(EVENT_PREFIX.length);
}

function parseDataLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(DATA_PREFIX)) return null;
  return trimmed.slice(DATA_PREFIX.length);
}

function extractDeltaToken(data: string): string | null {
  try {
    const parsed: ClaudeContentBlockDelta = JSON.parse(data);
    return parsed.delta?.text ?? null;
  } catch {
    return null;
  }
}

function extractErrorMessage(data: string): string {
  try {
    const parsed: ClaudeErrorEvent = JSON.parse(data);
    return parsed.error?.message ?? 'Unknown Claude SSE error';
  } catch {
    return 'Unknown Claude SSE error';
  }
}

export async function* claudeSseStream(
  params: ClaudeSseStreamParams
): AsyncGenerator<string, void, undefined> {
  const response = await fetch(params.url, {
    method: 'POST',
    headers: { ...params.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(params.body),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    const err: ClaudeErrorResponse = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Claude SSE error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

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
        const eventType = parseEventLine(line);
        if (eventType !== null) {
          currentEvent = eventType;
          continue;
        }

        const data = parseDataLine(line);
        if (data === null) continue;

        if (currentEvent === EVENT_CONTENT_BLOCK_DELTA) {
          const token = extractDeltaToken(data);
          if (token) yield token;
        } else if (currentEvent === EVENT_MESSAGE_STOP) {
          return;
        } else if (currentEvent === EVENT_ERROR) {
          throw new Error(extractErrorMessage(data));
        }

        currentEvent = '';
      }
    }
  } finally {
    reader.cancel();
  }
}
