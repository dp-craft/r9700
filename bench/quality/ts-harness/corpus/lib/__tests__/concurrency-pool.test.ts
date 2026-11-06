import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskFactory } from '@/lib/concurrency-pool';
import { runPool } from '@/lib/concurrency-pool';

// -- Helpers --

/** Creates a deferred promise with manual resolve/reject controls. */
const createDeferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Creates a delay promise for timing-sensitive tests. */
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('runPool', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // -- Positive paths --

  it('should return results in input order when tasks complete out of order', async () => {
    const deferred0 = createDeferred<string>();
    const deferred1 = createDeferred<string>();
    const deferred2 = createDeferred<string>();

    const tasks: readonly TaskFactory<string>[] = [
      () => deferred0.promise,
      () => deferred1.promise,
      () => deferred2.promise,
    ];

    const resultPromise = runPool(tasks, { concurrency: 3 });

    deferred2.resolve('third');
    deferred0.resolve('first');
    deferred1.resolve('second');

    const results = await resultPromise;

    expect(results).toEqual([
      { status: 'fulfilled', value: 'first' },
      { status: 'fulfilled', value: 'second' },
      { status: 'fulfilled', value: 'third' },
    ]);
  });

  it('should resolve all tasks when concurrency >= task count', async () => {
    const tasks: readonly TaskFactory<number>[] = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];

    const results = await runPool(tasks, { concurrency: 10 });

    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  });

  it('should return fulfilled results for successful tasks', async () => {
    const tasks: readonly TaskFactory<string>[] = [
      () => Promise.resolve('hello'),
      () => Promise.resolve('world'),
    ];

    const results = await runPool(tasks, { concurrency: 2 });

    expect(results).toEqual([
      { status: 'fulfilled', value: 'hello' },
      { status: 'fulfilled', value: 'world' },
    ]);
  });

  it('should return rejected results for failing tasks without affecting others', async () => {
    const tasks: readonly TaskFactory<string>[] = [
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('task failed')),
      () => Promise.resolve('also ok'),
    ];

    const results = await runPool(tasks, { concurrency: 3 });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(results[1]).toEqual(expect.objectContaining({ status: 'rejected' }));
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('task failed');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'also ok' });
  });

  // -- Concurrency enforcement --

  it('should execute at most N tasks simultaneously when concurrency is N', async () => {
    const concurrency = 2;
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks: readonly TaskFactory<string>[] = Array.from({ length: 6 }, (_, i) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(10);
      concurrent--;
      return `task-${i}`;
    });

    await runPool(tasks, { concurrency });

    expect(maxConcurrent).toBe(concurrency);
  });

  it('should execute tasks serially when concurrency is 1', async () => {
    const executionOrder: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks: readonly TaskFactory<string>[] = Array.from({ length: 4 }, (_, i) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      executionOrder.push(i);
      await delay(5);
      concurrent--;
      return `task-${i}`;
    });

    const results = await runPool(tasks, { concurrency: 1 });

    expect(maxConcurrent).toBe(1);
    expect(executionOrder).toEqual([0, 1, 2, 3]);
    expect(results).toHaveLength(4);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  });

  it('should default concurrency to 3 when not specified', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks: readonly TaskFactory<string>[] = Array.from({ length: 9 }, (_, i) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(10);
      concurrent--;
      return `task-${i}`;
    });

    await runPool(tasks);

    expect(maxConcurrent).toBe(3);
  });

  // -- Abort support --

  it('should reject remaining tasks with AbortError when signal is aborted mid-execution', async () => {
    const controller = new AbortController();
    let taskIndex = 0;

    const tasks: readonly TaskFactory<string>[] = Array.from(
      { length: 5 },
      (_, i) => async (signal: AbortSignal) => {
        void signal;
        taskIndex++;
        if (taskIndex === 2) {
          controller.abort();
        }
        await delay(5);
        return `task-${i}`;
      }
    );

    const results = await runPool(tasks, { concurrency: 1, signal: controller.signal });

    const rejectedResults = results.filter(r => r.status === 'rejected');
    expect(rejectedResults.length).toBeGreaterThan(0);

    rejectedResults.forEach(r => {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(DOMException);
      expect(reason.name).toBe('AbortError');
    });
  });

  it('should reject all tasks with AbortError when signal is already aborted before start', async () => {
    const controller = new AbortController();
    controller.abort();

    const taskFn = vi.fn(() => Promise.resolve('should not run'));
    const tasks: readonly TaskFactory<string>[] = [taskFn, taskFn, taskFn];

    const results = await runPool(tasks, { signal: controller.signal });

    expect(results).toHaveLength(3);
    results.forEach(r => {
      expect(r.status).toBe('rejected');
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(DOMException);
      expect(reason.name).toBe('AbortError');
    });
    expect(taskFn).not.toHaveBeenCalled();
  });

  it('should preserve partial results for tasks completed before abort', async () => {
    const controller = new AbortController();
    const deferred0 = createDeferred<string>();
    const deferred1 = createDeferred<string>();

    const tasks: readonly TaskFactory<string>[] = [
      () => deferred0.promise,
      () => deferred1.promise,
      () =>
        new Promise<string>((_, reject) => {
          // This task will never resolve — abort will reject it
          controller.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    ];

    const resultPromise = runPool(tasks, { concurrency: 3, signal: controller.signal });

    deferred0.resolve('completed-0');
    deferred1.resolve('completed-1');
    await delay(5);
    controller.abort();

    const results = await resultPromise;

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'completed-0' });
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'completed-1' });
  });

  // -- Edge cases --

  it('should return empty array for empty task array', async () => {
    const results = await runPool([], { concurrency: 3 });

    expect(results).toEqual([]);
  });

  it('should throw RangeError when concurrency is 0', async () => {
    const tasks: readonly TaskFactory<string>[] = [() => Promise.resolve('x')];

    await expect(runPool(tasks, { concurrency: 0 })).rejects.toThrow(RangeError);
  });

  it('should throw RangeError when concurrency is negative', async () => {
    const tasks: readonly TaskFactory<string>[] = [() => Promise.resolve('x')];

    await expect(runPool(tasks, { concurrency: -1 })).rejects.toThrow(RangeError);
  });

  it('should throw RangeError when concurrency is NaN', async () => {
    const tasks: readonly TaskFactory<string>[] = [() => Promise.resolve('x')];

    await expect(runPool(tasks, { concurrency: NaN })).rejects.toThrow(RangeError);
  });

  it('should throw RangeError when concurrency is fractional', async () => {
    const tasks: readonly TaskFactory<string>[] = [() => Promise.resolve('x')];

    await expect(runPool(tasks, { concurrency: 1.5 })).rejects.toThrow(RangeError);
  });

  // -- Mixed results --

  it('should handle mix of fulfilled and rejected tasks in correct order', async () => {
    const tasks: readonly TaskFactory<number>[] = [
      () => Promise.resolve(1),
      () => Promise.reject(new Error('fail-2')),
      () => Promise.resolve(3),
      () => Promise.reject(new Error('fail-4')),
      () => Promise.resolve(5),
    ];

    const results = await runPool(tasks, { concurrency: 2 });

    expect(results).toHaveLength(5);

    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('fail-2');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
    expect(results[3].status).toBe('rejected');
    expect((results[3] as PromiseRejectedResult).reason.message).toBe('fail-4');
    expect(results[4]).toEqual({ status: 'fulfilled', value: 5 });
  });

  // -- Signal passed to task factories --

  it('should pass the abort signal to each task factory', async () => {
    const controller = new AbortController();
    const receivedSignals: AbortSignal[] = [];

    const tasks: readonly TaskFactory<string>[] = [
      signal => {
        receivedSignals.push(signal);
        return Promise.resolve('a');
      },
      signal => {
        receivedSignals.push(signal);
        return Promise.resolve('b');
      },
    ];

    await runPool(tasks, { concurrency: 2, signal: controller.signal });

    expect(receivedSignals).toHaveLength(2);
    receivedSignals.forEach(signal => {
      expect(signal).toBe(controller.signal);
    });
  });

  it('should provide a default signal to task factories when no signal option is given', async () => {
    const receivedSignals: AbortSignal[] = [];

    const tasks: readonly TaskFactory<string>[] = [
      signal => {
        receivedSignals.push(signal);
        return Promise.resolve('a');
      },
    ];

    await runPool(tasks);

    expect(receivedSignals).toHaveLength(1);
    expect(receivedSignals[0]).toBeInstanceOf(AbortSignal);
    expect(receivedSignals[0].aborted).toBe(false);
  });
});
