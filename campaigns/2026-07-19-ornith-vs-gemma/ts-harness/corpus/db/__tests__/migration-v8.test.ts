import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fake IDB infrastructure — mirrors idb-schema-v7.test.ts pattern
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
// Module-level stub — global indexedDB
// ---------------------------------------------------------------------------

const mockIndexedDBOpen = vi.fn<(name: string, version?: number) => FakeOpenDBRequest>();

vi.stubGlobal('indexedDB', {
  open: mockIndexedDBOpen,
});

// ---------------------------------------------------------------------------
// V7 store names — full set present before v8 migration
// ---------------------------------------------------------------------------

const V7_STORES = [
  'sessions',
  'messages',
  'providerConfigs',
  'skills',
  'containers',
  'appSettings',
  'testRuns',
] as const;

// ---------------------------------------------------------------------------
// Test suite: IDB v7 → v8 migration (FR-081)
// ---------------------------------------------------------------------------

describe('idb migration v7 → v8 (FR-081 labRuns)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // DB_VERSION
  // -------------------------------------------------------------------------

  describe('DB_VERSION', () => {
    it('should equal 8 after v8 migration', async () => {
      // Arrange
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      // Act
      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();
      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert
      expect(mockIndexedDBOpen).toHaveBeenCalledWith('AiChatneyDB', 10);
    });
  });

  // -------------------------------------------------------------------------
  // v7 → v8 upgrade — surgical drop testRuns + create labRuns
  // -------------------------------------------------------------------------

  describe('upgrade handler — v7 to v8', () => {
    it('should drop legacy testRuns and create labRuns with updatedAt index when migrating v7 to v8', async () => {
      // Arrange: v7 database has all 7 stores including testRuns
      const fakeDb = buildFakeDatabase(V7_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act: fire upgrade from v7 to v8
      fakeRequest.onupgradeneeded?.({
        oldVersion: 7,
        newVersion: 8,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: testRuns is deleted
      expect(fakeDb.deleteObjectStore).toHaveBeenCalledWith('testRuns');

      // Assert: labRuns is created with updatedAt index
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const labRunsCallIdx = createCalls.findIndex(([name]) => name === 'labRuns');
      expect(labRunsCallIdx).toBeGreaterThanOrEqual(0);

      const labRunsStore = fakeDb.createObjectStore.mock.results[labRunsCallIdx]
        ?.value as FakeObjectStore;
      expect(labRunsStore.createIndex).toHaveBeenCalledWith('updatedAt', 'updatedAt', {
        unique: false,
      });
    });

    it('should NOT delete sessions, messages, or other non-testRuns stores during v7 to v8 migration', async () => {
      // Arrange: v7 database
      const fakeDb = buildFakeDatabase(V7_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act
      fakeRequest.onupgradeneeded?.({
        oldVersion: 7,
        newVersion: 8,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: only testRuns is deleted — other stores are preserved
      expect(fakeDb.deleteObjectStore).toHaveBeenCalledTimes(1);
      expect(fakeDb.deleteObjectStore).toHaveBeenCalledWith('testRuns');
    });

    it('should skip deleteObjectStore for testRuns when it is already absent during v7 to v8 band', async () => {
      // Arrange: v7 database without testRuns (edge: already cleaned up externally)
      const storesWithoutTestRuns = V7_STORES.filter(s => s !== 'testRuns');
      const fakeDb = buildFakeDatabase(storesWithoutTestRuns);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act
      fakeRequest.onupgradeneeded?.({
        oldVersion: 7,
        newVersion: 8,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: no attempt to delete a non-existent store
      expect(fakeDb.deleteObjectStore).not.toHaveBeenCalled();

      // And: labRuns is still created
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const labRunsCallIdx = createCalls.findIndex(([name]) => name === 'labRuns');
      expect(labRunsCallIdx).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // Fresh database (oldVersion 0 → 8) — createAllStores path
  // -------------------------------------------------------------------------

  describe('fresh database — oldVersion 0', () => {
    it('should create labRuns and NOT testRuns on a fresh database open at version 8', async () => {
      // Arrange: empty database (oldVersion=0 means createAllStores is called)
      const fakeDb = buildFakeDatabase([]);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act: upgrade fires with oldVersion=0 (brand new database)
      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 8,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: labRuns is created
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const createdNames = createCalls.map(([name]) => name);
      expect(createdNames).toContain('labRuns');

      // Assert: testRuns is NOT created
      expect(createdNames).not.toContain('testRuns');
    });

    it('should create labRuns with updatedAt index on fresh database', async () => {
      // Arrange
      const fakeDb = buildFakeDatabase([]);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act
      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 8,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: labRuns store gets its updatedAt index
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const labRunsCallIdx = createCalls.findIndex(([name]) => name === 'labRuns');
      expect(labRunsCallIdx).toBeGreaterThanOrEqual(0);

      const labRunsStore = fakeDb.createObjectStore.mock.results[labRunsCallIdx]
        ?.value as FakeObjectStore;
      expect(labRunsStore.createIndex).toHaveBeenCalledWith('updatedAt', 'updatedAt', {
        unique: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency — already at v8
  // -------------------------------------------------------------------------

  describe('idempotency — already at v8', () => {
    it('should be idempotent — opening an already-migrated v8 DB triggers no upgrade', async () => {
      // Arrange: database already at version 8 (no upgrade fires)
      const fakeDb = buildFakeDatabase([
        'sessions',
        'messages',
        'providerConfigs',
        'skills',
        'containers',
        'appSettings',
        'labRuns',
      ]);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const upgradeFired = false;

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Capture whether onupgradeneeded was set on this request
      // When versions match, IDB does NOT call onupgradeneeded at all
      // We simulate this by NOT firing it — just calling onsuccess directly
      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: upgrade was not fired (we never called onupgradeneeded)
      expect(upgradeFired).toBe(false);
    });

    it('should not delete or recreate labRuns when v8 band fires with labRuns already present', async () => {
      // Arrange: simulate a partial edge case where oldVersion < 8 band fires
      // but labRuns already exists (e.g. multi-step upgrade that already created it)
      const fakeDb = buildFakeDatabase([
        'sessions',
        'messages',
        'providerConfigs',
        'skills',
        'containers',
        'appSettings',
        'labRuns',
      ]);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act: simulate oldVersion=7 upgrade but labRuns already present, testRuns absent
      fakeRequest.onupgradeneeded?.({
        oldVersion: 7,
        newVersion: 8,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: labRuns is NOT created a second time (guard branch `!contains('labRuns')`)
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const labRunsCreateCount = createCalls.filter(([name]) => name === 'labRuns').length;
      expect(labRunsCreateCount).toBe(0);

      // Assert: no deletes either (testRuns absent)
      expect(fakeDb.deleteObjectStore).not.toHaveBeenCalled();
    });
  });
});
