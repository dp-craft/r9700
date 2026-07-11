import { isAuthError, isConnectivityError, isContextOverflowError, isGenerationTimeoutError } from '../llm';
import { type PipelineResult, type Stage, STAGE_NAME } from '../orchestration';
import type { FailureClass, RunMode, RunStatus } from '../shared';
import type { EscalationOutcome } from './runResult';

// status mapping: tdd completes only on an observed GREEN; impl
// propagates the pipeline's terminal status (completed = gate-pass).
export const mapStatus = (mode: RunMode, pipeline: PipelineResult): RunStatus => {
  if (pipeline.status !== 'completed') {
    return pipeline.status;
  }
  if (mode === 'tdd') {
    return pipeline.greenObserved ? 'completed' : 'failed';
  }
  return 'completed';
};

export const NO_PROGRESS_ERROR =
  'no-progress: identical failure recurred across attempts — implementation stuck or the test may be wrong';

export const AUTH_ERROR =
  'auth-error: provider rejected the credentials (missing/invalid/EXPIRED API key) — fix OPENROUTER_API_KEY / RUNNER_OPENROUTER_API_KEY (or the active provider key), or re-run with RUNNER_DELEGATION=claude to use Claude intentionally';

// The text of the final failure, used to classify the failure mode. Empty when
// the run had no failure.
export const finalFailureText = (pipeline: PipelineResult): string =>
  pipeline.failure?.output ?? pipeline.failure?.message ?? '';

// A Claude fallback is sanctioned ONLY when the model genuinely tried and could
// not deliver. Infra/config classes (auth/connectivity/fatal/interrupted) are
// hard stops — surfacing them, never a silent (billable) Claude fallback.
export const SANCTIONED_FALLBACK: ReadonlySet<FailureClass> = new Set<FailureClass>([
  'no-progress',
  'idle-stall',
  'gate-fail',
  'generation-timeout',
]);

// Provider-signal classes meaningful ONLY for a drive (model-call) failure.
// context-overflow is checked first (its message is runner-stamped and distinct,
// so the generic auth/connectivity substring scans must not mislabel it).
// Order matters: context-overflow and generation-timeout are runner-stamped, distinct
// markers that MUST be matched before the generic auth/connectivity substring scans
// (the generation-timeout marker contains 'timeout', which connectivity also matches).
export const DRIVE_FAILURE_MATCHERS: ReadonlyArray<readonly [(t: string) => boolean, FailureClass]> = [
  [isContextOverflowError, 'context-overflow'],
  [isGenerationTimeoutError, 'generation-timeout'],
  [isAuthError, 'auth'],
  [isConnectivityError, 'connectivity'],
];

export const classifyDriveFailure = (text: string): FailureClass | undefined =>
  DRIVE_FAILURE_MATCHERS.find(([match]): boolean => match(text))?.[1];

// Classify why a non-completed run failed. Drive provider-signals are checked
// first (they outrank the generic stall/gate signals); a completed run has no
// class. Non-drive gates (lint/tsc/test/red) carry captured tool output that
// routinely contains markers like "timeout", so the provider checks run on the
// drive gate ONLY — else a gate failure would be mislabelled connectivity/auth.
export const classifyFailure = (
  status: RunStatus,
  outcome: EscalationOutcome,
  text: string
): FailureClass | undefined => {
  if (status === 'completed') return undefined;
  if (outcome.pipeline.failure?.gate === 'drive') {
    const driveClass = classifyDriveFailure(text);
    if (driveClass !== undefined) return driveClass;
  }
  if (outcome.aborted) return 'idle-stall';
  if (outcome.noProgress) return 'no-progress';
  return 'gate-fail';
};

export const EMPTY_SPEC_ERROR =
  'empty-spec: nav bundle missing/corrupt or no target files — cannot run a blind task; ' +
  'check the nav bundle path and that it scopes at least one target file';

export const CONTEXT_OVERFLOW_ERROR =
  'context-overflow: prompt exceeded the model context window — escalating to a larger-context model';

export const GENERATION_TIMEOUT_ERROR =
  'generation-timeout: the model either produced no stream activity within the idle window ' +
  '(genuine stall) or exceeded the total wall-clock ceiling (active but non-converging) — ' +
  'escalating to a larger rung';

export const errorFor = (failureClass: FailureClass | undefined): string | undefined => {
  if (failureClass === 'auth') return AUTH_ERROR;
  if (failureClass === 'no-progress') return NO_PROGRESS_ERROR;
  if (failureClass === 'empty-spec') return EMPTY_SPEC_ERROR;
  if (failureClass === 'context-overflow') return CONTEXT_OVERFLOW_ERROR;
  if (failureClass === 'generation-timeout') return GENERATION_TIMEOUT_ERROR;
  return undefined;
};

// Resolve the display name of the stage that failed, for telemetry. Absent when
// no stage failed. Keyed off the stage IDENTITY (not a re-indexed lookup) so an
// R2 resume on the impl pipeline reports the correct stage name.
export const resolveFailedStage = (failedStage: Stage | undefined): string | undefined =>
  failedStage === undefined ? undefined : STAGE_NAME.get(failedStage);
