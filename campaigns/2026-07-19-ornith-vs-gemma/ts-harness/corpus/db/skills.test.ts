import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AtomicSkillDTO } from './idb';

vi.mock('./idb', () => ({
  getDb: vi.fn(),
  promisifyRequest: vi.fn(),
  transactionComplete: vi.fn(),
}));

vi.mock('./appSettings', () => ({
  getSeedBuiltinsDone: vi.fn(),
  putSeedBuiltinsDone: vi.fn(),
}));

import * as appSettings from './appSettings';
import * as idb from './idb';
import type { CreateSkillInput, UpdateSkillInput } from './skills';
import {
  createSkill,
  deleteSkill,
  duplicateSkill,
  getAllSkills,
  getSkill,
  getSkillByCommandPrefix,
  seedBuiltinSkills,
  updateSkill
} from './skills';

// -- Constants --

const FIXED_TIMESTAMP = 1_700_000_000_000;

// -- Mock aliases --

const mockGetDb = idb.getDb as ReturnType<typeof vi.fn>;
const mockPromisifyRequest = idb.promisifyRequest as ReturnType<typeof vi.fn>;
const mockTransactionComplete = idb.transactionComplete as ReturnType<typeof vi.fn>;
const mockGetSeedBuiltinsDone = appSettings.getSeedBuiltinsDone as ReturnType<typeof vi.fn>;
const mockPutSeedBuiltinsDone = appSettings.putSeedBuiltinsDone as ReturnType<typeof vi.fn>;

// -- Builders --

const buildSkill = (overrides?: Partial<AtomicSkillDTO>): AtomicSkillDTO => ({
  id: 'skill-1',
  name: 'Test Skill',
  prompt: 'Do something',
  type: 'custom',
  category: null,
  commandPrefix: null,
  conditions: null,
  description: null,
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  ...overrides,
});

const buildCreateInput = (overrides?: Partial<CreateSkillInput>): CreateSkillInput => ({
  name: 'New Skill',
  prompt: 'Do something new',
  category: null,
  commandPrefix: null,
  ...overrides,
});

// -- Fake DB factory --

interface FakeObjectStore {
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
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
    delete: vi.fn().mockReturnValue({}),
    get: vi.fn().mockReturnValue({}),
    getAll: vi.fn().mockReturnValue({}),
    index: vi.fn().mockReturnValue({ getAll: vi.fn().mockReturnValue({}) }),
  });

  const stores: Record<string, FakeObjectStore> = {
    skills: { ...defaultStore(), ...storeOverrides.skills },
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

describe('getAllSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return all skills when skills exist', async () => {
    const skill1 = buildSkill({ id: 'skill-1', createdAt: FIXED_TIMESTAMP });
    const skill2 = buildSkill({ id: 'skill-2', createdAt: FIXED_TIMESTAMP + 1000 });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([skill1, skill2]);

    const result = await getAllSkills();

    expect(result).toEqual([skill1, skill2]);
  });

  it('should return empty array when no skills exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    const result = await getAllSkills();

    expect(result).toEqual([]);
  });

  it('should open a readonly transaction on the skills store', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllSkills();

    expect(fakeDb.transaction).toHaveBeenCalledWith('skills', 'readonly');
    expect(fakeTx.objectStore).toHaveBeenCalledWith('skills');
  });

  it('should call getAll on the skills store', async () => {
    const fakeGetAllReq = { tag: 'fake-getAll-req' };
    const { fakeDb, stores } = buildFakeDb();
    stores.skills.getAll = vi.fn().mockReturnValue(fakeGetAllReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await getAllSkills();

    expect(mockPromisifyRequest).toHaveBeenCalledWith(fakeGetAllReq);
  });
});

