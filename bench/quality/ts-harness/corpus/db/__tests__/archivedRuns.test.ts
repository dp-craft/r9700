/**
 * Unit tests for src/db/archivedRuns.ts — Archived Runs service layer.
 * RED phase: src/db/archivedRuns.ts does not exist yet.
 * Covers: FR-031 (archive on tab close), FR-046 (reverse-chrono list),
 *         FR-051 (snapshot stored), FR-052 (permanent delete),
 *         FR-053 (export JSON shape), FR-058 (rollback on write failure),
 *         FR-059 (separate store from labRuns).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LabRunRow } from '@/db/labRuns';

import type { ArchivedLabRun } from '../archivedRuns';

// ---------------------------------------------------------------------------
// In-memory stores simulating IDB object stores.
// archivedRuns: keyed by id, with archivedAt index support. The PERSISTED shape
// is ArchivedLabRun (LabRunRow + archivedAt/archivedReason, carrying `cells`).
// labRuns: keyed by id.
// ---------------------------------------------------------------------------

const archivedRunsStore = new Map<string, ArchivedLabRun>();
const labRunsStore = new Map<string, LabRunRow>();

interface FakeRequest<T> {
  result: T;
}

const makeRequest = <T>(result: T): FakeRequest<T> => ({ result });

const makeFakeArchivedStore = () => ({
  put: (row: ArchivedLabRun): FakeRequest<void> => {
    archivedRunsStore.set(row.id, row);
    return makeRequest(undefined);
  },
  get: (id: string): FakeRequest<ArchivedLabRun | undefined> =>
    makeRequest(archivedRunsStore.get(id)),
  delete: (id: string): FakeRequest<void> => {
    archivedRunsStore.delete(id);
    return makeRequest(undefined);
  },
  getAll: (): FakeRequest<ArchivedLabRun[]> => makeRequest(Array.from(archivedRunsStore.values())),
  index: (_name: string) => ({
    getAll: (): FakeRequest<ArchivedLabRun[]> =>
      makeRequest(Array.from(archivedRunsStore.values())),
    openCursor: (_range: unknown, _direction: string): FakeRequest<null> => makeRequest(null),
  }),
});

const makeFakeLabRunsStore = () => ({
  delete: (id: string): FakeRequest<void> => {
    labRunsStore.delete(id);
    return makeRequest(undefined);
  },
  get: (id: string): FakeRequest<LabRunRow | undefined> => makeRequest(labRunsStore.get(id)),
});

// Multi-store fake transaction — returns the correct fake store per name.
const fakeTx = {
  objectStore: (name: string) => {
    if (name === 'archivedRuns') return makeFakeArchivedStore();
    if (name === 'labRuns') return makeFakeLabRunsStore();
    throw new Error(`Unknown store: ${name}`);
  },
};

const fakeDb = {
  transaction: (_stores: string | string[], _mode: string) => fakeTx,
};

vi.mock('../idb', () => ({
  getDb: vi.fn(async () => fakeDb),
  promisifyRequest: vi.fn(async <T>(req: FakeRequest<T>) => req.result),
  transactionComplete: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Subject under test (file does not exist yet — RED)
// ---------------------------------------------------------------------------

import {
  archiveCompletedRun,
  archiveRun,
  buildRunExport,
  deleteArchivedRuns,
  getArchivedRunById,
  getArchivedRuns
} from '../archivedRuns';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TS = 1_700_000_000_000;

const buildLabRunRow = (overrides: Partial<LabRunRow> = {}): LabRunRow => ({
  id: 'run-1',
  label: 'Test run',
  createdAt: FIXED_TS,
  updatedAt: FIXED_TS,
  configSnapshot: { models: [], prompts: [], userPrompt: 'Explain TDD' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'table',
  sort: 'mean',
  group: 'none',
  gridCols: 2,
  ...overrides,
});

const buildArchivedRun = (overrides: Partial<ArchivedLabRun> = {}): ArchivedLabRun => ({
  ...buildLabRunRow(),
  archivedAt: FIXED_TS + 5000,
  archivedReason: 'tab-close',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('db/archivedRuns — archiveRun (FR-031, FR-051)', () => {
  beforeEach(() => {
    archivedRunsStore.clear();
    labRunsStore.clear();
    vi.clearAllMocks();
  });

  it('should write the run to archivedRuns with archivedAt timestamp and archivedReason tab-close', async () => {
    // Arrange
    const run = buildLabRunRow({ id: 'run-42' });
    labRunsStore.set(run.id, run);
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TS + 9000);

    // Act
    const result = await archiveRun(run);

    // Assert
    expect(result.archivedReason).toBe('tab-close');
    expect(result.archivedAt).toBe(FIXED_TS + 9000);
    expect(result.id).toBe('run-42');
    expect(archivedRunsStore.has('run-42')).toBe(true);

    vi.useRealTimers();
  });

  it('should delete the labRuns row after writing to archivedRuns', async () => {
    // Arrange
    const run = buildLabRunRow({ id: 'run-del' });
    labRunsStore.set(run.id, run);

    // Act
    await archiveRun(run);

    // Assert
    expect(labRunsStore.has('run-del')).toBe(false);
  });

  it('should reject and leave labRuns intact when archivedRuns write fails (FR-058)', async () => {
    // Arrange
    const { getDb } = await import('../idb');
    const run = buildLabRunRow({ id: 'run-fail' });
    labRunsStore.set(run.id, run);

    const failingTx = {
      objectStore: (name: string) => {
        if (name === 'archivedRuns') {
          return {
            put: () => {
              throw new Error('IDB write failure');
            },
          };
        }
        return makeFakeLabRunsStore();
      },
    };
    vi.mocked(getDb).mockResolvedValueOnce({
      transaction: () => failingTx,
    } as unknown as IDBDatabase);

    // Act
    await expect(archiveRun(run)).rejects.toThrow();

    // Assert — labRuns row still present (rollback semantics)
    expect(labRunsStore.has('run-fail')).toBe(true);
  });
});

describe('db/archivedRuns — archiveCompletedRun', () => {
  beforeEach(() => {
    archivedRunsStore.clear();
    labRunsStore.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TS + 9000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should write the run to archivedRuns with archivedReason run-complete', async () => {
    // Arrange
    const run = buildLabRunRow({ id: 'run-complete-1' });

    // Act
    const result = await archiveCompletedRun(run);

    // Assert
    expect(result.archivedReason).toBe('run-complete');
    expect(result.archivedAt).toBe(FIXED_TS + 9000);
    expect(result.id).toBe('run-complete-1');
    expect(archivedRunsStore.has('run-complete-1')).toBe(true);
  });

  it('should NOT delete the labRuns row', async () => {
    // Arrange
    const run = buildLabRunRow({ id: 'run-keep' });
    labRunsStore.set(run.id, run);

    // Act
    await archiveCompletedRun(run);

    // Assert
    expect(labRunsStore.has('run-keep')).toBe(true);
  });

  it('should upsert (overwrite) if an existing archived entry exists for the same id', async () => {
    // Arrange
    const run = buildLabRunRow({ id: 'run-upsert' });
    const oldEntry = buildArchivedRun({
      id: 'run-upsert',
      archivedAt: FIXED_TS,
      archivedReason: 'tab-close',
    });
    archivedRunsStore.set(oldEntry.id, oldEntry);

    // Act
    await archiveCompletedRun(run);

    // Assert
    const stored = archivedRunsStore.get('run-upsert');
    expect(stored?.archivedReason).toBe('run-complete');
    expect(stored?.archivedAt).toBe(FIXED_TS + 9000);
  });
});

describe('db/archivedRuns — getArchivedRuns (FR-046)', () => {
  beforeEach(() => {
    archivedRunsStore.clear();
    vi.clearAllMocks();
  });

  it('should return archived runs in reverse-chronological order (newest archivedAt first)', async () => {
    // Arrange
    const older = buildArchivedRun({ id: 'run-old', archivedAt: FIXED_TS + 1000 });
    const newer = buildArchivedRun({ id: 'run-new', archivedAt: FIXED_TS + 5000 });
    const middle = buildArchivedRun({ id: 'run-mid', archivedAt: FIXED_TS + 3000 });
    archivedRunsStore.set(older.id, older);
    archivedRunsStore.set(newer.id, newer);
    archivedRunsStore.set(middle.id, middle);

    // Act
    const results = await getArchivedRuns();

    // Assert
    expect(results[0]?.id).toBe('run-new');
    expect(results[1]?.id).toBe('run-mid');
    expect(results[2]?.id).toBe('run-old');
  });

  it('should return an empty array when no runs are archived', async () => {
    // Act
    const results = await getArchivedRuns();

    // Assert
    expect(results).toHaveLength(0);
  });

  it('should respect the limit option by returning at most N runs', async () => {
    // Arrange — 3 runs, limit=2
    archivedRunsStore.set('a', buildArchivedRun({ id: 'a', archivedAt: FIXED_TS + 3000 }));
    archivedRunsStore.set('b', buildArchivedRun({ id: 'b', archivedAt: FIXED_TS + 2000 }));
    archivedRunsStore.set('c', buildArchivedRun({ id: 'c', archivedAt: FIXED_TS + 1000 }));

    // Act
    const results = await getArchivedRuns({ limit: 2 });

    // Assert
    expect(results).toHaveLength(2);
  });

  it('should respect beforeArchivedAt by excluding runs at or after the cursor', async () => {
    // Arrange
    const cutoff = FIXED_TS + 3000;
    archivedRunsStore.set('new', buildArchivedRun({ id: 'new', archivedAt: cutoff + 1000 }));
    archivedRunsStore.set('exact', buildArchivedRun({ id: 'exact', archivedAt: cutoff }));
    archivedRunsStore.set('old', buildArchivedRun({ id: 'old', archivedAt: cutoff - 1000 }));

    // Act
    const results = await getArchivedRuns({ beforeArchivedAt: cutoff });

    // Assert — only runs strictly before cutoff
    expect(results.every((r: ArchivedLabRun) => r.archivedAt < cutoff)).toBe(true);
    expect(results.some((r: ArchivedLabRun) => r.id === 'old')).toBe(true);
    expect(results.some((r: ArchivedLabRun) => r.id === 'exact')).toBe(false);
    expect(results.some((r: ArchivedLabRun) => r.id === 'new')).toBe(false);
  });

  it('should surface the persisted ArchivedLabRun shape carrying cells, archivedAt and archivedReason', async () => {
    // Arrange — a run with a populated cells array
    const run = buildArchivedRun({
      id: 'run-cells',
      archivedAt: FIXED_TS + 7000,
      archivedReason: 'run-complete',
      cells: [{ id: 'cell-1' }] as unknown as LabRunRow['cells'],
    });
    archivedRunsStore.set(run.id, run);

    // Act
    const results = await getArchivedRuns();
    const first = results[0];

    // Assert — read path returns ArchivedLabRun (cells present, not a TestRunDTO)
    expect(first?.cells).toHaveLength(1);
    expect(first?.archivedAt).toBe(FIXED_TS + 7000);
    expect(first?.archivedReason).toBe('run-complete');
  });
});

describe('db/archivedRuns — getArchivedRunById', () => {
  beforeEach(() => {
    archivedRunsStore.clear();
    vi.clearAllMocks();
  });

  it('should return the matching run when it exists', async () => {
    // Arrange
    const run = buildArchivedRun({ id: 'found-id' });
    archivedRunsStore.set(run.id, run);

    // Act
    const result = await getArchivedRunById('found-id');

    // Assert
    expect(result).toBeDefined();
    expect(result?.id).toBe('found-id');
  });

  it('should return undefined when the id does not exist', async () => {
    // Act
    const result = await getArchivedRunById('ghost-id');

    // Assert
    expect(result).toBeUndefined();
  });
});

describe('db/archivedRuns — deleteArchivedRuns (FR-052)', () => {
  beforeEach(() => {
    archivedRunsStore.clear();
    vi.clearAllMocks();
  });

  it('should remove specified ids and leave other entries intact', async () => {
    // Arrange
    const keep = buildArchivedRun({ id: 'keep-me' });
    const del1 = buildArchivedRun({ id: 'del-1' });
    const del2 = buildArchivedRun({ id: 'del-2' });
    archivedRunsStore.set(keep.id, keep);
    archivedRunsStore.set(del1.id, del1);
    archivedRunsStore.set(del2.id, del2);

    // Act
    await deleteArchivedRuns(['del-1', 'del-2']);

    // Assert
    expect(archivedRunsStore.has('del-1')).toBe(false);
    expect(archivedRunsStore.has('del-2')).toBe(false);
    expect(archivedRunsStore.has('keep-me')).toBe(true);
  });

  it('should resolve without error when deleting an id that does not exist', async () => {
    // Act / Assert — no throw for phantom id
    await expect(deleteArchivedRuns(['does-not-exist'])).resolves.toBeUndefined();
  });
});

describe('db/archivedRuns — buildRunExport (FR-053)', () => {
  it('should return a single RunExport object with the correct schema when given one run', () => {
    // Arrange
    const run = buildArchivedRun({ id: 'export-1' });

    // Act
    const result = buildRunExport([run]);

    // Assert — single → single object (not array)
    expect(Array.isArray(result)).toBe(false);
    const single = result as { schema: string; run: ArchivedLabRun };
    expect(single.schema).toBe('aichatney.archived-run.v1');
    expect(single.run.id).toBe('export-1');
  });

  it('should return an array of RunExport objects when given multiple runs', () => {
    // Arrange
    const runs = [buildArchivedRun({ id: 'export-a' }), buildArchivedRun({ id: 'export-b' })];

    // Act
    const result = buildRunExport(runs);

    // Assert — multiple → array
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{ schema: string; run: ArchivedLabRun }>;
    expect(arr).toHaveLength(2);
    expect(arr.every(e => e.schema === 'aichatney.archived-run.v1')).toBe(true);
    expect(arr[0]?.run.id).toBe('export-a');
    expect(arr[1]?.run.id).toBe('export-b');
  });
});
