import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock helpers for the global indexedDB API
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
// Module-level setup
// ---------------------------------------------------------------------------

const mockIndexedDBOpen = vi.fn<(name: string, version?: number) => FakeOpenDBRequest>();

vi.stubGlobal('indexedDB', {
  open: mockIndexedDBOpen,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('idb', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // DB_VERSION
  // -----------------------------------------------------------------------

  describe('DB_VERSION', () => {
    it('should equal 8 after v8 migration', async () => {
      // We cannot export DB_VERSION directly since it is module-private.
      // Instead, we verify the version number passed to indexedDB.open when
      // getDb is called.
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      // Trigger success to resolve the promise
      fakeRequest.onsuccess?.();
      await dbPromise;

      expect(mockIndexedDBOpen).toHaveBeenCalledWith('AiChatneyDB', 10);
    });
  });

  // -----------------------------------------------------------------------
  // SCHEMA — appSettings store
  // -----------------------------------------------------------------------

  describe('SCHEMA', () => {
    it('should include appSettings in the schema when creating all stores from scratch', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      // Simulate fresh install (oldVersion = 0)
      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toContain('appSettings');
    });

    it('should create appSettings with keyPath id and no indexes', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      // Simulate fresh install (oldVersion = 0)
      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const appSettingsCall = createCalls.find(([name]) => name === 'appSettings');

      expect(appSettingsCall).toBeDefined();
      expect(appSettingsCall?.[1]).toEqual({ keyPath: 'id' });

      // appSettings should NOT have any createIndex calls
      // Find the store object returned for appSettings
      const appSettingsCallIndex = createCalls.findIndex(([name]) => name === 'appSettings');
      const appSettingsStore = fakeDb.createObjectStore.mock.results[appSettingsCallIndex]
        ?.value as FakeObjectStore;
      expect(appSettingsStore.createIndex).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Upgrade handler — fresh install (oldVersion = 0)
  // -----------------------------------------------------------------------

  describe('upgrade handler — fresh install (oldVersion = 0)', () => {
    it('should create all 9 stores when oldVersion is 0', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
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

      expect(storeNames).toEqual(
        expect.arrayContaining([
          'sessions',
          'messages',
          'providerConfigs',
          'skills',
          'containers',
          'appSettings',
          'labRuns',
          'prompts',
          'archivedRuns',
        ])
      );
      expect(createCalls).toHaveLength(9);
    });

    it('should not delete any existing stores when oldVersion is 0', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      expect(fakeDb.deleteObjectStore).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Upgrade handler — v1 to v3 (oldVersion = 1)
  // -----------------------------------------------------------------------

  describe('upgrade handler — v1 to v3 (oldVersion = 1)', () => {
    it('should delete existing stores and recreate all stores including appSettings when upgrading from v1', async () => {
      const existingStores = ['sessions', 'messages', 'providerConfigs'];
      const fakeDb = buildFakeDatabase(existingStores);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 1,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // v1→v2 path: delete existing stores then recreate all
      expect(fakeDb.deleteObjectStore).toHaveBeenCalledTimes(existingStores.length);
      existingStores.forEach(name => {
        expect(fakeDb.deleteObjectStore).toHaveBeenCalledWith(name);
      });

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toContain('appSettings');
    });
  });

  // -----------------------------------------------------------------------
  // Upgrade handler — v2 to v3 (oldVersion = 2)
  // -----------------------------------------------------------------------

  describe('upgrade handler — v2 to v6 (oldVersion = 2)', () => {
    it('should add appSettings and testRuns then drop+recreate all via v6 when upgrading from v2', async () => {
      const fakeDb = buildFakeDatabase([
        'sessions',
        'messages',
        'providerConfigs',
        'skills',
        'containers',
      ]);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 2,
        newVersion: 6,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // v3 creates appSettings, v4 creates testRuns, v6 deletes all + recreates all 7
      expect(fakeDb.createObjectStore).toHaveBeenCalledWith('appSettings', {
        keyPath: 'id',
      });
      expect(fakeDb.createObjectStore).toHaveBeenCalledWith('testRuns', {
        keyPath: 'id',
      });
      // v6 drop+recreate also runs
      expect(fakeDb.deleteObjectStore).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Upgrade handler — indexes on fresh install
  // -----------------------------------------------------------------------

  describe('upgrade handler — indexes', () => {
    it('should create updatedAt index on sessions store during fresh install', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const sessionsCallIndex = createCalls.findIndex(([name]) => name === 'sessions');
      const sessionsStore = fakeDb.createObjectStore.mock.results[sessionsCallIndex]
        ?.value as FakeObjectStore;

      expect(sessionsStore.createIndex).toHaveBeenCalledWith('updatedAt', 'updatedAt', {
        unique: false,
      });
    });

    it('should create sessionId_createdAt compound index on messages store during fresh install', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 4,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const messagesCallIndex = createCalls.findIndex(([name]) => name === 'messages');
      const messagesStore = fakeDb.createObjectStore.mock.results[messagesCallIndex]
        ?.value as FakeObjectStore;

      expect(messagesStore.createIndex).toHaveBeenCalledWith(
        'sessionId_createdAt',
        ['sessionId', 'createdAt'],
        { unique: false }
      );
    });
  });

  // -----------------------------------------------------------------------
  // getDb caching
  // -----------------------------------------------------------------------

  describe('getDb', () => {
    it('should return the same promise on subsequent calls', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValue(fakeRequest);

      const { getDb } = await import('./idb');
      const promise1 = getDb();
      const promise2 = getDb();

      expect(promise1).toBe(promise2);
      expect(mockIndexedDBOpen).toHaveBeenCalledTimes(1);

      fakeRequest.onsuccess?.();
      await promise1;
    });

    it('should reject when indexedDB.open fails', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      const dbError = new DOMException('Open failed');
      fakeRequest.error = dbError;

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      fakeRequest.onerror?.();

      await expect(dbPromise).rejects.toBe(dbError);
    });

    it('should set onversionchange handler that closes the database', async () => {
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('./idb');
      const dbPromise = getDb();

      fakeRequest.onsuccess?.();
      await dbPromise;

      // The fakeDb should now have onversionchange set
      expect(fakeDb.onversionchange).toBeTypeOf('function');

      // Calling onversionchange should close the database
      fakeDb.onversionchange?.();
      expect(fakeDb.close).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // promisifyRequest
  // -----------------------------------------------------------------------

  describe('promisifyRequest', () => {
    it('should resolve with the request result on success', async () => {
      const { promisifyRequest } = await import('./idb');

      const fakeReq = {
        result: 'test-value',
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      } as unknown as IDBRequest<string>;

      const promise = promisifyRequest(fakeReq);

      (fakeReq as unknown as { onsuccess: () => void }).onsuccess();

      await expect(promise).resolves.toBe('test-value');
    });

    it('should reject with the request error on failure', async () => {
      const { promisifyRequest } = await import('./idb');

      const reqError = new DOMException('Request failed');
      const fakeReq = {
        result: undefined,
        error: reqError,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      } as unknown as IDBRequest<string>;

      const promise = promisifyRequest(fakeReq);

      (fakeReq as unknown as { onerror: () => void }).onerror();

      await expect(promise).rejects.toBe(reqError);
    });
  });

  // -----------------------------------------------------------------------
  // transactionComplete
  // -----------------------------------------------------------------------

  describe('transactionComplete', () => {
    it('should resolve when the transaction completes', async () => {
      const { transactionComplete } = await import('./idb');

      const fakeTx = {
        error: null,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
      } as unknown as IDBTransaction;

      const promise = transactionComplete(fakeTx);

      (fakeTx as unknown as { oncomplete: () => void }).oncomplete();

      await expect(promise).resolves.toBeUndefined();
    });

    it('should reject with the transaction error when it fails', async () => {
      const { transactionComplete } = await import('./idb');

      const txError = new DOMException('Transaction failed');
      const fakeTx = {
        error: txError,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
      } as unknown as IDBTransaction;

      const promise = transactionComplete(fakeTx);

      (fakeTx as unknown as { onerror: () => void }).onerror();

      await expect(promise).rejects.toBe(txError);
    });

    it('should reject with DOMException when the transaction is aborted', async () => {
      const { transactionComplete } = await import('./idb');

      const fakeTx = {
        error: null,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
      } as unknown as IDBTransaction;

      const promise = transactionComplete(fakeTx);

      (fakeTx as unknown as { onabort: () => void }).onabort();

      await expect(promise).rejects.toBeInstanceOf(DOMException);
      await expect(promise).rejects.toThrow('Transaction aborted');
    });
  });

  // -----------------------------------------------------------------------
  // Type exports — AppSettingDTO
  // -----------------------------------------------------------------------

  describe('AppSettingDTO export', () => {
    it('should be exported as a named type from the module', async () => {
      // This test verifies that AppSettingDTO is exported from idb.ts.
      // It imports the module and checks the type is usable at compile time.
      // When AppSettingDTO is added, this import will succeed; until then,
      // the TypeScript compiler will flag the type as missing.
      const mod = await import('./idb');

      // Construct an object matching the expected AppSettingDTO shape.
      // If the type exists but has a different shape, tsc will error.
      const setting: import('./idb').AppSettingDTO = {
        id: 'uiLanguage',
        value: 'hu',
      };

      expect(setting).toEqual({ id: 'uiLanguage', value: 'hu' });
      // Verify module loaded (runtime sanity)
      expect(mod).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // ChatMessage DTO — pipelineTrace field
  // -----------------------------------------------------------------------

  describe('ChatMessage DTO — pipelineTrace field', () => {
    it('should accept ChatMessage without pipelineTrace (backward compatible)', async () => {
      // When pipelineTrace is added as optional, existing messages without
      // the field must still satisfy the ChatMessage interface.
      const msg: import('./idb').ChatMessage = {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Hello',
        createdAt: 1_700_000_000_000,
      };

      expect(msg.id).toBe('msg-1');
      expect(msg).not.toHaveProperty('pipelineTrace');
    });

    it('should accept ChatMessage with pipelineTrace set to null', async () => {
      // pipelineTrace?: PipelineTrace | null — null means "pipeline ran
      // but produced no trace" vs undefined meaning "no pipeline ran"
      const msg: import('./idb').ChatMessage = {
        id: 'msg-2',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Translated response',
        createdAt: 1_700_000_000_000,
        pipelineTrace: null,
      };

      expect(msg.pipelineTrace).toBeNull();
    });

    it('should accept ChatMessage with a full pipelineTrace object', async () => {
      const msg: import('./idb').ChatMessage = {
        id: 'msg-3',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Translated output',
        createdAt: 1_700_000_000_000,
        pipelineTrace: {
          pipelineId: 'pipe-1',
          agentType: 'translation',
          steps: [
            {
              stepId: 'translate-input',
              label: 'Translate input',
              providerId: 'ollama',
              modelId: 'gemma3:1b',
              input: 'Hello',
              output: 'Szia',
              startedAt: 1_700_000_000_000,
              endedAt: 1_700_000_001_000,
              durationMs: 1000,
              tokenCount: 5,
              status: 'completed',
              error: null,
            },
          ],
          totalDurationMs: 1000,
          status: 'completed',
        },
      };

      expect(msg.pipelineTrace?.pipelineId).toBe('pipe-1');
      expect(msg.pipelineTrace?.steps).toHaveLength(1);
    });
  });
});
