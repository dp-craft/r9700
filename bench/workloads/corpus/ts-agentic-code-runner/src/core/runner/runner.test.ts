import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decompositionGate, functionalStyleGate } from '../gates/gates';
import type { LadderState } from '../orchestration/escalation';
import type { PipelineResult, StageContext } from '../orchestration/pipeline';
import { lintStage } from '../orchestration/pipeline';
import type { AgentRunResult } from '../shared/types';

// Controllable execFile seam: promisify(execFile) resolves/rejects via this fn.
// vi.hoisted so the ref exists before the vi.mock factory runs.
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

// Boundary / seam mocks — hoisted before imports via vi.mock hoisting
vi.mock('../orchestration/pipeline', async importOriginal => {
  const actual = await importOriginal<typeof import('../orchestration/pipeline')>();
  return {
    ...actual,
    runPipeline: vi.fn(),
  };
});

vi.mock('../llm/connector', () => ({
  generate: vi.fn(() => Promise.resolve({ text: 'ok', toolCallCount: 0 })),
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

vi.mock('../orchestration/escalation', () => {
  const LADDERS = {
    ollama: ['ollama', 'claude'],
    openrouter: ['openrouter', 'claude'],
  };
  return {
    LADDERS,
    TERMINAL_RUNG: 'claude',
    FAILS_PER_RUNG: 3,
    startRungForBackend: vi.fn((backend: string) => (backend === 'openrouter' ? 'openrouter' : 'ollama')),
    initLadder: vi.fn((start = 'ollama') => ({ rung: start, consecutiveFails: 0, exhausted: false })),
    recordFailure: vi.fn(state => state),
    recordSuccess: vi.fn(state => state),
    // Real-ish forceEscalate so the catch-seam escalation tests exercise the ladder.
    // A base rung force-escalates straight to the terminal claude rung (exhausted);
    // there is no ollama→openrouter cross-fallback.
    forceEscalate: vi.fn((state: { rung: string; exhausted: boolean }) => {
      if (state.exhausted || state.rung === 'claude') {
        return { ...state, exhausted: true };
      }
      return { rung: 'claude', consecutiveFails: 0, exhausted: true };
    }),
  };
});

vi.mock('../profiles/profiles', () => ({
  resolveProfile: vi.fn(() => ({
    name: 'p-ollama',
    backend: 'ollama',
    modelId: 'Qwen3-Coder-30B-A3B',
  })),
  profileForRung: vi.fn((_rung: string, base: { backend: string }) => base),
}));

vi.mock('../rules/rulesProjection', () => ({
  projectRules: vi.fn(() =>
    Promise.resolve({
      agentType: 'code-logic-writer',
      condensedRules: 'SENTINEL_RULES_PROJECTION',
      sources: ['.claude/agents/code-logic-writer.md'],
    })
  ),
}));

// Override buildImplPreload with a sentinel so the lazy-suffix wiring can be
// asserted without touching the filesystem; keep buildEditRegionDirective real.
vi.mock('../execution/editRegion', async importOriginal => {
  const actual = await importOriginal<typeof import('../execution/editRegion')>();
  return {
    ...actual,
    buildImplPreload: vi.fn(() => Promise.resolve('SENTINEL_IMPL_PRELOAD')),
  };
});

vi.mock('../reporting/telemetry', () => ({
  openTelemetry: vi.fn(() => ({ recordRun: vi.fn(), recordAttempt: vi.fn(), close: vi.fn() })),
  toTaskRunRow: vi.fn((result: { status: string; finalRung: string }) => ({
    status: result.status,
    final_rung: result.finalRung,
  })),
  toAttemptRunRow: vi.fn(),
}));

// Import mocked collaborators after vi.mock declarations
const { runPipeline, PIPELINES } = await import('../orchestration/pipeline');
const { generate, createModel } = await import('../llm/connector');
const { createToolRegistry, buildSdkTools, createMutationTracker } = await import('../tools/toolRegistry');
const { initLadder } = await import('../orchestration/escalation');
const { resolveProfile, profileForRung } = await import('../profiles/profiles');
const { projectRules } = await import('../rules/rulesProjection');
const { openTelemetry, toAttemptRunRow, toTaskRunRow } = await import('../reporting/telemetry');
const { buildImplPreload } = await import('../execution/editRegion');

const buildImplPreloadMock = vi.mocked(buildImplPreload);
const runPipelineMock = vi.mocked(runPipeline);
const generateMock = vi.mocked(generate);
const createModelMock = vi.mocked(createModel);
const createToolRegistryMock = vi.mocked(createToolRegistry);
const createMutationTrackerMock = vi.mocked(createMutationTracker);
const buildSdkToolsMock = vi.mocked(buildSdkTools);
const initLadderMock = vi.mocked(initLadder);
const resolveProfileMock = vi.mocked(resolveProfile);
const profileForRungMock = vi.mocked(profileForRung);
const projectRulesMock = vi.mocked(projectRules);
const openTelemetryMock = vi.mocked(openTelemetry);
const toTaskRunRowMock = vi.mocked(toTaskRunRow);
const toAttemptRunRowMock = vi.mocked(toAttemptRunRow);

import type { TaskSpec } from '../execution/executor';
import { makeTestDeps } from './__tests__/makeTestDeps';
import {
  buildCollaboratorsBlock,
  buildKickoff,
  buildOutcome,
  buildPlanRowsBlock,
  buildRequirementDetailsBlock,
  buildSpecExcerptsBlock,
  buildSystemPrompt,
  buildTestKickoff,
  checkTargetsClean,
  defaultRunTests,
  DirtyTreeError,
  resolveConclusionSummarizer,
  resolveMaxSteps,
  ROLE_PROFILES,
  runAgentLoop,
  type RunnerDeps,
  selectCodeKickoff,
  TDD_IMPL_KICKOFF_PROMPT
} from './runner';

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

const okLadder: LadderState = { rung: 'ollama', consecutiveFails: 0, exhausted: false };
const exhaustedLadder: LadderState = { rung: 'claude', consecutiveFails: 3, exhausted: true };

const makePipelineResult = (overrides: Partial<PipelineResult> = {}): PipelineResult => ({
  status: 'completed',
  passed: true,
  redObserved: false,
  greenObserved: true,
  failedStageIndex: undefined,
  finalLadder: okLadder,
  ...overrides,
});

const makeFakeTracker = (
  mutated: readonly string[] = []
): ReturnType<typeof createMutationTracker> => ({
  record: vi.fn(),
  mutatedPaths: vi.fn((): readonly string[] => mutated),
  revert: vi.fn(() => Promise.resolve()),
});

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    initLadderMock.mockReturnValue(okLadder);
    resolveProfileMock.mockReturnValue({
      name: 'p-ollama',
      backend: 'ollama',
      modelId: 'Qwen3-Coder-30B-A3B',
    });
    profileForRungMock.mockImplementation((_rung, base) => base);
    createModelMock.mockReturnValue({ provider: 'ollama' } as ReturnType<typeof createModel>);
    buildSdkToolsMock.mockReturnValue({});
    createToolRegistryMock.mockReturnValue({} as ReturnType<typeof createToolRegistry>);
    createMutationTrackerMock.mockReturnValue(makeFakeTracker());
    generateMock.mockResolvedValue({ text: 'ok', toolCallCount: 0 });

    projectRulesMock.mockResolvedValue({
      agentType: 'code-logic-writer',
      condensedRules: 'SENTINEL_RULES_PROJECTION',
    });

    openTelemetryMock.mockReturnValue({ recordRun: vi.fn(), recordAttempt: vi.fn(), close: vi.fn() });
    toTaskRunRowMock.mockImplementation(result => ({
      status: result.status,
      final_rung: result.finalRung,
      backend: result.backend ?? 'unknown',
      model_id: result.modelId,
      failure_class: result.failureClass ?? '',
      trace_id: '',
      span_id: '',
      agent_type: '',
      attempts: 0,
      duration_ms: 0,
      red_observed: 0,
      green_observed: 0,
      escalated: 0,
      fallback_sanctioned: 0,
      touched_file_count: 0,
      target_file_count: 0,
      failed_stage: '',
      started_at: '',
      input_tokens: result.usage?.inputTokens ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
      total_tokens: result.usage?.totalTokens ?? 0,
    }));

    runPipelineMock.mockResolvedValue(makePipelineResult());
  });

  // R-030: the runner is a seam over runPipeline — assert it INVOKES the pipeline.
  it('should invoke runPipeline with the impl stage list when mode is impl', async () => {
    const spec = makeSpec();
    const deps = makeImplDeps();

    await runAgentLoop(spec, deps);

    expect(runPipelineMock).toHaveBeenCalledTimes(1);
    const stages = runPipelineMock.mock.calls[0][0];
    expect(stages).toBe(PIPELINES.impl);
  });

  it('should invoke runPipeline with the tdd stage list when mode is tdd', async () => {
    const spec = makeSpec({ agentType: 'ts-test-writer' });
    const deps = makeImplDeps({ mode: 'tdd' });

    await runAgentLoop(spec, deps);

    const stages = runPipelineMock.mock.calls[0][0];
    expect(stages).toBe(PIPELINES.tdd);
  });

  it('should seed runPipeline with the initial ladder state', async () => {
    const spec = makeSpec();
    const deps = makeImplDeps();

    await runAgentLoop(spec, deps);

    expect(initLadderMock).toHaveBeenCalledTimes(1);
    const ladder0 = runPipelineMock.mock.calls[0][2];
    expect(ladder0).toBe(okLadder);
  });

  it('should map a completed pipeline result to status completed in impl mode', async () => {
    runPipelineMock.mockResolvedValue(
      makePipelineResult({ status: 'completed', greenObserved: false })
    );
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(result.status).toBe('completed');
  });

  it('should populate modelId from the final rung profile on a completed result', async () => {
    runPipelineMock.mockResolvedValue(makePipelineResult({ status: 'completed' }));
    profileForRungMock.mockReturnValue({
      name: 'p-ollama',
      backend: 'ollama',
      modelId: 'final-rung-model',
    });
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(result.modelId).toBe('final-rung-model');
  });

  it('should map a completed pipeline result to completed only when greenObserved is true in tdd mode', async () => {
    runPipelineMock.mockResolvedValue(
      makePipelineResult({ status: 'completed', greenObserved: true })
    );
    const spec = makeSpec({ agentType: 'ts-test-writer' });
    const deps = makeImplDeps({ mode: 'tdd' });

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(result.status).toBe('completed');
    expect(result.greenObserved).toBe(true);
  });

  it('should not return completed in tdd mode when greenObserved is false even if pipeline status is completed', async () => {
    runPipelineMock.mockResolvedValue(
      makePipelineResult({ status: 'completed', greenObserved: false })
    );
    const spec = makeSpec({ agentType: 'ts-test-writer' });
    const deps = makeImplDeps({ mode: 'tdd' });

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(result.status).not.toBe('completed');
  });

  it('should propagate a failed pipeline result to status failed', async () => {
    runPipelineMock.mockResolvedValue(
      makePipelineResult({
        status: 'failed',
        passed: false,
        failedStageIndex: 1,
        greenObserved: false,
        finalLadder: exhaustedLadder,
      })
    );
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(result.status).toBe('failed');
  });

  it('should propagate an local-exhausted pipeline result with the exhausted ladder rung', async () => {
    runPipelineMock.mockResolvedValue(
      makePipelineResult({
        status: 'local-exhausted',
        passed: false,
        failedStageIndex: 0,
        greenObserved: false,
        finalLadder: exhaustedLadder,
      })
    );
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(result.status).toBe('local-exhausted');
    expect(result.finalRung).toBe('claude');
  });

  it('should inject a drive that calls connector.generate with the sdk tool set', async () => {
    let captured: StageContextLike | undefined;
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      captured = ctx as unknown as StageContextLike;
      await ctx.driveCode();
      return makePipelineResult();
    });
    const spec = makeSpec();
    const deps = makeImplDeps();

    await runAgentLoop(spec, deps);

    expect(captured).toBeDefined();
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(buildSdkToolsMock).toHaveBeenCalledTimes(1);
    const req = generateMock.mock.calls[0][1] as { system: string };
    expect(req.system).toContain('SENTINEL_RULES_PROJECTION');
  });

  it('should make decomposition and functional-style gates no-ops when the code role is ui-writer', async () => {
    let captured: StageContext | undefined;
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      captured = ctx;
      return makePipelineResult();
    });
    const gateRun = vi.fn();
    const probeCtx = { cwd: '/x', run: gateRun };
    const spec = makeSpec({ agentType: 'ui-writer' });

    await runAgentLoop(spec, makeImplDeps());

    expect(captured).toBeDefined();
    const ctx = captured as StageContext;
    expect(await ctx.decompositionGate(['dirty.ts'], probeCtx)).toBeNull();
    expect(await ctx.functionalStyleGate(['dirty.ts'], probeCtx)).toBeNull();
    expect(gateRun).not.toHaveBeenCalled();
  });

  it('should keep the real decomposition/functional-style gates when the code role is code-logic-writer', async () => {
    let captured: StageContext | undefined;
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      captured = ctx;
      return makePipelineResult();
    });
    const spec = makeSpec({ agentType: 'code-logic-writer' });

    await runAgentLoop(spec, makeImplDeps());

    expect(captured).toBeDefined();
    const ctx = captured as StageContext;
    expect(ctx.decompositionGate).toBe(decompositionGate);
    expect(ctx.functionalStyleGate).toBe(functionalStyleGate);
  });

  // R-030 regression: makeDrive must pass a non-empty messages array to generate.
  // Bug: runner.ts line ~84 hard-codes `messages: []` — real models throw AI_InvalidPromptError.
  it('should pass a non-empty messages array to generate when drive is invoked', async () => {
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      await ctx.driveCode();
      return makePipelineResult();
    });
    const spec = makeSpec();
    const deps = makeImplDeps();

    await runAgentLoop(spec, deps);

    expect(generateMock).toHaveBeenCalledTimes(1);
    const req = generateMock.mock.calls[0]?.[1] as unknown as {
      readonly messages: readonly unknown[];
    };
    expect(req.messages.length).toBeGreaterThan(0);
  });

  // T9: the impl preload must be LAZY — buildImplPreload runs at code-drive
  // execution time (after RED wrote the failing test), not at kickoff-build time.
  it('should append the lazily-resolved impl preload to the code-drive kickoff in tdd mode', async () => {
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      await ctx.driveCode();
      return makePipelineResult();
    });

    await runAgentLoop(makeSpec(), makeImplDeps({ mode: 'tdd' }));

    expect(buildImplPreloadMock).toHaveBeenCalledTimes(1);
    const req = generateMock.mock.calls[0]?.[1] as unknown as {
      readonly messages: readonly { readonly content: string }[];
    };
    const joined = req.messages.map(m => m.content).join('\n');
    expect(joined).toContain('SENTINEL_IMPL_PRELOAD');
  });

  it('should append the lazily-resolved impl preload to the code-drive kickoff in impl mode', async () => {
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      await ctx.driveCode();
      return makePipelineResult();
    });

    await runAgentLoop(makeSpec(), makeImplDeps());

    expect(buildImplPreloadMock).toHaveBeenCalledTimes(1);
    const req = generateMock.mock.calls[0]?.[1] as unknown as {
      readonly messages: readonly { readonly content: string }[];
    };
    const joined = req.messages.map(m => m.content).join('\n');
    expect(joined).toContain('SENTINEL_IMPL_PRELOAD');
  });

  it('should pass the resolved max-steps cap to generate', async () => {
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      await ctx.driveCode();
      return makePipelineResult();
    });

    await runAgentLoop(makeSpec(), makeImplDeps());

    const req = generateMock.mock.calls[0]?.[1] as unknown as { readonly maxSteps: number };
    expect(req.maxSteps).toBe(resolveMaxSteps());
  });

  it('should record the token usage reported by the drive into telemetry', async () => {
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      await ctx.driveCode();
      return makePipelineResult();
    });
    generateMock.mockResolvedValue({
      text: 'ok',
      toolCallCount: 0,
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });
    const recordRun = vi.fn();
    openTelemetryMock.mockReturnValue({ recordRun, recordAttempt: vi.fn(), close: vi.fn() });

    const result = await runAgentLoop(makeSpec(), makeImplDeps());

    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
    const row = recordRun.mock.calls[0][0] as { input_tokens: number; total_tokens: number };
    expect(row.input_tokens).toBe(100);
    expect(row.total_tokens).toBe(120);
  });

  it('should sum token usage across multiple drives in one run', async () => {
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      await ctx.driveCode();
      await ctx.driveCode();
      return makePipelineResult();
    });
    generateMock.mockResolvedValue({
      text: 'ok',
      toolCallCount: 0,
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });

    const result = await runAgentLoop(makeSpec(), makeImplDeps());

    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40, totalTokens: 240 });
  });

  it('should report zero usage for a completed run whose drive reports no usage', async () => {
    runPipelineMock.mockImplementation(async (_stages, ctx) => {
      await ctx.driveCode();
      return makePipelineResult();
    });
    generateMock.mockResolvedValue({ text: 'ok', toolCallCount: 0 });

    const result = await runAgentLoop(makeSpec(), makeImplDeps());

    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it('should omit usage entirely on a fatal pre-run failure (no model ran)', async () => {
    projectRulesMock.mockRejectedValueOnce(new Error('rules projection blew up'));

    const result = await runAgentLoop(makeSpec(), makeImplDeps());

    expect(result.status).toBe('failed');
    expect(result.usage).toBeUndefined();
  });

  it('should scope the tool registry to the declared target files', async () => {
    const spec = makeSpec({ targetFiles: ['a.ts', 'b.ts'] });
    const deps = makeImplDeps();

    await runAgentLoop(spec, deps);

    expect(createToolRegistryMock).toHaveBeenCalledTimes(1);
    const args = createToolRegistryMock.mock.calls[0];
    expect(args[2]).toEqual(['a.ts', 'b.ts']);
  });

  it('should record exactly one telemetry row carrying the result status', async () => {
    const recordRun = vi.fn();
    const close = vi.fn();
    openTelemetryMock.mockReturnValue({ recordRun, recordAttempt: vi.fn(), close });
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(recordRun).toHaveBeenCalledTimes(1);
    const row = recordRun.mock.calls[0][0] as { status: string };
    expect(row.status).toBe(result.status);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('should resolve to a terminal failed result with telemetry when projectRules rejects', async () => {
    projectRulesMock.mockRejectedValueOnce(new Error('rules projection blew up'));
    const recordRun = vi.fn();
    const close = vi.fn();
    openTelemetryMock.mockReturnValue({ recordRun, recordAttempt: vi.fn(), close });
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(result.status).toBe('failed');
    expect(recordRun).toHaveBeenCalledTimes(1);
  });

  it('should resolve to a terminal failed result with telemetry when runPipeline keeps rejecting (non-connectivity drive throw)', async () => {
    // A non-connectivity drive throw is caught inside the attempt loop and routed
    // through the counted recordFailure path (NOT force-escalate). With the
    // identity recordFailure mock the ladder never advances, so the no-progress
    // guard halts on the 2nd identical signature → terminal failed.
    runPipelineMock.mockRejectedValue(new Error('pipeline blew up'));
    const recordRun = vi.fn();
    const close = vi.fn();
    openTelemetryMock.mockReturnValue({ recordRun, recordAttempt: vi.fn(), close });
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result: AgentRunResult = await runAgentLoop(spec, deps);

    expect(result.status).toBe('failed');
    expect(recordRun).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Per-attempt telemetry capture
  // -------------------------------------------------------------------------

  it('should populate attemptRecords with exactly one record for a single completed attempt', async () => {
    runPipelineMock.mockResolvedValue(makePipelineResult());

    const result = await runAgentLoop(makeSpec(), makeImplDeps());

    expect(result.attemptRecords).toHaveLength(1);
    const rec = result.attemptRecords![0];
    expect(rec.attempt).toBe(1);
    expect(rec.status).toBe('completed');
    expect(rec.rung).toBe('ollama');
  });

  it('should call recordAttempt once for a single completed attempt', async () => {
    runPipelineMock.mockResolvedValue(makePipelineResult());
    const recordAttempt = vi.fn();
    openTelemetryMock.mockReturnValue({ recordRun: vi.fn(), recordAttempt, close: vi.fn() });
    toAttemptRunRowMock.mockReturnValue({ trace_id: 'x', attempt: 1, rung: 'ollama', model_id: 'm', backend: 'ollama', stage: '', tool_calls: 0, status: 'completed', duration_ms: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 });

    await runAgentLoop(makeSpec(), makeImplDeps());

    expect(recordAttempt).toHaveBeenCalledTimes(1);
  });

  it('should populate attemptRecords once per attempt on a drive-throw path', async () => {
    runPipelineMock.mockRejectedValue(new Error('drive error'));

    const result = await runAgentLoop(makeSpec(), makeImplDeps());

    // No-progress halts after 2 identical failures; each attempt is captured.
    expect(result.attemptRecords!.length).toBeGreaterThanOrEqual(1);
    expect(result.attemptRecords!.every(r => r.attempt >= 1)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // F-01 / F-03 — runtime escalation: ladder advances, model rebuilt per rung,
  // attempts counted via repeatUntilExhausted (R-030: assert the seam drives it).
  // -------------------------------------------------------------------------

  // The base rung needs 3 fails to escalate; the 3rd fail jumps straight to the
  // terminal claude rung and exhausts (no openrouter intermediate, no cross-fallback).
  const advanceLadder = (ladder: LadderState): LadderState => {
    if (ladder.exhausted) {
      return ladder;
    }
    const fails = ladder.consecutiveFails + 1;
    if (fails < 3) {
      return { ...ladder, consecutiveFails: fails };
    }
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
      });
    });
  };

  it('should rebuild the model per rung-attempt across the escalation loop', async () => {
    initLadderMock.mockReturnValue({ rung: 'ollama', consecutiveFails: 0, exhausted: false });
    mockEscalatingPipeline();
    const spec = makeSpec();
    const deps = makeImplDeps();

    await runAgentLoop(spec, deps);

    // 3 ollama fails → exhausted→claude handoff: 3 attempts → 3 model builds.
    expect(createModelMock).toHaveBeenCalledTimes(3);
    expect(runPipelineMock).toHaveBeenCalledTimes(3);
  });

  it('should exhaust on the claude rung after FAILS_PER_RUNG base failures', async () => {
    initLadderMock.mockReturnValue({ rung: 'ollama', consecutiveFails: 0, exhausted: false });
    mockEscalatingPipeline();
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result = await runAgentLoop(spec, deps);

    // No 4th attempt exists for a base run — 3 ollama fails escalate straight to
    // the terminal claude handoff (exhausted), with no openrouter intermediate.
    expect(result.finalRung).toBe('claude');
    expect(result.status).toBe('local-exhausted');
  });

  it('should report the real attempt count, not a ladder proxy', async () => {
    initLadderMock.mockReturnValue({ rung: 'ollama', consecutiveFails: 0, exhausted: false });
    mockEscalatingPipeline();
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result = await runAgentLoop(spec, deps);

    expect(result.attempts).toBe(3);
    expect(result.status).toBe('local-exhausted');
  });

  it('should run exactly one attempt when the first pipeline passes', async () => {
    runPipelineMock.mockResolvedValue(makePipelineResult({ passed: true }));
    const spec = makeSpec();
    const deps = makeImplDeps();

    const result = await runAgentLoop(spec, deps);

    expect(result.attempts).toBe(1);
    expect(runPipelineMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // FR NEW:agentic-code-runner.retry-classifier — the retry-classifier is wired
  // into the escalation loop: an idle-stall failed sample is reverted and
  // resampled within the best-of-N sample budget rather than aborting after
  // one attempt; the loop still stops short of full ladder exhaustion because
  // the final aborted sample halts repeatUntilExhausted (R-030: assert the
  // seam acts on it).
  // -------------------------------------------------------------------------

  describe('retry-classifier wiring', () => {
    const ORIGINAL_IDLE_TIMEOUT = process.env.RUNNER_IDLE_TIMEOUT_MS;

    afterEach(() => {
      if (ORIGINAL_IDLE_TIMEOUT === undefined) {
        delete process.env.RUNNER_IDLE_TIMEOUT_MS;
      } else {
        process.env.RUNNER_IDLE_TIMEOUT_MS = ORIGINAL_IDLE_TIMEOUT;
      }
    });

    it('should resample within the best-of-N budget on an idle-stall failed attempt (classifier wired)', async () => {
      // idle timeout 0 + zero tool activity + non-transient failure ⇒ idle stall ⇒ abort.
      process.env.RUNNER_IDLE_TIMEOUT_MS = '0';
      generateMock.mockResolvedValue({ text: '', toolCallCount: 0 });
      // Tiny delay so elapsedMs > 0 (> idleTimeoutMs=0) ⇒ idle-stall window passes.
      runPipelineMock.mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(
              () =>
                resolve(
                  makePipelineResult({
                    status: 'failed',
                    passed: false,
                    failedStageIndex: 1,
                    failedStage: lintStage,
                    greenObserved: false,
                    finalLadder: okLadder,
                  })
                ),
              1
            )
          )
      );
      const spec = makeSpec();
      const deps = makeImplDeps();

      const result = await runAgentLoop(spec, deps);

      expect(result.attempts).toBe(3);
      expect(runPipelineMock).toHaveBeenCalledTimes(3);
      expect(result.status).toBe('failed');
    });

    it('should keep retrying to exhaustion when tool activity occurred (classifier returns retry)', async () => {
      process.env.RUNNER_IDLE_TIMEOUT_MS = '0';
      // Tool activity present ⇒ not an idle stall ⇒ classifier returns retry.
      generateMock.mockResolvedValue({ text: 'work', toolCallCount: 1 });
      initLadderMock.mockReturnValue({ rung: 'ollama', consecutiveFails: 0, exhausted: false });
      mockEscalatingPipeline();
      const spec = makeSpec();
      const deps = makeImplDeps();

      const result = await runAgentLoop(spec, deps);

      expect(result.attempts).toBe(3);
      expect(result.status).toBe('local-exhausted');
    });
  });

  // -------------------------------------------------------------------------
  // Connectivity drive-throw escalation: an unreachable rung (fetch failed /
  // ECONNREFUSED) force-escalates to the next ladder rung instead of fatal-abort.
  // -------------------------------------------------------------------------
  describe('connectivity drive-throw escalation', () => {
    const ollamaLadder: LadderState = { rung: 'ollama', consecutiveFails: 0, exhausted: false };
    const openrouterLadder: LadderState = {
      rung: 'openrouter',
      consecutiveFails: 0,
      exhausted: false,
    };

    // Real forceEscalate/recordFailure so the catch seam can advance the ladder.
    const wireRealEscalation = (): void => {
      initLadderMock.mockReturnValue(ollamaLadder);
      profileForRungMock.mockImplementation((rung, _base) => ({
        name: `p-${rung}`,
        backend: rung === 'openrouter' ? 'openrouter' : 'ollama',
        modelId: `model-${rung}`,
      }));
    };

    it('should force-escalate straight to claude when the base ollama rung throws a connectivity error', async () => {
      wireRealEscalation();
      // ollama base rung: generate throws `fetch failed` ⇒ force-escalate straight
      // to the terminal claude handoff (exhausted) — no openrouter cross-fallback.
      generateMock.mockRejectedValue(new Error('fetch failed'));
      createModelMock.mockImplementation(
        (profile: { modelId: string }) =>
          ({ provider: 'p', modelId: profile.modelId }) as ReturnType<typeof createModel>
      );
      runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
        await ctx.driveCode();
        return makePipelineResult({ passed: true, finalLadder: ladder });
      });
      const spec = makeSpec();
      const deps = makeImplDeps();

      const result = await runAgentLoop(spec, deps);

      expect(result.finalRung).toBe('claude');
      expect(result.status).toBe('local-exhausted');
    });

    it('should local-exhausted when the openrouter rung throws a connectivity error', async () => {
      wireRealEscalation();
      initLadderMock.mockReturnValue(openrouterLadder);
      generateMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'));
      createModelMock.mockImplementation(
        (profile: { modelId: string }) =>
          ({ provider: 'p', modelId: profile.modelId }) as ReturnType<typeof createModel>
      );
      runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
        await ctx.driveCode();
        return makePipelineResult({ passed: true, finalLadder: ladder });
      });
      const spec = makeSpec();
      const deps = makeImplDeps();

      const result = await runAgentLoop(spec, deps);

      expect(result.status).toBe('local-exhausted');
      expect(result.finalRung).toBe('claude');
    });

    it('should NOT force-escalate on a non-connectivity drive throw (counted failure path)', async () => {
      wireRealEscalation();
      // Generic API error on every rung; counted recordFailure (stubbed identity)
      // keeps the rung on ollama, so attempt 2 stays on ollama.
      generateMock.mockRejectedValue(new Error('429 rate limit exceeded'));
      createModelMock.mockImplementation(
        (profile: { modelId: string }) =>
          ({ provider: 'p', modelId: profile.modelId }) as ReturnType<typeof createModel>
      );
      runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
        await ctx.driveCode();
        return makePipelineResult({
          status: 'failed',
          passed: false,
          greenObserved: false,
          finalLadder: ladder,
        });
      });
      const spec = makeSpec();
      const deps = makeImplDeps();

      const result = await runAgentLoop(spec, deps);

      // recordFailure mock is identity ⇒ ladder never advances ⇒ stays ollama;
      // the no-progress guard halts on the 2nd identical signature.
      expect(result.finalRung).toBe('ollama');
    });

    it('should classify an ollama prompt over num_ctx*0.9 as context-overflow and force-escalate', async () => {
      wireRealEscalation();
      // generate RESOLVES (no provider throw), but reports a per-step prompt over
      // num_ctx*0.9 (default 65536*0.9 = 58982). The runner must detect the overflow,
      // throw, and force-escalate straight to the terminal claude rung — a fixed
      // context window cannot be retried into success on the same model.
      generateMock.mockResolvedValue({ text: 'ok', toolCallCount: 1, maxStepPromptTokens: 60000 });
      createModelMock.mockImplementation(
        (profile: { modelId: string }) =>
          ({ provider: 'p', modelId: profile.modelId }) as ReturnType<typeof createModel>
      );
      runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
        await ctx.driveCode();
        return makePipelineResult({ passed: true, finalLadder: ladder });
      });

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.failureClass).toBe('context-overflow');
      expect(result.finalRung).toBe('claude');
      expect(result.status).toBe('local-exhausted');
      expect(result.escalated).toBe(true);
    });

    it('should NOT trigger context-overflow on the openrouter backend (ollama-only guard)', async () => {
      wireRealEscalation();
      initLadderMock.mockReturnValue(openrouterLadder);
      // openrouter manages its own window: even a huge per-step prompt must NOT be
      // classified as context-overflow (the num_ctx guard is ollama-only).
      profileForRungMock.mockReturnValue({ name: 'p-or', backend: 'openrouter', modelId: 'm-or' });
      generateMock.mockResolvedValue({ text: 'ok', toolCallCount: 1, maxStepPromptTokens: 999999 });
      createModelMock.mockImplementation(
        (profile: { modelId: string }) =>
          ({ provider: 'p', modelId: profile.modelId }) as ReturnType<typeof createModel>
      );
      runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
        await ctx.driveCode();
        return makePipelineResult({
          status: 'failed',
          passed: false,
          greenObserved: false,
          finalLadder: ladder,
          failure: { gate: 'test', message: 'gate', output: 'gate failed' },
        });
      });

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.failureClass).not.toBe('context-overflow');
    });

    it('should classify a generation-timeout drive-throw as failureClass generation-timeout (not connectivity)', async () => {
      wireRealEscalation();
      generateMock.mockRejectedValue(
        new Error(
          '[rung:ollama] generation-timeout: no generation activity for 120000ms — aborting drive'
        )
      );
      createModelMock.mockImplementation(
        (profile: { modelId: string }) =>
          ({ provider: 'p', modelId: profile.modelId }) as ReturnType<typeof createModel>
      );
      runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
        await ctx.driveCode();
        return makePipelineResult({ passed: true, finalLadder: ladder });
      });

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.failureClass).toBe('generation-timeout');
    });

    it('should force-escalate to local-exhausted on a generation-timeout drive-throw (same as connectivity)', async () => {
      wireRealEscalation();
      generateMock.mockRejectedValue(
        new Error(
          '[rung:ollama] generation-timeout: no generation activity for 120000ms — aborting drive'
        )
      );
      createModelMock.mockImplementation(
        (profile: { modelId: string }) =>
          ({ provider: 'p', modelId: profile.modelId }) as ReturnType<typeof createModel>
      );
      runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
        await ctx.driveCode();
        return makePipelineResult({ passed: true, finalLadder: ladder });
      });

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.status).toBe('local-exhausted');
      expect(result.finalRung).toBe('claude');
    });
  });

  // -------------------------------------------------------------------------
  // Eval-capture on drive-throw paths. Regression: the attempt() catch block
  // escalated/failed WITHOUT snapshotting the model's output, so an escalate
  // eval dir collapsed to run.json and a failed dir lost its files/ snapshot.
  // EVERY captured attempt MUST snapshot mutated source regardless of outcome.
  // -------------------------------------------------------------------------
  describe('eval-capture on drive-throw paths', () => {
    const MUTATED = 'export const store = 42;\n';
    let evalCwd: string;
    let originalCwd: string;

    const snapshotPath = (): string => {
      const base = path.join(evalCwd, 'logs', 'runner-eval');
      const [runDir] = readdirSync(base);
      return path.join(base, runDir, 'attempt-1', 'files', 'store.ts');
    };

    beforeEach(() => {
      originalCwd = process.cwd();
      evalCwd = mkdtempSync(path.join(tmpdir(), 'runner-eval-'));
      mkdirSync(path.join(evalCwd, 'src'));
      writeFileSync(path.join(evalCwd, 'src', 'store.ts'), MUTATED);
      process.chdir(evalCwd);
      process.env.RUNNER_EVAL_CAPTURE = '1';
      createMutationTrackerMock.mockReturnValue(makeFakeTracker(['src/store.ts']));
      profileForRungMock.mockImplementation((rung, _base) => ({
        name: `p-${rung}`,
        backend: rung === 'openrouter' ? 'openrouter' : 'ollama',
        modelId: `model-${rung}`,
      }));
      createModelMock.mockImplementation(
        (profile: { modelId: string }) =>
          ({ provider: 'p', modelId: profile.modelId }) as ReturnType<typeof createModel>
      );
      // runPipeline drives the code stage, which throws via the rejected generate.
      runPipelineMock.mockImplementation(async (_stages, ctx, ladder) => {
        await ctx.driveCode();
        return makePipelineResult({ passed: true, finalLadder: ladder });
      });
    });

    afterEach(() => {
      process.chdir(originalCwd);
      delete process.env.RUNNER_EVAL_CAPTURE;
      rmSync(evalCwd, { recursive: true, force: true });
    });

    it('should snapshot mutated source to attempt-1/files on an local-exhausted drive throw', async () => {
      generateMock.mockRejectedValue(new Error('fetch failed'));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.status).toBe('local-exhausted');
      expect(readFileSync(snapshotPath(), 'utf8')).toBe(MUTATED);
    });

    it('should snapshot mutated source to attempt-1/files on a failed drive throw', async () => {
      generateMock.mockRejectedValue(new Error('429 rate limit exceeded'));

      await runAgentLoop(makeSpec(), makeImplDeps());

      expect(readFileSync(snapshotPath(), 'utf8')).toBe(MUTATED);
    });
  });

  // -------------------------------------------------------------------------
  // Result contract (fix 3): backend / escalated / fallbackSanctioned. The
  // orchestrator reads these instead of grepping the runner's source.
  // -------------------------------------------------------------------------
  describe('result contract: backend / escalated / fallbackSanctioned', () => {
    it('should report the ACTUAL backend of the final-rung profile, not the ladder rung label', async () => {
      // Regression for the observed bug: an openrouter-pinned profile run that
      // halts at the ladder start reported finalRung:'ollama' while the openrouter
      // model actually ran. backend must reveal the truth.
      // Stable failure so the no-progress guard halts on the 2nd identical
      // signature (mirrors the real observed run; without it the loop never
      // terminates because okLadder never exhausts).
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'failed',
          passed: false,
          failedStageIndex: 1,
          greenObserved: false,
          finalLadder: okLadder,
          failure: { gate: 'test', message: 'no-progress', output: 'identical failure' },
        })
      );
      profileForRungMock.mockReturnValue({
        name: 'openrouter-default',
        backend: 'openrouter',
        modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      });

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.finalRung).toBe('ollama');
      expect(result.backend).toBe('openrouter');
      expect(result.modelId).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
    });

    it('should set escalated=false when the ladder never leaves the first rung', async () => {
      runPipelineMock.mockResolvedValue(makePipelineResult({ finalLadder: okLadder }));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.escalated).toBe(false);
    });

    it('should set escalated=true when the final rung advanced past the start', async () => {
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'local-exhausted',
          passed: false,
          greenObserved: false,
          finalLadder: exhaustedLadder,
        })
      );

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.escalated).toBe(true);
    });

    it('should mark fallbackSanctioned=true on a non-connectivity failure', async () => {
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'failed',
          passed: false,
          failedStageIndex: 1,
          greenObserved: false,
          finalLadder: okLadder,
          failure: { gate: 'test', message: 'tests failed', output: 'AssertionError: expected 1' },
        })
      );

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.status).toBe('failed');
      expect(result.fallbackSanctioned).toBe(true);
    });

    it('should mark fallbackSanctioned=false on a connectivity failure (hard-stop)', async () => {
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'failed',
          passed: false,
          failedStageIndex: 1,
          greenObserved: false,
          finalLadder: okLadder,
          failure: { gate: 'drive', message: 'drive failed', output: '[rung:ollama] fetch failed' },
        })
      );

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.status).toBe('failed');
      expect(result.fallbackSanctioned).toBe(false);
    });

    it('should mark fallbackSanctioned=false on a completed run', async () => {
      runPipelineMock.mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.status).toBe('completed');
      expect(result.fallbackSanctioned).toBe(false);
    });

    it('should classify an expired/invalid API key as auth and HARD-STOP (not a sanctioned fallback)', async () => {
      // The phase-2 root cause: an expired OpenRouter key. A 401 must NOT become
      // a silent Claude fallback — it is an infra hard-stop with an actionable error.
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'failed',
          passed: false,
          failedStageIndex: 1,
          greenObserved: false,
          finalLadder: okLadder,
          failure: {
            gate: 'drive',
            message: 'drive failed',
            output: '[rung:ollama] AI_APICallError: 401 No auth credentials found',
          },
        })
      );

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.status).toBe('failed');
      expect(result.failureClass).toBe('auth');
      expect(result.fallbackSanctioned).toBe(false);
      expect(result.error).toContain('auth-error');
    });

    it('should fatal-fail without invoking a model when targetFiles is empty', async () => {
      const result = await runAgentLoop(makeSpec({ targetFiles: [] }), makeImplDeps());

      expect(result.status).toBe('failed');
      expect(result.failureClass).toBe('fatal');
      expect(result.fallbackSanctioned).toBe(false);
      expect(result.escalated).toBe(false);
      expect(runPipelineMock).not.toHaveBeenCalled();
      expect(createModelMock).not.toHaveBeenCalled();
    });

    it('should record telemetry for an empty-footprint fatal run', async () => {
      const recordRun = vi.fn();
      const close = vi.fn();
      openTelemetryMock.mockReturnValue({ recordRun, recordAttempt: vi.fn(), close });

      await runAgentLoop(makeSpec({ targetFiles: [] }), makeImplDeps());

      expect(recordRun).toHaveBeenCalledTimes(1);
    });

    it('should carry the target file count on an over-limit footprint fatal run', async () => {
      const overLimit = Array.from({ length: 51 }, (_, i) => `f${i}.ts`);
      const result = await runAgentLoop(makeSpec({ targetFiles: overLimit }), makeImplDeps());

      expect(result.failureClass).toBe('fatal');
      expect(result.targetFileCount).toBe(51);
    });

    it('should set targetFileCount and failedStage on a normal failed run', async () => {
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'failed',
          passed: false,
          failedStageIndex: 1,
          failedStage: lintStage,
          greenObserved: false,
          finalLadder: okLadder,
          failure: { gate: 'test', message: 'tests failed', output: 'AssertionError: expected 1' },
        })
      );

      const result = await runAgentLoop(makeSpec({ targetFiles: ['a.ts', 'b.ts'] }), makeImplDeps());

      expect(result.targetFileCount).toBe(2);
      // impl pipeline index 1 = lintStage → 'lint'
      expect(result.failedStage).toBe('lint');
    });

    it('should omit failedStage on a completed run', async () => {
      runPipelineMock.mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec({ targetFiles: ['a.ts'] }), makeImplDeps());

      expect(result.targetFileCount).toBe(1);
      expect(result.failedStage).toBeUndefined();
    });

    it('should tag a non-connectivity stall as failureClass no-progress (sanctioned)', async () => {
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'failed',
          passed: false,
          failedStageIndex: 1,
          greenObserved: false,
          finalLadder: okLadder,
          failure: { gate: 'test', message: 'tests failed', output: 'AssertionError: expected 1' },
        })
      );

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.failureClass).toBe('no-progress');
      expect(result.fallbackSanctioned).toBe(true);
    });

    it('should NOT classify a test-gate failure whose output contains "timeout" as connectivity', async () => {
      // Regression: a non-drive (test/red) gate failure carries captured
      // test-runner output that routinely contains "timeout" (a CONNECTIVITY
      // marker). It MUST classify off the stall/gate signals, never connectivity.
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'failed',
          passed: false,
          failedStageIndex: 1,
          greenObserved: false,
          finalLadder: okLadder,
          failure: {
            gate: 'test',
            message: 'tests pass before RED phase — write a NEW failing test for the target',
            output: 'Test timeout of 5000ms exceeded\n  at red.test.ts:12',
          },
        })
      );

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.failureClass).not.toBe('connectivity');
      expect(result.failureClass).toBe('no-progress');
      expect(result.fallbackSanctioned).toBe(true);
      expect(result.error).toContain('no-progress');
    });

    it('should still classify a drive-gate failure with a real connectivity marker as connectivity', async () => {
      runPipelineMock.mockResolvedValue(
        makePipelineResult({
          status: 'failed',
          passed: false,
          failedStageIndex: 1,
          greenObserved: false,
          finalLadder: okLadder,
          failure: {
            gate: 'drive',
            message: 'drive failed',
            output: '[rung:openrouter] fetch failed: ECONNRESET',
          },
        })
      );

      const result = await runAgentLoop(makeSpec(), makeImplDeps());

      expect(result.failureClass).toBe('connectivity');
      expect(result.fallbackSanctioned).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Honest mutation tracking + revert-on-failure: touchedFiles reflects what the
  // mutating tools actually changed; a non-completed run reverts those mutations.
  // -------------------------------------------------------------------------
  describe('mutation tracking + revert-on-failure', () => {
    const failedPipeline = (): PipelineResult =>
      makePipelineResult({
        status: 'failed',
        passed: false,
        failedStageIndex: 1,
        greenObserved: false,
        finalLadder: okLadder,
        failure: { gate: 'test', message: 'tests failed', output: 'AssertionError' },
      });

    it('should report touchedFiles from the tracker mutatedFiles, not the declared targets', async () => {
      createMutationTrackerMock.mockReturnValue(makeFakeTracker(['actual.ts']));
      runPipelineMock.mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec({ targetFiles: ['declared.ts'] }), makeImplDeps());

      expect(result.touchedFiles).toEqual(['actual.ts']);
    });

    it('should revert mutations when the run does not complete', async () => {
      const tracker = makeFakeTracker(['dirty.ts']);
      createMutationTrackerMock.mockReturnValue(tracker);
      runPipelineMock.mockResolvedValue(failedPipeline());

      await runAgentLoop(makeSpec(), makeImplDeps());

      // best-of-N (default N=3) reverts each losing sample before the next plus
      // the final revert-on-failure, so the exact count varies — the contract is
      // that a non-completed run DOES revert its mutations.
      expect(tracker.revert).toHaveBeenCalled();
    });

    it('should NOT revert mutations when the run completes', async () => {
      const tracker = makeFakeTracker(['kept.ts']);
      createMutationTrackerMock.mockReturnValue(tracker);
      runPipelineMock.mockResolvedValue(makePipelineResult({ status: 'completed' }));

      await runAgentLoop(makeSpec(), makeImplDeps());

      expect(tracker.revert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Dirty-target-tree guard: the runner reverts mutated targets to the snapshot
  // captured at the FIRST edit. A target already dirty vs HEAD would snapshot the
  // corruption — so the guard hard-stops with a DISTINCT dirty-tree failure class
  // BEFORE any model/profile work, and never bills Claude.
  // -------------------------------------------------------------------------
  describe('dirty-target-tree guard', () => {
    afterEach(() => {
      execFileImpl.current = () => Promise.resolve({ stdout: '', stderr: '' });
    });

    // git diff --quiet HEAD exits 0 (clean) when no target differs.
    const gitClean = (): void => {
      execFileImpl.current = () => Promise.resolve({ stdout: '', stderr: '' });
    };
    // git diff --quiet HEAD exits 1 (dirty) when a target differs from HEAD.
    const gitDirty = (): void => {
      execFileImpl.current = () => Promise.reject({ code: 1 });
    };

    it('should fail with failureClass dirty-tree when a target is dirty vs HEAD', async () => {
      gitDirty();

      const result = await runAgentLoop(makeSpec({ targetFiles: ['corrupt.ts'] }), makeImplDeps());

      expect(result.status).toBe('failed');
      expect(result.failureClass).toBe('dirty-tree');
    });

    it('should NOT sanction a Claude fallback on a dirty-tree hard-stop', async () => {
      gitDirty();

      const result = await runAgentLoop(makeSpec({ targetFiles: ['corrupt.ts'] }), makeImplDeps());

      expect(result.fallbackSanctioned).toBe(false);
      expect(result.escalated).toBe(false);
    });

    it('should list the dirty file in the error message', async () => {
      gitDirty();

      const result = await runAgentLoop(makeSpec({ targetFiles: ['corrupt.ts'] }), makeImplDeps());

      expect(result.error).toContain('dirty-tree');
      expect(result.error).toContain('corrupt.ts');
    });

    it('should not invoke any model or profile work when a target is dirty', async () => {
      gitDirty();

      await runAgentLoop(makeSpec({ targetFiles: ['corrupt.ts'] }), makeImplDeps());

      expect(resolveProfileMock).not.toHaveBeenCalled();
      expect(runPipelineMock).not.toHaveBeenCalled();
      expect(createModelMock).not.toHaveBeenCalled();
    });

    it('should proceed past the guard to the normal path when targets are clean', async () => {
      gitClean();
      runPipelineMock.mockResolvedValue(makePipelineResult({ status: 'completed' }));

      const result = await runAgentLoop(makeSpec({ targetFiles: ['clean.ts'] }), makeImplDeps());

      expect(result.failureClass).not.toBe('dirty-tree');
      expect(runPipelineMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // checkTargetsClean — pure verdict over an injected git `run` seam. Fires a
  // dirty verdict ONLY on a definite exit-1; an unverifiable exit (128 = not a
  // git repo / no HEAD, spawn failure) is treated as clean (never block).
  // -------------------------------------------------------------------------
  describe('checkTargetsClean', () => {
    const run = (exitCode: number): ((argv: string[]) => Promise<{ exitCode: number }>) =>
      vi.fn(() => Promise.resolve({ exitCode }));

    it('should report clean when no target files are given', async () => {
      const verdict = await checkTargetsClean([], run(1));
      expect(verdict.clean).toBe(true);
    });

    it('should report clean when git diff exits 0', async () => {
      const verdict = await checkTargetsClean(['a.ts'], run(0));
      expect(verdict.clean).toBe(true);
    });

    it('should report dirty when git diff exits 1', async () => {
      const verdict = await checkTargetsClean(['a.ts'], run(1));
      expect(verdict.clean).toBe(false);
    });

    it('should treat an unverifiable exit 128 (not a git repo) as clean', async () => {
      const verdict = await checkTargetsClean(['a.ts'], run(128));
      expect(verdict.clean).toBe(true);
    });

    it('should not throw at the call site when targets are clean (exit 0)', async () => {
      await expect(checkTargetsClean(['a.ts'], run(0))).resolves.toBeDefined();
    });
  });

  describe('DirtyTreeError', () => {
    it('should carry the dirty file list', () => {
      const err = new DirtyTreeError(['x.ts', 'y.ts']);
      expect(err).toBeInstanceOf(Error);
      expect(err.files).toEqual(['x.ts', 'y.ts']);
    });
  });

  // -------------------------------------------------------------------------
  // defaultRunTests — infra (spawn) failure MUST surface as a thrown fatal error,
  // not a { passed:false } test verdict that burns escalation-ladder rungs.
  // -------------------------------------------------------------------------
  describe('defaultRunTests spawn-vs-test-failure', () => {
    const spec = makeSpec();

    afterEach(() => {
      execFileImpl.current = () => Promise.resolve({ stdout: '', stderr: '' });
    });

    it('should throw when the vitest binary cannot be spawned (ENOENT)', async () => {
      execFileImpl.current = () => Promise.reject({ code: 'ENOENT' });
      const run = defaultRunTests(spec);

      await expect(run()).rejects.toThrow(/failed to spawn/);
    });

    it('should throw when execFile rejects with no code and no captured stdio', async () => {
      execFileImpl.current = () => Promise.reject({});
      const run = defaultRunTests(spec);

      await expect(run()).rejects.toThrow(/failed to spawn/);
    });

    it('should return passed:false for a numeric non-zero exit with output (real test failure)', async () => {
      execFileImpl.current = () =>
        Promise.reject({ code: 1, stdout: 'FAIL src/a.test.ts', stderr: '1 failed' });
      const run = defaultRunTests(spec);

      const result = await run();

      expect(result.passed).toBe(false);
      expect(result.noTests).toBe(false);
      expect(result.output).toContain('FAIL src/a.test.ts');
    });

    it('should return passed:true when the vitest run succeeds', async () => {
      execFileImpl.current = () => Promise.resolve({ stdout: 'PASS', stderr: '' });
      const run = defaultRunTests(spec);

      const result = await run();

      expect(result.passed).toBe(true);
      expect(result.noTests).toBe(false);
    });

    it('should return noTests:true when vitest exits 0 with "No test files found" in output', async () => {
      execFileImpl.current = () =>
        Promise.resolve({ stdout: 'No test files found, exiting with code 0', stderr: '' });
      const run = defaultRunTests(spec);

      const result = await run();

      expect(result.passed).toBe(true);
      expect(result.noTests).toBe(true);
    });

    it('should return noTests:false when vitest exits 0 with normal passing output', async () => {
      execFileImpl.current = () =>
        Promise.resolve({ stdout: '✓ src/foo.test.ts (3 tests)', stderr: '' });
      const run = defaultRunTests(spec);

      const result = await run();

      expect(result.noTests).toBe(false);
    });
  });
});

interface StageContextLike {
  readonly driveTest: () => Promise<void>;
  readonly driveCode: () => Promise<void>;
}

describe('buildSystemPrompt', () => {
  const spec: TaskSpec = {
    agentType: 'code-logic-writer',
    navBundlePath: 'nav.json',
    targetFiles: ['a.ts'],
  };
  const rules = 'RULESBODY';

  it('should start with the authority preamble', () => {
    const result = buildSystemPrompt(spec, spec.agentType, rules);
    expect(result.startsWith('You are an expert TypeScript engineer')).toBe(true);
  });

  it('should contain automated gates warning text', () => {
    const result = buildSystemPrompt(spec, spec.agentType, rules);
    expect(result).toContain('Automated gates');
    expect(result).toContain('FAIL the run');
  });

  it('should defer generic workflow guidance to the authoritative task kickoff', () => {
    const result = buildSystemPrompt(spec, spec.agentType, rules);
    expect(result).toContain('kickoff is authoritative');
  });

  it('should label the prompt with the explicit role param, not the spec agentType', () => {
    const result = buildSystemPrompt(spec, 'ts-test-writer', rules);
    expect(result).toContain('Agent ts-test-writer');
    expect(result).not.toContain('Agent code-logic-writer');
  });

  it('should still contain the target files from the original body', () => {
    const result = buildSystemPrompt(spec, spec.agentType, rules);
    expect(result).toContain('Targets: a.ts');
  });

  it('should still contain the rules section with the provided condensed rules', () => {
    const result = buildSystemPrompt(spec, spec.agentType, rules);
    expect(result).toContain('Rules:\nRULESBODY');
  });

  it('should omit the existing-tests block when existingTests is absent', () => {
    const result = buildSystemPrompt(spec, spec.agentType, rules);
    expect(result).not.toContain('Existing tests');
  });

  it('should omit the existing-tests block when every tree is empty', () => {
    const withEmpty: TaskSpec = {
      ...spec,
      existingTests: [{ path: 'src/x.test.ts', describeItTree: [] }],
    };
    const result = buildSystemPrompt(withEmpty, spec.agentType, rules);
    expect(result).not.toContain('Existing tests');
  });

  it('should include the block, path, and tree lines when existingTests is present', () => {
    const withTests: TaskSpec = {
      ...spec,
      existingTests: [
        { path: 'src/x.test.ts', describeItTree: ['describe X', '  it does Y'] },
      ],
    };
    const result = buildSystemPrompt(withTests, spec.agentType, rules);
    expect(result).toContain('Existing tests — EXTEND these files');
    expect(result).toContain('src/x.test.ts:');
    expect(result).toContain('describe X');
    expect(result).toContain('  it does Y');
  });

  it('should place the existing-tests block between Targets and Rules', () => {
    const withTests: TaskSpec = {
      ...spec,
      existingTests: [{ path: 'src/x.test.ts', describeItTree: ['describe X'] }],
    };
    const result = buildSystemPrompt(withTests, spec.agentType, rules);
    const targetsIdx = result.indexOf('Targets:');
    const blockIdx = result.indexOf('Existing tests');
    const rulesIdx = result.indexOf('Rules:');
    expect(targetsIdx).toBeLessThan(blockIdx);
    expect(blockIdx).toBeLessThan(rulesIdx);
  });

  it('should cap the total projected tree lines at 80 with a +N more marker', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `  it case ${i}`);
    const withTests: TaskSpec = {
      ...spec,
      existingTests: [{ path: 'src/big.test.ts', describeItTree: lines }],
    };
    const result = buildSystemPrompt(withTests, spec.agentType, rules);
    expect(result).toContain('  it case 79');
    expect(result).not.toContain('  it case 80');
    expect(result).toContain('… (+20 more)');
  });

  it('should be byte-identical to the 3-arg form when extraDirective is empty string', () => {
    const threeArg = buildSystemPrompt(spec, spec.agentType, rules);
    const fourArg = buildSystemPrompt(spec, spec.agentType, rules, '');
    expect(fourArg).toBe(threeArg);
  });

  it('should append extraDirective after the rules block when provided', () => {
    const directive = '\n\nLarge-file edit guidance: use the edit tool.';
    const result = buildSystemPrompt(spec, spec.agentType, rules, directive);
    const rulesIdx = result.indexOf('Rules:\nRULESBODY');
    const directiveIdx = result.indexOf('Large-file edit guidance');
    expect(rulesIdx).toBeGreaterThanOrEqual(0);
    expect(directiveIdx).toBeGreaterThan(rulesIdx);
  });
});

describe('buildSpecExcerptsBlock', () => {
  it('should return empty string when excerpts is undefined', () => {
    expect(buildSpecExcerptsBlock(undefined)).toBe('');
  });

  it('should return empty string when excerpts is empty array', () => {
    expect(buildSpecExcerptsBlock([])).toBe('');
  });

  it('should render header and joined excerpt lines when excerpts are present', () => {
    const result = buildSpecExcerptsBlock(['FR-01: The system shall...', 'FR-02: The user can...']);
    expect(result).toContain('Spec excerpts — the requirement text for this task:');
    expect(result).toContain('FR-01: The system shall...');
    expect(result).toContain('FR-02: The user can...');
  });

  it('should place excerpts block before Rules in buildSystemPrompt output', () => {
    const specWithExcerpts: TaskSpec = {
      agentType: 'code-logic-writer',
      navBundlePath: 'nav.json',
      targetFiles: ['a.ts'],
      specExcerpts: ['FR-01: The system shall persist the result.'],
    };
    const result = buildSystemPrompt(specWithExcerpts, specWithExcerpts.agentType, 'RULES');
    const excerptsIdx = result.indexOf('Spec excerpts');
    const rulesIdx = result.indexOf('Rules:');
    expect(excerptsIdx).toBeGreaterThanOrEqual(0);
    expect(excerptsIdx).toBeLessThan(rulesIdx);
  });

  it('should produce identical output to no-excerpts form when specExcerpts is absent', () => {
    const base: TaskSpec = { agentType: 'code-logic-writer', navBundlePath: 'nav.json', targetFiles: ['a.ts'] };
    const withUndefined: TaskSpec = { ...base, specExcerpts: undefined };
    expect(buildSystemPrompt(base, base.agentType, 'RULES')).toBe(
      buildSystemPrompt(withUndefined, withUndefined.agentType, 'RULES')
    );
  });
});

// ---------------------------------------------------------------------------
// buildRequirementDetailsBlock
// ---------------------------------------------------------------------------

describe('buildRequirementDetailsBlock', () => {
  it('should return empty string when details is undefined', () => {
    expect(buildRequirementDetailsBlock(undefined)).toBe('');
  });

  it('should return empty string when details is empty array', () => {
    expect(buildRequirementDetailsBlock([])).toBe('');
  });

  it('should render header and detail lines when details are present', () => {
    const result = buildRequirementDetailsBlock([
      'Requirement: FR-01\nOutcome: persists result',
    ]);
    expect(result).toContain(
      'Requirement detail (what to build — implement to satisfy this):'
    );
    expect(result).toContain('Requirement: FR-01');
    expect(result).toContain('Outcome: persists result');
  });

  it('should place requirement-details block before Rules in buildSystemPrompt output', () => {
    const spec: TaskSpec = {
      agentType: 'code-logic-writer',
      navBundlePath: 'nav.json',
      targetFiles: ['a.ts'],
      requirementDetails: ['Requirement: FR-01\nOutcome: do the thing'],
    };
    const result = buildSystemPrompt(spec, spec.agentType, 'RULES');
    const detailsIdx = result.indexOf('Requirement detail');
    const rulesIdx = result.indexOf('Rules:');
    expect(detailsIdx).toBeGreaterThanOrEqual(0);
    expect(detailsIdx).toBeLessThan(rulesIdx);
  });

  it('should produce identical output to no-details form when requirementDetails is absent', () => {
    const base: TaskSpec = {
      agentType: 'code-logic-writer',
      navBundlePath: 'nav.json',
      targetFiles: ['a.ts'],
    };
    const withUndefined: TaskSpec = { ...base, requirementDetails: undefined };
    expect(buildSystemPrompt(base, base.agentType, 'RULES')).toBe(
      buildSystemPrompt(withUndefined, withUndefined.agentType, 'RULES')
    );
  });
});

// ---------------------------------------------------------------------------
// buildPlanRowsBlock
// ---------------------------------------------------------------------------

describe('buildPlanRowsBlock', () => {
  it('should return empty string when rows is undefined', () => {
    expect(buildPlanRowsBlock(undefined)).toBe('');
  });

  it('should return empty string when rows is empty array', () => {
    expect(buildPlanRowsBlock([])).toBe('');
  });

  it('should render header and row lines when rows are present', () => {
    const result = buildPlanRowsBlock(['| src/a.ts | store | Feature A |']);
    expect(result).toContain(
      'Placement & behavior guidance (where this goes / what it must do):'
    );
    expect(result).toContain('| src/a.ts | store | Feature A |');
  });

  it('should place plan-rows block before Rules in buildSystemPrompt output', () => {
    const spec: TaskSpec = {
      agentType: 'code-logic-writer',
      navBundlePath: 'nav.json',
      targetFiles: ['a.ts'],
      planRows: ['| src/a.ts | store | Feature A |'],
    };
    const result = buildSystemPrompt(spec, spec.agentType, 'RULES');
    const planIdx = result.indexOf('Placement & behavior guidance');
    const rulesIdx = result.indexOf('Rules:');
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeLessThan(rulesIdx);
  });

  it('should produce identical output to no-rows form when planRows is absent', () => {
    const base: TaskSpec = {
      agentType: 'code-logic-writer',
      navBundlePath: 'nav.json',
      targetFiles: ['a.ts'],
    };
    const withUndefined: TaskSpec = { ...base, planRows: undefined };
    expect(buildSystemPrompt(base, base.agentType, 'RULES')).toBe(
      buildSystemPrompt(withUndefined, withUndefined.agentType, 'RULES')
    );
  });
});

describe('buildCollaboratorsBlock', () => {
  it('should return an empty string when collaborators is undefined', () => {
    expect(buildCollaboratorsBlock(undefined)).toBe('');
  });

  it('should return an empty string when signatures are empty and siblingBody is null', () => {
    expect(buildCollaboratorsBlock({ signatures: [], siblingBody: null })).toBe('');
  });

  it('should render signatures section with header and one name:signature line per entry', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'persistActiveRun', signature: '(): Promise<void>' }],
      siblingBody: null,
    });

    expect(result).toContain(
      'Collaborators — call these with their real signatures; do not invent or re-implement:'
    );
    expect(result).toContain('persistActiveRun: (): Promise<void>');
  });

  it('should render sibling section with header and body when siblingBody is present', () => {
    const result = buildCollaboratorsBlock({
      signatures: [],
      siblingBody: { name: 'getEvalComparisonPrompt', body: 'getEvalComparisonPrompt: (x) => x' },
    });

    expect(result).toContain(
      'Nearest existing sibling action (mirror its shape; do not copy verbatim):'
    );
    expect(result).toContain('getEvalComparisonPrompt: (x) => x');
  });

  it('should prefix the block with two newlines', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'fn', signature: '(): void' }],
      siblingBody: null,
    });

    expect(result.startsWith('\n\n')).toBe(true);
  });

  it('should render signatures-only block without sibling section when siblingBody is null', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'fn', signature: '(): void' }],
      siblingBody: null,
    });

    expect(result).toContain('fn: (): void');
    expect(result).not.toContain('Nearest existing sibling');
  });

  it('should render sibling-only block without signatures section when signatures are empty', () => {
    const result = buildCollaboratorsBlock({
      signatures: [],
      siblingBody: { name: 'doThing', body: 'doThing: () => {}' },
    });

    expect(result).toContain('Nearest existing sibling action');
    expect(result).toContain('doThing: () => {}');
    expect(result).not.toContain('do not invent or re-implement');
  });

  it('should cap sibling body at MAX_SIBLING_BODY_LINES lines and append truncation marker', () => {
    const longBody = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const result = buildCollaboratorsBlock({
      signatures: [],
      siblingBody: { name: 'bigFn', body: longBody },
    });

    expect(result).toContain('line 39');
    expect(result).not.toContain('line 40');
    expect(result).toContain('\n…(truncated)');
  });

  it('should not append truncation marker when body is within the line limit', () => {
    const body = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const result = buildCollaboratorsBlock({
      signatures: [],
      siblingBody: { name: 'fn', body },
    });

    expect(result).not.toContain('…(truncated)');
  });

  it('should render multiple signatures each on their own line', () => {
    const result = buildCollaboratorsBlock({
      signatures: [
        { name: 'fnA', signature: '(a: string): void' },
        { name: 'fnB', signature: '(): number' },
      ],
      siblingBody: null,
    });

    expect(result).toContain('fnA: (a: string): void');
    expect(result).toContain('fnB: (): number');
  });

  it('should render the type-shapes section with header and one Name = shape line per entry', () => {
    const result = buildCollaboratorsBlock({
      signatures: [],
      siblingBody: null,
      typeShapes: [
        { name: 'ComparisonRequest', shape: '{ userPrompt: string }' },
        { name: 'EvalComparisonDTO', shape: '{ winnerCellId: string }' },
      ],
    });

    expect(result).toContain('Type shapes — construct/read these with the correct fields:');
    expect(result).toContain('ComparisonRequest = { userPrompt: string }');
    expect(result).toContain('EvalComparisonDTO = { winnerCellId: string }');
  });

  it('should render the import path as (from \'...\') when a type shape has importPath', () => {
    const result = buildCollaboratorsBlock({
      signatures: [],
      siblingBody: null,
      typeShapes: [
        {
          name: 'ComparisonRequest',
          shape: '{ userPrompt: string }',
          importPath: '@/domain/comparison',
        },
        { name: 'EvalComparisonDTO', shape: '{ winnerCellId: string }' },
      ],
    });

    expect(result).toContain(
      'ComparisonRequest (from \'@/domain/comparison\') = { userPrompt: string }'
    );
    expect(result).toContain('EvalComparisonDTO = { winnerCellId: string }');
  });

  it('should omit the type-shapes section when typeShapes is empty', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'fn', signature: '(): void' }],
      siblingBody: null,
      typeShapes: [],
    });

    expect(result).not.toContain('Type shapes');
  });

  it('should omit the type-shapes section when typeShapes is absent', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'fn', signature: '(): void' }],
      siblingBody: null,
    });

    expect(result).not.toContain('Type shapes');
  });

  it('should place the type-shapes section after signatures and before the sibling body', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'fn', signature: '(): void' }],
      siblingBody: { name: 'sib', body: 'sib: () => {}' },
      typeShapes: [{ name: 'ComparisonRequest', shape: '{ userPrompt: string }' }],
    });

    const sigIdx = result.indexOf('do not invent or re-implement');
    const shapeIdx = result.indexOf('Type shapes — construct/read these');
    const sibIdx = result.indexOf('Nearest existing sibling action');
    expect(sigIdx).toBeGreaterThanOrEqual(0);
    expect(shapeIdx).toBeGreaterThan(sigIdx);
    expect(sibIdx).toBeGreaterThan(shapeIdx);
  });

  it('should render a type-only Required imports group as an import type statement', () => {
    const result = buildCollaboratorsBlock({
      signatures: [],
      siblingBody: null,
      typeShapes: [
        { name: 'ComparisonRequest', shape: '{}', importPath: '@/lib/judge-prompt' },
        { name: 'ComparisonOutput', shape: '{}', importPath: '@/lib/judge-prompt' },
      ],
    });

    expect(result).toContain(
      'Required imports — ensure these exact lines exist in the target file\'s top import block (add any that are missing; do not duplicate existing ones):'
    );
    expect(result).toContain(
      'import type { ComparisonRequest, ComparisonOutput } from \'@/lib/judge-prompt\';'
    );
  });

  it('should merge a type import and a value import from the same path into one line', () => {
    const result = buildCollaboratorsBlock({
      signatures: [
        {
          name: 'evaluateComparison',
          signature: '(from \'@/lib/judge-evaluator\') evaluateComparison(req: R): Promise<D>',
        },
      ],
      siblingBody: null,
      typeShapes: [{ name: 'JudgeConfig', shape: '{}', importPath: '@/lib/judge-evaluator' }],
    });

    expect(result).toContain(
      'import { evaluateComparison, type JudgeConfig } from \'@/lib/judge-evaluator\';'
    );
  });

  it('should render a value-only Required imports group when no matching typeShape exists', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'buildX', signature: '(from \'@/lib/x\') buildX(): void' }],
      siblingBody: null,
    });

    expect(result).toContain('import { buildX } from \'@/lib/x\';');
  });

  it('should skip a signature without a (from \'...\') prefix and omit the Required imports header', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'persistActiveRun', signature: '(): Promise<void>' }],
      siblingBody: null,
    });

    expect(result).not.toContain('Required imports —');
    expect(result).toContain('persistActiveRun: (): Promise<void>');
  });

  it('should skip a typeShape with no importPath and omit the Required imports header', () => {
    const result = buildCollaboratorsBlock({
      signatures: [],
      siblingBody: null,
      typeShapes: [{ name: 'Foo', shape: '{}' }],
    });

    expect(result).not.toContain('Required imports —');
  });

  it('should place the Required imports header before the signatures header when both present', () => {
    const result = buildCollaboratorsBlock({
      signatures: [{ name: 'buildX', signature: '(from \'@/lib/x\') buildX(): void' }],
      siblingBody: null,
    });

    const requiredIdx = result.indexOf('Required imports —');
    const sigIdx = result.indexOf('Collaborators — call these with their real signatures');
    expect(requiredIdx).toBeGreaterThanOrEqual(0);
    expect(sigIdx).toBeGreaterThan(requiredIdx);
  });
});

