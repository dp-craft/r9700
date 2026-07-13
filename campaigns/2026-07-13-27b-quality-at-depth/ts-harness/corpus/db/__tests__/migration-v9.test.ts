import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fake IDB infrastructure — mirrors migration-v8.test.ts pattern
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
// V8 store names — full set present before v9 migration
// ---------------------------------------------------------------------------

const V8_STORES = [
  'sessions',
  'messages',
  'providerConfigs',
  'skills',
  'containers',
  'appSettings',
  'labRuns',
] as const;

// ---------------------------------------------------------------------------
// Test suite: IDB v8 → v9 migration
// ---------------------------------------------------------------------------

describe('idb migration v8 → v9', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // DB_VERSION
  // -------------------------------------------------------------------------

  describe('DB_VERSION', () => {
    it('should equal 9', async () => {
      // Arrange
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      // Act
      const { DB_VERSION } = await import('@/db/idb');

      // Assert
      expect(DB_VERSION).toBe(10);
    });

    it('should open DB at version 9', async () => {
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
  // v8 → v9 upgrade — creates prompts and archivedRuns stores
  // -------------------------------------------------------------------------

  describe('upgrade handler — v8 to v9', () => {
    it('should create prompts store with keyPath id when migrating v8 to v9', async () => {
      // Arrange: v8 database
      const fakeDb = buildFakeDatabase(V8_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act: fire upgrade from v8 to v9
      fakeRequest.onupgradeneeded?.({
        oldVersion: 8,
        newVersion: 9,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: prompts store was created
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const promptsCall = createCalls.find(([name]) => name === 'prompts');
      expect(promptsCall).toBeDefined();
      expect(promptsCall?.[1]).toEqual({ keyPath: 'id' });
    });

    it('should create prompts store with no extra indexes when migrating v8 to v9', async () => {
      // Arrange
      const fakeDb = buildFakeDatabase(V8_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act
      fakeRequest.onupgradeneeded?.({
        oldVersion: 8,
        newVersion: 9,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: prompts store's createIndex is never called
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const promptsCallIdx = createCalls.findIndex(([name]) => name === 'prompts');
      expect(promptsCallIdx).toBeGreaterThanOrEqual(0);

      const promptsStore = fakeDb.createObjectStore.mock.results[promptsCallIdx]
        ?.value as FakeObjectStore;
      expect(promptsStore.createIndex).not.toHaveBeenCalled();
    });

    it('should create archivedRuns store with keyPath id when migrating v8 to v9', async () => {
      // Arrange
      const fakeDb = buildFakeDatabase(V8_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act
      fakeRequest.onupgradeneeded?.({
        oldVersion: 8,
        newVersion: 9,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: archivedRuns store was created with correct keyPath
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const archivedRunsCall = createCalls.find(([name]) => name === 'archivedRuns');
      expect(archivedRunsCall).toBeDefined();
      expect(archivedRunsCall?.[1]).toEqual({ keyPath: 'id' });
    });

    it('should create archivedRuns store with a non-unique archivedAt index when migrating v8 to v9', async () => {
      // Arrange
      const fakeDb = buildFakeDatabase(V8_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act
      fakeRequest.onupgradeneeded?.({
        oldVersion: 8,
        newVersion: 9,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: archivedRuns store has archivedAt index, not unique
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const archivedRunsCallIdx = createCalls.findIndex(([name]) => name === 'archivedRuns');
      expect(archivedRunsCallIdx).toBeGreaterThanOrEqual(0);

      const archivedRunsStore = fakeDb.createObjectStore.mock.results[archivedRunsCallIdx]
        ?.value as FakeObjectStore;
      expect(archivedRunsStore.createIndex).toHaveBeenCalledWith('archivedAt', 'archivedAt', {
        unique: false,
      });
    });

    it('should NOT touch existing stores when migrating v8 to v9', async () => {
      // Arrange: v8 database with all 7 stores
      const fakeDb = buildFakeDatabase(V8_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act
      fakeRequest.onupgradeneeded?.({
        oldVersion: 8,
        newVersion: 9,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: no existing store was deleted
      expect(fakeDb.deleteObjectStore).not.toHaveBeenCalled();

      // Assert: only the 2 new stores were created
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const createdNames = createCalls.map(([name]) => name);
      expect(createdNames).toContain('prompts');
      expect(createdNames).toContain('archivedRuns');
      expect(createdNames).not.toContain('sessions');
      expect(createdNames).not.toContain('messages');
      expect(createdNames).not.toContain('providerConfigs');
      expect(createdNames).not.toContain('skills');
      expect(createdNames).not.toContain('containers');
      expect(createdNames).not.toContain('appSettings');
      expect(createdNames).not.toContain('labRuns');
    });
  });

  // -------------------------------------------------------------------------
  // Fresh database (oldVersion 0 → 9) — createAllStores path
  // -------------------------------------------------------------------------

  describe('fresh database — oldVersion 0', () => {
    it('should include prompts store in fresh database created at version 9', async () => {
      // Arrange
      const fakeDb = buildFakeDatabase([]);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act: brand-new database
      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 9,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: prompts store exists in fresh DB
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const createdNames = createCalls.map(([name]) => name);
      expect(createdNames).toContain('prompts');
    });

    it('should include archivedRuns store in fresh database created at version 9', async () => {
      // Arrange
      const fakeDb = buildFakeDatabase([]);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);
      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      // Act
      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 9,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Assert: archivedRuns store exists in fresh DB
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const createdNames = createCalls.map(([name]) => name);
      expect(createdNames).toContain('archivedRuns');
    });
  });

  // -------------------------------------------------------------------------
  // New exported types — compile-time assertions (RED: these cause tsc errors
  // until the types are added to idb.ts)
  // -------------------------------------------------------------------------

  describe('new exported types', () => {
    it('should export PromptHistoryEntry as a named type from idb', () => {
      expectTypeOf<import('@/db/idb').PromptHistoryEntry>().not.toBeAny();
    });

    it('should export PromptReference as a named type from idb', () => {
      expectTypeOf<import('@/db/idb').PromptReference>().not.toBeAny();
    });

    it('should export PromptType as a named type from idb', () => {
      expectTypeOf<import('@/db/idb').PromptType>().not.toBeAny();
    });

    it('should export PromptSource as a named type from idb', () => {
      expectTypeOf<import('@/db/idb').PromptSource>().not.toBeAny();
    });

    it('should export ArchivedRun as a named type from idb', () => {
      expectTypeOf<import('@/db/idb').ArchivedRun>().not.toBeAny();
    });

    it('should export ArchivedReason as a named type from idb', () => {
      expectTypeOf<import('@/db/idb').ArchivedReason>().not.toBeAny();
    });
  });

  // -------------------------------------------------------------------------
  // ChatMessage optional assistant fields — compile-time + runtime assertions
  // -------------------------------------------------------------------------

  describe('ChatMessage optional assistant fields', () => {
    it('should have optional model field typed as string | undefined', () => {
      type ChatMessage = import('@/db/idb').ChatMessage;
      type ModelField = ChatMessage['model'];
      expectTypeOf<ModelField>().toEqualTypeOf<string | undefined>();
    });

    it('should have optional providerId field typed as string | undefined', () => {
      type ChatMessage = import('@/db/idb').ChatMessage;
      type Field = ChatMessage['providerId'];
      expectTypeOf<Field>().toEqualTypeOf<string | undefined>();
    });

    it('should have optional modelParams field typed as ModelParamsDTO | undefined', () => {
      type ChatMessage = import('@/db/idb').ChatMessage;
      type ModelParamsDTO = import('@/db/idb').ModelParamsDTO;
      type Field = ChatMessage['modelParams'];
      expectTypeOf<Field>().toEqualTypeOf<ModelParamsDTO | undefined>();
    });

    it('should have optional systemPromptSnapshot field typed as string | undefined', () => {
      type ChatMessage = import('@/db/idb').ChatMessage;
      type Field = ChatMessage['systemPromptSnapshot'];
      expectTypeOf<Field>().toEqualTypeOf<string | undefined>();
    });

    it('should allow constructing a ChatMessage with all optional assistant fields omitted', () => {
      type ChatMessage = import('@/db/idb').ChatMessage;
      // Compile error if these fields are required — they must be optional
      const msg: ChatMessage = {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'hello',
        createdAt: 0,
      };
      expect(msg.model).toBeUndefined();
      expect(msg.providerId).toBeUndefined();
      expect(msg.modelParams).toBeUndefined();
      expect(msg.systemPromptSnapshot).toBeUndefined();
    });

    it('should allow constructing a ChatMessage with all optional assistant fields present', () => {
      type ChatMessage = import('@/db/idb').ChatMessage;
      type ModelParamsDTO = import('@/db/idb').ModelParamsDTO;
      const params: ModelParamsDTO = {
        temperature: 0.7,
        maxTokens: 2048,
        topP: 1,
        thinkingEnabled: false,
        thinkingBudget: 0,
        contextSize: 4096,
      };
      const msg: ChatMessage = {
        id: 'msg-2',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'hello',
        createdAt: 0,
        model: 'gpt-4o',
        providerId: 'openrouter',
        modelParams: params,
        systemPromptSnapshot: 'You are helpful.',
      };
      expect(msg.model).toBe('gpt-4o');
      expect(msg.providerId).toBe('openrouter');
      expect(msg.modelParams?.temperature).toBe(0.7);
      expect(msg.systemPromptSnapshot).toBe('You are helpful.');
    });
  });
});
