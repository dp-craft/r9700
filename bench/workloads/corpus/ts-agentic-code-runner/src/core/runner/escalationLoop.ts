import { resolve } from 'node:path';

import {
  buildRunSummary,
  captureAttempt,
  evalCaptureEnabled,
  preserveFailedOutputs,
  resolveEvalRunDir,
  writeRunSummary
} from '../capture';
import { createRegionStore } from '../execution';
import { type TaskSpec } from '../execution';
import {
  appendConclusion,
  buildDriveMessages,
  extractConclusion,
  failureSignature,
  type FeedbackFileContext,
  isNoProgress,
  type Ledger,
  localizeOutput } from '../gates';
import {
  decompositionGate,
  defaultRunTests,
  functionalStyleGate,
  type GateContext,
  type GateFailure,
  gateRun,
  noopGate,
  scopedLintGate,
  scopedTestGate,
  toGate,
  tscGate
} from '../gates';
import type { ConnectorDeps } from '../llm';
import {
  type AttemptSignal,
  type ClassifierConfig,
  classifyAttempt,
  CONTEXT_OVERFLOW_MARKER,
  isConnectivityError,
  isContextOverflowError,
  isGenerationTimeoutError,
  isNearMiss
} from '../llm';
import { forceEscalate, initLadder, type LadderState, recordFailure, startRungForBackend, TERMINAL_RUNG } from '../orchestration';
import {
  decompositionStage,
  functionalStyleStage,
  greenStage,
  lintStage,
  type PipelineResult,
  planRetry,
  redStage,
  repeatUntilExhausted,
  runPipeline,
  type Stage,
  type StageContext,
  testStage,
  tscStage
} from '../orchestration';
import { type ModelProfile, profileForRung } from '../profiles';
import {
  buildImplPreloadWithSliceContract,
  buildKickoff,
  buildTestKickoff,
  selectCodeKickoff
} from '../prompt';
import { createProgress, type Progress } from '../reporting';
import type { AttemptCarry, EscalationOutcome, UsageAccumulator } from '../result';
import {
  buildAttemptRecord,
  computeUsageDelta
} from '../result';
import type { AttemptRecord } from '../shared';
import { ENV } from '../shared';
import { buildSdkTools, createMutationTracker, createToolRegistry, type NavBundleLookup } from '../tools';
import type { RunnerDeps } from './runner';

const DEFAULT_MAX_STEPS = 32;
const MAX_STEPS_ENV = ENV.MAX_STEPS;

// Per-drive cap on the AI-SDK tool-loop steps. Each step is one upstream request;
// the cap bounds the request COUNT (compaction bounds each request's SIZE). A 16-step
// cap truncated weak models mid-edit on large files (read test + read store + multiple
// edit/re-read cycles exhausts 16 before the file is left parseable), so the cap is 32
// (matching the documented default in capabilities.ts). NaN / sub-1 overrides fall back.
export const resolveMaxSteps = (): number => {
  const parsed = Number(process.env[MAX_STEPS_ENV] ?? DEFAULT_MAX_STEPS);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_MAX_STEPS : Math.floor(parsed);
};

const DEFAULT_BON_SAMPLES = 3;

// Best-of-N sample count for the base (local) rung. Exploits proven output
// variance on byte-identical input: run up to N samples, the first gate-green
// wins. NaN / sub-1 overrides fall back to the default; N=1 disables best-of-N
// (reproduces the exact single-attempt behavior).
export const resolveBonSamples = (): number => {
  const parsed = Number(process.env[ENV.BON_SAMPLES] ?? DEFAULT_BON_SAMPLES);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_BON_SAMPLES : Math.floor(parsed);
};

const DEFAULT_IDLE_TIMEOUT_MS = 120000;

