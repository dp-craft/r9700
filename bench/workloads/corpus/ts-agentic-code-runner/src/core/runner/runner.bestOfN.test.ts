import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LadderState } from '../orchestration/escalation';
import type { PipelineResult } from '../orchestration/pipeline';
import { lintStage, tscStage } from '../orchestration/pipeline';

// Controllable execFile seam (git status): promisify(execFile) resolves clean.
const execFileImpl = vi.hoisted(() => ({
  current: (): Promise<{ stdout: string; stderr: string }> =>
    Promise.resolve({ stdout: '', stderr: '' }),
}));

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const custom = Symbol.for('nodejs.util.promisify.custom');
  const execFile = (() => undefined) as unknown as {
    [k: symbol]: () => Promise<{ stdout: string; stderr: string }>;
  };
  execFile[custom] = (): Promise<{ stdout: string; stderr: string }> => execFileImpl.current();
  return { ...actual, default: { ...actual, execFile }, execFile };
});

vi.mock('../orchestration/pipeline', async importOriginal => {
  const actual = await importOriginal<typeof import('../orchestration/pipeline')>();
  return { ...actual, runPipeline: vi.fn() };
});

vi.mock('../llm/connector', () => ({
  generate: vi.fn(() => Promise.resolve({ text: 'ok', toolCallCount: 1 })),
  createModel: vi.fn(() => ({ provider: 'ollama' })),
  resolveOllamaNumCtx: vi.fn(() => 65536),
}));

