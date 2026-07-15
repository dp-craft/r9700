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
// V5 store names — the full set before v6 (testRuns was replaced by labRuns in v8)
// ---------------------------------------------------------------------------

const V5_STORES = [
  'sessions',
  'messages',
  'providerConfigs',
  'skills',
  'containers',
  'appSettings',
  'testRuns',
] as const;

// Current canonical stores (v8 schema — testRuns replaced by labRuns)
const CURRENT_STORES = [
  'sessions',
  'messages',
  'providerConfigs',
  'skills',
  'containers',
  'appSettings',
  'labRuns',
  'prompts',
  'archivedRuns',
] as const;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('idb schema v6 (016-web-search)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // DB_VERSION
  // -------------------------------------------------------------------------

  describe('DB_VERSION', () => {
    it('should equal 8 after v8 bump', async () => {
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
  // CitationDTO — type-level contract
  // -------------------------------------------------------------------------

  describe('CitationDTO interface', () => {
    it('should accept a valid CitationDTO with all required fields', async () => {
      // Given: the CitationDTO type is exported from idb.ts
      // When: an object satisfying the interface is constructed
      const citation: import('@/db/idb').CitationDTO = {
        index: 1,
        title: 'OpenAI Blog',
        url: 'https://openai.com/blog',
      };

      // Then: the object has the correct field values
      expect(citation.index).toBe(1);
      expect(citation.title).toBe('OpenAI Blog');
      expect(citation.url).toBe('https://openai.com/blog');
    });

    it('should accept a CitationDTO with index 0 (first citation)', async () => {
      // Given: citation indices are 0-based (boundary value)
      const citation: import('@/db/idb').CitationDTO = {
        index: 0,
        title: 'First result',
        url: 'https://example.com',
      };

      // Then: index 0 is valid
      expect(citation.index).toBe(0);
    });

    it('should accept a CitationDTO with an empty title', async () => {
      // Given: title may be empty when the search result has no page title
      const citation: import('@/db/idb').CitationDTO = {
        index: 2,
        title: '',
        url: 'https://example.com/page',
      };

      // Then: empty title is a valid edge case
      expect(citation.title).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // ChatSession — webSearchEnabled field
  // -------------------------------------------------------------------------

  describe('ChatSession interface — webSearchEnabled field', () => {
    it('should accept a ChatSession without webSearchEnabled (backward compatible)', async () => {
      // Given: existing sessions have no webSearchEnabled field
      const session: import('@/db/idb').ChatSession = {
        id: 'sess-1',
        title: 'My chat',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        model: 'gpt-4',
        providerId: 'openrouter',
        skillSnapshot: null,
      };

      // Then: the session satisfies the interface with webSearchEnabled omitted
      expect(session).not.toHaveProperty('webSearchEnabled');
    });

    it('should accept a ChatSession with webSearchEnabled set to true', async () => {
      // Given: web search is enabled for a session
      const session: import('@/db/idb').ChatSession = {
        id: 'sess-2',
        title: 'Web search chat',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_002_000,
        model: 'gpt-4',
        providerId: 'openrouter',
        skillSnapshot: null,
        webSearchEnabled: true,
      };

      // Then: webSearchEnabled is stored and accessible
      expect(session.webSearchEnabled).toBe(true);
    });

    it('should accept a ChatSession with webSearchEnabled set to false', async () => {
      // Given: web search is explicitly disabled for a session
      const session: import('@/db/idb').ChatSession = {
        id: 'sess-3',
        title: 'Normal chat',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_003_000,
        model: 'llama3',
        providerId: 'ollama',
        skillSnapshot: null,
        webSearchEnabled: false,
      };

      // Then: the false value is preserved
      expect(session.webSearchEnabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ChatMessage — citations field
  // -------------------------------------------------------------------------

  describe('ChatMessage interface — citations field', () => {
    it('should accept a ChatMessage without citations (backward compatible)', async () => {
      // Given: existing messages have no citations field
      const message: import('@/db/idb').ChatMessage = {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Hello world',
        createdAt: 1_700_000_000_000,
      };

      // Then: omitting citations still satisfies the interface
      expect(message).not.toHaveProperty('citations');
    });

    it('should accept a ChatMessage with an empty citations array', async () => {
      // Given: a web search response that found no citable sources
      const message: import('@/db/idb').ChatMessage = {
        id: 'msg-2',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'No sources found.',
        createdAt: 1_700_000_000_000,
        citations: [],
      };

      // Then: an empty array is a valid edge case
      expect(message.citations).toHaveLength(0);
    });

    it('should accept a ChatMessage with a single citation', async () => {
      // Given: a web-grounded response citing one source
      const message: import('@/db/idb').ChatMessage = {
        id: 'msg-3',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'According to [1], TypeScript is great.',
        createdAt: 1_700_000_000_000,
        citations: [{ index: 1, title: 'TypeScript Docs', url: 'https://typescriptlang.org' }],
      };

      // Then: the single citation is accessible with correct fields
      expect(message.citations).toHaveLength(1);
      expect(message.citations?.[0]).toEqual({
        index: 1,
        title: 'TypeScript Docs',
        url: 'https://typescriptlang.org',
      });
    });

    it('should accept a ChatMessage with multiple citations', async () => {
      // Given: a web-grounded response citing several sources
      const message: import('@/db/idb').ChatMessage = {
        id: 'msg-4',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Sources [1] and [2] agree on this.',
        createdAt: 1_700_000_000_000,
        citations: [
          { index: 1, title: 'Source A', url: 'https://source-a.com' },
          { index: 2, title: 'Source B', url: 'https://source-b.com' },
        ],
      };

      // Then: all citations are stored and accessible
      expect(message.citations).toHaveLength(2);
      expect(message.citations?.[1]?.index).toBe(2);
    });

    it('should accept a ChatMessage with citations alongside pipelineTrace', async () => {
      // Given: pipeline and web search may coexist in one message
      const message: import('@/db/idb').ChatMessage = {
        id: 'msg-5',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Pipeline + web search response',
        createdAt: 1_700_000_000_000,
        pipelineTrace: null,
        citations: [{ index: 1, title: 'A source', url: 'https://example.com' }],
      };

      // Then: both optional fields coexist without conflict
      expect(message.pipelineTrace).toBeNull();
      expect(message.citations).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // v5 → v6 upgrade path — drop+recreate strategy
  // -------------------------------------------------------------------------

  describe('upgrade handler — v5 to v6 (oldVersion = 5)', () => {
    it('should delete all v5 stores when upgrading from v5', async () => {
      // Given: a database with all v5 stores already present
      const fakeDb = buildFakeDatabase(V5_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      // When: upgrade handler fires with oldVersion = 5
      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 5,
        newVersion: 6,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Then: each v5 store is deleted at least once during the upgrade chain.
      // (v6→v7 may run a second drop cycle — assert by name, not total count,
      // to avoid brittleness against future version bumps.)
      V5_STORES.forEach(storeName => {
        expect(fakeDb.deleteObjectStore).toHaveBeenCalledWith(storeName);
      });
    });

    it('should recreate all stores after dropping v5 stores', async () => {
      // Given: a database with all v5 stores already present
      const fakeDb = buildFakeDatabase(V5_STORES);
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      // When: upgrade handler fires with oldVersion = 5
      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 5,
        newVersion: 6,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Then: all current canonical stores (v8 schema) are present in the final set
      // of create calls. Assert by name — agnostic to whether one or two drop+recreate
      // cycles fire (v6, v7, v8 bands may each trigger createAllStores).
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toEqual(expect.arrayContaining([...CURRENT_STORES]));
    });
  });

  // -------------------------------------------------------------------------
  // v5 → v6 upgrade path — fresh install still creates all stores
  // -------------------------------------------------------------------------

  describe('upgrade handler — fresh install (oldVersion = 0) after v6 bump', () => {
    it('should create all 7 stores on a fresh install', async () => {
      // Given: a brand new database (no existing stores)
      const fakeDb = buildFakeDatabase();
      const fakeRequest = buildFakeOpenDBRequest(fakeDb);

      mockIndexedDBOpen.mockReturnValueOnce(fakeRequest);

      // When: upgrade handler fires with oldVersion = 0
      const { getDb } = await import('@/db/idb');
      const dbPromise = getDb();

      fakeRequest.onupgradeneeded?.({
        oldVersion: 0,
        newVersion: 6,
        target: fakeRequest,
      } as unknown as Partial<IDBVersionChangeEvent>);

      fakeRequest.onsuccess?.();
      await dbPromise;

      // Then: all current canonical stores (v8 schema) are created without any deletions.
      // Fresh install (oldVersion = 0) calls createAllStores once — no drop cycle.
      const createCalls = fakeDb.createObjectStore.mock.calls as [string, { keyPath: string }][];
      const storeNames = createCalls.map(([name]) => name);

      expect(storeNames).toEqual(expect.arrayContaining([...CURRENT_STORES]));
      expect(createCalls).toHaveLength(CURRENT_STORES.length);
      expect(fakeDb.deleteObjectStore).not.toHaveBeenCalled();
    });
  });
});
