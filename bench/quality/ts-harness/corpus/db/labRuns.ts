// Service layer for the v8 `labRuns` IDB store (FR-032, FR-042, FR-081).
// Mirrors `db/sessions.ts` style: thin wrappers over native IDB via getDb + helpers.
// Type imports from `@/features/prompt-tester/types` are type-only (allowed by
// db/* exception — see CLAUDE_PROJECT_SPECIFIC.md import rules).

import type {
  CellResult,
  CompareMode,
  GridCols,
  GroupKey,
  ModelEntry,
  PromptEntry,
  SortKey
} from '@/features/prompt-tester/types';

import type { EvalComparisonDTO } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';

const STORE = 'labRuns' as const;
const UPDATED_AT_INDEX = 'updatedAt' as const;

export type LabRunRow = {
  readonly id: string;
  readonly label: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly configSnapshot: {
    readonly models: readonly ModelEntry[];
    readonly prompts: readonly PromptEntry[];
    readonly userPrompt: string;
  };
  readonly cells: readonly CellResult[];
  readonly selectedCellIds: readonly string[];
  readonly compareMode: CompareMode;
  readonly sort: SortKey;
  readonly group: GroupKey;
  readonly gridCols: GridCols;
  readonly evalComparison?: EvalComparisonDTO | null;
};

export async function getAllLabRuns(): Promise<readonly LabRunRow[]> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readonly');
  const idx = tx.objectStore(STORE).index(UPDATED_AT_INDEX);
  const all = await promisifyRequest<LabRunRow[]>(idx.getAll());
  return [...all].reverse();
}

export async function getLabRunById(id: string): Promise<LabRunRow | undefined> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readonly');
  const row = await promisifyRequest<LabRunRow | undefined>(tx.objectStore(STORE).get(id));
  return row;
}

export async function putLabRun(row: LabRunRow): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const stamped: LabRunRow = { ...row, updatedAt: Date.now() };
  tx.objectStore(STORE).put(stamped);
  await transactionComplete(tx);
}

export async function deleteLabRun(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await transactionComplete(tx);
}
