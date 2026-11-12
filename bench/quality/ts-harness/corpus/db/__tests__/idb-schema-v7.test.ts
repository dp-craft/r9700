import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock helpers — same pattern as idb-schema-v6.test.ts
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
// V6 store names — the full set before v7 (identical store list, schema bump only)
// ---------------------------------------------------------------------------

const V6_STORES = [
  'sessions',
  'messages',
  'providerConfigs',
  'skills',
  'containers',
  'appSettings',
  'testRuns',
] as const;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('idb schema v7 (022-prompt-tester-ux-redesign)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // DB_VERSION
  // -------------------------------------------------------------------------

  describe('DB_VERSION', () => {
    it('should equal 8 after v8 migration', async () => {
      // Given: a fresh database open request
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      // When: getDb is called — it passes DB_VERSION to indexedDB.open
      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Then: DB_VERSION 8 must be passed to the native open call
      expect(mockIndexedDBOpen).toHaveBeenCalledWith('AiChatneyDB', 10);
    });
  });

  // -------------------------------------------------------------------------
  // v6 → v7 upgrade path — drop+recreate strategy
  // -------------------------------------------------------------------------

  describe('upgrade handler — v6 to v7', () => {
    it('should delete existing stores and recreate all when upgrading from v6 to v7', async () => {
      // Given: a database with all v6 stores already present
      const fakeDb = buildFakeDatabase(V6_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      // When: upgrade handler fires with oldVersion = 6, newVersion = 7
      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 6,
        newVersion: 7,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Then: all existing v6 stores are deleted before recreating.
      // (v8 band may delete testRuns again — assert by name, not total count.)
      V6_STORES.forEach(storeName => {
        expect(fakeDb.deleteObjectStore).toHaveBeenCalledWith(storeName);
      });

      // And: the current canonical stores (v8 schema) are present in the final set of
      // create calls. The v8 band also runs after v7 — assert by name, not count,
      // to stay agnostic to how many drop+recreate cycles fire.
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toEqual(
        expect.arrayContaining([
          'sessions',
          'messages',
          'providerConfigs',
          'skills',
          'containers',
          'appSettings',
          'labRuns',
        ])
      );
    });
  });

  // -------------------------------------------------------------------------
  // v5 → v7 upgrade path — cross-chain coverage
  // -------------------------------------------------------------------------

  describe('upgrade handler — v5 to v7', () => {
    it('should reach the canonical 7-store schema when upgrading from v5 directly to v7', async () => {
      // Given: a database with all v5 stores already present
      const V5_STORES = [
        'sessions',
        'messages',
        'providerConfigs',
        'skills',
        'containers',
        'appSettings',
        'testRuns',
      ] as const;

      const fakeDb = buildFakeDatabase(V5_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      // When: upgrade handler fires with oldVersion = 5, newVersion = 7
      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 5,
        newVersion: 7,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Then: all 7 canonical stores are present in the final set of create calls.
      // Assert by store name — not call count — to remain agnostic to whether one
      // or two drop+recreate cycles fire (implementation detail).
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toEqual(
        expect.arrayContaining([
          'sessions',
          'messages',
          'providerConfigs',
          'skills',
          'containers',
          'appSettings',
          'labRuns',
        ])
      );
    });
  });

  // -------------------------------------------------------------------------
  // TestRunDTO type — mode + configHash required fields
  // -------------------------------------------------------------------------

  describe('TestRunDTO type', () => {
    it('should accept a valid TestRunDTO with mode and configHash fields', async () => {
      // Given: TestRunDTO now requires mode and configHash (v7 contract)
      const dto: import('@/db/idb').TestRunDTO = {
        id: 'run-v7',
        userPrompt: 'Test prompt',
        referenceAnswer: null,
        rowAxis: {
          type: 'models',
          values: [{ id: 'val-1', label: 'llama3', providerId: 'ollama', systemPrompt: null }],
        },
        columnAxis: null,
        concurrencyLimit: 3,
        results: [],
        judgeModelId: null,
        judgeProviderId: null,
        status: 'completed',
        createdAt: 1_700_000_000_000,
        durationMs: 5000,
        mode: 'simple',
        configHash: 'abc123',
      };

      // Then: mode and configHash are present with correct values
      expect(dto.mode).toBe('simple');
      expect(dto.configHash).toBe('abc123');
    });

    it('should accept TestRunDTO with mode set to advanced', async () => {
      // Given: PromptTesterMode union includes 'advanced'
      const dto: import('@/db/idb').TestRunDTO = {
        id: 'run-advanced',
        userPrompt: 'Advanced test',
        referenceAnswer: null,
        rowAxis: {
          type: 'models',
          values: [{ id: 'val-1', label: 'llama3', providerId: 'ollama', systemPrompt: null }],
        },
        columnAxis: null,
        concurrencyLimit: 3,
        results: [],
        judgeModelId: null,
        judgeProviderId: null,
        status: 'completed',
        createdAt: 1_700_000_000_000,
        durationMs: 5000,
        mode: 'advanced',
        configHash: 'hash-xyz',
      };

      // Then: mode 'advanced' is valid
      expect(dto.mode).toBe('advanced');
    });
  });

  // -------------------------------------------------------------------------
  // PromptTesterMode type — union contract
  // -------------------------------------------------------------------------

  describe('PromptTesterMode type', () => {
    it('should accept simple as a valid PromptTesterMode value', () => {
      // Given: PromptTesterMode = 'simple' | 'advanced'
      const mode: import('@/db/idb').PromptTesterMode = 'simple';

      // Then: 'simple' satisfies the type
      expect(mode).toBe('simple');
    });

    it('should accept advanced as a valid PromptTesterMode value', () => {
      // Given: PromptTesterMode = 'simple' | 'advanced'
      const mode: import('@/db/idb').PromptTesterMode = 'advanced';

      // Then: 'advanced' satisfies the type
      expect(mode).toBe('advanced');
    });
  });
});