// Resolve the idle-timeout window from env (NaN-guard falls back to the default).
const resolveIdleTimeoutMs = (): number => {
  const parsed = Number(process.env.RUNNER_IDLE_TIMEOUT_MS ?? DEFAULT_IDLE_TIMEOUT_MS);
  return Number.isNaN(parsed) ? DEFAULT_IDLE_TIMEOUT_MS : parsed;
};

// drive() runs the model that was built for the CURRENT rung's attempt (F-01);
// the model is constructed per-attempt in runEscalation, not closed over the
// initial ladder, so each rung escalation rebuilds the model.
// Mutable tool-activity accumulator (instrumentation boundary): drive() sums the
// tool-call count returned by each generate() so the retry-classifier can detect
// an idle stall (zero tool activity within the timeout window).
interface ActivityAccumulator {
  toolCalls: number;
}

interface DriveDeps {
  readonly model: ReturnType<ConnectorDeps['createModel']>;
  readonly generate: ConnectorDeps['generate'];
  readonly resolveOllamaNumCtx: ConnectorDeps['resolveOllamaNumCtx'];
  readonly system: string;
  readonly kickoff: string;
  readonly registry: ReturnType<typeof createToolRegistry>;
  readonly activity: ActivityAccumulator;
  readonly usage: UsageAccumulator;
  readonly telemetry: Readonly<Record<string, string>>;
  readonly progress: Progress;
  readonly ledger: Ledger;
  readonly stage: 'test' | 'code';
  readonly taskStatement?: string;
  readonly kickoffSuffix?: () => Promise<string>;
}

// Fraction of num_ctx above which an ollama prompt is treated as a context
// overflow: past this the model silently slides the oldest (task/system) messages
// off the window and corrupts the run with no signal. 0.9 leaves headroom for the
// final response tokens the prompt count does not include.
export const CONTEXT_OVERFLOW_FRACTION = 0.9;

// Only the ollama backend has a hard num_ctx; openrouter manages its own window.
// Returns a marked overflow message (force-escalates downstream) when an ollama
// step's prompt exceeded the threshold, else null. Chosen approach: POST-step
// check — generate() runs the whole tool-loop internally, so the cleanest abort
// the SDK supports is inspecting the per-step prompt counts it returns and failing
// the attempt loudly (vs. estimating tokens or hooking onStepFinish mid-loop).
const contextOverflowMessage = (
  resolveOllamaNumCtx: ConnectorDeps['resolveOllamaNumCtx'],
  backend: string,
  maxStepPromptTokens: number | undefined
): string | null => {
  if (backend !== 'ollama' || maxStepPromptTokens === undefined) return null;
  const limit = resolveOllamaNumCtx() * CONTEXT_OVERFLOW_FRACTION;
  if (maxStepPromptTokens <= limit) return null;
  return `${CONTEXT_OVERFLOW_MARKER}: prompt of ${maxStepPromptTokens} tokens exceeded num_ctx*${CONTEXT_OVERFLOW_FRACTION} (${limit}) — escalating to a larger-context rung`;
};

const makeDrive = (deps: DriveDeps): (() => Promise<void>) => {
  return async (): Promise<void> => {
    const suffix = deps.kickoffSuffix ? await deps.kickoffSuffix() : '';
    const result = await deps.generate(deps.model, {
      system: deps.system,
      messages: buildDriveMessages(deps.kickoff + suffix, deps.ledger, deps.stage),
      tools: buildSdkTools(deps.registry, deps.stage, {
        stage: deps.stage,
        taskStatement: deps.taskStatement,
      }),
      maxSteps: resolveMaxSteps(),
      telemetry: deps.telemetry,
    });
    deps.activity.toolCalls += result.toolCallCount;
    if (result.usage !== undefined) {
      deps.usage.inputTokens += result.usage.inputTokens;
      deps.usage.outputTokens += result.usage.outputTokens;
      deps.usage.totalTokens += result.usage.totalTokens;
    }
    deps.progress.event('drive', `toolCalls=${result.toolCallCount}`);
    if (result.haltReason === 'convergence') {
      deps.progress.event('halt', 'convergence');
    }
    const overflow = contextOverflowMessage(deps.resolveOllamaNumCtx, deps.telemetry.backend, result.maxStepPromptTokens);
    if (overflow !== null) {
      throw new Error(overflow);
    }
  };
};

