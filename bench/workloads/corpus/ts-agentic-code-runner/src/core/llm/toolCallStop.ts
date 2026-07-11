export const MAX_IDENTICAL_TOOL_CALLS = 4;

const sortedReplacer = (_key: string, value: unknown): unknown =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map(k => [k, (value as Record<string, unknown>)[k]])
      )
    : value;

const stableStringify = (value: unknown): string => JSON.stringify(value, sortedReplacer);

interface ToolCallLike {
  readonly toolName: string;
  readonly input: unknown;
}

interface StepLike {
  readonly toolCalls: ReadonlyArray<ToolCallLike>;
}

const toolCallKey = (call: ToolCallLike): string =>
  `${call.toolName}:${stableStringify(call.input)}`;

export const repeatedToolCallStop = (
  limit: number
): ((opts: { steps: ReadonlyArray<StepLike> }) => boolean) => {
  return ({ steps }) => {
    const keys = steps.flatMap(s => s.toolCalls.map(toolCallKey));
    if (keys.length < limit) return false;
    const tail = keys.slice(-limit);
    return tail.every(k => k === tail[0]);
  };
};

// Steps back over which a stall (no mutation) ends the drive early.
export const CONVERGENCE_WINDOW = 10;

// Tool names whose calls the mutation tracker records as real file changes; a
// drive that issues NONE of these is not converging on an edit.
export const MUTATING_TOOL_NAMES: readonly string[] = [
  'edit',
  'write',
  'verify_edit',
  'submit_region',
];

interface NamedToolCall {
  readonly toolName: string;
}

interface NamedStep {
  readonly toolCalls: ReadonlyArray<NamedToolCall>;
}

const isMutatingStep = (step: NamedStep): boolean =>
  step.toolCalls.some((c): boolean => MUTATING_TOOL_NAMES.includes(c.toolName));

// Sibling of repeatedToolCallStop: halt the drive when the last `window` steps
// produced no mutation-visible tool call — the model is spinning on reads/lsp
// without converging on a change.
export const convergenceStop = (
  window: number
): ((opts: { steps: ReadonlyArray<NamedStep> }) => boolean) => {
  return ({ steps }) => {
    if (steps.length < window) return false;
    if (!steps.some(isMutatingStep)) return false;
    return steps.slice(-window).every((s): boolean => !isMutatingStep(s));
  };
};

// True when the drive stopped BEFORE the step cap with a stalled tail — the
// signal it halted on convergence (vs. hitting maxSteps). Surfaced as a
// `halt: convergence` progress event so telemetry/ledger can distinguish it.
export const convergedEarly = (
  steps: ReadonlyArray<NamedStep>,
  window: number,
  maxSteps: number
): boolean =>
  steps.length > 0 && steps.length < maxSteps && convergenceStop(window)({ steps });