describe('buildSystemPrompt with collaborators', () => {
  const baseSpec: TaskSpec = {
    agentType: 'code-logic-writer',
    navBundlePath: 'nav.json',
    targetFiles: ['a.ts'],
  };
  const rules = 'RULESBODY';

  it('should include collaborators block between existing-tests block and Rules when both present', () => {
    const spec: TaskSpec = {
      ...baseSpec,
      existingTests: [{ path: 'src/x.test.ts', describeItTree: ['describe X'] }],
      collaborators: {
        signatures: [{ name: 'doIt', signature: '(): void' }],
        siblingBody: null,
      },
    };
    const result = buildSystemPrompt(spec, spec.agentType, rules);

    const existingIdx = result.indexOf('Existing tests');
    const collabIdx = result.indexOf('Collaborators —');
    const rulesIdx = result.indexOf('Rules:');
    expect(existingIdx).toBeGreaterThan(-1);
    expect(collabIdx).toBeGreaterThan(existingIdx);
    expect(collabIdx).toBeLessThan(rulesIdx);
  });

  it('should include collaborators block before Rules when existingTests is absent', () => {
    const spec: TaskSpec = {
      ...baseSpec,
      collaborators: {
        signatures: [{ name: 'doIt', signature: '(): void' }],
        siblingBody: null,
      },
    };
    const result = buildSystemPrompt(spec, spec.agentType, rules);

    const collabIdx = result.indexOf('Collaborators —');
    const rulesIdx = result.indexOf('Rules:');
    expect(collabIdx).toBeGreaterThan(-1);
    expect(collabIdx).toBeLessThan(rulesIdx);
  });

  it('should not include a collaborators block when collaborators is absent', () => {
    const result = buildSystemPrompt(baseSpec, baseSpec.agentType, rules);

    expect(result).not.toContain('Collaborators');
    expect(result).not.toContain('Nearest existing sibling');
  });

  it('should not include a collaborators block when collaborators has empty signatures and null siblingBody', () => {
    const spec: TaskSpec = {
      ...baseSpec,
      collaborators: { signatures: [], siblingBody: null },
    };
    const result = buildSystemPrompt(spec, spec.agentType, rules);

    expect(result).not.toContain('Collaborators');
  });
});

