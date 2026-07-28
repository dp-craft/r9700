import type { ArchivedReason } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';
import type { LabRunRow } from './labRuns';

// -- Constants --

const ARCHIVED_RUNS_STORE = 'archivedRuns';
const LAB_RUNS_STORE = 'labRuns';
const ARCHIVED_AT_INDEX = 'archivedAt';

// -- Persisted shape --
// The archivedRuns store persists ArchivedLabRun (LabRunRow + archive metadata,
// carrying `cells`). Read and export paths surface this shape directly.

export type ArchivedLabRun = LabRunRow & {
  readonly archivedAt: number;
  readonly archivedReason: ArchivedReason;
};

// -- Export type --

export type RunExport = {
  readonly schema: 'aichatney.archived-run.v1';
  readonly run: ArchivedLabRun;
};

const EXPORT_SCHEMA = 'aichatney.archived-run.v1' as const;

// -- Exported functions --

export const archiveCompletedRun = async (run: LabRunRow): Promise<ArchivedLabRun> => {
  const archived: ArchivedLabRun = {
    ...run,
    archivedAt: Date.now(),
    archivedReason: 'run-complete',
  };
  const db = await getDb();
  const tx = db.transaction(ARCHIVED_RUNS_STORE, 'readwrite');
  const archivedStore = tx.objectStore(ARCHIVED_RUNS_STORE);
  await promisifyRequest(archivedStore.put(archived));
  await transactionComplete(tx);
  return archived;
};

export const archiveRun = async (run: LabRunRow): Promise<ArchivedLabRun> => {
  const archived: ArchivedLabRun = {
    ...run,
    archivedAt: Date.now(),
    archivedReason: 'tab-close',
  };
  const db = await getDb();
  const tx = db.transaction([ARCHIVED_RUNS_STORE, LAB_RUNS_STORE], 'readwrite');
  const archivedStore = tx.objectStore(ARCHIVED_RUNS_STORE);
  const labStore = tx.objectStore(LAB_RUNS_STORE);
  await promisifyRequest(archivedStore.put(archived));
  await promisifyRequest(labStore.delete(run.id));
  await transactionComplete(tx);
  return archived;
};

export const getArchivedRuns = async (opts?: {
  readonly limit?: number;
  readonly beforeArchivedAt?: number;
}): Promise<readonly ArchivedLabRun[]> => {
  const db = await getDb();
  const tx = db.transaction(ARCHIVED_RUNS_STORE, 'readonly');
  const store = tx.objectStore(ARCHIVED_RUNS_STORE);
  const index = store.index(ARCHIVED_AT_INDEX);
  const all: readonly ArchivedLabRun[] = await promisifyRequest(index.getAll());

  const beforeArchivedAt = opts?.beforeArchivedAt;
  const filtered =
    beforeArchivedAt !== undefined ? all.filter(r => r.archivedAt < beforeArchivedAt) : all;

  const sorted = [...filtered].sort((a, b) => b.archivedAt - a.archivedAt);

  return opts?.limit !== undefined ? sorted.slice(0, opts.limit) : sorted;
};

export const getArchivedRunById = async (id: string): Promise<ArchivedLabRun | undefined> => {
  const db = await getDb();
  const tx = db.transaction(ARCHIVED_RUNS_STORE, 'readonly');
  const store = tx.objectStore(ARCHIVED_RUNS_STORE);
  return promisifyRequest(store.get(id));
};

export const deleteArchivedRuns = async (ids: readonly string[]): Promise<void> => {
  const db = await getDb();
  const tx = db.transaction(ARCHIVED_RUNS_STORE, 'readwrite');
  const store = tx.objectStore(ARCHIVED_RUNS_STORE);
  ids.forEach(id => {
    store.delete(id);
  });
  await transactionComplete(tx);
};

export const buildRunExport = (
  runs: readonly ArchivedLabRun[]
): RunExport | readonly RunExport[] => {
  const exports = runs.map((run): RunExport => ({ schema: EXPORT_SCHEMA, run }));
  return exports.length === 1 ? exports[0] : exports;
};
