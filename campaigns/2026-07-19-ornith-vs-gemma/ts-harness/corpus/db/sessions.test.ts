import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSession } from './idb';

vi.mock('./idb', () => ({
  getDb: vi.fn(),
  promisifyRequest: vi.fn(),
  transactionComplete: vi.fn(),
}));

import * as idb from './idb';
import { deleteSession, getAllSessions, putSession } from './sessions';

// -- Constants --

const FIXED_TIMESTAMP = 1_700_000_000_000;

// -- Builders --

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
  id: 'session-1',
  title: 'Test Session',
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  model: 'llama3',
  providerId: 'ollama',
  skillSnapshot: null,
  ...overrides,
});

// -- Mock aliases --

const mockGetDb = idb.getDb as ReturnType<typeof vi.fn>;
const mockPromisifyRequest = idb.promisifyRequest as ReturnType<typeof vi.fn>;
const mockTransactionComplete = idb.transactionComplete as ReturnType<typeof vi.fn>;

// -- Fake DB factory --

interface FakeObjectStore {
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  index: ReturnType<typeof vi.fn>;
}

interface FakeDb {
  transaction: ReturnType<typeof vi.fn>;
}

const buildFakeDb = (objectStores: Record<string, Partial<FakeObjectStore>> = {}) => {
  const defaultStore: FakeObjectStore = {
    put: vi.fn().mockReturnValue({}),
    delete: vi.fn().mockReturnValue({}),
    index: vi.fn().mockReturnValue({ getAll: vi.fn().mockReturnValue({}) }),
  };

  const stores: Record<string, FakeObjectStore> = {
    sessions: { ...defaultStore, ...objectStores.sessions },
    messages: { ...defaultStore, ...objectStores.messages },
  };

  const fakeTx = {
    objectStore: vi.fn((name: string) => stores[name] ?? defaultStore),
  };

  const fakeDb: FakeDb = {
    transaction: vi.fn().mockReturnValue(fakeTx),
  };

  return { fakeDb, fakeTx, stores };
};

// -- Test suite --

describe('getAllSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return sessions in reverse-chronological order when sessions exist', async () => {
    const older = buildSession({ id: 'session-1', updatedAt: FIXED_TIMESTAMP });
    const newer = buildSession({ id: 'session-2', updatedAt: FIXED_TIMESTAMP + 1000 });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([older, newer]);

    const result = await getAllSessions();

    expect(result).toEqual([newer, older]);
  });

  it('should return empty array when no sessions exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    const result = await getAllSessions();

    expect(result).toEqual([]);
  });

  it('should open a readonly transaction on the sessions store', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllSessions();

    expect(fakeDb.transaction).toHaveBeenCalledWith('sessions', 'readonly');
    expect(fakeTx.objectStore).toHaveBeenCalledWith('sessions');
  });

  it('should query via the updatedAt index', async () => {
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllSessions();

    expect(stores.sessions.index).toHaveBeenCalledWith('updatedAt');
  });

  it('should pass the index getAll request to promisifyRequest', async () => {
    const fakeGetAllReq = { isFakeGetAllReq: true };
    const fakeIndex = { getAll: vi.fn().mockReturnValue(fakeGetAllReq) };
    const { fakeDb, stores } = buildFakeDb();
    stores.sessions.index = vi.fn().mockReturnValue(fakeIndex);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllSessions();

    expect(mockPromisifyRequest).toHaveBeenCalledWith(fakeGetAllReq);
  });
});

describe('putSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write the session to the sessions object store', async () => {
    const session = buildSession();
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putSession(session);

    expect(stores.sessions.put).toHaveBeenCalledWith(session);
  });

  it('should open a readwrite transaction on the sessions store', async () => {
    const session = buildSession();
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putSession(session);

    expect(fakeDb.transaction).toHaveBeenCalledWith('sessions', 'readwrite');
  });

  it('should await transaction completion after putting the session', async () => {
    const session = buildSession();
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putSession(session);

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should persist all session fields without mutation', async () => {
    const session = buildSession({
      id: 'sess-xyz',
      title: 'My Chat',
      model: 'mistral',
      providerId: 'openrouter',
      createdAt: 1_000,
      updatedAt: 2_000,
    });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putSession(session);

    const [saved] = stores.sessions.put.mock.calls[0] as [ChatSession];
    expect(saved).toEqual(session);
  });
});