describe('ROLE_PROFILES', () => {
  it('should map ui-writer to ts-test-writer with structuralGates disabled', () => {
    expect(ROLE_PROFILES['ui-writer']).toStrictEqual({
      testRole: 'ts-test-writer',
      structuralGates: false,
    });
  });

  it('should map code-logic-writer to ts-test-writer with structuralGates enabled', () => {
    expect(ROLE_PROFILES['code-logic-writer']).toStrictEqual({
      testRole: 'ts-test-writer',
      structuralGates: true,
    });
  });

  it('should provide a profile for every supported agent type', () => {
    expect(Object.keys(ROLE_PROFILES).sort()).toStrictEqual([
      'code-logic-writer',
      'lint-fix-loop',
      'ts-test-writer',
      'ui-writer',
    ]);
  });
});

describe('buildOutcome feedback routing', () => {
  const ladder: LadderState = initLadder();
  const failedAt = (failedStageIndex: number): PipelineResult => ({
    status: 'failed',
    passed: false,
    redObserved: false,
    greenObserved: false,
    failedStageIndex,
    failure: { gate: 'test', message: 'boom', output: 'boom output' },
    finalLadder: ladder,
  });
  const passedPipeline: PipelineResult = {
    status: 'completed',
    passed: true,
    redObserved: true,
    greenObserved: true,
    failedStageIndex: undefined,
    finalLadder: ladder,
  };

  it('should append a conclusion with stage test when the red stage failed', async () => {
    const outcome = await buildOutcome(failedAt(0), {
      priorLedger: [],
      history: [],
      attempts: 1,
      aborted: false,
      redStageFailed: true,
    });
    expect(outcome.carry?.ledger).toHaveLength(1);
    expect(outcome.carry?.ledger[0]?.stage).toBe('test');
  });

  it('should append a conclusion with stage code when a non-red stage failed', async () => {
    const outcome = await buildOutcome(failedAt(2), {
      priorLedger: [],
      history: [],
      attempts: 1,
      aborted: false,
      redStageFailed: false,
    });
    expect(outcome.carry?.ledger).toHaveLength(1);
    expect(outcome.carry?.ledger[0]?.stage).toBe('code');
  });

  it('should preserve the prior ledger on a pipeline success', async () => {
    const priorLedger = [{ attempt: 1, stage: 'code' as const, signature: 'sig', note: 'note' }];
    const outcome = await buildOutcome(passedPipeline, {
      priorLedger,
      history: [],
      attempts: 2,
      aborted: false,
      redStageFailed: false,
    });
    expect(outcome.carry?.ledger).toBe(priorLedger);
  });

  it('should accumulate the ledger across multiple failures', async () => {
    const first = await buildOutcome(failedAt(2), {
      priorLedger: [],
      history: [],
      attempts: 1,
      aborted: false,
      redStageFailed: false,
    });
    const second = await buildOutcome(failedAt(2), {
      priorLedger: first.carry!.ledger,
      history: [],
      attempts: 2,
      aborted: false,
      redStageFailed: false,
    });
    expect(second.carry?.ledger).toHaveLength(2);
  });

  it('should still record noProgress when the same failure recurs', async () => {
    const first = await buildOutcome(failedAt(2), {
      priorLedger: [],
      history: [],
      attempts: 1,
      aborted: false,
      redStageFailed: false,
    });
    const second = await buildOutcome(failedAt(2), {
      priorLedger: first.carry!.ledger,
      history: first.carry!.history,
      attempts: 2,
      aborted: false,
      redStageFailed: false,
    });
    expect(second.noProgress).toBe(true);
  });

  it('should give a slice-mode code failure a submit_region retry directive', async () => {
    const outcome = await buildOutcome(failedAt(2), {
      priorLedger: [],
      history: [],
      attempts: 1,
      aborted: false,
      redStageFailed: false,
      fileContext: 'slice',
    });
    const note = outcome.carry?.ledger[0]?.note ?? '';
    expect(note).toContain('submit_region');
    expect(note).not.toContain('Read the current state');
  });
});

