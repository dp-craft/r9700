import { describe, expect, it } from 'vitest';

import { runPipeline } from '../runner';
import type { PipelineEvent, PipelineStepDef } from '../types';

// Yields each character of `output` as a separate token
const buildStep = (id: string, output: string): PipelineStepDef => ({
  id,
  label: `Step ${id}`,
  providerId: 'ollama',
  modelId: 'test-model',
  systemPrompt: null,
  execute: async function* (input: string) {
    void input;
    for (const char of output) {
      yield char;
    }
  },
});

// Yields each element of `tokens` array as a separate token
const buildMultiTokenStep = (id: string, tokens: readonly string[]): PipelineStepDef => ({
  id,
  label: `Step ${id}`,
  providerId: 'test',
  modelId: 'test-model',
  systemPrompt: null,
  execute: async function* (

    _input: string,

    _signal: AbortSignal
  ) {
    for (const token of tokens) {
      yield token;
    }
  },
});

// Throws an Error instance after yielding one empty token
const buildFailingStep = (id: string, errorMessage: string): PipelineStepDef => ({
  id,
  label: `Step ${id}`,
  providerId: 'ollama',
  modelId: 'test-model',
  systemPrompt: null,
  execute: async function* () {
    yield '';
    throw new Error(errorMessage);
  },
});

// Throws a raw string (not an Error instance)
const buildStringThrowingStep = (id: string, errorString: string): PipelineStepDef => ({
  id,
  label: `Step ${id}`,
  providerId: 'test',
  modelId: 'test-model',
  systemPrompt: null,
  execute: async function* (

    _input: string,

    _signal: AbortSignal
  ): AsyncGenerator<string, void, undefined> {
    if (errorString) throw errorString;
    yield '';
  },
});

const collectEvents = async (
  gen: AsyncGenerator<PipelineEvent, void, undefined>
): Promise<readonly PipelineEvent[]> => {
  const events: PipelineEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
};

