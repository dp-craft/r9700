import type { GateContext, GateFailure } from '../gates';
import { isTransformError } from '../gates';
import type { Progress } from '../reporting';
import type { RunMode, RunStatus } from '../shared';
import type { LadderState } from './escalation';
import { recordFailure } from './escalation';

export interface StageContext {
  readonly cwd: string;
  readonly driveTest: () => Promise<void>;
  readonly driveCode: () => Promise<void>;
  readonly runTests: () => Promise<{ readonly passed: boolean; readonly output: string; readonly noTests: boolean }>;
  readonly lintGate: (
    files: readonly string[],
    gateCtx: GateContext
  ) => Promise<GateFailure | null>;
  readonly tscGate: (ctx: GateContext) => Promise<GateFailure | null>;
  readonly testGate: (ctx: GateContext) => Promise<GateFailure | null>;
  readonly decompositionGate: (
    files: readonly string[],
    gateCtx: GateContext
  ) => Promise<GateFailure | null>;
  readonly functionalStyleGate: (
    files: readonly string[],
    gateCtx: GateContext
  ) => Promise<GateFailure | null>;
  readonly gateCtx: GateContext;
  readonly touchedFiles: readonly string[];
  readonly redObserved: boolean;
  readonly greenObserved: boolean;
  readonly progress: Progress;
}

export type StageOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'fail'; readonly failure: GateFailure };

export type Stage = (ctx: StageContext) => Promise<StageOutcome>;

export interface PipelineResult {
  readonly status: RunStatus;
  readonly passed: boolean;
  readonly redObserved: boolean;
  readonly greenObserved: boolean;
  readonly failedStageIndex: number | undefined;
  readonly failedStage?: Stage;
  readonly failure?: GateFailure;
  readonly finalLadder: LadderState;
}

const ok = (): StageOutcome => ({ kind: 'ok' });

const failOutcome = (gate: GateFailure['gate'], message: string, output: string): StageOutcome => ({
  kind: 'fail',
  failure: { gate, message, output },
});

const gateOutcome = (failure: GateFailure | null): StageOutcome =>
  failure === null ? ok() : { kind: 'fail', failure };

export const redStage: Stage = async (ctx: StageContext): Promise<StageOutcome> => {
  await ctx.driveTest();
  const { passed, output, noTests } = await ctx.runTests();
  if (noTests) {
    return failOutcome('test', 'no test was created or collected — write a failing test for the target', output);
  }
  if (isTransformError(output)) {
    return failOutcome('test', 'test file does not parse — fix the test-file syntax', output);
  }
  return passed
    ? failOutcome('test', 'tests pass before RED phase — write a NEW failing test for the target', output)
    : ok();
};

export const implStage: Stage = async (ctx: StageContext): Promise<StageOutcome> => {
  await ctx.driveCode();
  return ok();
};

export const greenStage: Stage = async (ctx: StageContext): Promise<StageOutcome> => {
  await ctx.driveCode();
  const { passed, output, noTests } = await ctx.runTests();
  if (noTests) {
    return failOutcome('test', 'no test ran to confirm GREEN — the target test is missing', output);
  }
  return passed
    ? ok()
    : failOutcome('test', 'tests did not reach GREEN after the implementation drive', output);
};

export const lintStage: Stage = async (ctx: StageContext): Promise<StageOutcome> =>
  gateOutcome(await ctx.lintGate(ctx.touchedFiles, ctx.gateCtx));

export const tscStage: Stage = async (ctx: StageContext): Promise<StageOutcome> =>
  gateOutcome(await ctx.tscGate(ctx.gateCtx));

export const testStage: Stage = async (ctx: StageContext): Promise<StageOutcome> =>
  gateOutcome(await ctx.testGate(ctx.gateCtx));

// Runs LAST: correctness is gated first, then structure. A complex-but-passing
// solution fails here and the feedback loop tells the model to extract helpers.
export const decompositionStage: Stage = async (ctx: StageContext): Promise<StageOutcome> =>
  gateOutcome(await ctx.decompositionGate(ctx.touchedFiles, ctx.gateCtx));

// Runs after decompositionStage: rejects imperative constructs (loops, let, var,
// classes) in generated source — enforces the FP "no loops" rule structurally.
export const functionalStyleStage: Stage = async (ctx: StageContext): Promise<StageOutcome> =>
  gateOutcome(await ctx.functionalStyleGate(ctx.touchedFiles, ctx.gateCtx));

// Stable display names for each Stage, keyed by identity. The capabilities
// command projects gate sequences from PIPELINES through this map; a stage used
// in PIPELINES without an entry here surfaces as 'unknown' (drift guard test).
export const STAGE_NAME: ReadonlyMap<Stage, string> = new Map<Stage, string>([
  [redStage, 'red'],
  [implStage, 'impl'],
  [greenStage, 'green'],
  [lintStage, 'lint'],
  [tscStage, 'tsc'],
  [testStage, 'test'],
  [decompositionStage, 'decomposition'],
  [functionalStyleStage, 'functional-style'],
]);

export const PIPELINES: Record<'tdd' | 'impl', readonly Stage[]> = {
  tdd: [
    redStage,
    implStage,
    greenStage,
    lintStage,
    tscStage,
    decompositionStage,
    functionalStyleStage,
  ],
  impl: [implStage, lintStage, tscStage, testStage, decompositionStage, functionalStyleStage],
};

