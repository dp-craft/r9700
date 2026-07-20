import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, ChatSession } from './idb';

vi.mock('./idb', () => ({
  getDb: vi.fn(),
  promisifyRequest: vi.fn(),
  transactionComplete: vi.fn(),
}));

import * as idb from './idb';
import { deleteMessagesBySession, getMessages, putMessage } from './messages';

// -- Constants --

const FIXED_TIMESTAMP = 1_700_000_000_000;

// -- Builders --

const buildMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: 'message-1',
  sessionId: 'session-1',
  role: 'user',
  content: 'Hello',
  createdAt: FIXED_TIMESTAMP,
  ...overrides,
});

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
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  index: ReturnType<typeof vi.fn>;
}

interface FakeTx {
  objectStore: ReturnType<typeof vi.fn>;
}

interface FakeDb {
  transaction: ReturnType<typeof vi.fn>;
}

const buildFakeDb = (storeOverrides: Record<string, Partial<FakeObjectStore>> = {}) => {
  const defaultStore = (): FakeObjectStore => ({
    put: vi.fn().mockReturnValue({}),
    get: vi.fn().mockReturnValue({ result: undefined }),
    delete: vi.fn().mockReturnValue({}),
    index: vi.fn().mockReturnValue({ getAll: vi.fn().mockReturnValue({}) }),
  });

  const stores: Record<string, FakeObjectStore> = {
    messages: { ...defaultStore(), ...storeOverrides.messages },
    sessions: { ...defaultStore(), ...storeOverrides.sessions },
  };

  const fakeTx: FakeTx = {
    objectStore: vi.fn((name: string) => stores[name] ?? defaultStore()),
  };

  const fakeDb: FakeDb = {
    transaction: vi.fn().mockReturnValue(fakeTx),
  };

  return { fakeDb, fakeTx, stores };
};

// -- Test suites --

describe('getMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return messages for the given sessionId in ascending createdAt order', async () => {
    const msg1 = buildMessage({ id: 'msg-1', createdAt: FIXED_TIMESTAMP });
    const msg2 = buildMessage({
      id: 'msg-2',
      role: 'assistant',
      content: 'Hi',
      createdAt: FIXED_TIMESTAMP + 500,
    });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([msg1, msg2]);

    const result = await getMessages('session-1');

    expect(result).toEqual([msg1, msg2]);
  });

  it('should return empty array when session has no messages', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    const result = await getMessages('session-1');

    expect(result).toEqual([]);
  });

  it('should open a readonly transaction on the messages store', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getMessages('session-1');

    expect(fakeDb.transaction).toHaveBeenCalledWith('messages', 'readonly');
  });

  it('should query via the sessionId_createdAt compound index', async () => {
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getMessages('session-1');

    expect(stores.messages.index).toHaveBeenCalledWith('sessionId_createdAt');
  });

  it('should use IDBKeyRange.bound for query', async () => {
    const fakeGetAllReq = { tag: 'fake-getAll-req' };
    const fakeIndex = { getAll: vi.fn().mockReturnValue(fakeGetAllReq) };
    const { fakeDb, stores } = buildFakeDb();
    stores.messages.index = vi.fn().mockReturnValue(fakeIndex);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getMessages('session-1');

    const [rangeArg] = fakeIndex.getAll.mock.calls[0] as [IDBKeyRange];
    expect(rangeArg).toBeInstanceOf(IDBKeyRange);
  });

  it('should pass the index getAll request to promisifyRequest', async () => {
    const fakeGetAllReq = { tag: 'fake-getAll-req' };
    const fakeIndex = { getAll: vi.fn().mockReturnValue(fakeGetAllReq) };
    const { fakeDb, stores } = buildFakeDb();
    stores.messages.index = vi.fn().mockReturnValue(fakeIndex);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getMessages('session-1');

    expect(mockPromisifyRequest).toHaveBeenCalledWith(fakeGetAllReq);
  });
});

