import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LabRunRow } from '../labRuns';

// ---------------------------------------------------------------------------
// In-memory store simulating an IDB object store + updatedAt index.
// ---------------------------------------------------------------------------

const memStore = new Map<string, LabRunRow>();

interface FakeRequest<T> {
  result: T;
}

const makeRequest = <T>(result: T): FakeRequest<T> => ({ result });

const fakeStore = {
  get: (id: string): FakeRequest<LabRunRow | undefined> => makeRequest(memStore.get(id)),
  put: (row: LabRunRow): FakeRequest<void> => {
    memStore.set(row.id, row);
    return makeRequest(undefined);
  },
  delete: (id: string): FakeRequest<void> => {
    memStore.delete(id);
    return makeRequest(undefined);
  },
  index: (_name: string) => ({
    getAll: (): FakeRequest<LabRunRow[]> => {
      const all = Array.from(memStore.values());
      // mimic IDB index sort ascending by updatedAt
      return makeRequest([...all].sort((a, b) => a.updatedAt - b.updatedAt));
    },
  }),
};

const fakeTx = {
  objectStore: (_name: string) => fakeStore,
};

const fakeDb = {
  transaction: (_store: string, _mode: string) => fakeTx,
};

vi.mock('../idb', () => ({
  getDb: vi.fn(async () => fakeDb),
  promisifyRequest: vi.fn(async <T>(req: FakeRequest<T>) => req.result),
  transactionComplete: vi.fn(async () => undefined),
}));

import { deleteLabRun, getAllLabRuns, getLabRunById, putLabRun } from '../labRuns';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildRow = (overrides: Partial<LabRunRow> = {}): LabRunRow => ({
  id: 'run-1',
  label: 'Futtatás 1',
  createdAt: 1_700_000_000_000,
  updatedAt: 0,
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'diff',
  sort: 'mean',
  group: 'model',
  gridCols: 3,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('db/labRuns', () => {
  beforeEach(() => {
    memStore.clear();
  });

  it('should create and retrieve a row by id', async () => {
    const row = buildRow();
    await putLabRun(row);

    const fetched = await getLabRunById(row.id);

    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe('run-1');
    expect(fetched?.label).toBe('Futtatás 1');
  });

  it('should overwrite on second put with same id (upsert)', async () => {
    const row = buildRow();
    await putLabRun(row);
    await putLabRun(buildRow({ label: 'new' }));

    const fetched = await getLabRunById(row.id);

    expect(fetched?.label).toBe('new');
    expect(memStore.size).toBe(1);
  });

  it('should stamp updatedAt = Date.now() internally on put', async () => {
    const beforePut = Date.now();
    await putLabRun(buildRow({ updatedAt: 0 }));
    const fetched = await getLabRunById('run-1');

    expect(fetched?.updatedAt).toBeGreaterThanOrEqual(beforePut);
  });

  it('should return rows reverse-chronologically by updatedAt', async () => {
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValueOnce(1_000);
    await putLabRun(buildRow({ id: 'a' }));

    nowSpy.mockReturnValueOnce(2_000);
    await putLabRun(buildRow({ id: 'b' }));

    nowSpy.mockReturnValueOnce(3_000);
    await putLabRun(buildRow({ id: 'c' }));

    const all = await getAllLabRuns();

    expect(all.map(r => r.id)).toEqual(['c', 'b', 'a']);

    nowSpy.mockRestore();
  });

  it('should delete a row by id', async () => {
    await putLabRun(buildRow());

    await deleteLabRun('run-1');

    const fetched = await getLabRunById('run-1');
    expect(fetched).toBeUndefined();
  });

  it('should no-op on deleteLabRun for missing id', async () => {
    await expect(deleteLabRun('nonexistent')).resolves.toBeUndefined();
  });
});