interface StageContextDrives {
  readonly driveTest: () => Promise<void>;
  readonly driveCode: () => Promise<void>;
  readonly structuralGates: boolean;
}

const buildStageContext = (
  spec: TaskSpec,
  deps: RunnerDeps,
  drives: StageContextDrives,
  progress: Progress
): StageContext => {
  const cwd = process.cwd();
  const gateCtx: GateContext = { cwd, run: gateRun };
  return {
    cwd,
    driveTest: drives.driveTest,
    driveCode: drives.driveCode,
    runTests: deps.runTests ?? defaultRunTests(spec),
    lintGate: (files, gateCtx) => scopedLintGate(files)(gateCtx),
    tscGate: toGate(tscGate),
    testGate: scopedTestGate(spec.targetFiles),
    decompositionGate: drives.structuralGates ? decompositionGate : noopGate,
    functionalStyleGate: drives.structuralGates ? functionalStyleGate : noopGate,
    gateCtx,
    touchedFiles: spec.targetFiles,
    redObserved: false,
    greenObserved: deps.mode !== 'tdd',
    progress,
  };
};

// Map the failed stage back to a classifier failure kind. No failure ⇒ transient
// (the classifier returns retry for transient, which is harmless here).
const failureKindFor = (
  failedStage: Stage | undefined
): AttemptSignal['failureKind'] => {
  if (failedStage === undefined) {
    return 'transient';
  }
  if (failedStage === redStage || failedStage === greenStage || failedStage === testStage) {
    return 'test-fail';
  }
  if (
    failedStage === lintStage ||
    failedStage === tscStage ||
    failedStage === decompositionStage ||
    failedStage === functionalStyleStage
  ) {
    return 'gate-fail';
  }
  return 'transient';
};

// Decide abort-vs-retry for a failed attempt via the retry-classifier. The attempt
// number + failing-gate output are threaded so the first-attempt early-exit triage
// can see a decisively deep failure and end the run as terminally exhausted.
const decideAborted = (
  pipeline: PipelineResult,
  activity: ActivityAccumulator,
  elapsedMs: number,
  cfg: ClassifierConfig,
  attemptNumber: number
): boolean => {
  if (pipeline.passed) {
    return false;
  }
  const signal: AttemptSignal = {
    failureKind: failureKindFor(pipeline.failedStage),
    toolActivityCount: activity.toolCalls,
    elapsedMs,
    attemptNumber,
    output: pipeline.failure?.output ?? '',
  };
  return classifyAttempt(signal, cfg) === 'abort';
};

// Mutable invocation counter (instrumentation boundary): counts the real number
// of pipeline attempts run across the escalation loop (F-03).
interface AttemptCounter {
  count: number;
}

// Drive-throw classes that cannot retry into success on the same rung (the rung is
// unreachable, the window is fixed, or the generation stalled/ran away) → force the
// climb to the next rung immediately rather than burning counted retries.
const isForceEscalateError = (message: string): boolean =>
  isConnectivityError(message) ||
  isContextOverflowError(message) ||
  isGenerationTimeoutError(message);

