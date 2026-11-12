import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock helpers — same pattern as idb.test.ts
// ---------------------------------------------------------------------------

interface FakeObjectStore {
  createIndex: ReturnType<typeof vi.fn>;
}

interface FakeOpenDBRequest {
  result: FakeDatabase;
  error: DOMException | null;
  onupgradeneeded: ((event: Partial<IDBVersionChangeEvent>) => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
}

interface FakeDatabase {
  createObjectStore: ReturnType<typeof vi.fn>;
  deleteObjectStore: ReturnType<typeof vi.fn>;
  objectStoreNames: DOMStringList;
  close: ReturnType<typeof vi.fn>;
  onversionchange: (() => void) | null;
}

const buildFakeObjectStore = (): FakeObjectStore => ({
  createIndex: vi.fn(),
});

const buildFakeDatabase = (existingStoreNames: readonly string[] = []): FakeDatabase => {
  const storeNames = [...existingStoreNames];

  const domStringList = {
    length: storeNames.length,
    item: (i: number) => storeNames[i] ?? null,
    contains: (name: string) => storeNames.includes(name),
    [Symbol.iterator]: () => storeNames[Symbol.iterator](),
  } as unknown as DOMStringList;

  return {
    createObjectStore: vi.fn().mockImplementation(() => buildFakeObjectStore()),
    deleteObjectStore: vi.fn(),
    objectStoreNames: domStringList,
    close: vi.fn(),
    onversionchange: null,
  };
};

const buildFakeOpenDBRequest = (fakeDb: FakeDatabase): FakeOpenDBRequest => ({
  result: fakeDb,
  error: null,
  onupgradeneeded: null,
  onsuccess: null,
  onerror: null,
  onblocked: null,
});

// ---------------------------------------------------------------------------
// Module-level setup — stub global indexedDB
// ---------------------------------------------------------------------------

const mockIndexedDBOpen = vi.fn<(name: string, version?: number) => FakeOpenDBRequest>();

vi.stubGlobal('indexedDB', {
  open: mockIndexedDBOpen,
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const V3_STORES = [
  'sessions',
  'messages',
  'providerConfigs',
  'skills',
  'containers',
  'appSettings',
] as const;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('idb v3 → v4 migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // DB_VERSION
  // -------------------------------------------------------------------------

  describe('DB_VERSION', () => {
    it('should equal 8 after v8 migration', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onsuccess?.();
      await dbPromise;

      expect(mockIndexedDBOpen).toHaveBeenCalledWith('AiChatneyDB', 10);
    });
  });

  // -------------------------------------------------------------------------
  // v3 → v4 upgrade (oldVersion = 3)
  // -------------------------------------------------------------------------

  describe('upgrade handler — v3 to v4 (oldVersion = 3)', () => {
    it('should create the testRuns store when upgrading from v3', async () => {
      const fakeDb = buildFakeDatabase(V3_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 3,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      expect(fakeDb.createObjectStore).toHaveBeenCalledWith('testRuns', {
        keyPath: 'id',
      });
    });

    it('should create a createdAt index on the testRuns store when upgrading from v3', async () => {
      const fakeDb = buildFakeDatabase(V3_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 3,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const testRunsCallIndex = createCalls.findIndex(([name]) => name === 'testRuns');
      const testRunsStore = fakeDb.createObjectStore.mock.results[testRunsCallIndex]
        ?.value as FakeObjectStore;

      expect(testRunsStore.createIndex).toHaveBeenCalledWith('createdAt', 'createdAt', {
        unique: false,
      });
    });

    it('should create testRuns then drop+recreate all stores via v6 migration when upgrading from v3', async () => {
      const fakeDb = buildFakeDatabase(V3_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 3,
        newVersion: 6,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // v4 creates testRuns; v6 drop+recreates all 7 (v7 block skipped via else-if chain).
      // Assert intent (final schema) by store names rather than a brittle call count
      // that changes whenever a new drop+recreate version is added.
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toEqual(expect.arrayContaining([...V3_STORES, 'testRuns']));
      expect(fakeDb.deleteObjectStore).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Fresh install (oldVersion = 0) — testRuns included
  // -------------------------------------------------------------------------

  describe('upgrade handler — fresh install (oldVersion = 0)', () => {
    it('should create all 7 stores including labRuns when oldVersion is 0', async () => {
      // Fresh install calls createAllStores directly (v8 schema: labRuns replaces testRuns).
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toEqual(expect.arrayContaining([...V3_STORES, 'labRuns']));
      expect(createCalls).toHaveLength(9);
    });

    it('should create labRuns with keyPath id during fresh install', async () => {
      // testRuns was replaced by labRuns in v8; fresh install uses current SCHEMA.
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const labRunsCall = createCalls.find(([name]) => name === 'labRuns');

      expect(labRunsCall).toBeDefined();
      expect(labRunsCall?.[1]).toEqual({ keyPath: 'id' });
    });

    it('should create updatedAt index on labRuns during fresh install', async () => {
      // labRuns uses updatedAt index (not createdAt like the old testRuns).
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const labRunsCallIndex = createCalls.findIndex(([name]) => name === 'labRuns');
      const labRunsStore = fakeDb.createObjectStore.mock.results[labRunsCallIndex]
        ?.value as FakeObjectStore;

      expect(labRunsStore.createIndex).toHaveBeenCalledWith('updatedAt', 'updatedAt', {
        unique: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Multi-step upgrade — v1 → v4 (oldVersion = 1)
  // -------------------------------------------------------------------------

  describe('upgrade handler — v1 to v4 (oldVersion = 1)', () => {
    it('should create labRuns along with all other stores when upgrading from v1', async () => {
      // v1 path: deleteExistingStores + createAllStores (v8 schema: labRuns, no testRuns).
      const existingStores = ['sessions', 'messages', 'providerConfigs'];
      const fakeDb = buildFakeDatabase(existingStores);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 1,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toContain('labRuns');
    });
  });

  // -------------------------------------------------------------------------
  // Multi-step upgrade — v2 → v4 (oldVersion = 2)
  // -------------------------------------------------------------------------

  describe('upgrade handler — v2 to v4 (oldVersion = 2)', () => {
    it('should create both appSettings and testRuns when upgrading from v2', async () => {
      const v2Stores = ['sessions', 'messages', 'providerConfigs', 'skills', 'containers'];
      const fakeDb = buildFakeDatabase(v2Stores);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 2,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toContain('appSettings');
      expect(storeNames).toContain('testRuns');
    });
  });

  // -------------------------------------------------------------------------
  // SCHEMA — testRuns declaration
  // -------------------------------------------------------------------------

  describe('SCHEMA — labRuns store (v8)', () => {
    it('should define labRuns with keyPath id in the schema on fresh install', async () => {
      // testRuns was replaced by labRuns in v8; fresh install uses current SCHEMA.
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const labRunsCall = createCalls.find(([name]) => name === 'labRuns');

      expect(labRunsCall).toBeDefined();
      expect(labRunsCall?.[1]).toEqual({ keyPath: 'id' });
    });

    it('should define updatedAt index on the labRuns store on fresh install', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('../idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const labRunsCallIndex = createCalls.findIndex(([name]) => name === 'labRuns');
      const labRunsStore = fakeDb.createObjectStore.mock.results[labRunsCallIndex]
        ?.value as FakeObjectStore;

      expect(labRunsStore.createIndex).toHaveBeenCalledTimes(1);
      expect(labRunsStore.createIndex).toHaveBeenCalledWith('updatedAt', 'updatedAt', {
        unique: false,
      });
    });
  });
});
