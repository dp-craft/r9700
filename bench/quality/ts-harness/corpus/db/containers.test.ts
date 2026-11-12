import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillContainerDTO } from './idb';

vi.mock('./idb', () => ({
  getDb: vi.fn(),
  promisifyRequest: vi.fn(),
  transactionComplete: vi.fn(),
}));

import {
  createContainer,
  deleteContainer,
  getAllContainers,
  getContainer,
  removeSkillFromAllContainers,
  updateContainer
} from './containers';
import * as idb from './idb';

// -- Constants --

const FIXED_TIMESTAMP = 1_700_000_000_000;

// -- Builders --

const buildContainer = (overrides?: Partial<SkillContainerDTO>): SkillContainerDTO => ({
  id: 'container-1',
  name: 'Test Container',
  skillIds: [],
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
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
  get: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
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
    delete: vi.fn().mockReturnValue({}),
    get: vi.fn().mockReturnValue({}),
    getAll: vi.fn().mockReturnValue({}),
  });

  const stores: Record<string, FakeObjectStore> = {
    containers: { ...defaultStore(), ...storeOverrides.containers },
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

describe('getAllContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return containers sorted by createdAt ascending when containers exist', async () => {
    const newer = buildContainer({ id: 'c-2', createdAt: FIXED_TIMESTAMP + 5000 });
    const older = buildContainer({ id: 'c-1', createdAt: FIXED_TIMESTAMP });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([newer, older]);

    const result = await getAllContainers();

    expect(result).toEqual([older, newer]);
  });

  it('should return empty array when no containers exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    const result = await getAllContainers();

    expect(result).toEqual([]);
  });

  it('should open a readonly transaction on the containers store', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllContainers();

    expect(fakeDb.transaction).toHaveBeenCalledWith('containers', 'readonly');
    expect(fakeTx.objectStore).toHaveBeenCalledWith('containers');
  });

  it('should pass the getAll request to promisifyRequest', async () => {
    const fakeGetAllReq = { tag: 'fake-getAll-req' };
    const { fakeDb, stores } = buildFakeDb();
    stores.containers.getAll = vi.fn().mockReturnValue(fakeGetAllReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllContainers();

    expect(mockPromisifyRequest).toHaveBeenCalledWith(fakeGetAllReq);
  });

  it('should preserve sort order when containers have identical createdAt', async () => {
    const c1 = buildContainer({ id: 'c-1', name: 'Alpha', createdAt: FIXED_TIMESTAMP });
    const c2 = buildContainer({ id: 'c-2', name: 'Beta', createdAt: FIXED_TIMESTAMP });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([c1, c2]);

    const result = await getAllContainers();

    expect(result).toHaveLength(2);
  });
});

describe('getContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the container when it exists', async () => {
    const container = buildContainer();
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(container);

    const result = await getContainer('container-1');

    expect(result).toEqual(container);
  });

  it('should return undefined when the container does not exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    const result = await getContainer('non-existent');

    expect(result).toBeUndefined();
  });

  it('should open a readonly transaction on the containers store', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await getContainer('container-1');

    expect(fakeDb.transaction).toHaveBeenCalledWith('containers', 'readonly');
    expect(fakeTx.objectStore).toHaveBeenCalledWith('containers');
  });

  it('should pass the get request with the correct id to promisifyRequest', async () => {
    const fakeGetReq = { tag: 'fake-get-req' };
    const { fakeDb, stores } = buildFakeDb();
    stores.containers.get = vi.fn().mockReturnValue(fakeGetReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await getContainer('my-container-id');

    expect(stores.containers.get).toHaveBeenCalledWith('my-container-id');
    expect(mockPromisifyRequest).toHaveBeenCalledWith(fakeGetReq);
  });
});

describe('createContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a container with generated id and timestamps', async () => {
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createContainer({ name: 'My Container', skillIds: ['skill-1'] });

    expect(result.name).toBe('My Container');
    expect(result.skillIds).toEqual(['skill-1']);
    expect(result.id).toBeDefined();
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.createdAt).toBeTypeOf('number');
    expect(result.updatedAt).toBeTypeOf('number');
    expect(result.createdAt).toBe(result.updatedAt);
    expect(stores.containers.put).toHaveBeenCalledWith(result);
  });

  it('should open a readwrite transaction on the containers store', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await createContainer({ name: 'Test', skillIds: [] });

    expect(fakeDb.transaction).toHaveBeenCalledWith('containers', 'readwrite');
  });

  it('should await transaction completion', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await createContainer({ name: 'Test', skillIds: [] });

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should create a container with empty skillIds', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createContainer({ name: 'Empty Container', skillIds: [] });

    expect(result.skillIds).toEqual([]);
  });

  it('should throw when name is empty string', async () => {
    await expect(createContainer({ name: '', skillIds: [] })).rejects.toThrow();
  });

  it('should throw when name is only whitespace', async () => {
    await expect(createContainer({ name: '   ', skillIds: [] })).rejects.toThrow();
  });
});

