import { describe, expect, it } from 'vitest';

import {
  convergedEarly,
  CONVERGENCE_WINDOW,
  convergenceStop,
  MUTATING_TOOL_NAMES
} from './toolCallStop';

// A step carries the tool calls the model issued that turn; convergence cares
// only about the tool NAME (mutation-visible vs. not).
const step = (...toolNames: readonly string[]): { readonly toolCalls: readonly { readonly toolName: string }[] } => ({
  toolCalls: toolNames.map((toolName): { readonly toolName: string } => ({ toolName })),
});

const readSteps = (count: number): readonly { readonly toolCalls: readonly { readonly toolName: string }[] }[] =>
  Array.from({ length: count }, (): ReturnType<typeof step> => step('read'));

describe('convergenceStop', () => {
  it('should not halt when fewer than the window of steps have run', () => {
    const stop = convergenceStop(CONVERGENCE_WINDOW);

    expect(stop({ steps: readSteps(CONVERGENCE_WINDOW - 1) })).toBe(false);
  });

  it('should halt when a stalled window follows an earlier mutation', () => {
    const stop = convergenceStop(CONVERGENCE_WINDOW);
    const steps = [step('edit'), ...readSteps(CONVERGENCE_WINDOW)];

    expect(stop({ steps })).toBe(true);
  });

  it('should not halt when the window is full but no mutation has ever occurred', () => {
    const stop = convergenceStop(CONVERGENCE_WINDOW);

    expect(stop({ steps: readSteps(CONVERGENCE_WINDOW) })).toBe(false);
  });

  it('should not halt when a mutating tool call occurred within the window', () => {
    const stop = convergenceStop(CONVERGENCE_WINDOW);
    const steps = [...readSteps(CONVERGENCE_WINDOW - 1), step('edit')];

    expect(stop({ steps })).toBe(false);
  });

  it.each(MUTATING_TOOL_NAMES)('should treat %s as a mutation-visible call', (mutating: string) => {
    const stop = convergenceStop(CONVERGENCE_WINDOW);
    const steps = [step(mutating), ...readSteps(CONVERGENCE_WINDOW - 1)];

    expect(stop({ steps })).toBe(false);
  });
});

describe('convergedEarly', () => {
  it('should report convergence when the drive stopped before the step cap with a stalled tail after a mutation', () => {
    const steps = [step('edit'), ...readSteps(CONVERGENCE_WINDOW)];

    expect(convergedEarly(steps, CONVERGENCE_WINDOW, 32)).toBe(true);
  });

  it('should not report convergence when no mutation has ever occurred', () => {
    expect(convergedEarly(readSteps(CONVERGENCE_WINDOW), CONVERGENCE_WINDOW, 32)).toBe(false);
  });

  it('should not report convergence when the step cap was reached', () => {
    const steps = [step('edit'), ...readSteps(CONVERGENCE_WINDOW)];

    expect(convergedEarly(steps, CONVERGENCE_WINDOW, steps.length)).toBe(false);
  });

  it('should not report convergence when no steps ran', () => {
    expect(convergedEarly([], CONVERGENCE_WINDOW, 32)).toBe(false);
  });
});