vi.mock('../tools/toolRegistry', () => ({
  createToolRegistry: vi.fn(() => ({})),
  buildSdkTools: vi.fn(() => ({})),
  createMutationTracker: vi.fn(() => ({
    record: vi.fn(),
    mutatedPaths: vi.fn((): readonly string[] => []),
    revert: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock('../orchestration/escalation', () => ({
  LADDERS: { ollama: ['ollama', 'claude'], openrouter: ['openrouter', 'claude'] },
  TERMINAL_RUNG: 'claude',
  FAILS_PER_RUNG: 3,
  startRungForBackend: vi.fn((backend: string) => (backend === 'openrouter' ? 'openrouter' : 'ollama')),
  initLadder: vi.fn((start = 'ollama') => ({ rung: start, consecutiveFails: 0, exhausted: false })),
  recordFailure: vi.fn(state => state),
  recordSuccess: vi.fn(state => state),
  forceEscalate: vi.fn((state: { rung: string; exhausted: boolean }) =>
    state.exhausted || state.rung === 'claude'
      ? { ...state, exhausted: true }
      : { rung: 'claude', consecutiveFails: 0, exhausted: true }
  ),
}));

vi.mock('../profiles/profiles', () => ({
  resolveProfile: vi.fn(() => ({ name: 'p-ollama', backend: 'ollama', modelId: 'Qwen3-Coder-30B-A3B' })),
  profileForRung: vi.fn((_rung: string, base: { backend: string }) => base),
}));

vi.mock('../rules/rulesProjection', () => ({
  projectRules: vi.fn(() =>
    Promise.resolve({ agentType: 'code-logic-writer', condensedRules: 'RULES', sources: [] })
  ),
}));

vi.mock('../execution/editRegion', async importOriginal => {
  const actual = await importOriginal<typeof import('../execution/editRegion')>();
  return { ...actual, buildImplPreload: vi.fn(() => Promise.resolve('PRELOAD')) };
});

vi.mock('../reporting/telemetry', () => ({
  openTelemetry: vi.fn(() => ({ recordRun: vi.fn(), recordAttempt: vi.fn(), close: vi.fn() })),
  toTaskRunRow: vi.fn((result: { status: string; finalRung: string }) => ({
    status: result.status,
    final_rung: result.finalRung,
  })),
  toAttemptRunRow: vi.fn(),
}));

const { runPipeline } = await import('../orchestration/pipeline');
const { createModel } = await import('../llm/connector');
const { createToolRegistry, createMutationTracker } = await import('../tools/toolRegistry');
const { initLadder } = await import('../orchestration/escalation');
const { profileForRung } = await import('../profiles/profiles');
const { openTelemetry } = await import('../reporting/telemetry');

const runPipelineMock = vi.mocked(runPipeline);
const createModelMock = vi.mocked(createModel);
const createToolRegistryMock = vi.mocked(createToolRegistry);
const createMutationTrackerMock = vi.mocked(createMutationTracker);
const initLadderMock = vi.mocked(initLadder);
const profileForRungMock = vi.mocked(profileForRung);
const openTelemetryMock = vi.mocked(openTelemetry);

import type { TaskSpec } from '../execution/executor';
import { makeTestDeps } from './__tests__/makeTestDeps';
import { resolveBonSamples, runAgentLoop, type RunnerDeps, shouldRunBestOfN } from './runner';

const BON_ENV = 'RUNNER_BON_SAMPLES';
const originalBonEnv = process.env[BON_ENV];

const makeSpec = (overrides: Partial<TaskSpec> = {}): TaskSpec => ({
  agentType: 'code-logic-writer',
  navBundlePath: 'specs/branch/nav/T001.json',
  targetFiles: ['a.ts'],
  ...overrides,
});

const makeImplDeps = (overrides: Partial<RunnerDeps> = {}): RunnerDeps => ({
  mode: 'impl',
  ...makeTestDeps(),
  ...overrides,
});

const baseLadder: LadderState = { rung: 'ollama', consecutiveFails: 0, exhausted: false };
const terminalLadder: LadderState = { rung: 'claude', consecutiveFails: 0, exhausted: false };
const exhaustedLadder: LadderState = { rung: 'claude', consecutiveFails: 3, exhausted: true };

const makePipelineResult = (overrides: Partial<PipelineResult> = {}): PipelineResult => ({
  status: 'completed',
  passed: true,
  redObserved: false,
  greenObserved: true,
  failedStageIndex: undefined,
  finalLadder: baseLadder,
  ...overrides,
});

const makeFakeTracker = (
  mutated: readonly string[] = []
): ReturnType<typeof createMutationTracker> => ({
  record: vi.fn(),
  mutatedPaths: vi.fn((): readonly string[] => mutated),
  revert: vi.fn(() => Promise.resolve()),
});

// A base-rung failure that is NOT a triage-abort and NOT exhausted → best-of-N resamples.
const resamplingFailure = (): PipelineResult =>
  makePipelineResult({
    status: 'failed',
    passed: false,
    failedStageIndex: 1,
    failedStage: lintStage,
    greenObserved: false,
    finalLadder: { rung: 'ollama', consecutiveFails: 1, exhausted: false },
    failure: { gate: 'lint', message: 'lint failed', output: 'ESLint: unused var' },
  });

const advanceLadder = (ladder: LadderState): LadderState => {
  if (ladder.exhausted) return ladder;
  const fails = ladder.consecutiveFails + 1;
  if (fails < 3) return { ...ladder, consecutiveFails: fails };
  return { rung: 'claude', consecutiveFails: 0, exhausted: true };
};

const mockEscalatingPipeline = (): void => {
  runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
    await ctx.driveCode();
    const finalLadder = advanceLadder(ladder);
    return makePipelineResult({
      status: finalLadder.exhausted ? 'local-exhausted' : 'failed',
      passed: false,
      greenObserved: false,
      finalLadder,
      failure: { gate: 'lint', message: 'lint failed', output: 'ESLint: unused var' },
    });
  });
};

describe('best-of-N gate-select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[BON_ENV];
    initLadderMock.mockReturnValue(baseLadder);
    profileForRungMock.mockImplementation((_rung, base) => base);
    createModelMock.mockReturnValue({ provider: 'ollama' } as ReturnType<typeof createModel>);
    createToolRegistryMock.mockReturnValue({} as ReturnType<typeof createToolRegistry>);
    createMutationTrackerMock.mockReturnValue(makeFakeTracker());
    openTelemetryMock.mockReturnValue({ recordRun: vi.fn(), recordAttempt: vi.fn(), close: vi.fn() });
    runPipelineMock.mockResolvedValue(makePipelineResult());
  });

  afterEach(() => {
    if (originalBonEnv === undefined) delete process.env[BON_ENV];
    else process.env[BON_ENV] = originalBonEnv;
  });

  describe('resolveBonSamples', () => {
    it('should default to 3 samples when the env override is unset', () => {
      delete process.env[BON_ENV];
      expect(resolveBonSamples()).toBe(3);
    });

    it('should read the sample count from RUNNER_BON_SAMPLES when set', () => {
      process.env[BON_ENV] = '5';
      expect(resolveBonSamples()).toBe(5);
    });

    it('should fall back to the default when the override is non-numeric', () => {
      process.env[BON_ENV] = 'abc';
      expect(resolveBonSamples()).toBe(3);
    });

    it('should fall back to the default when the override is below 1', () => {
      process.env[BON_ENV] = '0';
      expect(resolveBonSamples()).toBe(3);
    });

    it('should floor a fractional override', () => {
      process.env[BON_ENV] = '2.9';
      expect(resolveBonSamples()).toBe(2);
    });
  });

  describe('shouldRunBestOfN', () => {
    it('should fire on the base local rung when samples exceed one', () => {
      expect(shouldRunBestOfN(baseLadder, 3)).toBe(true);
    });

    it('should not fire when samples is one (feature-off, single-attempt path)', () => {
      expect(shouldRunBestOfN(baseLadder, 1)).toBe(false);
    });

    it('should not fire on the terminal claude handoff rung', () => {
      expect(shouldRunBestOfN(terminalLadder, 3)).toBe(false);
    });

    it('should not fire on an exhausted ladder', () => {
      expect(shouldRunBestOfN(exhaustedLadder, 3)).toBe(false);
    });
  });

  describe('base-rung best-of-N loop', () => {
    it('should iterate on a near-miss sample with no inter-sample revert when sample 2 passes', async () => {
      const tracker = makeFakeTracker(['a.ts']);
      createMutationTrackerMock.mockReturnValue(tracker);
      runPipelineMock
        .mockResolvedValueOnce(resamplingFailure())
        .mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.status).toBe('completed');
      expect(result.attempts).toBe(2);
      expect(runPipelineMock).toHaveBeenCalledTimes(2);
      // Sample 1 is a near-miss (lint gate, mutated edits landed, not aborted,
      // not stuck) → iterated in place, no revert between samples; the winner's
      // mutations are kept (no finalizeRun revert on a completed run) → zero reverts.
      expect(tracker.revert).toHaveBeenCalledTimes(0);
      expect(result.touchedFiles).toEqual(['a.ts']);
    });

    it('should emit one attempt_runs record per sample', async () => {
      runPipelineMock
        .mockResolvedValueOnce(resamplingFailure())
        .mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.attemptRecords).toHaveLength(2);
      expect(result.attemptRecords!.map(r => r.attempt)).toEqual([1, 2]);
    });

    it('should run three samples then escalate when every base-rung sample fails', async () => {
      mockEscalatingPipeline();

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.attempts).toBe(3);
      expect(runPipelineMock).toHaveBeenCalledTimes(3);
      expect(result.status).toBe('local-exhausted');
      expect(result.finalRung).toBe('claude');
    });

    it('should resample after a triage-abort sample while budget remains (hopeless, not iterated) until the ladder exhausts', async () => {
      // Only the GLOBAL first attempt is subject to first-attempt triage (attemptNumber
      // === 1); resampled attempts 2/3 are ordinary 'retry' classifications. With a
      // static non-advancing ladder the outer escalation loop would never terminate, so
      // this drives the ladder to exhaustion (FAILS_PER_RUNG=3) like the real pipeline
      // would, terminating the run after exactly 3 pipeline calls.
      const tscFlood = Array.from({ length: 9 }, (_, i) => `src/x.ts(${i},1): error TS2322: bad`).join('\n');
      runPipelineMock.mockImplementation(async (_stages, _ctx, ladder) => {
        const finalLadder = advanceLadder(ladder);
        return makePipelineResult({
          status: finalLadder.exhausted ? 'local-exhausted' : 'failed',
          passed: false,
          failedStageIndex: 1,
          failedStage: tscStage,
          greenObserved: false,
          finalLadder,
          failure: { gate: 'tsc', message: 'tsc failed', output: tscFlood },
        });
      });

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(runPipelineMock).toHaveBeenCalledTimes(3);
      expect(result.attempts).toBe(3);
      expect(result.status).toBe('local-exhausted');
      expect(result.finalRung).toBe('claude');
    });

    it('should keep iterating a near-miss chain with no inter-sample revert when the failure signature changes', async () => {
      const tracker = makeFakeTracker(['a.ts']);
      createMutationTrackerMock.mockReturnValue(tracker);
      runPipelineMock
        .mockResolvedValueOnce(
          makePipelineResult({
            status: 'failed',
            passed: false,
            failedStageIndex: 1,
            failedStage: lintStage,
            greenObserved: false,
            finalLadder: baseLadder,
            failure: { gate: 'lint', message: 'lint failed', output: 'A' },
          })
        )
        .mockResolvedValueOnce(
          makePipelineResult({
            status: 'failed',
            passed: false,
            failedStageIndex: 1,
            failedStage: tscStage,
            greenObserved: false,
            finalLadder: baseLadder,
            failure: { gate: 'tsc', message: 'tsc failed', output: 'B' },
          })
        )
        .mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(runPipelineMock).toHaveBeenCalledTimes(3);
      expect(tracker.revert).toHaveBeenCalledTimes(0);
      expect(result.attempts).toBe(3);
      expect(result.status).toBe('completed');
    });

    it('should flip to hopeless (revert + resample) when the iterated sample repeats the same failure signature', async () => {
      const tracker = makeFakeTracker(['a.ts']);
      createMutationTrackerMock.mockReturnValue(tracker);
      runPipelineMock
        .mockResolvedValueOnce(resamplingFailure())
        .mockResolvedValueOnce(resamplingFailure())
        .mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(runPipelineMock).toHaveBeenCalledTimes(3);
      expect(tracker.revert).toHaveBeenCalledTimes(1);
      expect(result.attempts).toBe(3);
      expect(result.status).toBe('completed');
    });

    it('should treat a drive-throw (gate=drive) sample as hopeless and revert before resampling', async () => {
      const tracker = makeFakeTracker();
      createMutationTrackerMock.mockReturnValue(tracker);
      runPipelineMock
        .mockResolvedValueOnce(
          makePipelineResult({
            status: 'failed',
            passed: false,
            failedStageIndex: undefined,
            failedStage: undefined,
            greenObserved: false,
            finalLadder: baseLadder,
            failure: { gate: 'drive', message: 'drive failed on the ollama rung', output: '[rung:ollama] boom' },
          })
        )
        .mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(runPipelineMock).toHaveBeenCalledTimes(2);
      expect(tracker.revert).toHaveBeenCalledTimes(1);
      expect(result.attempts).toBe(2);
      expect(result.status).toBe('completed');
    });
  });

  describe('feature-off dispatch', () => {
    it('should not revert between attempts when RUNNER_BON_SAMPLES is 1', async () => {
      process.env[BON_ENV] = '1';
      const tracker = makeFakeTracker(['a.ts']);
      createMutationTrackerMock.mockReturnValue(tracker);
      runPipelineMock
        .mockResolvedValueOnce(resamplingFailure())
        .mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.status).toBe('completed');
      expect(result.attempts).toBe(2);
      // N=1 reproduces the single-attempt path: no best-of-N inter-sample revert.
      expect(tracker.revert).not.toHaveBeenCalled();
    });
  });

  describe('terminal rung', () => {
    it('should run exactly one attempt on the terminal claude handoff rung', async () => {
      initLadderMock.mockReturnValue(terminalLadder);
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'local-exhausted',
          passed: false,
          greenObserved: false,
          finalLadder: exhaustedLadder,
        })
      );

      await runAgentLoop(makeSpec(), makeImplDeps());

      expect(runPipelineMock).toHaveBeenCalledTimes(1);
    });
  });
});
