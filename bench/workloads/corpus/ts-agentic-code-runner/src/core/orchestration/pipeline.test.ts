import { describe, expect, it, vi } from 'vitest';

import type { GateContext, GateFailure } from '../gates/gates';
// ---------------------------------------------------------------------------
// Minimal StageContext builder
// ---------------------------------------------------------------------------
import { createProgress } from '../reporting/progress';
import type { LadderState } from './escalation';
import { FAILS_PER_RUNG, initLadder, recordFailure } from './escalation';
import type { Stage, StageContext, StageOutcome } from './pipeline';
import {
  decompositionStage,
  functionalStyleStage,
  greenStage,
  implStage,
  lintStage,
  PIPELINES,
  redStage,
  repeatUntilExhausted,
  runPipeline,
  testStage,
  tscStage
} from './pipeline';

const makeCtx = (overrides: Partial<StageContext> = {}): StageContext => ({
  cwd: '/test/cwd',
  driveTest: vi.fn().mockResolvedValue(undefined),
  driveCode: vi.fn().mockResolvedValue(undefined),
  runTests: vi.fn().mockResolvedValue({ passed: true, output: '', noTests: false }),
  lintGate: vi.fn().mockResolvedValue(null),
  tscGate: vi.fn().mockResolvedValue(null),
  testGate: vi.fn().mockResolvedValue(null),
  decompositionGate: vi.fn().mockResolvedValue(null),
  functionalStyleGate: vi.fn().mockResolvedValue(null),
  gateCtx: { cwd: '/test/cwd', run: vi.fn() } satisfies GateContext,
  touchedFiles: [],
  redObserved: false,
  greenObserved: false,
  progress: createProgress(false),
  ...overrides,
});

const ok = (): StageOutcome => ({ kind: 'ok' });
const fail = (message: string): StageOutcome => ({
  kind: 'fail',
  failure: { gate: 'test', message, output: '' } satisfies GateFailure,
});

// ---------------------------------------------------------------------------
// PIPELINES.tdd stage order (T012 required assertion)
// ---------------------------------------------------------------------------

describe('PIPELINES.tdd stage order', () => {
  it('should list red, impl, green, lint, tsc, decomposition, functionalStyle stages for tdd mode', () => {
    expect(PIPELINES.tdd).toStrictEqual([
      redStage,
      implStage,
      greenStage,
      lintStage,
      tscStage,
      decompositionStage,
      functionalStyleStage,
    ]);
  });

  it('should have exactly seven stages in tdd mode', () => {
    expect(PIPELINES.tdd).toHaveLength(7);
  });

  it('should keep redStage at index 0 before implStage (RED-before-impl ordering)', () => {
    expect(PIPELINES.tdd.indexOf(redStage)).toBe(0);
    expect(PIPELINES.tdd.indexOf(redStage)).toBeLessThan(PIPELINES.tdd.indexOf(implStage));
  });

  it('should have functionalStyleStage as the last stage in tdd mode', () => {
    expect(PIPELINES.tdd[PIPELINES.tdd.length - 1]).toBe(functionalStyleStage);
  });

  it('should have decompositionStage immediately before functionalStyleStage in tdd mode', () => {
    const decompIdx = PIPELINES.tdd.indexOf(decompositionStage);
    const fpIdx = PIPELINES.tdd.indexOf(functionalStyleStage);
    expect(fpIdx).toBe(decompIdx + 1);
  });
});

// ---------------------------------------------------------------------------
// PIPELINES.impl stage order
// ---------------------------------------------------------------------------

describe('PIPELINES.impl stage order', () => {
  it('should list impl, lint, tsc, test, decomposition, functionalStyle stages for impl mode', () => {
    expect(PIPELINES.impl).toStrictEqual([
      implStage,
      lintStage,
      tscStage,
      testStage,
      decompositionStage,
      functionalStyleStage,
    ]);
  });

  it('should not include redStage in impl mode', () => {
    expect(PIPELINES.impl).not.toContain(redStage);
  });

  it('should have functionalStyleStage as the last stage in impl mode', () => {
    expect(PIPELINES.impl[PIPELINES.impl.length - 1]).toBe(functionalStyleStage);
  });
});

// ---------------------------------------------------------------------------
// redStage
// ---------------------------------------------------------------------------

