import type { CitationDTO } from '@/domain/entities';

export interface CuratedModelViewModel {
  readonly baseName: string;
  readonly displayName: string;
  readonly description: string;
  readonly approxSize: string;
  readonly pros: string;
  readonly cons: string;
  readonly isAvailable?: boolean;
}

export interface PipelineStepTraceViewModel {
  readonly stepId: string;
  readonly label: string;
  readonly input: string;
  readonly output: string;
  readonly status: 'completed' | 'failed' | 'aborted';
}

export interface PipelineTraceViewModel {
  readonly pipelineId: string;
  readonly agentType: string;
  readonly steps: readonly PipelineStepTraceViewModel[];
  readonly status: 'completed' | 'failed' | 'aborted';
}

export interface MessageViewModel {
  readonly id: string;
  readonly sessionId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: number;
  readonly model?: string;
  readonly citations?: readonly CitationDTO[];
  readonly reasoning?: string;
  readonly pipelineTrace?: PipelineTraceViewModel | null;
}
