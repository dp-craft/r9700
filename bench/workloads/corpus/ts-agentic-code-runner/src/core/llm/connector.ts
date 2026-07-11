import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  type StopCondition,
  streamText,
  type ToolSet
} from 'ai';

import { flushTracing, telemetrySettings } from '../reporting';
import type { TokenUsage } from '../shared';
import { compactMessages } from './compaction';
import type { createModel } from './createModel';
import type { resolveOllamaNumCtx } from './ollama';
import { GENERATION_TIMEOUT_MARKER } from './retryClassifier';
import { resolveGenerateMaxTotalMs, resolveGenerateTimeoutMs } from './sampling';
import {
  convergedEarly,
  CONVERGENCE_WINDOW,
  convergenceStop,
  MAX_IDENTICAL_TOOL_CALLS,
  repeatedToolCallStop
} from './toolCallStop';

// Re-export shims — these symbols now live in sibling files but were historically
// imported from './connector' (connector.test.ts depends on this surface).
export { createModel } from './createModel';
export { ollamaDispatcherOptions } from './dispatchers';
export {
  DEFAULT_OLLAMA_NUM_CTX,
  DEFAULT_OLLAMA_REPEAT_PENALTY,
  DEFAULT_OLLAMA_TEMPERATURE,
  resolveOllamaIdleTimeoutMs,
  resolveOllamaNumCtx,
  resolveOllamaSampling,
  resolveOllamaThink
} from './ollama';
export type { ProviderRouting } from './providerRouting';
export {
  resolveAllowFallbacks,
  resolveCacheControl,
  resolveProviderRouting
} from './providerRouting';
export type { ReasoningSetting } from './sampling';
export {
  DEFAULT_GENERATE_MAX_TOTAL_MS,
  DEFAULT_GENERATE_TIMEOUT_MS,
  resolveGenerateMaxTotalMs,
  resolveGenerateTimeoutMs,
  resolveReasoning,
  resolveSampling
} from './sampling';
export {
  convergedEarly,
  CONVERGENCE_WINDOW,
  convergenceStop,
  MAX_IDENTICAL_TOOL_CALLS,
  MUTATING_TOOL_NAMES,
  repeatedToolCallStop
} from './toolCallStop';

// Reason a drive halted early, distinct from hitting the step cap or finishing
// with DONE. Surfaced so telemetry/ledger can attribute the stop.
export type DriveHaltReason = 'convergence';

export interface GenerateRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: ToolSet;
  readonly maxSteps: number;
  readonly telemetry?: Readonly<Record<string, string>>;
}

export type { TokenUsage };

export interface GenerateResult {
  readonly text: string;
  readonly toolCallCount: number;
  readonly usage?: TokenUsage;
  // Largest per-step prompt (input) token count observed across the drive's
  // internal tool-loop. The runner compares this against num_ctx to detect an
  // ollama context overflow (the model silently slides the oldest messages off
  // when the prompt exceeds the window). Absent when no step usage is reported.
  readonly maxStepPromptTokens?: number;
  // 'convergence' when the drive stopped early because the last CONVERGENCE_WINDOW
  // steps produced no mutating tool call; absent for a normal DONE / step-cap stop.
  readonly haltReason?: DriveHaltReason;
}

// prepareStep hook: before each step, shrink stale tool-result payloads in the
// transcript the SDK is about to resend. The SDK keeps the originals, so this is
// recomputed from the full history every step and only bounds the SENT payload —
// it never drops a tool-call/result pair (keeps the protocol valid).
export const compactionStep = (opts: {
  readonly messages: ModelMessage[];
}): { readonly messages: ModelMessage[] } => ({ messages: compactMessages(opts.messages) });

