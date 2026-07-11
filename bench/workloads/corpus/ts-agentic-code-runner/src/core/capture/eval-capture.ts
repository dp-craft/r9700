import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { LadderState } from '../orchestration';
import { type PipelineResult, type Stage, STAGE_NAME } from '../orchestration';
import type { RunMode, RunStatus } from '../shared';
import { parseSpecId, parseTaskId, sanitizeModelId } from './failed-output';

const ENV_FLAG = 'RUNNER_EVAL_CAPTURE';

// Opt-in gate: capture only when the flag is exactly "1". Reading a passed env
// record (not process.env directly) keeps the resolver pure and testable.
export const evalCaptureEnabled = (env: NodeJS.ProcessEnv): boolean => env[ENV_FLAG] === '1';

export interface ResolveRunDirParams {
  readonly cwd: string;
  readonly navBundlePath: string;
  readonly timestamp: number;
}

export const resolveEvalRunDir = (params: ResolveRunDirParams): string => {
  const specId = parseSpecId(params.navBundlePath);
  const taskId = parseTaskId(params.navBundlePath);
  const dir = `${specId}-${taskId}-${params.timestamp}`;
  return path.join(params.cwd, 'logs', 'runner-eval', dir);
};

export interface AttemptCapture {
  readonly runDir: string;
  readonly cwd: string;
  readonly attempt: number;
  readonly rung: LadderState['rung'];
  readonly stages: readonly Stage[];
  readonly pipeline: PipelineResult;
  readonly mutatedFiles: readonly string[];
  readonly toolCalls: number;
  readonly durationMs: number;
}

const stageName = (stage: Stage | undefined): string | null =>
  stage === undefined ? null : (STAGE_NAME.get(stage) ?? 'unknown');

// The furthest stage reached: the failing stage when failed, else the last stage
// in the plan (a passing pipeline ran the whole sequence).
const furthestStageName = (capture: AttemptCapture): string | null => {
  if (capture.pipeline.failedStage !== undefined) {
    return stageName(capture.pipeline.failedStage);
  }
  return stageName(capture.stages.at(-1));
};

interface AttemptMeta {
  readonly attempt: number;
  readonly rung: LadderState['rung'];
  readonly furthestStage: string | null;
  readonly failedStage: string | null;
  readonly gateName: string | null;
  readonly toolCalls: number;
  readonly durationMs: number;
}

const buildMeta = (capture: AttemptCapture): AttemptMeta => ({
  attempt: capture.attempt,
  rung: capture.rung,
  furthestStage: furthestStageName(capture),
  failedStage: stageName(capture.pipeline.failedStage),
  gateName: capture.pipeline.failure?.gate ?? null,
  toolCalls: capture.toolCalls,
  durationMs: capture.durationMs,
});

const copyMutatedFile = async (file: string, capture: AttemptCapture, dir: string): Promise<void> => {
  try {
    const content = await readFile(path.resolve(capture.cwd, file), 'utf8');
    await writeFile(path.join(dir, path.basename(file)), content);
  } catch {
    return;
  }
};

// Side-effect boundary: snapshot one attempt's artifacts BEFORE the next attempt's
// revert discards them. Fully best-effort — any failure resolves silently so the
// pipeline is never disturbed (mirrors preserveFailedOutputs).
export const captureAttempt = async (capture: AttemptCapture): Promise<void> => {
  const attemptDir = path.join(capture.runDir, `attempt-${capture.attempt}`);
  const filesDir = path.join(attemptDir, 'files');
  try {
    await mkdir(filesDir, { recursive: true });
    await writeFile(path.join(attemptDir, 'meta.json'), JSON.stringify(buildMeta(capture), null, 2));
    await writeFile(path.join(attemptDir, 'gate-output.txt'), capture.pipeline.failure?.output ?? '');
    await Promise.all(capture.mutatedFiles.map((f): Promise<void> => copyMutatedFile(f, capture, filesDir)));
  } catch {
    return;
  }
};

export interface RunSummary {
  readonly specId: string;
  readonly taskId: string;
  readonly modelId: string;
  readonly mode: RunMode;
  readonly status: RunStatus;
  readonly finalRung: LadderState['rung'];
  readonly attempts: number;
  readonly totalTokens: number;
}

export interface BuildRunSummaryParams {
  readonly navBundlePath: string;
  readonly modelId: string;
  readonly mode: RunMode;
  readonly status: RunStatus;
  readonly finalRung: LadderState['rung'];
  readonly attempts: number;
  readonly totalTokens: number;
}

export const buildRunSummary = (params: BuildRunSummaryParams): RunSummary => ({
  specId: parseSpecId(params.navBundlePath),
  taskId: parseTaskId(params.navBundlePath),
  modelId: sanitizeModelId(params.modelId),
  mode: params.mode,
  status: params.status,
  finalRung: params.finalRung,
  attempts: params.attempts,
  totalTokens: params.totalTokens,
});

// Side-effect boundary: write the run-level summary once at run end. Best-effort.
export const writeRunSummary = async (runDir: string, summary: RunSummary): Promise<void> => {
  try {
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'run.json'), JSON.stringify(summary, null, 2));
  } catch {
    return;
  }
};
