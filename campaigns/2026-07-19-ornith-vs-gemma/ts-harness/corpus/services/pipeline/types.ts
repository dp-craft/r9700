import type { StreamEvent } from '../llm/types';

export type PipelineEvent =
  | { readonly type: 'pipeline-start'; readonly pipelineId: string }
  | { readonly type: 'step-start'; readonly stepId: string; readonly label: string }
  | { readonly type: 'step-token'; readonly stepId: string; readonly delta: string }
  | { readonly type: 'step-end'; readonly stepId: string; readonly output: string }
  | { readonly type: 'pipeline-end'; readonly pipelineId: string }
  | { readonly type: 'pipeline-error'; readonly stepId: string; readonly error: string };

export interface PipelineStepDef {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly systemPrompt: string | null;
  readonly execute: (
    input: string,
    signal: AbortSignal
  ) => AsyncGenerator<string | StreamEvent, void, undefined>;
}

export interface PipelineStepTrace {
  readonly stepId: string;
  readonly label: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly input: string;
  readonly output: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly tokenCount: number;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly error: string | null;
}

export interface PipelineTrace {
  readonly pipelineId: string;
  readonly agentType: string;
  readonly steps: readonly PipelineStepTrace[];
  readonly totalDurationMs: number;
  readonly status: 'completed' | 'failed' | 'aborted';
}

export interface PipelineProgress {
  readonly isActive: boolean;
  readonly currentStepId: string | null;
  readonly currentStepLabel: string | null;
  readonly completedSteps: readonly string[];
  readonly streamingContent: string;
}

export type PipelineRunner = (
  steps: readonly PipelineStepDef[],
  initialInput: string,
  signal: AbortSignal
) => AsyncGenerator<PipelineEvent, void, undefined>;