describe('getSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the skill when it exists', async () => {
    const skill = buildSkill({ id: 'skill-42' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(skill);

    const result = await getSkill('skill-42');

    expect(result).toEqual(skill);
  });

  it('should return undefined when skill does not exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    const result = await getSkill('non-existent');

    expect(result).toBeUndefined();
  });

  it('should open a readonly transaction on the skills store', async () => {
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await getSkill('skill-1');

    expect(fakeDb.transaction).toHaveBeenCalledWith('skills', 'readonly');
    expect(fakeTx.objectStore).toHaveBeenCalledWith('skills');
  });

  it('should call store.get with the provided id', async () => {
    const fakeGetReq = { tag: 'fake-get-req' };
    const { fakeDb, stores } = buildFakeDb();
    stores.skills.get = vi.fn().mockReturnValue(fakeGetReq);
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await getSkill('skill-abc');

    expect(stores.skills.get).toHaveBeenCalledWith('skill-abc');
    expect(mockPromisifyRequest).toHaveBeenCalledWith(fakeGetReq);
  });
});

describe('getSkillByCommandPrefix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the skill matching the command prefix', async () => {
    const target = buildSkill({ id: 'skill-2', commandPrefix: '/code' });
    const other = buildSkill({ id: 'skill-1', commandPrefix: '/chat' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([other, target]);

    const result = await getSkillByCommandPrefix('/code');

    expect(result).toEqual(target);
  });

  it('should return undefined when no skill has the given prefix', async () => {
    const skill = buildSkill({ commandPrefix: '/chat' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([skill]);

    const result = await getSkillByCommandPrefix('/missing');

    expect(result).toBeUndefined();
  });

  it('should return undefined when no skills exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    const result = await getSkillByCommandPrefix('/code');

    expect(result).toBeUndefined();
  });

  it('should return undefined when skills have null command prefixes', async () => {
    const skill = buildSkill({ commandPrefix: null });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([skill]);

    const result = await getSkillByCommandPrefix('/anything');

    expect(result).toBeUndefined();
  });
});

describe('createSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a skill with type custom and generated id and timestamps', async () => {
    const input = buildCreateInput({ name: 'My Skill', prompt: 'Do X', category: 'persona' });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createSkill(input);

    expect(result.name).toBe('My Skill');
    expect(result.prompt).toBe('Do X');
    expect(result.type).toBe('custom');
    expect(result.category).toBe('persona');
    expect(result.commandPrefix).toBeNull();
    expect(result.conditions).toBeNull();
    expect(result.id).toBeDefined();
    expect(result.id).not.toBe('');
    expect(result.createdAt).toBeTypeOf('number');
    expect(result.updatedAt).toBeTypeOf('number');
    expect(stores.skills.put).toHaveBeenCalled();
  });

  it('should set createdAt and updatedAt to the same timestamp', async () => {
    const input = buildCreateInput();
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createSkill(input);

    expect(result.createdAt).toBe(result.updatedAt);
  });

  it('should persist the skill to the store via put', async () => {
    const input = buildCreateInput();
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createSkill(input);

    const [savedSkill] = stores.skills.put.mock.calls[0] as [AtomicSkillDTO];
    expect(savedSkill).toEqual(result);
  });

  it('should await transaction completion', async () => {
    const input = buildCreateInput();
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await createSkill(input);

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should preserve commandPrefix when provided', async () => {
    const input = buildCreateInput({ commandPrefix: '/test' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createSkill(input);

    expect(result.commandPrefix).toBe('/test');
  });

  it('should throw when name duplicates an existing skill', async () => {
    const existing = buildSkill({ name: 'Duplicate Name' });
    const input = buildCreateInput({ name: 'Duplicate Name' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([existing]);

    await expect(createSkill(input)).rejects.toThrow();
  });

  it('should throw when commandPrefix duplicates an existing skill', async () => {
    const existing = buildSkill({ commandPrefix: '/dupe' });
    const input = buildCreateInput({ commandPrefix: '/dupe' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([existing]);

    await expect(createSkill(input)).rejects.toThrow();
  });

  it('should not throw for commandPrefix when existing skill has null prefix', async () => {
    const existing = buildSkill({ commandPrefix: null });
    const input = buildCreateInput({ commandPrefix: '/new-prefix' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createSkill(input);

    expect(result.commandPrefix).toBe('/new-prefix');
  });

  it('should not throw for null commandPrefix even when existing skills have prefixes', async () => {
    const existing = buildSkill({ commandPrefix: '/existing' });
    const input = buildCreateInput({ commandPrefix: null });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createSkill(input);

    expect(result.commandPrefix).toBeNull();
  });

  it('should throw when prompt is empty string', async () => {
    const input = buildCreateInput({ prompt: '' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await expect(createSkill(input)).rejects.toThrow();
  });

  it('should throw when prompt is only whitespace', async () => {
    const input = buildCreateInput({ prompt: '   ' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);

    await expect(createSkill(input)).rejects.toThrow();
  });

  it('should save description when provided', async () => {
    const input = buildCreateInput({ description: 'A helpful skill' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createSkill(input);

    expect(result.description).toBe('A helpful skill');
  });

  it('should default description to null when not provided', async () => {
    const input = buildCreateInput();
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await createSkill(input);

    expect(result.description).toBeNull();
  });
});

describe('updateSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should apply partial updates and return the updated skill', async () => {
    const existing = buildSkill({ id: 'skill-1', name: 'Old Name', prompt: 'Old prompt' });
    const update: UpdateSkillInput = { name: 'New Name' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.name).toBe('New Name');
    expect(result.prompt).toBe('Old prompt');
    expect(result.id).toBe('skill-1');
  });

  it('should update the updatedAt timestamp', async () => {
    const existing = buildSkill({ id: 'skill-1', updatedAt: FIXED_TIMESTAMP });
    const update: UpdateSkillInput = { name: 'Updated' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.updatedAt).toBeGreaterThanOrEqual(FIXED_TIMESTAMP);
  });

  it('should persist the updated skill via put', async () => {
    const existing = buildSkill({ id: 'skill-1' });
    const update: UpdateSkillInput = { prompt: 'Updated prompt' };
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    const [savedSkill] = stores.skills.put.mock.calls[0] as [AtomicSkillDTO];
    expect(savedSkill).toEqual(result);
  });

  it('should await transaction completion', async () => {
    const existing = buildSkill({ id: 'skill-1' });
    const update: UpdateSkillInput = { name: 'Updated' };
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await updateSkill('skill-1', update);

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should throw when skill is builtin', async () => {
    const builtin = buildSkill({ id: 'builtin-1', type: 'builtin' });
    const update: UpdateSkillInput = { name: 'Hacked' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(builtin);

    await expect(updateSkill('builtin-1', update)).rejects.toThrow();
  });

  it('should throw when skill is not found', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await expect(updateSkill('non-existent', { name: 'X' })).rejects.toThrow();
  });

  it('should throw when updated name duplicates another skill', async () => {
    const existing = buildSkill({ id: 'skill-1', name: 'Original' });
    const other = buildSkill({ id: 'skill-2', name: 'Taken Name' });
    const update: UpdateSkillInput = { name: 'Taken Name' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing, other]);

    await expect(updateSkill('skill-1', update)).rejects.toThrow();
  });

  it('should not throw when updated name matches the same skill being updated', async () => {
    const existing = buildSkill({ id: 'skill-1', name: 'Same Name' });
    const update: UpdateSkillInput = { name: 'Same Name' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.name).toBe('Same Name');
  });

  it('should throw when updated commandPrefix duplicates another skill', async () => {
    const existing = buildSkill({ id: 'skill-1', commandPrefix: null });
    const other = buildSkill({ id: 'skill-2', commandPrefix: '/taken' });
    const update: UpdateSkillInput = { commandPrefix: '/taken' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing, other]);

    await expect(updateSkill('skill-1', update)).rejects.toThrow();
  });

  it('should not throw when updated commandPrefix matches the same skill', async () => {
    const existing = buildSkill({ id: 'skill-1', commandPrefix: '/mine' });
    const update: UpdateSkillInput = { commandPrefix: '/mine' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.commandPrefix).toBe('/mine');
  });

  it('should update category when provided', async () => {
    const existing = buildSkill({ id: 'skill-1', category: null });
    const update: UpdateSkillInput = { category: 'persona' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.category).toBe('persona');
  });

  it('should allow setting category to null', async () => {
    const existing = buildSkill({ id: 'skill-1', category: 'persona' });
    const update: UpdateSkillInput = { category: null };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.category).toBeNull();
  });

  it('should update description when provided', async () => {
    const existing = buildSkill({ id: 'skill-1', description: null });
    const update: UpdateSkillInput = { description: 'Updated desc' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.description).toBe('Updated desc');
  });

  it('should allow setting description to null', async () => {
    const existing = buildSkill({ id: 'skill-1', description: 'Old desc' });
    const update: UpdateSkillInput = { description: null };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.description).toBeNull();
  });

  it('should not change description when not included in update', async () => {
    const existing = buildSkill({ id: 'skill-1', description: 'Keep me' });
    const update: UpdateSkillInput = { name: 'New Name' };
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing).mockResolvedValueOnce([existing]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await updateSkill('skill-1', update);

    expect(result.description).toBe('Keep me');
  });
});

describe('deleteSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delete the skill from the store', async () => {
    const existing = buildSkill({ id: 'skill-1', type: 'custom' });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteSkill('skill-1');

    expect(stores.skills.delete).toHaveBeenCalledWith('skill-1');
  });

  it('should open a readwrite transaction on skills store', async () => {
    const existing = buildSkill({ id: 'skill-1', type: 'custom' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteSkill('skill-1');

    expect(fakeDb.transaction).toHaveBeenCalledWith('skills', 'readwrite');
  });

  it('should await transaction completion', async () => {
    const existing = buildSkill({ id: 'skill-1', type: 'custom' });
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(existing);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await deleteSkill('skill-1');

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should throw when skill does not exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await expect(deleteSkill('non-existent')).rejects.toThrow();
  });
});

describe('duplicateSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a copy with a new id and type custom', async () => {
    const original = buildSkill({
      id: 'skill-1',
      name: 'Original',
      type: 'custom',
      prompt: 'Do X',
    });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(original).mockResolvedValueOnce([original]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await duplicateSkill('skill-1');

    expect(result.id).not.toBe('skill-1');
    expect(result.id).toBeDefined();
    expect(result.type).toBe('custom');
    expect(result.prompt).toBe('Do X');
  });

  it('should name the copy with "(Copy)" suffix', async () => {
    const original = buildSkill({ id: 'skill-1', name: 'My Skill' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(original).mockResolvedValueOnce([original]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await duplicateSkill('skill-1');

    expect(result.name).toBe('My Skill (Copy)');
  });

  it('should set commandPrefix to null on the copy', async () => {
    const original = buildSkill({ id: 'skill-1', commandPrefix: '/original' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(original).mockResolvedValueOnce([original]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await duplicateSkill('skill-1');

    expect(result.commandPrefix).toBeNull();
  });

  it('should duplicate a builtin skill as a custom skill', async () => {
    const builtin = buildSkill({ id: 'builtin-1', type: 'builtin', name: 'Built-in Skill' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(builtin).mockResolvedValueOnce([builtin]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await duplicateSkill('builtin-1');

    expect(result.type).toBe('custom');
    expect(result.name).toBe('Built-in Skill (Copy)');
  });

  it('should persist the duplicated skill via put', async () => {
    const original = buildSkill({ id: 'skill-1' });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(original).mockResolvedValueOnce([original]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await duplicateSkill('skill-1');

    const [savedSkill] = stores.skills.put.mock.calls[0] as [AtomicSkillDTO];
    expect(savedSkill).toEqual(result);
  });

  it('should await transaction completion', async () => {
    const original = buildSkill({ id: 'skill-1' });
    const { fakeDb, fakeTx } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(original).mockResolvedValueOnce([original]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await duplicateSkill('skill-1');

    expect(mockTransactionComplete).toHaveBeenCalledWith(fakeTx);
  });

  it('should throw when the original skill does not exist', async () => {
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(undefined);

    await expect(duplicateSkill('non-existent')).rejects.toThrow();
  });

  it('should preserve category from the original skill', async () => {
    const original = buildSkill({ id: 'skill-1', category: 'constraints' });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(original).mockResolvedValueOnce([original]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await duplicateSkill('skill-1');

    expect(result.category).toBe('constraints');
  });

  it('should generate new timestamps for the copy', async () => {
    const original = buildSkill({
      id: 'skill-1',
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    });
    const { fakeDb } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(original).mockResolvedValueOnce([original]);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    const result = await duplicateSkill('skill-1');

    expect(result.createdAt).toBeTypeOf('number');
    expect(result.updatedAt).toBeTypeOf('number');
    expect(result.createdAt).toBe(result.updatedAt);
  });
});

describe('seedBuiltinSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPutSeedBuiltinsDone.mockResolvedValue(undefined);
    // Default: no pre-existing skills (fresh install path)
    mockPromisifyRequest.mockResolvedValue([]);
  });

  // Locked test case 1: seeds builtins on first call when flag unset, then sets the flag
  it('should seed builtins on first call when seed-builtins-done is unset, then sets the flag', async () => {
    mockGetSeedBuiltinsDone.mockResolvedValueOnce(false);
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await seedBuiltinSkills();

    expect(stores.skills.put).toHaveBeenCalled();
    expect(mockPutSeedBuiltinsDone).toHaveBeenCalledWith(true);
  });

  // Locked test case 2: second call is a no-op (flag set) — even if all builtins were deleted
  it('should be a no-op on second call when flag is set (even if all builtins deleted)', async () => {
    mockGetSeedBuiltinsDone.mockResolvedValueOnce(true);
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);

    await seedBuiltinSkills();

    expect(stores.skills.put).not.toHaveBeenCalled();
    expect(mockPutSeedBuiltinsDone).not.toHaveBeenCalled();
  });

  // Locked test case 3: deleteSkill succeeds on a builtin skill (guard removed)
  it('should delete a builtin skill without throwing', async () => {
    const builtin = buildSkill({ id: 'builtin-1', type: 'builtin' });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce(builtin);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await expect(deleteSkill('builtin-1')).resolves.toBeUndefined();
    expect(stores.skills.delete).toHaveBeenCalledWith('builtin-1');
  });

  // Locked test case 4: each default skill is seeded exactly once (no HU+EN duplication)
  it('should seed each default skill exactly once with no locale duplication', async () => {
    mockGetSeedBuiltinsDone.mockResolvedValueOnce(false);
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await seedBuiltinSkills();

    const putCalls = stores.skills.put.mock.calls as unknown as [AtomicSkillDTO][];
    const names = putCalls.map(call => call[0].name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
    expect(putCalls.length).toBe(4); // exactly 4 BUILTIN_SKILL_TEMPLATES
    putCalls.forEach(call => {
      expect(call[0].type).toBe('builtin');
    });
  });

  // RED test: existing install upgrade-path — flag unset but builtins already present
  it('should set seed-builtins-done and NOT duplicate builtins when flag unset but builtins already exist', async () => {
    mockGetSeedBuiltinsDone.mockResolvedValueOnce(false);
    const existingBuiltin = buildSkill({ id: 'builtin-existing', type: 'builtin' });
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockPromisifyRequest.mockResolvedValueOnce([existingBuiltin]);

    await seedBuiltinSkills();

    expect(stores.skills.put).not.toHaveBeenCalled();
    expect(mockPutSeedBuiltinsDone).toHaveBeenCalledWith(true);
  });

  it('should seed builtin skills with valid categories', async () => {
    mockGetSeedBuiltinsDone.mockResolvedValueOnce(false);
    const { fakeDb, stores } = buildFakeDb();
    mockGetDb.mockResolvedValueOnce(fakeDb);
    mockTransactionComplete.mockResolvedValueOnce(undefined);

    await seedBuiltinSkills();

    const validCategories = ['persona', 'context', 'constraints', 'format', 'examples', null];
    const putCalls = stores.skills.put.mock.calls;
    (putCalls as unknown as [AtomicSkillDTO][]).forEach(call => {
      expect(validCategories).toContain(call[0].category);
    });
  });
});
