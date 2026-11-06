export type TaskFactory<T> = (signal: AbortSignal) => Promise<T>;

export interface PoolOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

export type RunPool = <T>(
  tasks: readonly TaskFactory<T>[],
  options?: PoolOptions
) => Promise<readonly PromiseSettledResult<T>[]>;

const DEFAULT_CONCURRENCY = 3;

const createAbortResult = <T>(): PromiseSettledResult<T> => ({
  status: 'rejected' as const,
  reason: new DOMException('Aborted', 'AbortError'),
});

const createFulfilledResult = <T>(value: T): PromiseSettledResult<T> => ({
  status: 'fulfilled' as const,
  value,
});

const createRejectedResult = <T>(reason: unknown): PromiseSettledResult<T> => ({
  status: 'rejected' as const,
  reason,
});

const validateConcurrency = (concurrency: number): void => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      `Concurrency must be a positive integer >= 1, received ${String(concurrency)}`
    );
  }
};

const resolveSignal = (signal: AbortSignal | undefined): AbortSignal =>
  signal ?? new AbortController().signal;

const executeTask = <T>(
  factory: TaskFactory<T>,
  signal: AbortSignal
): Promise<PromiseSettledResult<T>> =>
  factory(signal).then(createFulfilledResult<T>, createRejectedResult<T>);

// runPool uses internal mutation (results array, active set) as a pragmatic
// necessity for bounded concurrency — scoped entirely within the function closure.
export const runPool: RunPool = async <T>(
  tasks: readonly TaskFactory<T>[],
  options?: PoolOptions
): Promise<readonly PromiseSettledResult<T>[]> => {
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  validateConcurrency(concurrency);

  if (tasks.length === 0) {
    return [];
  }

  const signal = resolveSignal(options?.signal);
  const results = Array<PromiseSettledResult<T>>(tasks.length);
  const active = new Set<Promise<void>>();

  for (const [index, factory] of tasks.entries()) {
    if (signal.aborted) {
      results[index] = createAbortResult<T>();
      continue;
    }

    const wrapper = executeTask(factory, signal).then(result => {
      results[index] = result;
      active.delete(wrapper);
    });
    active.add(wrapper);

    if (active.size >= concurrency) {
      await Promise.race(active);
    }
  }

  await Promise.all(active);
  return results;
};
