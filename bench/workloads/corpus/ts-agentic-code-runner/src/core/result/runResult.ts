import type { TaskSpec } from '../execution';
import type { Ledger } from '../gates';
import { type LadderState, type PipelineResult, startRungForBackend } from '../orchestration';
import { type ModelProfile, profileForRung } from '../profiles';
import type {
  AgentRunResult,
  AgentType,
  AttemptRecord,
  BackendKind,
  FailureClass,
  RungName,
  RunMode,
  RunStatus,
  TokenUsage
} from '../shared';
import {
  classifyFailure,
  EMPTY_SPEC_ERROR,
  errorFor,
  finalFailureText,
  mapStatus,
  resolveFailedStage,
  SANCTIONED_FALLBACK
} from './failureClass';

// Run-level token accumulator (instrumentation boundary): every drive sums its
// generate() usage here so telemetry records the WHOLE run's cost. Distinct from
// ActivityAccumulator, which resets per attempt for idle-stall detection — token
// cost must survive across attempts and the escalation ladder.
export interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Threaded between attempts by repeatUntilExhausted: the accumulated conclusion
// ledger + the running history of failure signatures (no-progress check).
export interface AttemptCarry {
  readonly ledger: Ledger;
  readonly history: readonly string[];
  readonly lastPipeline?: PipelineResult;
}

export interface EscalationOutcome {
  readonly passed: boolean;
  readonly finalLadder: LadderState;
  readonly pipeline: PipelineResult;
  readonly attempts: number;
  readonly aborted: boolean;
  readonly noProgress: boolean;
  readonly mutatedFiles: readonly string[];
  // Token usage summed across the whole run (attached at runEscalation return).
  readonly usage?: TokenUsage;
  // Per-attempt telemetry records (attached at runEscalation return).
  readonly attemptRecords?: readonly AttemptRecord[];
  readonly carry?: AttemptCarry;
}

// Compute the per-attempt token delta relative to a prior snapshot.
export const computeUsageDelta = (current: UsageAccumulator, prior: UsageAccumulator): TokenUsage => ({
  inputTokens: current.inputTokens - prior.inputTokens,
  outputTokens: current.outputTokens - prior.outputTokens,
  totalTokens: current.totalTokens - prior.totalTokens,
});

interface AttemptCtx {
  readonly attempt: number;
  readonly rung: RungName;
  readonly modelId: string;
  readonly backend: BackendKind;
  readonly toolCalls: number;
  readonly durationMs: number;
}

// Build a single per-attempt telemetry record from its execution context.
export const buildAttemptRecord = (ctx: AttemptCtx, pipeline: PipelineResult, usage: TokenUsage): AttemptRecord => ({
  attempt: ctx.attempt,
  rung: ctx.rung,
  modelId: ctx.modelId,
  backend: ctx.backend,
  stage: resolveFailedStage(pipeline.failedStage) ?? '',
  toolCalls: ctx.toolCalls,
  status: pipeline.passed ? 'completed' : pipeline.status,
  durationMs: ctx.durationMs,
  usage,
});