// A drive (model-call) exception never reaches runPipeline, so it cannot burn a
// rung via the counted path. Classify it: a CONNECTIVITY failure on a rung cannot
// retry into success → force-escalate to the next rung immediately; any other
// throw keeps the counted recordFailure behavior. The synthetic failure's output
// is rung-tagged so the same connectivity error on consecutive DIFFERENT rungs
// yields different signatures (no false no-progress halt).
const driveFailurePipeline = (
  ladder: LadderState,
  message: string
): PipelineResult => {
  const escalated = isForceEscalateError(message) ? forceEscalate(ladder) : recordFailure(ladder);
  const failure: GateFailure = {
    gate: 'drive',
    message: `drive failed on the ${ladder.rung} rung`,
    output: `[rung:${ladder.rung}] ${message}`,
  };
  return {
    status: escalated.exhausted ? 'local-exhausted' : 'failed',
    passed: false,
    redObserved: false,
    greenObserved: false,
    failedStageIndex: undefined,
    failure,
    finalLadder: escalated,
  };
};

// Env flag that gates the optional LLM-summarizer for conclusion notes.
export const LLM_CONCLUSION_ENV = 'RUNNER_LLM_CONCLUSION';

// Returns a summarizer function when the env flag is '1' or 'true'; otherwise
// undefined (deterministic buildFeedbackMessage fallback is used instead).
export const resolveConclusionSummarizer = (
  generate: ConnectorDeps['generate'],
  model: ReturnType<ConnectorDeps['createModel']>
): ((f: GateFailure) => Promise<string | null>) | undefined => {
  const val = process.env[LLM_CONCLUSION_ENV]?.trim().toLowerCase();
  if (val !== '1' && val !== 'true') return undefined;
  return async (failure: GateFailure): Promise<string | null> => {
    const r = await generate(model, {
      system:
        '<senior-eng: in ≤5 short lines summarize what was attempted/changed and the constraint to respect next; describe actions only, no judgment, no code>',
      messages: [{ role: 'user', content: localizeOutput(failure) }],
      tools: {},
      maxSteps: 1,
    });
    return r.text.trim() || null;
  };
};

export interface BuildOutcomeOpts {
  readonly priorLedger: Ledger;
  readonly history: readonly string[];
  readonly attempts: number;
  readonly aborted: boolean;
  readonly redStageFailed: boolean;
  readonly summarize?: (f: GateFailure) => Promise<string | null>;
  readonly fileContext?: FeedbackFileContext;
}

// Extract stable no-progress metadata from a pipeline result + history.
const computeProgressInfo = (
  pipeline: PipelineResult,
  history: readonly string[]
): { readonly noProgress: boolean; readonly nextHistory: readonly string[] } => {
  const signature =
    pipeline.failure === undefined ? undefined : failureSignature(pipeline.failure);
  return {
    noProgress: signature !== undefined && isNoProgress(history, signature),
    nextHistory: signature === undefined ? history : [...history, signature],
  };
};

// Build the EscalationOutcome shared by the success path and the drive-throw path:
// thread the failure signature into the history (no-progress check) and append a
// stage-tagged Conclusion to the ledger. `redStageFailed` routes to the test role;
// any other stage failure routes to the code role.
export const buildOutcome = async (
  pipeline: PipelineResult,
  opts: BuildOutcomeOpts
): Promise<EscalationOutcome> => {
  const { priorLedger, history, attempts, aborted, redStageFailed, summarize, fileContext } = opts;
  const { noProgress, nextHistory } = computeProgressInfo(pipeline, history);
  const base = {
    passed: pipeline.passed,
    finalLadder: pipeline.finalLadder,
    pipeline,
    attempts,
    aborted,
    noProgress,
    mutatedFiles: [] as readonly string[],
  };
  if (pipeline.failure === undefined) {
    return { ...base, carry: { ledger: priorLedger, history: nextHistory, lastPipeline: pipeline } };
  }
  const stage: 'test' | 'code' = redStageFailed ? 'test' : 'code';
  const conclusion = await extractConclusion(pipeline.failure, attempts, stage, summarize, fileContext);
  const ledger = appendConclusion(priorLedger, conclusion);
  return { ...base, carry: { ledger, history: nextHistory, lastPipeline: pipeline } };
};