export interface RetryPlan {
  readonly stages: readonly Stage[];
  readonly reset: boolean;
}

// Plan the next attempt's pipeline. Resume: once a valid failing test was
// established (redObserved), the test is good — a later gate failure (greenStage
// incomplete-impl OR a post-green structural gate) resumes on the impl pipeline
// (no RED, no reset) so the failing test + partial impl survive and the model
// iterates with the gate failure as feedback. Restart: only when RED was never
// observed (the test itself is the problem) does tdd restart with a full reset.
export const planRetry = (mode: RunMode, prior: PipelineResult | undefined): RetryPlan => {
  if (prior === undefined || mode !== 'tdd') {
    return { stages: PIPELINES[mode], reset: false };
  }
  if (prior.redObserved === true) {
    return { stages: PIPELINES.impl, reset: false };
  }
  return { stages: PIPELINES.tdd, reset: true };
};

interface StageScan {
  readonly failedStageIndex: number | undefined;
  readonly failedStage: Stage | undefined;
  readonly failure: GateFailure | undefined;
  readonly ladder: LadderState;
  readonly redObserved: boolean;
  readonly greenObserved: boolean;
}

const observeStage = (
  stage: Stage,
  scan: StageScan
): Pick<StageScan, 'redObserved' | 'greenObserved'> => ({
  redObserved: scan.redObserved || stage === redStage,
  greenObserved: scan.greenObserved || stage === greenStage,
});

const stageLabel = (stage: Stage): string => STAGE_NAME.get(stage) ?? 'unknown';

const shortMsg = (failure: GateFailure): string => failure.message.split('\n')[0].slice(0, 80);

const scanStages = async (
  stages: readonly Stage[],
  ctx: StageContext,
  ladder0: LadderState
): Promise<StageScan> => {
  const reducer = async (
    accP: Promise<StageScan>,
    stage: Stage,
    index: number
  ): Promise<StageScan> => {
    const acc = await accP;
    if (acc.failedStageIndex !== undefined) {
      return acc;
    }
    const label = stageLabel(stage);
    ctx.progress.event('stage', `${label} start`);
    const outcome = await stage(ctx);
    if (outcome.kind === 'fail') {
      ctx.progress.event('stage', `${label} fail: ${shortMsg(outcome.failure)}`);
      return {
        ...acc,
        failedStageIndex: index,
        failedStage: stage,
        failure: outcome.failure,
        ladder: recordFailure(acc.ladder),
      };
    }
    ctx.progress.event('stage', `${label} ok`);
    return { ...acc, ...observeStage(stage, acc) };
  };
  const seed: StageScan = {
    failedStageIndex: undefined,
    failedStage: undefined,
    failure: undefined,
    ladder: ladder0,
    redObserved: false,
    greenObserved: false,
  };
  return stages.reduce(reducer, Promise.resolve(seed));
};

// greenObserved for gate-only pipelines (impl, no greenStage): all stages passed.
const resolveGreenObserved = (stages: readonly Stage[], scan: StageScan): boolean =>
  stages.includes(greenStage) ? scan.greenObserved : scan.failedStageIndex === undefined;

const statusFor = (
  failedStageIndex: number | undefined,
  greenObserved: boolean,
  ladder: LadderState
): RunStatus => {
  if (failedStageIndex !== undefined) {
    return ladder.exhausted ? 'local-exhausted' : 'failed';
  }
  return greenObserved ? 'completed' : 'failed';
};

export async function runPipeline(
  stages: readonly Stage[],
  ctx: StageContext,
  ladder0: LadderState
): Promise<PipelineResult> {
  const scan = await scanStages(stages, ctx, ladder0);
  const greenObserved = resolveGreenObserved(stages, scan);
  const status = statusFor(scan.failedStageIndex, greenObserved, scan.ladder);
  return {
    status,
    passed: status === 'completed',
    redObserved: scan.redObserved,
    greenObserved,
    failedStageIndex: scan.failedStageIndex,
    failedStage: scan.failedStage,
    failure: scan.failure,
    finalLadder: scan.ladder,
  };
}

// Retry loop. `attempt` may return a `carry` (threaded as `prior` into the next
// attempt — e.g. failure feedback) and a `noProgress` flag (the same failure
// recurred → stop early instead of exhausting the ladder). Both are optional, so
// a plain `(ladder) => T` attempt that sets neither behaves exactly as before.
export async function repeatUntilExhausted<
  C,
  T extends {
    readonly passed: boolean;
    readonly finalLadder: LadderState;
    readonly aborted?: boolean;
    readonly noProgress?: boolean;
    readonly carry?: C;
  }
>(ladder0: LadderState, attempt: (ladder: LadderState, prior?: C) => Promise<T>): Promise<T> {
  const run = async (ladder: LadderState, prior: C | undefined): Promise<T> => {
    const result = await attempt(ladder, prior);
    const stop =
      result.passed ||
      result.aborted === true ||
      result.noProgress === true ||
      result.finalLadder.exhausted;
    return stop ? result : run(result.finalLadder, result.carry);
  };
  return run(ladder0, undefined);
}