export const toRunResult = (
  spec: TaskSpec,
  mode: RunMode,
  outcome: EscalationOutcome,
  baseProfile: ModelProfile
): AgentRunResult => {
  // An aborted (idle-stall) or no-progress run is not completed; force 'failed'
  // unless the pipeline already produced a terminal local-exhausted status.
  const stalled =
    (outcome.aborted || outcome.noProgress) &&
    !outcome.pipeline.passed &&
    outcome.pipeline.status !== 'local-exhausted';
  const status = stalled ? 'failed' : mapStatus(mode, outcome.pipeline);
  // Resolve the FINAL rung's profile once — its backend + modelId are what
  // actually ran (decoupled from the ladder rung label, see AgentRunResult).
  const finalProfile = profileForRung(outcome.finalLadder.rung, baseProfile);
  const failureClass = classifyFailure(status, outcome, finalFailureText(outcome.pipeline));
  const failedStage = resolveFailedStage(outcome.pipeline.failedStage);
  const base: AgentRunResult = {
    status,
    agentType: spec.agentType,
    touchedFiles: outcome.mutatedFiles,
    finalRung: outcome.finalLadder.rung,
    backend: finalProfile.backend,
    escalated: outcome.finalLadder.rung !== startRungForBackend(baseProfile.backend),
    fallbackSanctioned: failureClass !== undefined && SANCTIONED_FALLBACK.has(failureClass),
    attempts: outcome.attempts,
    redObserved: outcome.pipeline.redObserved,
    greenObserved: outcome.pipeline.greenObserved,
    modelId: finalProfile.modelId,
    targetFileCount: spec.targetFiles.length,
    ...(failureClass !== undefined ? { failureClass } : {}),
    ...(failedStage !== undefined ? { failedStage } : {}),
    ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
    ...(outcome.attemptRecords !== undefined ? { attemptRecords: outcome.attemptRecords } : {}),
  };
  const error = errorFor(failureClass);
  return error === undefined ? base : { ...base, error };
};

const UNKNOWN_MODEL_ID = 'unknown';

// The differing fields across the hard-stop result builders (fatal/dirty-tree/
// empty-spec): everything else in the ~15-field AgentRunResult is identical.
interface FailureResultFields {
  readonly status: RunStatus;
  readonly failureClass: FailureClass;
  readonly escalated: boolean;
  readonly error: string;
}

// The shared hard-stop shape (no model ran): attempts=1, nothing observed, an
// UNKNOWN model id, backend omitted. Parameterized only by the fields that differ
// between the fatal, dirty-tree, and empty-spec builders.
const failureResult = (
  agentType: AgentType,
  targetFiles: readonly string[],
  fields: FailureResultFields
): AgentRunResult => ({
  status: fields.status,
  agentType,
  touchedFiles: targetFiles,
  finalRung: 'ollama',
  failureClass: fields.failureClass,
  escalated: fields.escalated,
  fallbackSanctioned: false,
  attempts: 1,
  redObserved: false,
  greenObserved: false,
  modelId: UNKNOWN_MODEL_ID,
  targetFileCount: targetFiles.length,
  error: fields.error,
});

// A fatal infra/config error (no model ran): escalated=false and NOT a
// sanctioned review handoff — the orchestrator must surface it, not silently
// route for review. `backend` is omitted (nothing ran).
export const fatalResult = (spec: TaskSpec, error: string): AgentRunResult =>
  failureResult(spec.agentType, spec.targetFiles, {
    status: 'failed',
    failureClass: 'fatal',
    escalated: false,
    error,
  });

// A dirty-tree hard-stop (target already differs from HEAD): mirrors fatalResult
// but with a DISTINCT, diagnosable failureClass. Not a sanctioned review handoff
// — surface it; committing/stashing the dirty target is the fix.
export const dirtyTreeResult = (spec: TaskSpec, files: readonly string[]): AgentRunResult =>
  failureResult(spec.agentType, spec.targetFiles, {
    status: 'failed',
    failureClass: 'dirty-tree',
    escalated: false,
    error:
      'dirty-tree: target file(s) have uncommitted changes vs HEAD — commit or stash first; ' +
      'the runner reverts to the pre-run snapshot, so a dirty start would persist. ' +
      `Files: ${files.join(', ')}`,
  });

// An empty-spec hard-stop (nav bundle missing/corrupt or zero target files): the
// runner cannot run a blind task. Mirrors the dirty-tree shape with a DISTINCT
// failureClass and the local-exhausted review handoff so a human re-supplies the
// bundle. Built in runTask BEFORE runAgentLoop, so it never drives a model.
export const emptySpecResult = (
  agentType: AgentType,
  targetFiles: readonly string[]
): AgentRunResult =>
  failureResult(agentType, targetFiles, {
    status: 'local-exhausted',
    failureClass: 'empty-spec',
    escalated: true,
    error: EMPTY_SPEC_ERROR,
  });