// Drive escalation via repeatUntilExhausted (F-01): build the rung model
// per-attempt (NOT closed over the initial ladder), run the pipeline, thread the
// resulting ladder back, and count the real number of attempts (F-03).
// Mutable holder for the rung seen on the previous attempt, so a rung change
// across attempts can surface an 'escalate' event (instrumentation boundary).
interface RungTracker {
  rung: LadderState['rung'];
}

const emitEscalation = (progress: Progress, tracker: RungTracker, rung: LadderState['rung']): void => {
  if (rung !== tracker.rung) {
    progress.event('escalate', `${tracker.rung}→${rung}`);
    tracker.rung = rung;
  }
};

const emitAbort = (progress: Progress, outcome: EscalationOutcome): void => {
  if (outcome.aborted) {
    progress.event('abort', 'idle-stall');
  } else if (outcome.noProgress) {
    progress.event('abort', 'no-progress');
  }
};

// All mutable run-level state for one escalation. The accumulators (usage,
// attemptRecords, counter, modelTracker, rungTracker) are MUTATED across attempts
// and read again in finalizeRun/telemetry — they MUST stay the same shared object
// references (state is passed by reference to runAttempt, never spread/cloned).
interface EscalationState {
  readonly spec: TaskSpec;
  readonly deps: RunnerDeps;
  readonly baseProfile: ModelProfile;
  readonly systems: { readonly test: string; readonly code: string };
  readonly structuralGates: boolean;
  readonly progress: Progress;
  readonly runStartedAt: number;
  readonly tracker: ReturnType<typeof createMutationTracker>;
  readonly registry: ReturnType<typeof createToolRegistry>;
  readonly regionStore: ReturnType<typeof createRegionStore>;
  readonly counter: AttemptCounter;
  readonly cfg: ClassifierConfig;
  readonly initialLadder: LadderState;
  readonly rungTracker: RungTracker;
  readonly modelTracker: { id: string };
  readonly usage: UsageAccumulator;
  readonly redStageFailed: (pipeline: PipelineResult) => boolean;
  readonly captureEnabled: boolean;
  readonly evalRunDir: string | undefined;
  readonly attemptRecords: { rows: readonly AttemptRecord[] };
}

const setupEscalation = (
  spec: TaskSpec,
  deps: RunnerDeps,
  baseProfile: ModelProfile,
  systems: { readonly test: string; readonly code: string },
  structuralGates: boolean,
  navBundleLookup: NavBundleLookup
): EscalationState => {
  const progress = deps.progress ?? createProgress(false);
  const runStartedAt = Date.now();
  const tracker = createMutationTracker(process.cwd());
  const regionStore = createRegionStore();
  const registry = createToolRegistry(
    process.cwd(),
    navBundleLookup,
    spec.targetFiles,
    tracker,
    regionStore
  );
  const counter: AttemptCounter = { count: 0 };
  const cfg: ClassifierConfig = { idleTimeoutMs: resolveIdleTimeoutMs() };
  const initialLadder = initLadder(startRungForBackend(baseProfile.backend));
  const rungTracker: RungTracker = { rung: initialLadder.rung };
  // Tracks the model id used by the LAST attempt's drive, so a preserved failed
  // output is labelled with the model that actually produced it (not the NEXT
  // rung's model that recordFailure already advanced the ladder to).
  const modelTracker = { id: baseProfile.modelId };
  // Run-level token accumulator: survives across attempts/rungs (unlike the
  // per-attempt activity accumulator) so telemetry sees the whole run's cost.
  const usage: UsageAccumulator = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const redStageFailed = (pipeline: PipelineResult): boolean =>
    deps.mode === 'tdd' && pipeline.failedStage === redStage;
  // Opt-in eval capture: resolve the run dir once; per-attempt artifacts are
  // snapshotted before the NEXT attempt's revert discards them.
  const captureEnabled = evalCaptureEnabled(process.env);
  const evalRunDir = captureEnabled
    ? resolveEvalRunDir({
        cwd: process.cwd(),
        navBundlePath: spec.navBundlePath,
        timestamp: runStartedAt,
      })
    : undefined;
  // Per-attempt telemetry accumulator (instrumentation boundary): spread-reassigned
  // on every attempt so the final rows array is readonly-safe and push-free.
  const attemptRecords: { rows: readonly AttemptRecord[] } = { rows: [] };
  return {
    spec,
    deps,
    baseProfile,
    systems,
    structuralGates,
    progress,
    runStartedAt,
    tracker,
    registry,
    regionStore,
    counter,
    cfg,
    initialLadder,
    rungTracker,
    modelTracker,
    usage,
    redStageFailed,
    captureEnabled,
    evalRunDir,
    attemptRecords,
  };
};

