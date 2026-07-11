import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LadderState } from '../orchestration/escalation';
import {
  decompositionStage,
  greenStage,
  implStage,
  lintStage,
  type PipelineResult,
  redStage
} from '../orchestration/pipeline';
import {
  type AttemptCapture,
  captureAttempt,
  evalCaptureEnabled,
  resolveEvalRunDir,
  type RunSummary,
  writeRunSummary
} from './eval-capture';

const LADDER: LadderState = { rung: 'ollama', exhausted: false } as unknown as LadderState;

const passingPipeline = (): PipelineResult => ({
  status: 'completed',
  passed: true,
  redObserved: true,
  greenObserved: true,
  failedStageIndex: undefined,
  failedStage: undefined,
  failure: undefined,
  finalLadder: LADDER,
});

const failingPipeline = (): PipelineResult => ({
  status: 'failed',
  passed: false,
  redObserved: true,
  greenObserved: true,
  failedStageIndex: 3,
  failedStage: lintStage,
  failure: { gate: 'lint', message: 'lint failed', output: 'ESLint: 2 errors' },
  finalLadder: LADDER,
});

describe('evalCaptureEnabled', () => {
  it('should be true when RUNNER_EVAL_CAPTURE is "1"', () => {
    expect(evalCaptureEnabled({ RUNNER_EVAL_CAPTURE: '1' })).toBe(true);
  });

  it('should be false when RUNNER_EVAL_CAPTURE is unset', () => {
    expect(evalCaptureEnabled({})).toBe(false);
  });

  it('should be false when RUNNER_EVAL_CAPTURE is "0"', () => {
    expect(evalCaptureEnabled({ RUNNER_EVAL_CAPTURE: '0' })).toBe(false);
  });
});

describe('resolveEvalRunDir', () => {
  it('should compose the documented logs/runner-eval layout', () => {
    const dir = resolveEvalRunDir({
      cwd: '/work',
      navBundlePath: 'specs/045-foo/task-dag/nav/T003.json',
      timestamp: 1718900000000,
    });
    expect(dir).toBe(path.join('/work', 'logs', 'runner-eval', '045-T003-1718900000000'));
  });
});

describe('captureAttempt', () => {
  let cwd: string;
  let runDir: string;

  const baseCapture = (overrides: Partial<AttemptCapture> = {}): AttemptCapture => ({
    runDir,
    cwd,
    attempt: 1,
    rung: 'ollama',
    stages: [redStage, implStage, greenStage, lintStage, decompositionStage],
    pipeline: failingPipeline(),
    mutatedFiles: ['src/a.ts'],
    toolCalls: 4,
    durationMs: 1234,
    ...overrides,
  });

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'eval-capture-'));
    runDir = path.join(cwd, 'logs', 'runner-eval', '045-T003-111');
    writeFileSync(path.join(cwd, 'src-a.ts'), 'export const a = 1;\n');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('should write meta.json with the documented attempt shape', async () => {
    writeFileSync(path.join(cwd, 'a.ts'), 'x');
    await captureAttempt(baseCapture({ mutatedFiles: ['a.ts'] }));
    const meta = JSON.parse(readFileSync(path.join(runDir, 'attempt-1', 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({
      attempt: 1,
      rung: 'ollama',
      furthestStage: 'lint',
      failedStage: 'lint',
      gateName: 'lint',
      toolCalls: 4,
      durationMs: 1234,
    });
  });

  it('should write the failing gate output to gate-output.txt', async () => {
    await captureAttempt(baseCapture());
    const out = readFileSync(path.join(runDir, 'attempt-1', 'gate-output.txt'), 'utf8');
    expect(out).toContain('ESLint: 2 errors');
  });

  it('should copy each mutated file content into attempt-<n>/files', async () => {
    writeFileSync(path.join(cwd, 'a.ts'), 'export const a = 1;\n');
    await captureAttempt(baseCapture({ attempt: 2, mutatedFiles: ['a.ts'] }));
    const copied = readFileSync(path.join(runDir, 'attempt-2', 'files', 'a.ts'), 'utf8');
    expect(copied).toBe('export const a = 1;\n');
  });

  it('should report furthestStage as the last stage for a passing pipeline', async () => {
    await captureAttempt(baseCapture({ pipeline: passingPipeline(), mutatedFiles: [] }));
    const meta = JSON.parse(readFileSync(path.join(runDir, 'attempt-1', 'meta.json'), 'utf8'));
    expect(meta.furthestStage).toBe('decomposition');
    expect(meta.failedStage).toBeNull();
  });

  it('should never throw when a mutated file is missing', async () => {
    await expect(
      captureAttempt(baseCapture({ mutatedFiles: ['does-not-exist.ts'] }))
    ).resolves.toBeUndefined();
  });
});

describe('writeRunSummary', () => {
  let cwd: string;
  let runDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'eval-summary-'));
    runDir = path.join(cwd, 'logs', 'runner-eval', '045-T003-222');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('should write run.json with the documented run shape', async () => {
    const summary: RunSummary = {
      specId: '045',
      taskId: 'T003',
      modelId: 'qwen3',
      mode: 'tdd',
      status: 'failed',
      finalRung: 'openrouter',
      attempts: 3,
      totalTokens: 4200,
    };
    await writeRunSummary(runDir, summary);
    const parsed = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    expect(parsed).toEqual(summary);
  });

  it('should create no directory when called with a runDir that does not exist yet', async () => {
    await writeRunSummary(runDir, {
      specId: '045',
      taskId: 'T003',
      modelId: 'm',
      mode: 'impl',
      status: 'completed',
      finalRung: 'ollama',
      attempts: 1,
      totalTokens: 0,
    });
    expect(existsSync(path.join(runDir, 'run.json'))).toBe(true);
    expect(readdirSync(runDir)).toContain('run.json');
  });
});