describe('deleteSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delete the session record from the sessions store', async () => {
    const { fakeDb, stores } = buildFakeDb();
    // Simulate cursor returning null immediately (no messages)
    const fakeIndexReq = {
      onsuccess: null as ((ev: unknown) => void) | null,
      onerror: null as ((ev: unknown) => void) | null,
      result: null,
    };
    const fakeIndex = { openCursor: vi.fn().mockReturnValue(fakeIndexReq) };
    stores.messages.index = vi.fn().mockReturnValue(fakeIndex);

    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const deletePromise = deleteSession('session-1');

    // Trigger the onsuccess callback with null cursor (no messages)
    await Promise.resolve(); // Let the code set up the handlers
    if (fakeIndexReq.onsuccess) {
      fakeIndexReq.onsuccess({});
    }

    await deletePromise;

    expect(stores.sessions.delete).toHaveBeenCalledWith('session-1');
  });

  it('should open a readwrite transaction on both sessions and messages stores', async () => {
    const { fakeDb, stores } = buildFakeDb();
    const fakeIndexReq = {
      onsuccess: null as ((ev: unknown) => void) | null,
      onerror: null as ((ev: unknown) => void) | null,
      result: null,
    };
    const fakeIndex = { openCursor: vi.fn().mockReturnValue(fakeIndexReq) };
    stores.messages.index = vi.fn().mockReturnValue(fakeIndex);

    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const deletePromise = deleteSession('session-1');

    await Promise.resolve();
    if (fakeIndexReq.onsuccess) {
      fakeIndexReq.onsuccess({});
    }

    await deletePromise;

    expect(fakeDb.transaction).toHaveBeenCalledWith(['sessions', 'messages'], 'readwrite');
  });

  it('should use the sessionId_createdAt index for cursor query', async () => {
    const { fakeDb, stores } = buildFakeDb();
    const fakeIndexReq = {
      onsuccess: null as ((ev: unknown) => void) | null,
      onerror: null as ((ev: unknown) => void) | null,
      result: null,
    };
    const fakeIndex = { openCursor: vi.fn().mockReturnValue(fakeIndexReq) };
    stores.messages.index = vi.fn().mockReturnValue(fakeIndex);

    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const deletePromise = deleteSession('session-1');

    await Promise.resolve();
    if (fakeIndexReq.onsuccess) {
      fakeIndexReq.onsuccess({});
    }

    await deletePromise;

    expect(stores.messages.index).toHaveBeenCalledWith('sessionId_createdAt');
  });

  it('should use IDBKeyRange.bound for cursor query', async () => {
    const { fakeDb, stores } = buildFakeDb();
    const openCursorMock = vi.fn().mockReturnValue({
      onsuccess: null,
      onerror: null,
      result: null,
    });
    const fakeIndex = { openCursor: openCursorMock };
    stores.messages.index = vi.fn().mockReturnValue(fakeIndex);

    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const deletePromise = deleteSession('session-1');

    await Promise.resolve();
    const req = openCursorMock.mock.results[0]?.value;
    if (req?.onsuccess) {
      req.onsuccess({});
    }

    await deletePromise;

    const [rangeArg] = openCursorMock.mock.calls[0] as [IDBKeyRange];
    expect(rangeArg).toBeInstanceOf(IDBKeyRange);
  });

  it('should await transaction completion after deletes', async () => {
    const { fakeDb, fakeTx, stores } = buildFakeDb();
    const fakeIndexReq = {
      onsuccess: null as ((ev: unknown) => void) | null,
      onerror: null as ((ev: unknown) => void) | null,
      result: null,
    };
    const fakeIndex = { openCursor: vi.fn().mockReturnValue(fakeIndexReq) };
    stores.messages.index = vi.fn().mockReturnValue(fakeIndex);

    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const deletePromise = deleteSession('session-1');

    await Promise.resolve();
    if (fakeIndexReq.onsuccess) {
      fakeIndexReq.onsuccess({});
    }

    await deletePromise;

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });
});
