import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSettingDTO } from './idb';

vi.mock('./idb', () => ({
  getDb: vi.fn(),
  promisifyRequest: vi.fn(),
  transactionComplete: vi.fn(),
}));

import {
  getAllAppSettings,
  getAppSetting,
  getLabParallelismMode,
  getLabRunParallel,
  putAppSetting,
  putLabParallelismMode,
  putLabRunParallel
} from './appSettings';
import * as idb from './idb';

// -- Mock aliases --

const mockGetDb = idb.getDb as ReturnType<typeof vi.fn>;
const mockPromisifyRequest = idb.promisifyRequest as ReturnType<typeof vi.fn>;
const mockTransactionComplete = idb.transactionComplete as ReturnType<typeof vi.fn>;

// -- Builders --

const buildAppSetting = (overrides?: Partial<AppSettingDTO>): AppSettingDTO => ({
  id: 'locale',
  value: 'en',
  ...overrides,
});

// -- Fake DB factory --

interface FakeObjectStore {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
}

interface FakeTx {
  objectStore: ReturnType<typeof vi.fn>;
}

interface FakeDb {
  transaction: ReturnType<typeof vi.fn>;
}

const buildFakeDb = (storeOverrides: Partial<FakeObjectStore> = {}) => {
  const defaultStore = (): FakeObjectStore => ({
    put: vi.fn().mockReturnValue({}),
    get: vi.fn().mockReturnValue({}),
    getAll: vi.fn().mockReturnValue({}),
  });

  const store: FakeObjectStore = { ...defaultStore(), ...storeOverrides };

  const stores: Record<string, FakeObjectStore> = {
    appSettings: store,
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

describe('getAppSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the value when the setting exists', async () => {
    const setting = buildAppSetting({ id: 'locale', value: 'de' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(setting);

    const result = await getAppSetting('locale');

    expect(result).toBe('de');
  });

  it('should return null when the setting does not exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    const result = await getAppSetting('non-existent');

    expect(result).toBeNull();
  });

  it('should open a readonly transaction on the appSettings store', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await getAppSetting('locale');

    expect(fakeDb.transaction).toHaveBeenCalledWith('appSettings', 'readonly');
    expect(fakeTx.objectStore).toHaveBeenCalledWith('appSettings');
  });

  it('should pass the get request to promisifyRequest', async () => {
    const fakeGetReq = { tag: 'fake-get-req' };
    const { fakeDb, stores } = buildFakeDb();
    stores.appSettings.get = vi.fn().mockReturnValue(fakeGetReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await getAppSetting('locale');

    expect(stores.appSettings.get).toHaveBeenCalledWith('locale');
    expect(mockPromisifyRequest).toHaveBeenCalledWith(fakeGetReq);
  });
});

describe('putAppSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write an AppSettingDTO to the appSettings store', async () => {
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putAppSetting('locale', 'fr');

    expect(stores.appSettings.put).toHaveBeenCalledWith({ id: 'locale', value: 'fr' });
  });

  it('should open a readwrite transaction on the appSettings store', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putAppSetting('theme', 'dark');

    expect(fakeDb.transaction).toHaveBeenCalledWith('appSettings', 'readwrite');
  });

  it('should await transaction completion', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putAppSetting('locale', 'en');

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should create the correct {id, value} shape', async () => {
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await putAppSetting('fontSize', 'large');

    const [saved] = stores.appSettings.put.mock.calls[0] as [AppSettingDTO];
    expect(saved).toEqual({ id: 'fontSize', value: 'large' });
  });
});

describe('getAllAppSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return all settings when settings exist', async () => {
    const setting1 = buildAppSetting({ id: 'locale', value: 'en' });
    const setting2 = buildAppSetting({ id: 'theme', value: 'dark' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([setting1, setting2]);

    const result = await getAllAppSettings();

    expect(result).toEqual([setting1, setting2]);
  });

  it('should return empty array when no settings exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    const result = await getAllAppSettings();

    expect(result).toEqual([]);
  });

  it('should open a readonly transaction on the appSettings store', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllAppSettings();

    expect(fakeDb.transaction).toHaveBeenCalledWith('appSettings', 'readonly');
    expect(fakeTx.objectStore).toHaveBeenCalledWith('appSettings');
  });

  it('should call getAll on the appSettings store', async () => {
    const fakeGetAllReq = { tag: 'fake-getAll-req' };
    const { fakeDb, stores } = buildFakeDb();
    stores.appSettings.getAll = vi.fn().mockReturnValue(fakeGetAllReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllAppSettings();

    expect(mockPromisifyRequest).toHaveBeenCalledWith(fakeGetAllReq);
  });
});

describe('getLabRunParallel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when no value is stored (absent key)', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    const result = await getLabRunParallel();

    expect(result).toBe(true);
  });

  it('should return false when stored value is false', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce({ id: 'lab-run-parallel', value: 'false' });

    const result = await getLabRunParallel();

    expect(result).toBe(false);
  });

  it('should return true when stored value is true', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce({ id: 'lab-run-parallel', value: 'true' });

    const result = await getLabRunParallel();

    expect(result).toBe(true);
  });
});

describe('putLabRunParallel + getLabRunParallel round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should persist false and retrieve false', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);
    mockTransactionComplete.mockResolvedValue(undefined);
    mockPromisifyRequest.mockResolvedValueOnce({ id: 'lab-run-parallel', value: 'false' });

    await putLabRunParallel(false);
    const result = await getLabRunParallel();

    expect(result).toBe(false);
  });
});

describe('getLabParallelismMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return same-model when no value is stored (absent key)', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    const result = await getLabParallelismMode();

    expect(result).toBe('same-model');
  });

  it('should return same-model when stored value is invalid', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce({
      id: 'lab-parallelism-mode',
      value: 'invalid-value',
    });

    const result = await getLabParallelismMode();

    expect(result).toBe('same-model');
  });

  it('should return everything when stored value is everything', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce({ id: 'lab-parallelism-mode', value: 'everything' });

    const result = await getLabParallelismMode();

    expect(result).toBe('everything');
  });

  it('should return same-model when stored value is same-model', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce({ id: 'lab-parallelism-mode', value: 'same-model' });

    const result = await getLabParallelismMode();

    expect(result).toBe('same-model');
  });
});

describe('putLabParallelismMode + getLabParallelismMode round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should persist everything and retrieve everything', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);
    mockTransactionComplete.mockResolvedValue(undefined);
    mockPromisifyRequest.mockResolvedValueOnce({ id: 'lab-parallelism-mode', value: 'everything' });

    await putLabParallelismMode('everything');
    const result = await getLabParallelismMode();

    expect(result).toBe('everything');
  });
});