// Minimal token-usage shape consumed by mapUsage / maxStepPromptTokens. Both the
// resolved streamText usage and totalUsage satisfy it.
interface UsageLike {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

// Minimal shape the helpers below consume — the resolved streamText object (text +
// awaited steps/usage/totalUsage/toolCalls) structurally satisfies it, so the
// helpers stay agnostic of the concrete SDK result type.
interface ResolvedGeneration {
  readonly text: string;
  readonly steps?: ReadonlyArray<{
    readonly toolCalls: ReadonlyArray<{ readonly toolName: string }>;
    readonly usage?: UsageLike;
  }>;
  readonly usage?: UsageLike;
  readonly totalUsage?: UsageLike;
  readonly toolCalls: ReadonlyArray<unknown>;
}

// streamText return surface the connector relies on: the drainable event stream
// plus the per-field resolution promises.
interface StreamingHandle {
  readonly fullStream: AsyncIterable<unknown>;
  readonly text: PromiseLike<string>;
  readonly steps: PromiseLike<ResolvedGeneration['steps']>;
  readonly usage: PromiseLike<UsageLike>;
  readonly totalUsage: PromiseLike<UsageLike>;
  readonly toolCalls: PromiseLike<ResolvedGeneration['toolCalls']>;
}

type TimeoutReason = 'idle' | 'total';

interface ArmOnly {
  arm(): void;
}

interface Watchdogs {
  arm(): void;
  clear(): void;
  reason(): TimeoutReason | undefined;
}

// Two abort sources on ONE controller: a re-armable idle-gap timer (fires after
// `idleMs` of NO stream activity) and a one-shot total wall-clock timer (armed once
// at creation, never re-armed). Whichever fires first records its reason and aborts;
// `reason()` lets the caller tailor the timeout MESSAGE (same failureClass for both).
const armWatchdogs = (
  controller: AbortController,
  idleMs: number,
  totalMs: number
): Watchdogs => {
  const state: { r?: TimeoutReason } = {};
  let idle: ReturnType<typeof setTimeout> | undefined;
  const total = setTimeout((): void => {
    state.r ??= 'total';
    controller.abort();
  }, totalMs);
  const arm = (): void => {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout((): void => {
      state.r ??= 'idle';
      controller.abort();
    }, idleMs);
  };
  const clear = (): void => {
    if (idle !== undefined) clearTimeout(idle);
    clearTimeout(total);
  };
  return { arm, clear, reason: (): TimeoutReason | undefined => state.r };
};

// An AI SDK fullStream may surface a model/tool error as an `{ type: 'error' }` part
// rather than rejecting the awaited promises — normalize it to an Error to rethrow.
const isErrorPart = (part: unknown): part is { readonly error?: unknown } =>
  typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'error';

const errorPartError = (part: unknown): Error | undefined => {
  if (!isErrorPart(part)) return undefined;
  const raw = part.error;
  return raw instanceof Error ? raw : new Error(String(raw));
};

// Drain the event stream, re-arming the watchdog on EVERY event. A stream-level
// error part rethrows the original error (the catch in generate only stamps the
// generation-timeout marker when our own abort fired).
const drainStream = async (
  fullStream: AsyncIterable<unknown>,
  watchdog: ArmOnly,
  throwIfAborted: () => void
): Promise<void> => {
  throwIfAborted();
  watchdog.arm();
  for await (const part of fullStream) {
    throwIfAborted();
    watchdog.arm();
    const err = errorPartError(part);
    if (err !== undefined) throw err;
  }
};

const resolveStreamResult = async (handle: StreamingHandle): Promise<ResolvedGeneration> => {
  const [text, steps, totalUsage, usage, toolCalls] = await Promise.all([
    handle.text,
    handle.steps,
    handle.totalUsage,
    handle.usage,
    handle.toolCalls,
  ]);
  return { text, steps, totalUsage, usage, toolCalls };
};

const buildStopWhen = (maxSteps: number): Array<StopCondition<ToolSet>> => [
  stepCountIs(maxSteps),
  repeatedToolCallStop(MAX_IDENTICAL_TOOL_CALLS) as StopCondition<ToolSet>,
  convergenceStop(CONVERGENCE_WINDOW) as StopCondition<ToolSet>,
];

const startStream = (
  model: LanguageModel,
  req: GenerateRequest,
  signal: AbortSignal
): StreamingHandle =>
  streamText({
    model,
    system: req.system,
    messages: [...req.messages],
    tools: req.tools,
    stopWhen: buildStopWhen(req.maxSteps),
    prepareStep: compactionStep,
    abortSignal: signal,
    experimental_telemetry: telemetrySettings(req.telemetry ?? {}),
    onStepFinish: (): void => void flushTracing(),
  }) as StreamingHandle;

// Pre-attach settle handlers to the resolution promises (awaited only on the
// success path) so a watchdog-abort rejection of them is never flagged "unhandled".
const silenceResolution = (handle: StreamingHandle): void => {
  void Promise.allSettled([
    handle.text,
    handle.steps,
    handle.usage,
    handle.totalUsage,
    handle.toolCalls,
  ]);
};

const generationTimeoutError = (
  reason: TimeoutReason | undefined,
  idleMs: number,
  totalMs: number
): Error => {
  const detail =
    reason === 'total'
      ? `wall-clock ceiling ${totalMs}ms exceeded (active but non-converging) — aborting drive`
      : `no generation activity for ${idleMs}ms — aborting drive`;
  return new Error(`${GENERATION_TIMEOUT_MARKER}: ${detail}`);
};

// The provider may not cancel the stream on abort — guard the drain loop so a
// fired watchdog throws the timeout itself rather than streaming indefinitely.
const abortGuard = (
  controller: AbortController,
  watchdogs: Watchdogs,
  idleMs: number,
  totalMs: number
): (() => void) => (): void => {
  if (controller.signal.aborted) throw generationTimeoutError(watchdogs.reason(), idleMs, totalMs);
};

const runGenerate = async (
  model: LanguageModel,
  req: GenerateRequest
): Promise<GenerateResult> => {
  const controller = new AbortController();
  const idleMs = resolveGenerateTimeoutMs();
  const totalMs = resolveGenerateMaxTotalMs();
  const watchdogs = armWatchdogs(controller, idleMs, totalMs);
  const guard = abortGuard(controller, watchdogs, idleMs, totalMs);
  try {
    const result = startStream(model, req, controller.signal);
    silenceResolution(result);
    await drainStream(result.fullStream, watchdogs, guard);
    return toGenerateResult(await resolveStreamResult(result), req.maxSteps);
  } catch (error) {
    if (controller.signal.aborted) throw generationTimeoutError(watchdogs.reason(), idleMs, totalMs);
    throw error;
  } finally {
    watchdogs.clear();
  }
};

export function generate(model: LanguageModel, req: GenerateRequest): Promise<GenerateResult> {
  const result = runGenerate(model, req);
  // Pre-attach a no-op handler so a watchdog-abort rejection surfacing during a
  // fake-timer flush — before the caller awaits — is never flagged "unhandled".
  // The caller's own await still receives the rejection (handlers are independent).
  void result.catch((): void => {});
  return result;
}

// `result.toolCalls` is the AI SDK's LAST-step value; summing every step's calls
// is the true per-run total (the top-level field undercounts a multi-step loop to
// just its final turn). Fall back to the top-level field when steps are absent.
const countToolCalls = (result: ResolvedGeneration): number =>
  Array.isArray(result.steps) && result.steps.length > 0
    ? result.steps.reduce((total: number, step): number => total + step.toolCalls.length, 0)
    : result.toolCalls.length;

// The per-step prompt token count grows as the tool-loop appends turns; the LAST
// step holds the largest prompt, but max() is robust to any ordering. This is the
// real ollama prompt length (no estimation) — compared against num_ctx to detect
// a context overflow. Undefined when no step usage is reported.
const maxStepPromptTokens = (result: ResolvedGeneration): number | undefined => {
  if (!Array.isArray(result.steps) || result.steps.length === 0) {
    return result.usage?.inputTokens;
  }
  return Math.max(...result.steps.map((step): number => step.usage?.inputTokens ?? 0));
};

// 'convergence' when the drive stopped before the step cap with a stalled tail
// (no mutating tool call in the last CONVERGENCE_WINDOW steps); else undefined.
const resolveHaltReason = (
  result: ResolvedGeneration,
  maxSteps: number
): DriveHaltReason | undefined =>
  Array.isArray(result.steps) && convergedEarly(result.steps, CONVERGENCE_WINDOW, maxSteps)
    ? 'convergence'
    : undefined;

const toGenerateResult = (result: ResolvedGeneration, maxSteps: number): GenerateResult => {
  // `result.usage` is the LAST step's usage (mirrors result.toolCalls above);
  // `result.totalUsage` is the sum across every tool-loop step — the true cost of
  // the whole drive, which is what telemetry must record (a long loop's input
  // grows per step, so last-step usage drastically undercounts it).
  const usage = mapUsage(result.totalUsage);
  const promptTokens = maxStepPromptTokens(result);
  const haltReason = resolveHaltReason(result, maxSteps);
  const base = { text: result.text, toolCallCount: countToolCalls(result) };
  return {
    ...base,
    ...(usage !== undefined ? { usage } : {}),
    ...(promptTokens !== undefined ? { maxStepPromptTokens: promptTokens } : {}),
    ...(haltReason !== undefined ? { haltReason } : {}),
  };
};

const mapUsage = (
  usage:
    | {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
    }
    | undefined
): TokenUsage | undefined =>
  usage === undefined
    ? undefined
    : {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      };

// Injected LLM-connector service boundary. The composition root (runTask) passes
// these concrete functions into the runner's RunnerDeps so the controller never
// imports the connector directly. Typed by `typeof` so signatures stay identical.
export interface ConnectorDeps {
  readonly createModel: typeof createModel;
  readonly generate: typeof generate;
  readonly resolveOllamaNumCtx: typeof resolveOllamaNumCtx;
}