describe('resolveConclusionSummarizer', () => {
  const ENV_KEY = 'RUNNER_LLM_CONCLUSION';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
  });

  it('should return undefined when the env flag is unset', () => {
    const model = createModel({ backend: 'ollama', modelId: 'test', name: 'test' } as Parameters<typeof createModel>[0]);
    expect(resolveConclusionSummarizer(generate, model)).toBeUndefined();
  });

  it('should return undefined when the env flag is set to 0', () => {
    process.env[ENV_KEY] = '0';
    const model = createModel({ backend: 'ollama', modelId: 'test', name: 'test' } as Parameters<typeof createModel>[0]);
    expect(resolveConclusionSummarizer(generate, model)).toBeUndefined();
  });

  it('should return undefined when the env flag is set to false', () => {
    process.env[ENV_KEY] = 'false';
    const model = createModel({ backend: 'ollama', modelId: 'test', name: 'test' } as Parameters<typeof createModel>[0]);
    expect(resolveConclusionSummarizer(generate, model)).toBeUndefined();
  });

  it('should return a function when the env flag is set to 1', () => {
    process.env[ENV_KEY] = '1';
    const model = createModel({ backend: 'ollama', modelId: 'test', name: 'test' } as Parameters<typeof createModel>[0]);
    expect(resolveConclusionSummarizer(generate, model)).toBeTypeOf('function');
  });

  it('should return a function when the env flag is set to true', () => {
    process.env[ENV_KEY] = 'true';
    const model = createModel({ backend: 'ollama', modelId: 'test', name: 'test' } as Parameters<typeof createModel>[0]);
    expect(resolveConclusionSummarizer(generate, model)).toBeTypeOf('function');
  });

  it('should return a function when the env flag is set to TRUE (case-insensitive)', () => {
    process.env[ENV_KEY] = '  TRUE  ';
    const model = createModel({ backend: 'ollama', modelId: 'test', name: 'test' } as Parameters<typeof createModel>[0]);
    expect(resolveConclusionSummarizer(generate, model)).toBeTypeOf('function');
  });

  const makeFailure = (): { gate: string; message: string; output: string } => ({
    gate: 'tsc',
    message: 'boom',
    output: 'type error',
  });

  it('should call generate with an empty tool set when the summarizer runs', async () => {
    process.env[ENV_KEY] = '1';
    generateMock.mockResolvedValueOnce({ text: 'attempted x', toolCallCount: 0 });
    const model = createModel({ backend: 'ollama', modelId: 'test', name: 'test' } as Parameters<typeof createModel>[0]);
    const summarize = resolveConclusionSummarizer(generate, model);
    const note = await summarize?.(makeFailure() as Parameters<NonNullable<typeof summarize>>[0]);
    expect(note).toBe('attempted x');
    const req = generateMock.mock.calls.at(-1)?.[1];
    expect(req?.tools).toEqual({});
    expect(req?.maxSteps).toBe(1);
  });

  it('should prompt to summarize what was attempted, not why it failed', async () => {
    process.env[ENV_KEY] = '1';
    generateMock.mockResolvedValueOnce({ text: 's', toolCallCount: 0 });
    const model = createModel({ backend: 'ollama', modelId: 'test', name: 'test' } as Parameters<typeof createModel>[0]);
    const summarize = resolveConclusionSummarizer(generate, model);
    await summarize?.(makeFailure() as Parameters<NonNullable<typeof summarize>>[0]);
    const system = (generateMock.mock.calls.at(-1)?.[1]?.system ?? '').toLowerCase();
    expect(system).not.toContain('why it failed');
    expect(system).toContain('attempted');
  });
});

