/**
 * Unit tests for src/db/appSettings.ts — KV surface.
 * Covers: putAppSetting round-trip (infrastructure sanity check).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSettingDTO } from '@/db/idb';

// ---------------------------------------------------------------------------
// In-memory store simulating the appSettings IDB object store.
// ---------------------------------------------------------------------------

const memStore = new Map<string, AppSettingDTO>();

interface FakeRequest<T> {
  result: T;
}

const makeRequest = <T>(result: T): FakeRequest<T> => ({ result });

const fakeStore = {
  get: (id: string): FakeRequest<AppSettingDTO | undefined> => makeRequest(memStore.get(id)),
  put: (row: AppSettingDTO): FakeRequest<void> => {
    memStore.set(row.id, row);
    return makeRequest(undefined);
  },
  getAll: (): FakeRequest<AppSettingDTO[]> => makeRequest(Array.from(memStore.values())),
};

const fakeTx = {
  objectStore: (_name: string) => fakeStore,
};

const fakeDb = {
  transaction: (_store: string, _mode: string) => fakeTx,
};

vi.mock('../idb', () => ({
  getDb: vi.fn(async () => fakeDb),
  promisifyRequest: vi.fn(async <T>(req: FakeRequest<T>) => req.result),
  transactionComplete: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import {
  getLabEvalModel,
  getLabEvalProvider,
  putAppSetting,
  setLabEvalModel,
  setLabEvalProvider
} from '../appSettings';

beforeEach(() => {
  memStore.clear();
});

describe('putAppSetting', () => {
  it('should store a value and make it retrievable from the in-memory store', async () => {
    await putAppSetting('some-key', 'some-value');
    const stored = memStore.get('some-key');
    expect(stored?.value).toBe('some-value');
  });
});

// --- Evaluator model config ---

describe('getLabEvalProvider / setLabEvalProvider', () => {
  it('should round-trip a provider value', async () => {
    await setLabEvalProvider('openai');
    const result = await getLabEvalProvider();
    expect(result).toBe('openai');
  });

  it('should return null when never written', async () => {
    const result = await getLabEvalProvider();
    expect(result).toBeNull();
  });
});

describe('getLabEvalModel / setLabEvalModel', () => {
  it('should round-trip a model value', async () => {
    await setLabEvalModel('gpt-4o');
    const result = await getLabEvalModel();
    expect(result).toBe('gpt-4o');
  });

  it('should return null when never written', async () => {
    const result = await getLabEvalModel();
    expect(result).toBeNull();
  });
});