describe('putMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write the message to the messages object store', async () => {
    const message = buildMessage();
    const sessReq = { result: undefined };
    const { fakeDb, stores } = buildFakeDb();
    stores.sessions.get = vi.fn().mockReturnValue(sessReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putMessage(message);

    expect(stores.messages.put).toHaveBeenCalledWith(message);
  });

  it('should open a readwrite transaction on both messages and sessions stores', async () => {
    const message = buildMessage();
    const sessReq = { result: undefined };
    const { fakeDb, stores } = buildFakeDb();
    stores.sessions.get = vi.fn().mockReturnValue(sessReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putMessage(message);

    expect(fakeDb.transaction).toHaveBeenCalledWith(['messages', 'sessions'], 'readwrite');
  });

  it('should get session by sessionId from the sessions store', async () => {
    const message = buildMessage({ sessionId: 'session-abc' });
    const sessReq = { result: undefined };
    const { fakeDb, stores } = buildFakeDb();
    stores.sessions.get = vi.fn().mockReturnValue(sessReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putMessage(message);

    expect(stores.sessions.get).toHaveBeenCalledWith('session-abc');
  });

  it('should update session updatedAt when session exists', async () => {
    const message = buildMessage({ createdAt: FIXED_TIMESTAMP + 9999 });
    const session = buildSession({ updatedAt: FIXED_TIMESTAMP });
    const sessReq = { result: session };
    const { fakeDb, stores } = buildFakeDb();
    stores.sessions.get = vi.fn().mockReturnValue(sessReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putMessage(message);

    // The implementation mutates sessReq.result.updatedAt directly
    expect(session.updatedAt).toBe(FIXED_TIMESTAMP + 9999);
    expect(stores.sessions.put).toHaveBeenCalledWith(session);
  });

  it('should not update sessions store when the session does not exist', async () => {
    const message = buildMessage({ sessionId: 'non-existent' });
    const sessReq = { result: undefined };
    const { fakeDb, stores } = buildFakeDb();
    stores.sessions.get = vi.fn().mockReturnValue(sessReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putMessage(message);

    expect(stores.sessions.put).not.toHaveBeenCalled();
  });

  it('should await transaction completion', async () => {
    const message = buildMessage();
    const sessReq = { result: undefined };
    const { fakeDb, fakeTx, stores } = buildFakeDb();
    stores.sessions.get = vi.fn().mockReturnValue(sessReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putMessage(message);

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should persist all message fields without mutation', async () => {
    const message = buildMessage({
      id: 'msg-xyz',
      sessionId: 'session-42',
      role: 'assistant',
      content: 'A long reply',
      createdAt: 99_999,
    });
    const sessReq = { result: undefined };
    const { fakeDb, stores } = buildFakeDb();
    stores.sessions.get = vi.fn().mockReturnValue(sessReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putMessage(message);

    const [savedMsg] = stores.messages.put.mock.calls[0] as [ChatMessage];
    expect(savedMsg).toEqual(message);
  });
});

describe('deleteMessagesBySession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should open a readwrite transaction on the messages store only', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteMessagesBySession('session-1');

    expect(fakeDb.transaction).toHaveBeenCalledWith('messages', 'readwrite');
    expect(fakeDb.transaction).not.toHaveBeenCalledWith(
      expect.arrayContaining(['sessions']),
      expect.anything()
    );
  });

  it('should query the sessionId_createdAt index to find matching messages', async () => {
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteMessagesBySession('session-1');

    expect(stores.messages.index).toHaveBeenCalledWith('sessionId_createdAt');
  });

  it('should delete all messages returned by the index getAll', async () => {
    const msg1 = buildMessage({ id: 'msg-1', sessionId: 'session-1' });
    const msg2 = buildMessage({ id: 'msg-2', sessionId: 'session-1', role: 'assistant' });
    const fakeGetAllReq = { tag: 'fake-getAll-req' };
    const fakeIndex = { getAll: vi.fn().mockReturnValue(fakeGetAllReq) };
    const { fakeDb, stores } = buildFakeDb();
    stores.messages.index = vi.fn().mockReturnValue(fakeIndex);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([msg1, msg2]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteMessagesBySession('session-1');

    expect(stores.messages.delete).toHaveBeenCalledWith('msg-1');
    expect(stores.messages.delete).toHaveBeenCalledWith('msg-2');
    expect(stores.messages.delete).toHaveBeenCalledTimes(2);
  });

  it('should not touch the sessions store at all', async () => {
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteMessagesBySession('session-1');

    expect(stores.sessions.get).not.toHaveBeenCalled();
    expect(stores.sessions.put).not.toHaveBeenCalled();
  });

  it('should await transaction completion', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteMessagesBySession('session-1');

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should resolve without error when the session has no messages', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await expect(deleteMessagesBySession('session-with-no-messages')).resolves.toBeUndefined();
  });
});