// Which authoritative-source contract the code drive showed the model this
// attempt, so retry feedback matches the kickoff (G2). A test-stage failure
// reads/edits the test file directly → 'none'. A code-stage failure used slice
// mode when the region store recorded an authorized region → 'slice'; otherwise
// buildImplPreload covered the target as authoritative full source → 'preload'.
const resolveFileContext = (
  state: EscalationState,
  redStageFailed: boolean
): FeedbackFileContext => {
  if (redStageFailed || state.spec.targetFiles.length === 0) return 'none';
  const recorded = state.regionStore.get(resolve(process.cwd(), state.spec.targetFiles[0]));
  return recorded !== null ? 'slice' : 'preload';
};

const runAttempt = async (
  state: EscalationState,
  ladder: LadderState,
  prior?: AttemptCarry
): Promise<EscalationOutcome> => {
  const { spec, deps, baseProfile, systems, structuralGates, progress } = state;
  state.counter.count += 1;
  emitEscalation(progress, state.rungTracker, ladder.rung);
  const profile = profileForRung(ladder.rung, baseProfile);
  state.modelTracker.id = profile.modelId;
  const model = deps.connector.createModel(profile);
  progress.event('attempt', `#${state.counter.count} rung=${ladder.rung}`);
  progress.event('model', profile.modelId);
  // Fresh per-attempt tool-activity accumulator (instrumentation boundary).
  const activity: ActivityAccumulator = { toolCalls: 0 };
  const telemetry: Readonly<Record<string, string>> = {
    modelId: profile.modelId,
    backend: profile.backend,
    agentType: spec.agentType,
    rung: ladder.rung,
  };
  const priorLedger: Ledger = prior?.ledger ?? [];
  const summarize = resolveConclusionSummarizer(deps.connector.generate, model);
  const driveBase = {
    model,
    generate: deps.connector.generate,
    resolveOllamaNumCtx: deps.connector.resolveOllamaNumCtx,
    registry: state.registry,
    activity,
    usage: state.usage,
    telemetry,
    progress,
  };
  const driveTest = makeDrive({
    ...driveBase,
    system: systems.test,
    kickoff: buildKickoff(await buildTestKickoff(spec.existingTests), spec.taskStatement),
    ledger: priorLedger,
    stage: 'test',
    taskStatement: spec.taskStatement,
  });
  const driveCode = makeDrive({
    ...driveBase,
    system: systems.code,
    kickoff: buildKickoff(selectCodeKickoff(deps.mode), spec.taskStatement),
    taskStatement: spec.taskStatement,
    kickoffSuffix: (): Promise<string> =>
      buildImplPreloadWithSliceContract(spec, undefined, {
        regionStore: state.regionStore,
      }),
    ledger: priorLedger,
    stage: 'code',
  });
  const ctx = buildStageContext(spec, deps, { driveTest, driveCode, structuralGates }, progress);
  const history = prior?.history ?? [];
  const plan = planRetry(deps.mode, prior?.lastPipeline);
  await deps.onBeforeAttempt?.(plan.reset);
  if (plan.reset && prior !== undefined) {
    await state.tracker.revert();
  }
  // Snapshot this attempt's artifacts for EVERY outcome (completed/failed/
  // escalate) before the next attempt's revert discards them — the catch
  // (drive-throw) path must capture too, else escalate collapses to run.json.
  const snapshotAttempt = async (result: PipelineResult, elapsedMs: number): Promise<void> => {
    if (state.evalRunDir === undefined) return;
    await captureAttempt({
      runDir: state.evalRunDir,
      cwd: process.cwd(),
      attempt: state.counter.count,
      rung: ladder.rung,
      stages: plan.stages,
      pipeline: result,
      mutatedFiles: state.tracker.mutatedPaths(),
      toolCalls: activity.toolCalls,
      durationMs: elapsedMs,
    });
  };
  const startedAt = Date.now();
  const u0 = { ...state.usage };
  try {
    const pipeline = await runPipeline(plan.stages, ctx, ladder);
    const elapsedMs = Date.now() - startedAt;
    const aborted = decideAborted(pipeline, activity, elapsedMs, state.cfg, state.counter.count);
    const redStageFailed = state.redStageFailed(pipeline);
    const outcome = await buildOutcome(pipeline, {
      priorLedger,
      history,
      attempts: state.counter.count,
      aborted,
      redStageFailed,
      summarize,
      fileContext: resolveFileContext(state, redStageFailed),
    });
    emitAbort(progress, outcome);
    const rec = buildAttemptRecord(
      { attempt: state.counter.count, rung: ladder.rung, modelId: profile.modelId, backend: profile.backend, toolCalls: activity.toolCalls, durationMs: elapsedMs },
      pipeline,
      computeUsageDelta(state.usage, u0)
    );
    state.attemptRecords.rows = [...state.attemptRecords.rows, rec];
    await snapshotAttempt(pipeline, elapsedMs);
    return outcome;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const failPipeline = driveFailurePipeline(ladder, message);
    const rec = buildAttemptRecord(
      { attempt: state.counter.count, rung: ladder.rung, modelId: profile.modelId, backend: profile.backend, toolCalls: activity.toolCalls, durationMs: Date.now() - startedAt },
      failPipeline,
      computeUsageDelta(state.usage, u0)
    );
    state.attemptRecords.rows = [...state.attemptRecords.rows, rec];
    await snapshotAttempt(failPipeline, Date.now() - startedAt);
    // A drive throw has no failed stage → feedback routes to the code role.
    return buildOutcome(failPipeline, {
      priorLedger,
      history,
      attempts: state.counter.count,
      aborted: false,
      redStageFailed: false,
      summarize,
      fileContext: resolveFileContext(state, false),
    });
  }
};

