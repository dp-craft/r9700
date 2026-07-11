import { Agent } from 'undici';

import { resolveOllamaIdleTimeoutMs } from './ollama';
import { resolveGenerateTimeoutMs } from './sampling';

// undici exposes its idle timeouts only at the dispatcher level, so the global
// timeout is applied by routing every provider's HTTP traffic through one Agent
// whose headersTimeout/bodyTimeout match resolveGenerateTimeoutMs(). The Agent is
// built lazily once (the timeout is process-stable after config load).
type Dispatcher = NonNullable<RequestInit['dispatcher']>;

const buildDispatcher = (): Dispatcher => {
  const timeoutMs = resolveGenerateTimeoutMs();
  return new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
};

const dispatcherRef: { current?: Dispatcher } = {};

const timeoutDispatcher = (): Dispatcher => (dispatcherRef.current ??= buildDispatcher());

export const timeoutFetch: typeof globalThis.fetch = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1]
): Promise<Response> => {
  const reqInit: RequestInit = { ...init, dispatcher: timeoutDispatcher() };
  return globalThis.fetch(input, reqInit);
};

// Ollama streams a single slow generation step that can emit no bytes for minutes.
// The AI SDK AbortController does not propagate into the in-flight ollama request,
// so a finite undici idle timeout is the effective per-step watchdog (a hung step
// otherwise runs forever). Env-tunable via RUNNER_OLLAMA_IDLE_TIMEOUT_MS (default 20 min).
export const ollamaDispatcherOptions = (): { headersTimeout: number; bodyTimeout: number } => {
  const t = resolveOllamaIdleTimeoutMs();
  return { headersTimeout: t, bodyTimeout: t };
};

const ollamaDispatcherRef: { current?: Dispatcher } = {};

const ollamaDispatcher = (): Dispatcher =>
  (ollamaDispatcherRef.current ??= new Agent(ollamaDispatcherOptions()));

export const ollamaFetch: typeof globalThis.fetch = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1]
): Promise<Response> => {
  const reqInit: RequestInit = { ...init, dispatcher: ollamaDispatcher() };
  return globalThis.fetch(input, reqInit);
};
