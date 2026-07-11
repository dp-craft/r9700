// Interval (in tool results) between task-anchor recitations. A long agent loop
// slides the task statement out of the effective attention window; re-stating it
// on every Nth tool result keeps the goal in-context without flooding the loop.
export const RECITATION_INTERVAL = 10;

const RECITATION_TASK_CHARS = 80;

export interface RecitationContext {
  readonly stage: string;
  readonly taskStatement?: string;
}

const recitationLine = (ctx: RecitationContext): string => {
  const statement = (ctx.taskStatement ?? '').trim().slice(0, RECITATION_TASK_CHARS);
  return `\n[task: ${ctx.stage} — ${statement}]`;
};

// Loop-level recitation counter: ONE reciter per drive, shared by every tool
// execute, so the interval counts tool results across the whole loop (not per
// handler). Appends a task anchor to every RECITATION_INTERVAL-th result.
export const createReciter = (ctx: RecitationContext): ((output: string) => string) => {
  const state = { count: 0 };
  const line = recitationLine(ctx);
  return (output: string): string => {
    state.count += 1;
    return state.count % RECITATION_INTERVAL === 0 ? `${output}${line}` : output;
  };
};