describe('redStage', () => {
  it('should invoke driveTest (NOT driveCode) to produce RED observations', async () => {
    const ctx = makeCtx({ runTests: vi.fn().mockResolvedValue({ passed: false, output: 'boom', noTests: false }) });

    await redStage(ctx);

    expect(ctx.driveTest).toHaveBeenCalled();
    expect(ctx.driveCode).not.toHaveBeenCalled();
  });

  it('should return ok when tests fail (RED observed)', async () => {
    const ctx = makeCtx({ runTests: vi.fn().mockResolvedValue({ passed: false, output: '', noTests: false }) });

    const outcome = await redStage(ctx);

    expect(outcome.kind).toBe('ok');
  });

  it('should return fail when tests already pass before RED phase (no RED observed)', async () => {
    const ctx = makeCtx({ runTests: vi.fn().mockResolvedValue({ passed: true, output: '', noTests: false }) });

    const outcome = await redStage(ctx);

    expect(outcome.kind).toBe('fail');
  });

  it('should return fail with "no test was created" message when noTests is true', async () => {
    const ctx = makeCtx({
      runTests: vi.fn().mockResolvedValue({ passed: false, output: 'No test files found', noTests: true }),
    });

    const outcome = await redStage(ctx);

    expect(outcome.kind).toBe('fail');
    expect(outcome.kind === 'fail' && outcome.failure.message).toContain('no test was created or collected');
  });

  it('should prefer noTests failure over passed:true failure when both are true', async () => {
    const ctx = makeCtx({
      runTests: vi.fn().mockResolvedValue({ passed: true, output: 'No test files found', noTests: true }),
    });

    const outcome = await redStage(ctx);

    expect(outcome.kind).toBe('fail');
    expect(outcome.kind === 'fail' && outcome.failure.message).toContain('no test was created or collected');
  });

  it('should return fail with "does not parse" message when test output is a transform error', async () => {
    const transformOutput =
      'Error: Transform failed with 1 error:\n/workspace/foo.test.ts:47:4: ERROR: Unexpected ","';
    const ctx = makeCtx({
      runTests: vi.fn().mockResolvedValue({ passed: false, output: transformOutput, noTests: false }),
    });

    const outcome = await redStage(ctx);

    expect(outcome.kind).toBe('fail');
    expect(outcome.kind === 'fail' && outcome.failure.message).toContain('does not parse');
  });

  it('should NOT count a transform error as valid RED (must return fail not ok)', async () => {
    const transformOutput = 'SyntaxError: Unexpected token }';
    const ctx = makeCtx({
      runTests: vi.fn().mockResolvedValue({ passed: false, output: transformOutput, noTests: false }),
    });

    const outcome = await redStage(ctx);

    // parse error is not a valid failing test — must be fail, not ok
    expect(outcome.kind).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// greenStage
// ---------------------------------------------------------------------------

describe('greenStage', () => {
  it('should invoke driveCode (NOT driveTest) to produce GREEN observations', async () => {
    const ctx = makeCtx({ redObserved: true });

    await greenStage(ctx);

    expect(ctx.driveCode).toHaveBeenCalled();
    expect(ctx.driveTest).not.toHaveBeenCalled();
  });

  it('should return ok when tests pass (GREEN observed)', async () => {
    const ctx = makeCtx({
      redObserved: true,
      runTests: vi.fn().mockResolvedValue({ passed: true, output: '', noTests: false }),
    });

    const outcome = await greenStage(ctx);

    expect(outcome.kind).toBe('ok');
  });

  it('should return fail when tests never pass within cap', async () => {
    const ctx = makeCtx({
      redObserved: true,
      runTests: vi.fn().mockResolvedValue({ passed: false, output: 'green-fail-log', noTests: false }),
    });

    const outcome = await greenStage(ctx);

    expect(outcome.kind).toBe('fail');
  });

  it('should return fail with "no test ran to confirm GREEN" message when noTests is true', async () => {
    const ctx = makeCtx({
      redObserved: true,
      runTests: vi.fn().mockResolvedValue({ passed: false, output: 'No test files found', noTests: true }),
    });

    const outcome = await greenStage(ctx);

    expect(outcome.kind).toBe('fail');
    expect(outcome.kind === 'fail' && outcome.failure.message).toContain('no test ran to confirm GREEN');
  });

  it('should prefer noTests failure over passed:false failure when noTests is true', async () => {
    const ctx = makeCtx({
      redObserved: true,
      runTests: vi.fn().mockResolvedValue({ passed: false, output: 'No test files found', noTests: true }),
    });

    const outcome = await greenStage(ctx);

    expect(outcome.kind === 'fail' && outcome.failure.message).toContain('no test ran to confirm GREEN');
  });
});

// ---------------------------------------------------------------------------
// two-role drive separation (RED → test role, GREEN → code role)
// ---------------------------------------------------------------------------

describe('two-role drive separation', () => {
  it('should drive the TEST role in red and the CODE role in green within one pipeline run', async () => {
    const ctx = makeCtx({
      runTests: vi
        .fn()
        .mockResolvedValueOnce({ passed: false, output: '', noTests: false })
        .mockResolvedValue({ passed: true, output: '', noTests: false }),
    });

    await redStage(ctx);
    await greenStage(ctx);

    expect(ctx.driveTest).toHaveBeenCalledTimes(1);
    expect(ctx.driveCode).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// implStage
// ---------------------------------------------------------------------------

describe('implStage', () => {
  it('should invoke driveCode (NOT driveTest) to produce implementation', async () => {
    const ctx = makeCtx();

    await implStage(ctx);

    expect(ctx.driveCode).toHaveBeenCalled();
    expect(ctx.driveTest).not.toHaveBeenCalled();
  });

  it('should return ok when drive succeeds', async () => {
    const ctx = makeCtx();

    const outcome = await implStage(ctx);

    expect(outcome.kind).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// lintStage
// ---------------------------------------------------------------------------

describe('lintStage', () => {
  it('should invoke the lintGate boundary', async () => {
    const ctx = makeCtx();

    await lintStage(ctx);

    expect(ctx.lintGate).toHaveBeenCalledWith(ctx.touchedFiles, ctx.gateCtx);
  });

  it('should return ok when lint passes', async () => {
    const ctx = makeCtx({ lintGate: vi.fn().mockResolvedValue(null) });

    const outcome = await lintStage(ctx);

    expect(outcome.kind).toBe('ok');
  });

  it('should return fail when lint gate reports a failure', async () => {
    const gateFailure: GateFailure = { gate: 'lint', message: 'lint failed', output: '' };
    const ctx = makeCtx({ lintGate: vi.fn().mockResolvedValue(gateFailure) });

    const outcome = await lintStage(ctx);

    expect(outcome.kind).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// tscStage
// ---------------------------------------------------------------------------

describe('tscStage', () => {
  it('should invoke the tscGate boundary', async () => {
    const ctx = makeCtx();

    await tscStage(ctx);

    expect(ctx.tscGate).toHaveBeenCalledWith(ctx.gateCtx);
  });

  it('should return ok when tsc passes', async () => {
    const ctx = makeCtx({ tscGate: vi.fn().mockResolvedValue(null) });

    const outcome = await tscStage(ctx);

    expect(outcome.kind).toBe('ok');
  });

  it('should return fail when tsc gate reports a failure', async () => {
    const gateFailure: GateFailure = { gate: 'tsc', message: 'tsc failed', output: '' };
    const ctx = makeCtx({ tscGate: vi.fn().mockResolvedValue(gateFailure) });

    const outcome = await tscStage(ctx);

    expect(outcome.kind).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// testStage
// ---------------------------------------------------------------------------

describe('testStage', () => {
  it('should invoke the testGate boundary', async () => {
    const ctx = makeCtx();

    await testStage(ctx);

    expect(ctx.testGate).toHaveBeenCalledWith(ctx.gateCtx);
  });

  it('should return ok when test gate passes', async () => {
    const ctx = makeCtx({ testGate: vi.fn().mockResolvedValue(null) });

    const outcome = await testStage(ctx);

    expect(outcome.kind).toBe('ok');
  });

  it('should return fail when test gate reports a failure', async () => {
    const gateFailure: GateFailure = { gate: 'test', message: 'test failed', output: '' };
    const ctx = makeCtx({ testGate: vi.fn().mockResolvedValue(gateFailure) });

    const outcome = await testStage(ctx);

    expect(outcome.kind).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// decompositionStage
// ---------------------------------------------------------------------------

describe('decompositionStage', () => {
  it('should invoke the decompositionGate with touchedFiles and gateCtx', async () => {
    const ctx = makeCtx({ touchedFiles: ['src/lib/foo.ts'] });

    await decompositionStage(ctx);

    expect(ctx.decompositionGate).toHaveBeenCalledWith(ctx.touchedFiles, ctx.gateCtx);
  });

  it('should return ok when the decompositionGate resolves null', async () => {
    const ctx = makeCtx({ decompositionGate: vi.fn().mockResolvedValue(null) });

    const outcome = await decompositionStage(ctx);

    expect(outcome.kind).toBe('ok');
  });

  it('should return fail when the decompositionGate resolves a GateFailure', async () => {
    const gateFailure: GateFailure = {
      gate: 'decomposition',
      message: 'functions exceed the cognitive-complexity cap',
      output: 'noExcessiveCognitiveComplexity',
    };
    const ctx = makeCtx({ decompositionGate: vi.fn().mockResolvedValue(gateFailure) });

    const outcome = await decompositionStage(ctx);

    expect(outcome.kind).toBe('fail');
    expect(outcome.kind === 'fail' && outcome.failure).toStrictEqual(gateFailure);
  });
});

// ---------------------------------------------------------------------------
// functionalStyleStage
// ---------------------------------------------------------------------------

describe('functionalStyleStage', () => {
  it('should invoke the functionalStyleGate with touchedFiles and gateCtx', async () => {
    const ctx = makeCtx({ touchedFiles: ['src/lib/foo.ts'] });

    await functionalStyleStage(ctx);

    expect(ctx.functionalStyleGate).toHaveBeenCalledWith(ctx.touchedFiles, ctx.gateCtx);
  });

  it('should return ok when the functionalStyleGate resolves null', async () => {
    const ctx = makeCtx({ functionalStyleGate: vi.fn().mockResolvedValue(null) });

    const outcome = await functionalStyleStage(ctx);

    expect(outcome.kind).toBe('ok');
  });

  it('should return fail when the functionalStyleGate resolves a GateFailure', async () => {
    const gateFailure: GateFailure = {
      gate: 'functional-style',
      message: 'imperative constructs found',
      output: 'dirty.ts:2 — for loop',
    };
    const ctx = makeCtx({ functionalStyleGate: vi.fn().mockResolvedValue(gateFailure) });

    const outcome = await functionalStyleStage(ctx);

    expect(outcome.kind).toBe('fail');
    expect(outcome.kind === 'fail' && outcome.failure).toStrictEqual(gateFailure);
  });
});

// ---------------------------------------------------------------------------
// runPipeline — happy path
// ---------------------------------------------------------------------------

describe('runPipeline — happy path', () => {
  it('should return completed status when all stages pass', async () => {
    const stages: readonly Stage[] = [
      vi.fn().mockResolvedValue(ok()),
      vi.fn().mockResolvedValue(ok()),
    ];
    const ctx = makeCtx({ greenObserved: true });
    const ladder = initLadder();

    const result = await runPipeline(stages, ctx, ladder);

    expect(result.status).toBe('completed');
  });

  it('should invoke every stage in order when all pass', async () => {
    const calls: number[] = [];
    const stages: readonly Stage[] = [
      vi.fn().mockImplementation(async () => {
        calls.push(0);
        return ok();
      }),
      vi.fn().mockImplementation(async () => {
        calls.push(1);
        return ok();
      }),
      vi.fn().mockImplementation(async () => {
        calls.push(2);
        return ok();
      }),
    ];
    const ctx = makeCtx({ greenObserved: true });

    await runPipeline(stages, ctx, initLadder());

    expect(calls).toStrictEqual([0, 1, 2]);
  });

  it('should report greenObserved true when ctx greenObserved is true after stages', async () => {
    const stages: readonly Stage[] = [vi.fn().mockResolvedValue(ok())];
    const ctx = makeCtx({ greenObserved: true });

    const result = await runPipeline(stages, ctx, initLadder());

    expect(result.greenObserved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runPipeline — tdd GREEN requirement
// ---------------------------------------------------------------------------

describe('runPipeline — tdd GREEN requirement', () => {
  it('should return failed when the greenStage never observes GREEN', async () => {
    // greenStage's runTests never passes → GREEN not observed → not completed.
    const ctx = makeCtx({ runTests: vi.fn().mockResolvedValue({ passed: false, output: '', noTests: false }) });

    const result = await runPipeline([implStage, greenStage], ctx, initLadder());

    expect(result.status).not.toBe('completed');
    expect(result.greenObserved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runPipeline — stage failure stops the pipeline
// ---------------------------------------------------------------------------

describe('runPipeline — stage failure stops pipeline', () => {
  it('should stop at the first failing stage and not invoke subsequent stages', async () => {
    const stage2 = vi.fn().mockResolvedValue(ok());
    const stages: readonly Stage[] = [vi.fn().mockResolvedValue(fail('stage 0 failed')), stage2];
    const ctx = makeCtx();

    await runPipeline(stages, ctx, initLadder());

    expect(stage2).not.toHaveBeenCalled();
  });

  it('should record the failing stage in the result', async () => {
    const stages: readonly Stage[] = [
      vi.fn().mockResolvedValue(fail('lint error')),
      vi.fn().mockResolvedValue(ok()),
    ];
    const ctx = makeCtx();

    const result = await runPipeline(stages, ctx, initLadder());

    expect(result.failedStageIndex).toBe(0);
  });

  it('should return failed status when a stage fails', async () => {
    const stages: readonly Stage[] = [vi.fn().mockResolvedValue(fail('tsc error'))];
    const ctx = makeCtx();

    const result = await runPipeline(stages, ctx, initLadder());

    expect(result.status).toBe('failed');
  });

  it('should fold the failure into the ladder via recordFailure', async () => {
    const stages: readonly Stage[] = [vi.fn().mockResolvedValue(fail('stage failed'))];
    const ctx = makeCtx();
    const ladder = initLadder();

    const result = await runPipeline(stages, ctx, ladder);

    // After one failure the ladder's consecutiveFails increments from 0 to 1
    expect(result.finalLadder.consecutiveFails).toBe(1);
  });

  it('should return local-exhausted when the ladder is exhausted after repeated failures', async () => {
    // Exhaust the ladder: a base rung escalates straight to the terminal claude
    // rung (exhausted) after FAILS_PER_RUNG failures — no intermediate rungs.
    const totalFailsToExhaust = FAILS_PER_RUNG;
    let ladder: LadderState = initLadder();

    // Drive the ladder to exhaustion by running the pipeline that many times
    for (let i = 0; i < totalFailsToExhaust; i++) {
      const stages: readonly Stage[] = [vi.fn().mockResolvedValue(fail('repeated fail'))];
      const result = await runPipeline(stages, makeCtx(), ladder);
      ladder = result.finalLadder;
    }

    expect(ladder.exhausted).toBe(true);

    const stages: readonly Stage[] = [vi.fn().mockResolvedValue(fail('still failing'))];
    const result = await runPipeline(stages, makeCtx(), ladder);

    expect(result.status).toBe('local-exhausted');
  });
});

// ---------------------------------------------------------------------------
// F-02 — failure output is preserved (not hardcoded to '')
// ---------------------------------------------------------------------------

describe('failure output preservation', () => {
  it('should thread runTests output into the redStage failure', async () => {
    const ctx = makeCtx({
      runTests: vi.fn().mockResolvedValue({ passed: true, output: 'RED-LOG', noTests: false }),
    });

    const outcome = await redStage(ctx);

    expect(outcome.kind === 'fail' && outcome.failure.output).toBe('RED-LOG');
  });

  it('should thread runTests output into the greenStage failure', async () => {
    const ctx = makeCtx({
      runTests: vi.fn().mockResolvedValue({ passed: false, output: 'GREEN-LOG', noTests: false }),
    });

    const outcome = await greenStage(ctx);

    expect(outcome.kind === 'fail' && outcome.failure.output).toBe('GREEN-LOG');
  });
});

// ---------------------------------------------------------------------------
// F-03 — redObserved / greenObserved computed from actual stage outcomes
// ---------------------------------------------------------------------------

describe('runPipeline — observation flags from stages', () => {
  it('should report redObserved true when redStage passes (RED observed)', async () => {
    const ctx = makeCtx({ runTests: vi.fn().mockResolvedValue({ passed: false, output: '', noTests: false }) });

    const result = await runPipeline([redStage], ctx, initLadder());

    expect(result.redObserved).toBe(true);
  });

  it('should report redObserved true even when a later stage fails', async () => {
    const ctx = makeCtx({ runTests: vi.fn().mockResolvedValue({ passed: false, output: '', noTests: false }) });
    const stages: readonly Stage[] = [redStage, vi.fn().mockResolvedValue(fail('later fail'))];

    const result = await runPipeline(stages, ctx, initLadder());

    expect(result.redObserved).toBe(true);
    expect(result.failedStageIndex).toBe(1);
  });

  it('should report greenObserved true when greenStage passes', async () => {
    // redStage observes RED (tests fail first), greenStage observes GREEN (then pass).
    const runTests = vi
      .fn()
      .mockResolvedValueOnce({ passed: false, output: '', noTests: false })
      .mockResolvedValue({ passed: true, output: '', noTests: false });
    const ctx = makeCtx({ runTests });

    const result = await runPipeline([redStage, greenStage], ctx, initLadder());

    expect(result.greenObserved).toBe(true);
    expect(result.redObserved).toBe(true);
  });

  it('should report greenObserved false when greenStage is absent and a gate stage fails', async () => {
    const gateFailure: GateFailure = { gate: 'lint', message: 'x', output: '' };
    const ctx = makeCtx({ lintGate: vi.fn().mockResolvedValue(gateFailure) });

    const result = await runPipeline([implStage, lintStage], ctx, initLadder());

    expect(result.greenObserved).toBe(false);
  });

  it('should report greenObserved true for a gate-only pipeline when all gates pass', async () => {
    const ctx = makeCtx();

    const result = await runPipeline([implStage, lintStage, tscStage], ctx, initLadder());

    expect(result.greenObserved).toBe(true);
  });

  it('should expose passed true on a completed pipeline', async () => {
    const ctx = makeCtx();

    const result = await runPipeline([implStage, lintStage], ctx, initLadder());

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// repeatUntilExhausted
// ---------------------------------------------------------------------------

// repeatUntilExhausted now THREADS the ladder: attempt(ladder) receives the
// current ladder and returns { passed, finalLadder }; the loop recurses with the
// returned finalLadder. The attempt owns the recordFailure (one fail per run).
interface AttemptResult {
  readonly passed: boolean;
  readonly finalLadder: LadderState;
}

describe('repeatUntilExhausted', () => {
  it('should invoke the attempt with the initial ladder on the first iteration', async () => {
    const ladder = initLadder();
    const attempt = vi.fn(
      async (l: LadderState, _prior?: undefined): Promise<AttemptResult> => ({
        passed: true,
        finalLadder: l,
      })
    );

    await repeatUntilExhausted(ladder, attempt);

    expect(attempt).toHaveBeenCalledWith(ladder, undefined);
  });

  it('should return a passing result immediately when the first attempt passes', async () => {
    const attempt = vi.fn(
      async (l: LadderState): Promise<AttemptResult> => ({ passed: true, finalLadder: l })
    );

    const result = await repeatUntilExhausted(initLadder(), attempt);

    expect(result.passed).toBe(true);
  });

  it('should thread the returned finalLadder back into the next attempt', async () => {
    const ladders: LadderState[] = [];
    const attempt = vi.fn(async (l: LadderState): Promise<AttemptResult> => {
      ladders.push(l);
      return ladders.length >= 2
        ? { passed: true, finalLadder: l }
        : { passed: false, finalLadder: recordFailure(l) };
    });

    await repeatUntilExhausted(initLadder(), attempt);

    // Second call received the ladder produced by the first attempt's recordFailure.
    expect(ladders[1]).toStrictEqual(recordFailure(ladders[0]));
  });

  it('should retry the attempt after each failure until the threaded ladder is exhausted', async () => {
    const totalFailsToExhaust = FAILS_PER_RUNG;
    const attempt = vi.fn(
      async (l: LadderState): Promise<AttemptResult> => ({
        passed: false,
        finalLadder: recordFailure(l),
      })
    );

    await repeatUntilExhausted(initLadder(), attempt);

    expect(attempt).toHaveBeenCalledTimes(totalFailsToExhaust);
  });

  it('should return a failing result when the threaded ladder is exhausted', async () => {
    const attempt = vi.fn(
      async (l: LadderState): Promise<AttemptResult> => ({
        passed: false,
        finalLadder: recordFailure(l),
      })
    );

    const result = await repeatUntilExhausted(initLadder(), attempt);

    expect(result.passed).toBe(false);
    expect(result.finalLadder.exhausted).toBe(true);
  });

  it('should stop retrying once an attempt passes mid-run', async () => {
    const attempt = vi.fn(async (l: LadderState): Promise<AttemptResult> => {
      const calls = attempt.mock.calls.length;
      return calls >= 3
        ? { passed: true, finalLadder: l }
        : { passed: false, finalLadder: recordFailure(l) };
    });

    const result = await repeatUntilExhausted(initLadder(), attempt);

    expect(attempt).toHaveBeenCalledTimes(3);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// repeatUntilExhausted — carry threading (new in feedback-retry loop)
// ---------------------------------------------------------------------------

interface CarryResult {
  readonly passed: boolean;
  readonly finalLadder: LadderState;
  readonly carry?: string;
  readonly noProgress?: boolean;
}

describe('repeatUntilExhausted — carry threading', () => {
  it('should pass the carry from one attempt as prior to the next attempt', async () => {
    const priorValues: Array<string | undefined> = [];
    const attempt = vi.fn(async (l: LadderState, prior?: string): Promise<CarryResult> => {
      priorValues.push(prior);
      const calls = attempt.mock.calls.length;
      return calls >= 2
        ? { passed: true, finalLadder: l }
        : { passed: false, finalLadder: recordFailure(l), carry: 'feedback-from-attempt-1' };
    });

    await repeatUntilExhausted(initLadder(), attempt);

    expect(priorValues[0]).toBeUndefined();
    expect(priorValues[1]).toBe('feedback-from-attempt-1');
  });

  it('should stop immediately when an attempt returns noProgress true', async () => {
    const attempt = vi.fn(
      async (l: LadderState): Promise<CarryResult> => ({
        passed: false,
        finalLadder: recordFailure(l),
        noProgress: true,
      })
    );

    const result = await repeatUntilExhausted(initLadder(), attempt);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(result.passed).toBe(false);
    expect(result.noProgress).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// progress events emitted during stage execution
// ---------------------------------------------------------------------------

describe('runPipeline — progress events', () => {
  it('should emit stage start and stage ok events when a stage passes', async () => {
    const lines: string[] = [];
    const progress = createProgress(true, line => lines.push(line));
    const stages: readonly Stage[] = [vi.fn().mockResolvedValue(ok())];
    const ctx = makeCtx({ greenObserved: true, progress });

    await runPipeline(stages, ctx, initLadder());

    expect(lines.some(l => l.includes('stage') && l.includes('start'))).toBe(true);
    expect(lines.some(l => l.includes('stage') && l.includes('ok'))).toBe(true);
  });

  it('should emit stage start and stage fail events when a stage fails', async () => {
    const lines: string[] = [];
    const progress = createProgress(true, line => lines.push(line));
    const stages: readonly Stage[] = [vi.fn().mockResolvedValue(fail('boom'))];
    const ctx = makeCtx({ progress });

    await runPipeline(stages, ctx, initLadder());

    expect(lines.some(l => l.includes('stage') && l.includes('start'))).toBe(true);
    expect(lines.some(l => l.includes('stage') && l.includes('fail'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runPipeline — failure field exposed (new in feedback-retry loop)
// ---------------------------------------------------------------------------

describe('runPipeline — failure field', () => {
  it('should expose the GateFailure on a failing run', async () => {
    const gateFailure: GateFailure = {
      gate: 'lint',
      message: 'lint blew up',
      output: 'line 1\nline 2',
    };
    const stages: readonly Stage[] = [
      vi.fn().mockResolvedValue({ kind: 'fail', failure: gateFailure } satisfies StageOutcome),
    ];
    const ctx = makeCtx();

    const result = await runPipeline(stages, ctx, initLadder());

    expect(result.failure).toStrictEqual(gateFailure);
  });

  it('should expose failure as undefined when all stages pass', async () => {
    const stages: readonly Stage[] = [
      vi.fn().mockResolvedValue(ok()),
      vi.fn().mockResolvedValue(ok()),
    ];
    const ctx = makeCtx({ greenObserved: true });

    const result = await runPipeline(stages, ctx, initLadder());

    expect(result.failure).toBeUndefined();
  });
});