const finalizeRun = async (
  state: EscalationState,
  outcome: EscalationOutcome
): Promise<EscalationOutcome> => {
  // Snapshot what the mutating tools ACTUALLY changed BEFORE any revert, so the
  // reported touchedFiles stay honest regardless of the revert.
  const mutatedFiles = state.tracker.mutatedPaths();
  if (!outcome.passed) {
    if (mutatedFiles.length > 0) {
      await preserveFailedOutputs({
        navBundlePath: state.spec.navBundlePath,
        modelId: state.modelTracker.id,
        mutatedFiles,
        timestamp: Date.now(),
      });
    }
    await state.tracker.revert();
  }
  if (state.evalRunDir !== undefined) {
    await writeRunSummary(
      state.evalRunDir,
      buildRunSummary({
        navBundlePath: state.spec.navBundlePath,
        modelId: state.modelTracker.id,
        mode: state.deps.mode,
        status: outcome.passed ? 'completed' : outcome.pipeline.status,
        finalRung: outcome.finalLadder.rung,
        attempts: outcome.attempts,
        totalTokens: state.usage.totalTokens,
      })
    );
  }
  return { ...outcome, mutatedFiles, usage: { ...state.usage }, attemptRecords: state.attemptRecords.rows };
};

// Best-of-N gate-select fires only on the BASE (local, non-terminal) rung and
// only when N>1. The terminal claude handoff rung runs a single attempt, and
// N=1 reproduces the exact single-attempt (feature-off) path.
export const shouldRunBestOfN = (ladder: LadderState, samples: number): boolean =>
  samples > 1 && !ladder.exhausted && ladder.rung !== TERMINAL_RUNG;