describe('resolveMaxSteps', () => {
  const ENV_KEY = 'RUNNER_MAX_STEPS';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
  });

  it('should default to 32 when the env var is unset', () => {
    expect(resolveMaxSteps()).toBe(32);
  });

  it('should honor a numeric env override', () => {
    process.env[ENV_KEY] = '12';
    expect(resolveMaxSteps()).toBe(12);
  });

  it('should floor a fractional override', () => {
    process.env[ENV_KEY] = '8.9';
    expect(resolveMaxSteps()).toBe(8);
  });

  it('should fall back to the default when the override is non-numeric', () => {
    process.env[ENV_KEY] = 'lots';
    expect(resolveMaxSteps()).toBe(32);
  });

  it('should fall back to the default when the override is below 1', () => {
    process.env[ENV_KEY] = '0';
    expect(resolveMaxSteps()).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// PURE: buildKickoff
// ---------------------------------------------------------------------------

describe('buildKickoff', () => {
  const BASE = 'Begin the task now.';

  it('should prepend Task: <statement> and two newlines when taskStatement is present', () => {
    // Arrange / Act
    const result = buildKickoff(BASE, 'Add runEvalComparison(runId)');

    // Assert
    expect(result).toBe('Task: Add runEvalComparison(runId)\n\nBegin the task now.');
  });

  it('should return the base prompt unchanged when taskStatement is undefined', () => {
    // Arrange / Act
    const result = buildKickoff(BASE, undefined);

    // Assert
    expect(result).toBe(BASE);
  });

  it('should return the base prompt unchanged when taskStatement is an empty string', () => {
    // Arrange / Act
    const result = buildKickoff(BASE, '');

    // Assert
    expect(result).toBe(BASE);
  });

  it('should return the base prompt unchanged when taskStatement is whitespace-only', () => {
    // Arrange / Act
    const result = buildKickoff(BASE, '   ');

    // Assert
    expect(result).toBe(BASE);
  });
});

// ---------------------------------------------------------------------------
// PURE: TDD_IMPL_KICKOFF_PROMPT content contract
// ---------------------------------------------------------------------------

describe('TDD_IMPL_KICKOFF_PROMPT', () => {
  it('should instruct implementing production code to pass the shown failing test', () => {
    expect(TDD_IMPL_KICKOFF_PROMPT).toMatch(/failing test.*shown below/i);
    expect(TDD_IMPL_KICKOFF_PROMPT).toMatch(/implement only the production code/i);
  });

  it('should forbid editing test files', () => {
    expect(TDD_IMPL_KICKOFF_PROMPT).toMatch(/do not.*test file/i);
  });

  it('should not contain the contradictory "Read the failing test first" instruction', () => {
    expect(TDD_IMPL_KICKOFF_PROMPT).not.toContain('Read the failing test first');
  });

  it('should reference the test as shown below so model does not need to read it', () => {
    expect(TDD_IMPL_KICKOFF_PROMPT).toContain('shown below');
  });

  it('should prepend task statement when passed through buildKickoff', () => {
    // Arrange / Act
    const result = buildKickoff(TDD_IMPL_KICKOFF_PROMPT, 'Add selectCodeKickoff helper');

    // Assert
    expect(result).toMatch(/^Task: Add selectCodeKickoff helper\n\n/);
    expect(result).toContain(TDD_IMPL_KICKOFF_PROMPT);
  });
});

// ---------------------------------------------------------------------------
// PURE: selectCodeKickoff — mode-based kickoff selection
// ---------------------------------------------------------------------------

describe('selectCodeKickoff', () => {
  it('should return TDD_IMPL_KICKOFF_PROMPT when mode is tdd', () => {
    expect(selectCodeKickoff('tdd')).toBe(TDD_IMPL_KICKOFF_PROMPT);
  });

  it('should return the generic KICKOFF_PROMPT when mode is impl', () => {
    const result = selectCodeKickoff('impl');
    expect(result).toMatch(/begin the task now/i);
    expect(result).not.toBe(TDD_IMPL_KICKOFF_PROMPT);
  });
});

// ---------------------------------------------------------------------------
// PURE: TEST_KICKOFF_PROMPT content contract
// ---------------------------------------------------------------------------

describe('TEST_KICKOFF_PROMPT (via buildTestKickoff base)', () => {
  it('should NOT contain the phrase "create the test file"', async () => {
    const base = await buildTestKickoff(undefined);
    expect(base).not.toMatch(/create the test file/i);
  });
});

// ---------------------------------------------------------------------------
// PURE: code-drive behavioral contract (authoritative preload + no-shell)
// ---------------------------------------------------------------------------

describe('code-drive kickoff behavioral contract', () => {
  it('should tell both code kickoffs the preload is authoritative — do not re-read', () => {
    for (const kickoff of [selectCodeKickoff('impl'), selectCodeKickoff('tdd')]) {
      expect(kickoff).toMatch(/authoritative/i);
      expect(kickoff).toMatch(/do not re-read/i);
    }
  });

  it('should tell both code kickoffs not to run tests, builds, or shell commands', () => {
    for (const kickoff of [selectCodeKickoff('impl'), selectCodeKickoff('tdd')]) {
      expect(kickoff).toMatch(/do not run tests, builds, or shell/i);
      expect(kickoff).toMatch(/harness automatically runs the full gate/i);
    }
  });

  it('should NOT add the no-shell / authoritative contract to the TEST kickoff', async () => {
    const testKickoff = await buildTestKickoff(undefined);
    expect(testKickoff).not.toMatch(/do not run tests, builds, or shell/i);
    expect(testKickoff).not.toMatch(/harness automatically runs the full gate/i);
  });
});

// ---------------------------------------------------------------------------
// PURE: buildTestKickoff — existing-test-aware kickoff builder
// ---------------------------------------------------------------------------

describe('buildTestKickoff', () => {
  it('should return the base prompt unchanged when existingTests is undefined', async () => {
    const result = await buildTestKickoff(undefined);
    expect(result).toMatch(/write a failing test/i);
    expect(result).not.toMatch(/do not create a new/i);
  });

  it('should return the base prompt unchanged when existingTests is empty', async () => {
    const result = await buildTestKickoff([]);
    expect(result).toMatch(/write a failing test/i);
    expect(result).not.toMatch(/do not create a new/i);
  });

  it('should name the existing path and forbid creating a new test file when one entry is present', async () => {
    const result = await buildTestKickoff([{ path: 'src/features/foo/__tests__/foo.test.ts' }]);
    expect(result).toMatch(/do not create a new.*\.test/i);
    expect(result).toContain('src/features/foo/__tests__/foo.test.ts');
  });

  it('should list multiple paths comma-separated when several existing tests are present', async () => {
    const result = await buildTestKickoff([
      { path: 'src/a.test.ts' },
      { path: 'src/b.test.ts' },
    ]);
    expect(result).toContain('src/a.test.ts');
    expect(result).toContain('src/b.test.ts');
    expect(result).toMatch(/src\/a\.test\.ts, src\/b\.test\.ts/);
  });

  it('should prepend task statement when passed through buildKickoff', async () => {
    const kickoff = await buildTestKickoff([{ path: 'src/foo.test.ts' }]);
    const result = buildKickoff(kickoff, 'Add runEvalComparison');
    expect(result).toMatch(/^Task: Add runEvalComparison\n\n/);
    expect(result).toContain('src/foo.test.ts');
  });

  it('should inject tail anchor from existingTests[0] in a fenced block via injectable reader', async () => {
    const fileBody = [
      'import { renderHook } from \'@testing-library/react\';',
      'import { useFoo } from \'./useFoo\';',
      '',
      'describe(\'useFoo\', () => {',
      '  it(\'should return initial state\', () => {',
      '    const { result } = renderHook(() => useFoo());',
      '    expect(result.current).toBeDefined();',
      '  });',
      '});',
    ].join('\n');
    const read = async (path: string): Promise<string | null> =>
      path === 'src/a.test.ts' ? fileBody : null;
    const result = await buildTestKickoff([{ path: 'src/a.test.ts' }, { path: 'src/b.test.ts' }], read);
    // Tail anchor block is present
    expect(result).toContain('To append safely, call the edit tool with this EXACT anchor');
    expect(result).toMatch(/```[\s\S]+```/);
    // Last 6 non-blank lines of the file appear in the tail block
    expect(result).toContain('describe(\'useFoo\', () => {');
    expect(result).toContain('renderHook(() => useFoo())');
    expect(result).toContain('});');
    // renderHook guidance line is present
    expect(result).toContain('renderHook(() => useX())');
    // Ambiguous anchor warning is present
    expect(result).toContain('A single `});` is an ambiguous anchor and will be rejected');
  });

  it('should include renderHook guidance and ambiguous-anchor warning when read returns null', async () => {
    const read = async (_path: string): Promise<string | null> => null;
    const result = await buildTestKickoff([{ path: 'src/a.test.ts' }], read);
    expect(result).toContain('renderHook(() => useX())');
    expect(result).not.toContain('To append safely');
    expect(result).not.toContain('```');
  });

  it('should inject tail of existingTests[0] only — not content from other test files', async () => {
    const contents: Readonly<Record<string, string>> = {
      'src/a.test.ts': 'line1\nline2\nline3\nline4\nline5\nline6\nline7\n',
      'src/b.test.ts': 'only_in_b\n',
    };
    const read = async (path: string): Promise<string | null> => contents[path] ?? null;
    const result = await buildTestKickoff([{ path: 'src/a.test.ts' }, { path: 'src/b.test.ts' }], read);
    // Tail of first file is injected
    expect(result).toContain('line2');
    // Content from the second file is NOT injected
    expect(result).not.toContain('only_in_b');
  });
});