describe('updateContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update name when provided', async () => {
    const existing = buildContainer({ id: 'c-1', name: 'Old Name' });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateContainer('c-1', { name: 'New Name' });

    expect(result.name).toBe('New Name');
    expect(stores.containers.put).toHaveBeenCalled();
  });

  it('should update skillIds when provided', async () => {
    const existing = buildContainer({ id: 'c-1', skillIds: ['old-skill'] });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateContainer('c-1', { skillIds: ['new-skill-1', 'new-skill-2'] });

    expect(result.skillIds).toEqual(['new-skill-1', 'new-skill-2']);
  });

  it('should update updatedAt timestamp', async () => {
    const existing = buildContainer({ id: 'c-1', updatedAt: FIXED_TIMESTAMP });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateContainer('c-1', { name: 'Updated' });

    expect(result.updatedAt).toBeGreaterThanOrEqual(FIXED_TIMESTAMP);
  });

  it('should preserve unchanged fields when partial update is applied', async () => {
    const existing = buildContainer({
      id: 'c-1',
      name: 'Keep This',
      skillIds: ['skill-a', 'skill-b'],
    });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateContainer('c-1', { name: 'Changed Name' });

    expect(result.skillIds).toEqual(['skill-a', 'skill-b']);
    expect(result.id).toBe('c-1');
    expect(result.createdAt).toBe(FIXED_TIMESTAMP);
  });

  it('should open a readwrite transaction on the containers store', async () => {
    const existing = buildContainer();
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await updateContainer('container-1', { name: 'Updated' });

    expect(fakeDb.transaction).toHaveBeenCalledWith('containers', 'readwrite');
  });

  it('should await transaction completion', async () => {
    const existing = buildContainer();
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await updateContainer('container-1', { name: 'Updated' });

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should throw when container is not found', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await expect(updateContainer('non-existent', { name: 'Nope' })).rejects.toThrow();
  });

  it('should put the updated container back to the store', async () => {
    const existing = buildContainer({ id: 'c-1' });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateContainer('c-1', { name: 'New' });

    const [savedContainer] = stores.containers.put.mock.calls[0] as [SkillContainerDTO];
    expect(savedContainer).toEqual(result);
  });
});

describe('deleteContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delete the container record from the containers store', async () => {
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteContainer('container-1');

    expect(stores.containers.delete).toHaveBeenCalledWith('container-1');
  });

  it('should open a readwrite transaction on the containers store', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteContainer('container-1');

    expect(fakeDb.transaction).toHaveBeenCalledWith('containers', 'readwrite');
  });

  it('should await transaction completion', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteContainer('container-1');

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });
});

describe('removeSkillFromAllContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return names of affected containers when skill is found in multiple containers', async () => {
    const c1 = buildContainer({ id: 'c-1', name: 'Container A', skillIds: ['skill-x', 'skill-y'] });
    const c2 = buildContainer({ id: 'c-2', name: 'Container B', skillIds: ['skill-x', 'skill-z'] });
    const c3 = buildContainer({ id: 'c-3', name: 'Container C', skillIds: ['skill-z'] });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([c1, c2, c3]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await removeSkillFromAllContainers('skill-x');

    expect(result).toEqual(expect.arrayContaining(['Container A', 'Container B']));
    expect(result).toHaveLength(2);
  });

  it('should update affected containers with the skill removed from skillIds', async () => {
    const c1 = buildContainer({ id: 'c-1', name: 'Container A', skillIds: ['skill-x', 'skill-y'] });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([c1]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await removeSkillFromAllContainers('skill-x');

    const putCalls = stores.containers.put.mock.calls;
    expect(putCalls).toHaveLength(1);
    const [savedContainer] = putCalls[0] as [SkillContainerDTO];
    expect(savedContainer.skillIds).toEqual(['skill-y']);
    expect(savedContainer.id).toBe('c-1');
  });

  it('should return empty array when no containers reference the skill', async () => {
    const c1 = buildContainer({ id: 'c-1', skillIds: ['skill-a'] });
    const c2 = buildContainer({ id: 'c-2', skillIds: ['skill-b'] });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([c1, c2]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await removeSkillFromAllContainers('skill-nonexistent');

    expect(result).toEqual([]);
  });

  it('should not modify containers that do not reference the skill', async () => {
    const c1 = buildContainer({ id: 'c-1', name: 'Affected', skillIds: ['skill-x', 'skill-y'] });
    const c2 = buildContainer({ id: 'c-2', name: 'Unaffected', skillIds: ['skill-z'] });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([c1, c2]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await removeSkillFromAllContainers('skill-x');

    const putCalls = stores.containers.put.mock.calls;
    expect(putCalls).toHaveLength(1);
    const [savedContainer] = putCalls[0] as [SkillContainerDTO];
    expect(savedContainer.id).toBe('c-1');
  });

  it('should return empty array when there are no containers at all', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await removeSkillFromAllContainers('skill-x');

    expect(result).toEqual([]);
  });

  it('should handle container where skill is the only element in skillIds', async () => {
    const c1 = buildContainer({ id: 'c-1', name: 'Solo Skill', skillIds: ['skill-x'] });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([c1]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await removeSkillFromAllContainers('skill-x');

    const putCalls = stores.containers.put.mock.calls;
    expect(putCalls).toHaveLength(1);
    const [savedContainer] = putCalls[0] as [SkillContainerDTO];
    expect(savedContainer.skillIds).toEqual([]);
  });

  it('should await transaction completion', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await removeSkillFromAllContainers('skill-x');

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });
});