// A sample that ENDS the adaptive-retry loop with no further sample: a gate-green
// winner (its mutations are kept) OR a ladder exhaustion (no local rung left to
// try). A 5.2 triage-abort NO LONGER ends the loop — while sample budget remains it
// flips the next sample to a fresh re-roll (the triage forfeits attempt 1 precisely
// so a fresh attempt can start; the old byte-identical best-of-N forfeited the
// remaining budget instead).
const bonLoopEnds = (outcome: EscalationOutcome): boolean =>
  outcome.passed || outcome.finalLadder.exhausted;

// Run up to `samples` SEQUENTIAL base-rung attempts (single GPU — never parallel).
// This is an ADAPTIVE retry loop, not pure best-of-N: after each losing sample it
// classifies the outcome (isNearMiss). A NEAR-MISS — a concrete, self-fixable gate
// failure whose edits landed — is ITERATED: its file state is kept and its conclusion
// ledger is threaded as the next sample's `prior`, so the model fixes its own
// near-green attempt from the gate feedback (the ledger machinery the old
// byte-identical best-of-N never reached). A HOPELESS sample (abort, drive-throw,
// zero mutations, stuck no-progress) is REVERTED and re-rolled from the ORIGINAL
// `prior` (a fresh sample). The first gate-green sample wins and its mutations
// survive; a ladder exhaustion ends the loop. Each sample is a real counted attempt
// with its own attempt_runs row (runAttempt owns that). After the budget is spent the
// last outcome is returned so the escalation machinery advances/exhausts unchanged.
const runBestOfN = async (
  state: EscalationState,
  ladder: LadderState,
  prior: AttemptCarry | undefined,
  samples: number
): Promise<EscalationOutcome> => {
  const step = async (
    rung: LadderState,
    priorCarry: AttemptCarry | undefined,
    remaining: number
  ): Promise<EscalationOutcome> => {
    const outcome = await runAttempt(state, rung, priorCarry);
    if (bonLoopEnds(outcome) || remaining <= 1) {
      return outcome;
    }
    const nearMiss = isNearMiss({
      failedGate: outcome.pipeline.failure?.gate,
      aborted: outcome.aborted,
      noProgress: outcome.noProgress,
      mutatedCount: state.tracker.mutatedPaths().length,
    });
    if (nearMiss) {
      // Iterate: keep the edits on disk, thread THIS sample's ledger feedback forward.
      return step(outcome.finalLadder, outcome.carry, remaining - 1);
    }
    // Hopeless: discard the edits, re-roll from the original prior (fresh sample).
    await state.tracker.revert();
    return step(outcome.finalLadder, prior, remaining - 1);
  };
  return step(ladder, prior, samples);
};

export const runEscalation = async (
  spec: TaskSpec,
  deps: RunnerDeps,
  baseProfile: ModelProfile,
  systems: { readonly test: string; readonly code: string },
  structuralGates: boolean,
  navBundleLookup: NavBundleLookup
): Promise<EscalationOutcome> => {
  const state = setupEscalation(spec, deps, baseProfile, systems, structuralGates, navBundleLookup);
  const samples = resolveBonSamples();
  const outcome = await repeatUntilExhausted(
    state.initialLadder,
    (ladder: LadderState, prior?: AttemptCarry) =>
      shouldRunBestOfN(ladder, samples)
        ? runBestOfN(state, ladder, prior, samples)
        : runAttempt(state, ladder, prior)
  );
  return finalizeRun(state, outcome);
};
