import { LAB_RUN_CONCURRENCY } from '@/config';
import type { ParallelismMode } from '@/domain/run-controls';

export type { ParallelismMode };

export type ConcurrencyCell = { readonly modelKey: string };

export type ExecutionGroup<T> = {
  readonly modelKey: string;
  readonly items: readonly T[];
  readonly concurrency: number;
};

export type ParallelRunsSettings = {
  readonly serialAcrossModels: boolean;
  readonly serialWithinModel: boolean;
};

export const deriveParallelRunsSettings = (
  runParallel: boolean,
  mode: ParallelismMode
): ParallelRunsSettings => ({
  serialAcrossModels: !runParallel || mode === 'same-model',
  serialWithinModel: !runParallel,
});

const SERIAL_CONCURRENCY = 1;

const groupByModelKey = <T extends { readonly modelKey: string }>(
  cells: readonly T[]
): ReadonlyMap<string, readonly T[]> =>
  cells.reduce<Map<string, T[]>>((acc, cell) => {
    const group = acc.get(cell.modelKey);
    return acc.set(cell.modelKey, group ? [...group, cell] : [cell]);
  }, new Map());

const resolveGroupConcurrency = (settings: ParallelRunsSettings): number =>
  settings.serialWithinModel ? SERIAL_CONCURRENCY : LAB_RUN_CONCURRENCY;

export const scheduleRun = <T extends { readonly modelKey: string }>(
  cells: readonly T[],
  settings: ParallelRunsSettings
): readonly ExecutionGroup<T>[] => {
  if (cells.length === 0) return [];

  const concurrency = resolveGroupConcurrency(settings);

  return [...groupByModelKey(cells).entries()].map(([modelKey, groupCells]) => ({
    modelKey,
    items: groupCells,
    concurrency,
  }));
};