describe('runPipeline', () => {
  it('should yield pipeline-start as first event', async () => {
    const steps = [buildStep('s1', 'hi')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));

    expect(events[0]).toEqual(expect.objectContaining({ type: 'pipeline-start' }));
    expect(events[0]).toHaveProperty('pipelineId');
  });

  it('should yield correct event sequence for single-step pipeline', async () => {
    const steps = [buildStep('s1', 'AB')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const types = events.map(e => e.type);

    expect(types).toEqual([
      'pipeline-start',
      'step-start',
      'step-token',
      'step-token',
      'step-end',
      'pipeline-end',
    ]);
  });

  it('should yield correct event sequence for 3-step pipeline', async () => {
    const steps = [buildStep('s1', 'A'), buildStep('s2', 'B'), buildStep('s3', 'C')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const types = events.map(e => e.type);

    expect(types).toEqual([
      'pipeline-start',
      'step-start',
      'step-token',
      'step-end',
      'step-start',
      'step-token',
      'step-end',
      'step-start',
      'step-token',
      'step-end',
      'pipeline-end',
    ]);
  });

  it('should feed accumulated output of step N as input to step N+1', async () => {
    const capturedInputs: string[] = [];

    const buildCapturingStep = (id: string, output: string): PipelineStepDef => ({
      id,
      label: `Step ${id}`,
      providerId: 'ollama',
      modelId: 'test-model',
      systemPrompt: null,
      execute: async function* (input: string) {
        capturedInputs.push(input);
        for (const char of output) {
          yield char;
        }
      },
    });

    const steps = [
      buildCapturingStep('s1', 'alpha'),
      buildCapturingStep('s2', 'beta'),
      buildCapturingStep('s3', 'gamma'),
    ];
    const controller = new AbortController();

    await collectEvents(runPipeline(steps, 'initial', controller.signal));

    expect(capturedInputs).toEqual(['initial', 'alpha', 'beta']);
  });

  it('should yield pipeline-error and stop when signal is aborted before a step', async () => {
    const controller = new AbortController();
    controller.abort();

    const steps = [buildStep('s1', 'hi')];
    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const types = events.map(e => e.type);

    expect(types).toEqual(['pipeline-start', 'pipeline-error']);
    const errorEvent = events.find(e => e.type === 'pipeline-error');
    expect(errorEvent).toEqual(expect.objectContaining({ stepId: 's1', error: 'Aborted' }));
  });

  it('should yield pipeline-error when a step throws', async () => {
    const steps = [buildStep('s1', 'OK'), buildFailingStep('s2', 'LLM connection failed')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const errorEvent = events.find(e => e.type === 'pipeline-error');

    expect(errorEvent).toEqual(
      expect.objectContaining({
        type: 'pipeline-error',
        stepId: 's2',
        error: 'LLM connection failed',
      })
    );
  });

  it('should not yield pipeline-end on error', async () => {
    const steps = [buildFailingStep('s1', 'boom')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const types = events.map(e => e.type);

    expect(types).not.toContain('pipeline-end');
  });

  it('should yield step-token events for each delta from step.execute', async () => {
    const steps = [buildStep('s1', 'Hello')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const tokenEvents = events.filter(e => e.type === 'step-token');

    expect(tokenEvents).toEqual([
      { type: 'step-token', stepId: 's1', delta: 'H' },
      { type: 'step-token', stepId: 's1', delta: 'e' },
      { type: 'step-token', stepId: 's1', delta: 'l' },
      { type: 'step-token', stepId: 's1', delta: 'l' },
      { type: 'step-token', stepId: 's1', delta: 'o' },
    ]);
  });

  it('should set step-end output to concatenation of all tokens when step yields multiple tokens', async () => {
    const steps = [buildMultiTokenStep('s1', ['Hello', ' ', 'world'])];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const stepEndEvent = events.find(e => e.type === 'step-end');

    expect(stepEndEvent).toEqual({ type: 'step-end', stepId: 's1', output: 'Hello world' });
  });

  it('should use step-end output as input for the next step when tokens are multi-character strings', async () => {
    const capturedInputs: string[] = [];

    const buildCapturingMultiTokenStep = (
      id: string,
      tokens: readonly string[]
    ): PipelineStepDef => ({
      id,
      label: `Step ${id}`,
      providerId: 'test',
      modelId: 'test-model',
      systemPrompt: null,
      execute: async function* (input: string) {
        capturedInputs.push(input);
        for (const token of tokens) {
          yield token;
        }
      },
    });

    const steps = [
      buildCapturingMultiTokenStep('s1', ['Hello', ' ', 'world']),
      buildCapturingMultiTokenStep('s2', ['Response']),
    ];
    const controller = new AbortController();

    await collectEvents(runPipeline(steps, 'initial', controller.signal));

    expect(capturedInputs[1]).toBe('Hello world');
  });

  it('should yield pipeline-error for step 2 and stop when signal is aborted between steps', async () => {
    const controller = new AbortController();

    const buildStepThatAbortsAfter = (id: string, output: string): PipelineStepDef => ({
      id,
      label: `Step ${id}`,
      providerId: 'test',
      modelId: 'test-model',
      systemPrompt: null,
      execute: async function* (input: string) {
        void input;
        for (const char of output) {
          yield char;
        }
        controller.abort();
      },
    });

    const steps = [
      buildStepThatAbortsAfter('s1', 'done'),
      buildStep('s2', 'never'),
      buildStep('s3', 'never'),
    ];

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const types = events.map(e => e.type);
    const errorEvent = events.find(e => e.type === 'pipeline-error');

    expect(types).toContain('step-end');
    expect(errorEvent).toEqual(
      expect.objectContaining({ type: 'pipeline-error', stepId: 's2', error: 'Aborted' })
    );
    expect(types).not.toContain('pipeline-end');
  });

  it('should complete step 1 normally before yielding pipeline-error for step 2 on throw', async () => {
    const steps = [
      buildStep('s1', 'OK'),
      buildFailingStep('s2', 'Network failure'),
      buildStep('s3', 'never'),
    ];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const types = events.map(e => e.type);

    expect(types).toContain('step-end');
    const step1EndIndex = types.indexOf('step-end');
    const errorIndex = types.indexOf('pipeline-error');
    expect(step1EndIndex).toBeLessThan(errorIndex);
    expect(types).not.toContain('pipeline-end');
    expect(events.filter(e => e.type === 'step-start')).toHaveLength(2);
  });

  it('should yield pipeline-error with raw string message when a non-Error value is thrown', async () => {
    const steps = [buildStringThrowingStep('s1', 'string error')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const errorEvent = events.find(e => e.type === 'pipeline-error');

    expect(errorEvent).toEqual(
      expect.objectContaining({ type: 'pipeline-error', stepId: 's1', error: 'string error' })
    );
  });

  it('should yield only pipeline-start and pipeline-end when given an empty steps array', async () => {
    const controller = new AbortController();

    const events = await collectEvents(runPipeline([], 'input', controller.signal));
    const types = events.map(e => e.type);

    expect(types).toEqual(['pipeline-start', 'pipeline-end']);
  });

  it('should yield a valid UUID-format pipelineId in the pipeline-start event', async () => {
    const steps = [buildStep('s1', 'hi')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const startEvent = events[0];

    expect(startEvent).toHaveProperty('pipelineId');
    if (startEvent.type === 'pipeline-start') {
      expect(startEvent.pipelineId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    }
  });

  it('should yield a valid UUID-format pipelineId in the pipeline-end event matching pipeline-start', async () => {
    const steps = [buildStep('s1', 'hi')];
    const controller = new AbortController();

    const events = await collectEvents(runPipeline(steps, 'input', controller.signal));
    const startEvent = events.find(e => e.type === 'pipeline-start');
    const endEvent = events.find(e => e.type === 'pipeline-end');

    expect(startEvent?.type === 'pipeline-start' && endEvent?.type === 'pipeline-end').toBe(true);
    if (startEvent?.type === 'pipeline-start' && endEvent?.type === 'pipeline-end') {
      expect(endEvent.pipelineId).toBe(startEvent.pipelineId);
    }
  });

  it('should include step label in step-start event', async () => {
    const step: PipelineStepDef = {
      id: 's1',
      label: 'My custom label',
      providerId: 'test',
      modelId: 'test-model',
      systemPrompt: null,
      execute: async function* () {
        yield 'x';
      },
    };
    const controller = new AbortController();

    const events = await collectEvents(runPipeline([step], 'input', controller.signal));
    const stepStartEvent = events.find(e => e.type === 'step-start');

    expect(stepStartEvent).toEqual({ type: 'step-start', stepId: 's1', label: 'My custom label' });
  });
});
