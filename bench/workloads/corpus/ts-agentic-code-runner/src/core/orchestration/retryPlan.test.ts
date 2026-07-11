import { describe, expect, it } from 'vitest';

import type { GateContext, GateFailure } from '../gates/gates';
import { createProgress } from '../reporting/progress';
import { initLadder } from './escalation';
import {
  decompositionStage,
  functionalStyleStage,
  greenStage,
  implStage,
  lintStage,
  type PipelineResult,
  PIPELINES,
  redStage,
  runPipeline,
  tscStage
} from './pipeline';
import { planRetry } from './pipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeGateFailure = (gate: GateFailure['gate'] = 'lint'): GateFailure => ({
  gate,
  message: 'gate failed',
  output: '',
});

const makePipelineResult = (overrides: Partial<PipelineResult> = {}): PipelineResult => ({
  status: 'failed',
  passed: false,
  redObserved: false,
  greenObserved: false,
  failedStageIndex: undefined,
  failedStage: undefined,
  failure: undefined,
  finalLadder: initLadder(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// planRetry — truth table
// ---------------------------------------------------------------------------

describe('planRetry — first attempt (prior undefined)', () => {
  it('should return PIPELINES.tdd and reset false when mode is tdd and prior is undefined', () => {
    const result = planRetry('tdd', undefined);

    expect(result.stages).toBe(PIPELINES.tdd);
    expect(result.reset).toBe(false);
  });

  it('should return PIPELINES.impl and reset false when mode is impl and prior is undefined', () => {
    const result = planRetry('impl', undefined);

    expect(result.stages).toBe(PIPELINES.impl);
    expect(result.reset).toBe(false);
  });
});

describe('planRetry — non-tdd modes always return full pipeline without reset', () => {
  it('should return PIPELINES.impl and reset false for impl mode even after a prior failure', () => {
    const prior = makePipelineResult({
      greenObserved: true,
      failedStage: lintStage,
    });

    const result = planRetry('impl', prior);

    expect(result.stages).toBe(PIPELINES.impl);
    expect(result.reset).toBe(false);
  });
});

describe('planRetry — tdd post-green structural gate failure (R2)', () => {
  it('should return PIPELINES.impl and reset false when tdd prior failed at lintStage with greenObserved true', () => {
    const prior = makePipelineResult({
      redObserved: true,
      greenObserved: true,
      failedStage: lintStage,
      failure: makeGateFailure('lint'),
    });

    const result = planRetry('tdd', prior);

    expect(result.stages).toBe(PIPELINES.impl);
    expect(result.reset).toBe(false);
  });

  it('should return PIPELINES.impl and reset false when tdd prior failed at tscStage with greenObserved true', () => {
    const prior = makePipelineResult({
      redObserved: true,
      greenObserved: true,
      failedStage: tscStage,
      failure: makeGateFailure('tsc'),
    });

    const result = planRetry('tdd', prior);

    expect(result.stages).toBe(PIPELINES.impl);
    expect(result.reset).toBe(false);
  });

  it('should return PIPELINES.impl and reset false when tdd prior failed at decompositionStage with greenObserved true', () => {
    const prior = makePipelineResult({
      redObserved: true,
      greenObserved: true,
      failedStage: decompositionStage,
      failure: makeGateFailure('decomposition'),
    });

    const result = planRetry('tdd', prior);

    expect(result.stages).toBe(PIPELINES.impl);
    expect(result.reset).toBe(false);
  });

  it('should return PIPELINES.impl and reset false when tdd prior failed at functionalStyleStage with greenObserved true', () => {
    const prior = makePipelineResult({
      redObserved: true,
      greenObserved: true,
      failedStage: functionalStyleStage,
      failure: makeGateFailure('functional-style'),
    });

    const result = planRetry('tdd', prior);

    expect(result.stages).toBe(PIPELINES.impl);
    expect(result.reset).toBe(false);
  });
});

describe('planRetry — tdd retry keyed on redObserved (R1 restart vs resume)', () => {
  // (b) RED never observed → the test itself is the problem → full restart.
  it('should return PIPELINES.tdd and reset true when tdd prior failed at redStage (RED never observed)', () => {
    const prior = makePipelineResult({
      redObserved: false,
      greenObserved: false,
      failedStage: redStage,
      failure: makeGateFailure('test'),
    });

    const result = planRetry('tdd', prior);

    expect(result.stages).toBe(PIPELINES.tdd);
    expect(result.reset).toBe(true);
  });

  it('should return PIPELINES.tdd and reset true on a drive-throw before RED (failedStage undefined, redObserved false)', () => {
    const prior = makePipelineResult({
      redObserved: false,
      greenObserved: false,
      failedStage: undefined,
    });

    const result = planRetry('tdd', prior);

    expect(result.stages).toBe(PIPELINES.tdd);
    expect(result.reset).toBe(true);
  });

  // (a) RED observed but greenStage failed (valid failing test, incomplete impl)
  // → resume on impl, keep the test + partial impl, no reset.
  it('should return PIPELINES.impl and reset false when RED was observed but greenStage failed (incomplete impl)', () => {
    const prior = makePipelineResult({
      redObserved: true,
      greenObserved: false,
      failedStage: greenStage,
      failure: makeGateFailure('test'),
    });

    const result = planRetry('tdd', prior);

    expect(result.stages).toBe(PIPELINES.impl);
    expect(result.reset).toBe(false);
  });

  it('should return PIPELINES.impl and reset false when RED was observed and a structural gate failed before GREEN was recorded', () => {
    const prior = makePipelineResult({
      redObserved: true,
      greenObserved: false,
      failedStage: lintStage,
      failure: makeGateFailure('lint'),
    });

    const result = planRetry('tdd', prior);

    expect(result.stages).toBe(PIPELINES.impl);
    expect(result.reset).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// planRetry — anti-trap property / stress test
// ---------------------------------------------------------------------------

type AllModes = 'tdd' | 'impl';
type AllStages =
  | typeof redStage
  | typeof implStage
  | typeof greenStage
  | typeof lintStage
  | typeof tscStage
  | typeof decompositionStage
  | typeof functionalStyleStage
  | undefined;

const ALL_MODES: readonly AllModes[] = ['tdd', 'impl'];

const ALL_STAGE_ENTRIES: ReadonlyArray<{ name: string; stage: AllStages }> = [
  { name: 'redStage', stage: redStage },
  { name: 'implStage', stage: implStage },
  { name: 'greenStage', stage: greenStage },
  { name: 'lintStage', stage: lintStage },
  { name: 'tscStage', stage: tscStage },
  { name: 'decompositionStage', stage: decompositionStage },
  { name: 'functionalStyleStage', stage: functionalStyleStage },
  { name: 'undefined (drive-throw)', stage: undefined },
];

describe('planRetry — anti-trap property: never restart RED against leftover green impl without reset', () => {
  for (const mode of ALL_MODES) {
    for (const { name, stage } of ALL_STAGE_ENTRIES) {
      for (const greenObserved of [true, false] as const) {
        const label = `mode=${mode} failedStage=${name} greenObserved=${greenObserved}`;

        it(`should not return stages-starting-with-redStage without reset when greenObserved=true — ${label}`, () => {
          if (!greenObserved) {
            // Property only fires when greenObserved is true
            return;
          }
          const prior = makePipelineResult({ greenObserved, failedStage: stage });

          const result = planRetry(mode, prior);

          const startsWithRed = result.stages[0] === redStage;
          if (startsWithRed) {
            // If stages start with red, reset MUST be true (clean slate)
            expect(result.reset).toBe(true);
          }
        });

        it(`should not return stages starting with redStage AND reset false when greenObserved=true — ${label}`, () => {
          if (!greenObserved) {
            return;
          }
          const prior = makePipelineResult({ greenObserved, failedStage: stage });

          const result = planRetry(mode, prior);

          const redFirstWithoutReset = result.stages[0] === redStage && result.reset === false;
          expect(redFirstWithoutReset).toBe(false);
        });

        it(`should not start with redStage when reset is false — ${label}`, () => {
          const prior = makePipelineResult({ greenObserved, failedStage: stage });

          const result = planRetry(mode, prior);

          if (result.reset === false) {
            expect(result.stages[0]).not.toBe(redStage);
          }
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Integration — R2 resume: PIPELINES.impl succeeds without a RED stage
// ---------------------------------------------------------------------------

const makeCtx = (overrides: Partial<Parameters<typeof import('./pipeline')['runPipeline']>[1]> = {}) => ({
  cwd: '/test/cwd',
  driveTest: async () => undefined,
  driveCode: async () => undefined,
  runTests: async () => ({ passed: true, output: '', noTests: false }),
  lintGate: async (_files: readonly string[], _ctx: GateContext) => null,
  tscGate: async (_ctx: GateContext) => null,
  testGate: async (_ctx: GateContext) => null,
  decompositionGate: async (_files: readonly string[], _ctx: GateContext) => null,
  functionalStyleGate: async (_files: readonly string[], _ctx: GateContext) => null,
  gateCtx: { cwd: '/test/cwd', run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } as GateContext,
  touchedFiles: [] as readonly string[],
  redObserved: false,
  greenObserved: false,
  progress: createProgress(false),
  ...overrides,
});

describe('planRetry R2 resume — PIPELINES.impl succeeds without RED stage', () => {
  it('should reach completed status running PIPELINES.impl when tests pass and all gates pass', async () => {
    // Arrange: context where tests pass and all gates clear — simulates a
    // post-green working tree where only structural fixes are needed.
    const ctx = makeCtx({
      runTests: async () => ({ passed: true, output: '', noTests: false }),
    });

    // Act: run the impl pipeline (no redStage present)
    const result = await runPipeline(PIPELINES.impl, ctx, initLadder());

    // Assert: pipeline completes without encountering RED
    expect(result.passed).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.redObserved).toBe(false);
  });

  it('should not invoke driveTest at any point during PIPELINES.impl', async () => {
    let driveTestCalled = false;
    const ctx = makeCtx({
      driveTest: async () => {
        driveTestCalled = true;
      },
    });

    await runPipeline(PIPELINES.impl, ctx, initLadder());

    expect(driveTestCalled).toBe(false);
  });

  it('should report greenObserved true for PIPELINES.impl when all stages pass (gate-only resolveGreenObserved)', async () => {
    const ctx = makeCtx();

    const result = await runPipeline(PIPELINES.impl, ctx, initLadder());

    expect(result.greenObserved).toBe(true);
  });

  it('should report planRetry R2 stages (PIPELINES.impl) can reach completed after a post-green structural failure', async () => {
    // Simulate: prior attempt had greenObserved=true but failed at lintStage
    const prior = makePipelineResult({
      redObserved: true,
      greenObserved: true,
      failedStage: lintStage,
      failure: makeGateFailure('lint'),
    });

    // planRetry selects impl pipeline
    const { stages, reset } = planRetry('tdd', prior);

    expect(reset).toBe(false);
    expect(stages).toBe(PIPELINES.impl);

    // Running those stages on a fixed working tree completes
    const ctx = makeCtx();
    const result = await runPipeline(stages, ctx, initLadder());

    expect(result.passed).toBe(true);
    expect(result.redObserved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Seam note (not a test — documented for the impl step)
// ---------------------------------------------------------------------------
// runEscalation closes over `tracker.revert()` and calls it once unconditionally
// at the end when !outcome.passed. There is no injectable seam for asserting
// WHEN revert is called between attempts vs. at the end of the loop.
//
// Recommended seam: thread a `reset: boolean` field (from planRetry) into the
// attempt closure. If `reset === true`, call `tracker.revert()` at the START of
// the NEXT attempt (before building the new StageContext), rather than only at
// the end. The impl step should expose this as:
//   `onAttemptStart?: (reset: boolean) => Promise<void>`
// on EscalationDeps (or a similar injectable), so tests can assert it was called
// with the correct boolean per-attempt without reaching into private tracker state.
