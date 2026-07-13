import type { PipelineEvent, PipelineStepDef } from './types';

const extractErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function* runPipeline(
  steps: readonly PipelineStepDef[],
  initialInput: string,
  signal: AbortSignal
): AsyncGenerator<PipelineEvent, void, undefined> {
  const pipelineId = crypto.randomUUID();
  yield { type: 'pipeline-start', pipelineId };

  let currentInput = initialInput;

  for (const step of steps) {
    if (signal.aborted) {
      yield { type: 'pipeline-error', stepId: step.id, error: 'Aborted' };
      return;
    }

    yield { type: 'step-start', stepId: step.id, label: step.label };

    let accumulated = '';
    try {
      for await (const item of step.execute(currentInput, signal)) {
        if (typeof item !== 'string') continue;
        accumulated += item;
        yield { type: 'step-token', stepId: step.id, delta: item };
      }
    } catch (error: unknown) {
      yield { type: 'pipeline-error', stepId: step.id, error: extractErrorMessage(error) };
      return;
    }

    yield { type: 'step-end', stepId: step.id, output: accumulated };
    currentInput = accumulated;
  }

  yield { type: 'pipeline-end', pipelineId };
}
