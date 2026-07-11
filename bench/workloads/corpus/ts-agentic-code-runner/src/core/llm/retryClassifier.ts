export type RetryDecision = 'retry' | 'abort';

export interface AttemptSignal {
  readonly failureKind: 'test-fail' | 'gate-fail' | 'tool-error' | 'transient';
  readonly toolActivityCount: number;
  readonly elapsedMs: number;
  // Present only on the escalation-loop path (F-01): the 1-based attempt index and
  // the failing gate's raw text, so the first-attempt triage can fire. Omitted in
  // unit callers that only exercise the idle-stall rule.
  readonly attemptNumber?: number;
  readonly output?: string;
}

export interface ClassifierConfig {
  readonly idleTimeoutMs: number;
}

// Network/connectivity failure markers (case-insensitive substring match). A drive
// throw carrying any of these means the rung is unreachable — climb the ladder
// rather than burning retries that cannot succeed.
const CONNECTIVITY_MARKERS: readonly string[] = [
  'fetch failed',
  'econnrefused',
  'enotfound',
  'getaddrinfo',
  'eai_again',
  'etimedout',
  'socket hang up',
  'timeout',
];

export function isConnectivityError(message: string): boolean {
  const lower = message.toLowerCase();
  return CONNECTIVITY_MARKERS.some((marker): boolean => lower.includes(marker));
}

// Auth/credential failure markers (case-insensitive substring match). A drive
// throw carrying any of these means the provider rejected the credentials
// (missing / invalid / EXPIRED API key) — an infra-config HARD STOP, NOT a
// "the model can't do it" failure. It must never trigger a sanctioned Claude
// fallback (which silently bills Claude while the real fix is the key).
const AUTH_MARKERS: readonly string[] = [
  '401',
  '403',
  'unauthorized',
  'forbidden',
  'invalid api key',
  'no auth credentials',
  'authentication',
  'api key',
  'expired',
];

export function isAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return AUTH_MARKERS.some((marker): boolean => lower.includes(marker));
}

// Sentinel the runner stamps into a drive-failure message when an ollama prompt
// exceeds its context window. A context overflow cannot be retried into success on
// the same model (the window is fixed) — it must force-escalate to a larger rung,
// exactly like a connectivity hard-stop. Detected on the drive-gate output only.
export const CONTEXT_OVERFLOW_MARKER = 'context-overflow';

export function isContextOverflowError(message: string): boolean {
  return message.toLowerCase().includes(CONTEXT_OVERFLOW_MARKER);
}

// Sentinel the connector stamps into a drive-failure message when a generation
// produces no stream activity within the idle-gap watchdog window (a genuine stall
// or a runaway exceeding the window). It cannot retry into success on the same
// model → force-escalate, exactly like context-overflow. CONNECTIVITY_MARKERS also
// contains 'timeout', so this check MUST run before isConnectivityError everywhere.
export const GENERATION_TIMEOUT_MARKER = 'generation-timeout';

export function isGenerationTimeoutError(message: string): boolean {
  return message.toLowerCase().includes(GENERATION_TIMEOUT_MARKER);
}

// Seeded (NOT statistically derived) abort threshold: telemetry's attempt_runs
// table is sparse (32 rows, all failed), so this default is hand-picked from the
// worst observed waste, env-overridable, not a fitted distribution. A first attempt
// that already throws 8+ distinct tsc errors is decisively too deep for the same
// rung to retry into GREEN — early-exit rather than burning ~2 h of retries.
const DEFAULT_TSC_ERROR_ABORT_THRESHOLD = 8;
export const TSC_ERROR_ABORT_THRESHOLD_ENV = 'RUNNER_TSC_ABORT_THRESHOLD';

// Resolve the first-attempt tsc-error abort threshold from env (NaN/negative guard
// falls back to the seeded default).
export const resolveTscErrorAbortThreshold = (): number => {
  const parsed = Number(process.env[TSC_ERROR_ABORT_THRESHOLD_ENV] ?? DEFAULT_TSC_ERROR_ABORT_THRESHOLD);
  return Number.isNaN(parsed) || parsed < 0 ? DEFAULT_TSC_ERROR_ABORT_THRESHOLD : Math.floor(parsed);
};

// Count distinct `error TS` occurrences in gate output (case-insensitive). tsc
// prints one such line per diagnostic, so the count approximates the type-error
// depth of the attempt.
export function countTscErrors(output: string): number {
  const matches = output.toLowerCase().match(/error ts/g);
  return matches === null ? 0 : matches.length;
}

// Early-exit triage for the FIRST attempt only: end the run as terminally exhausted
// when it shows a decisively deep failure, rather than retrying into ~29 min (0/33
// success at attempt 3) or ~2 h of waste. Force-escalate classes (connectivity /
// context-overflow / generation-timeout) never reach here — they are handled at the
// drive seam. Attempts >1 keep the normal retry ladder.
export function triageFirstAttempt(
  signal: AttemptSignal,
  output: string,
  attemptNumber: number
): RetryDecision {
  if (attemptNumber !== 1) return 'retry';
  if (signal.failureKind === 'tool-error') return 'abort';
  if (countTscErrors(output) > resolveTscErrorAbortThreshold()) return 'abort';
  return 'retry';
}

// The gates whose failure is a concrete, self-fixable code defect (lint / tsc /
// test / decomposition / functional-style). A 'drive' failure is a model-call throw,
// not a code-level defect, so it is never a near-miss. Kept as bare GateName string
// literals so this module stays import-free — core/result imports it, and importing
// GateName back from core/gates would risk a dependency cycle.
const NEAR_MISS_GATES: ReadonlySet<string> = new Set([
  'lint',
  'tsc',
  'test',
  'decomposition',
  'functional-style',
]);

// Inputs the adaptive best-of-N retry loop feeds the near-miss classifier after a
// losing base-rung sample. Sourced from that sample's EscalationOutcome and the run's
// mutation tracker, passed as primitives so this module does not import the result types.
export interface NearMissSignal {
  // pipeline.failure?.gate — the failing gate name, or undefined when the attempt
  // produced no concrete gate failure.
  readonly failedGate: string | undefined;
  // outcome.aborted — a triage-abort / idle-stall: decisively too deep to iterate.
  readonly aborted: boolean;
  // outcome.noProgress — the failure signature repeated: iterating is stuck.
  readonly noProgress: boolean;
  // tracker.mutatedPaths().length — zero means the edits never landed on disk.
  readonly mutatedCount: number;
}

// A near-miss sample is worth ITERATING on rather than re-rolling from baseline: a
// concrete, self-fixable gate failure whose edits actually landed, that is neither
// aborted nor stuck (noProgress). The adaptive retry loop keeps such a sample's file
// state and threads its conclusion ledger to the next attempt; everything else is
// hopeless → revert + resample.
export function isNearMiss(signal: NearMissSignal): boolean {
  if (signal.aborted || signal.noProgress) return false;
  if (signal.failedGate === undefined || !NEAR_MISS_GATES.has(signal.failedGate)) return false;
  return signal.mutatedCount > 0;
}

export function classifyAttempt(signal: AttemptSignal, cfg: ClassifierConfig): RetryDecision {
  const idleStall: boolean =
    signal.failureKind !== 'transient' &&
    signal.toolActivityCount === 0 &&
    signal.elapsedMs > cfg.idleTimeoutMs;
  if (idleStall) return 'abort';
  if (signal.attemptNumber !== undefined) {
    return triageFirstAttempt(signal, signal.output ?? '', signal.attemptNumber);
  }
  return 'retry';
}
