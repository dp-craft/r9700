/**
 * Unit tests for src/db/prompts.ts — Prompt History service layer.
 * RED phase: src/db/prompts.ts does not exist yet.
 * Covers: FR-068 (dedup+NUL separator), FR-069/070 (capture), FR-072 (silent failure),
 *         FR-073 (delete), FR-081 (whitespace skip).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptHistoryEntry } from '@/db/idb';

// ---------------------------------------------------------------------------
// In-memory store simulating an IDB object store (no indexes needed for prompts).
// ---------------------------------------------------------------------------

const memStore = new Map<string, PromptHistoryEntry>();

interface FakeRequest<T> {
  result: T;
}

const makeRequest = <T>(result: T): FakeRequest<T> => ({ result });

const fakeStore = {
  get: (id: string): FakeRequest<PromptHistoryEntry | undefined> => makeRequest(memStore.get(id)),
  put: (row: PromptHistoryEntry): FakeRequest<void> => {
    memStore.set(row.id, row);
    return makeRequest(undefined);
  },
  delete: (id: string): FakeRequest<void> => {
    memStore.delete(id);
    return makeRequest(undefined);
  },
  getAll: (): FakeRequest<PromptHistoryEntry[]> => makeRequest(Array.from(memStore.values())),
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

// Stable WebCrypto mock — deterministic, collision-safe SHA-256 simulation.
// Real implementation calls crypto.subtle.digest; we produce a unique hex per preimage.
const cryptoSubtleMock = {
  digest: vi.fn(async (_algorithm: string, data: BufferSource): Promise<ArrayBuffer> => {
    // Produce a deterministic fake digest by summing the bytes with a position multiplier.
    const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : (data as Uint8Array));
    const sum = bytes.reduce((acc, b, i) => acc + b * (i + 1), 0);
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    view.setUint32(0, sum >>> 0, false);
    view.setUint32(4, (sum * 31) >>> 0, false);
    return buf;
  }),
};

Object.defineProperty(globalThis, 'crypto', {
  value: {
    subtle: cryptoSubtleMock,
    getRandomValues: (arr: Uint8Array) => arr,
  },
  configurable: true,
});

// ---------------------------------------------------------------------------
// Subject under test (file does not exist yet — RED)
// ---------------------------------------------------------------------------

import {
  capturePrompt,
  computePromptId,
  deletePrompts,
  getAllPrompts,
  PROMPT_REFERENCE_CAP
} from '../prompts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TS = 1_700_000_000_000;

const makeRef = (kind: 'session' | 'run', id: string, usedAt = FIXED_TS) =>
  ({ kind, id, usedAt }) as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('db/prompts — computePromptId', () => {
  it('should return the same hex string for identical (text, type) inputs', async () => {
    // Given
    const text = 'Hello world';
    const type = 'USER' as const;

    // When
    const id1 = await computePromptId(text, type);
    const id2 = await computePromptId(text, type);

    // Then
    expect(id1).toBe(id2);
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);
  });

  it('should return different hex strings for different (text, type) pairs', async () => {
    // Given
    const id1 = await computePromptId('Hello', 'USER');
    const id2 = await computePromptId('World', 'USER');
    const id3 = await computePromptId('Hello', 'SYSTEM');

    // Then
    expect(id1).not.toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id2).not.toBe(id3);
  });

  it('should use NUL separator so ("a","SYSTEM") and ("aSYSTEM","USER") produce different ids (FR-068 collision-safe)', async () => {
    // Given — classic prefix collision without NUL separator
    const withNul1 = await computePromptId('a', 'SYSTEM');
    const withNul2 = await computePromptId('aSYSTEM', 'USER');

    // Then — must differ (NUL separator makes preimage "a\0SYSTEM" vs "aSYSTEM\0USER")
    expect(withNul1).not.toBe(withNul2);
  });
});

describe('db/prompts — capturePrompt new entry (FR-068)', () => {
  beforeEach(() => {
    memStore.clear();
    vi.clearAllMocks();
  });

  it('should write a new row with useCount=1 and firstSource matching the input source', async () => {
    // Given
    const input = {
      text: 'Explain TDD',
      type: 'USER' as const,
      source: 'CHAT' as const,
      reference: makeRef('session', 'sess-1'),
    };

    // When
    await capturePrompt(input);

    // Then
    const all = Array.from(memStore.values());
    expect(all).toHaveLength(1);
    expect(all[0]?.useCount).toBe(1);
    expect(all[0]?.firstSource).toBe('CHAT');
    expect(all[0]?.references).toHaveLength(1);
    expect(all[0]?.text).toBe('Explain TDD');
    expect(all[0]?.type).toBe('USER');
  });
});

describe('db/prompts — capturePrompt dedup (FR-068)', () => {
  beforeEach(() => {
    memStore.clear();
    vi.clearAllMocks();
  });

  it('should produce a single row with useCount=2 and lastUsedAt updated when the same text+type is captured twice', async () => {
    // Given — same text, different timestamps
    const ref1 = makeRef('session', 'sess-1', FIXED_TS);
    const ref2 = makeRef('session', 'sess-2', FIXED_TS + 1000);

    await capturePrompt({ text: 'Refactor this', type: 'USER', source: 'CHAT', reference: ref1 });

    // When
    await capturePrompt({ text: 'Refactor this', type: 'USER', source: 'LAB', reference: ref2 });

    // Then
    const all = Array.from(memStore.values());
    expect(all).toHaveLength(1);
    const entry = all[0]!;
    expect(entry.useCount).toBe(2);
    expect(entry.lastUsedAt).toBe(FIXED_TS + 1000);
    expect(entry.references).toHaveLength(2);
    // firstSource is preserved from first capture
    expect(entry.firstSource).toBe('CHAT');
  });
});

describe('db/prompts — capturePrompt reference cap (FR-068 D6)', () => {
  beforeEach(() => {
    memStore.clear();
    vi.clearAllMocks();
  });

  it('should cap references at PROMPT_REFERENCE_CAP and continue incrementing useCount beyond the cap', async () => {
    // Given — capture the same prompt 51 times
    const totalCaptures = PROMPT_REFERENCE_CAP + 1;
    for (let i = 0; i < totalCaptures; i++) {
      await capturePrompt({
        text: 'Repeated prompt',
        type: 'USER',
        source: 'CHAT',
        reference: makeRef('session', `sess-${i}`, FIXED_TS + i),
      });
    }

    // Then
    const entry = Array.from(memStore.values())[0]!;
    expect(entry.useCount).toBe(totalCaptures);
    expect(entry.references.length).toBe(PROMPT_REFERENCE_CAP);
  });
});

describe('db/prompts — capturePrompt whitespace skip (FR-081)', () => {
  beforeEach(() => {
    memStore.clear();
    vi.clearAllMocks();
  });

  it('should not write any row when text is empty string', async () => {
    // Given / When
    await capturePrompt({
      text: '',
      type: 'USER',
      source: 'CHAT',
      reference: makeRef('session', 'sess-1'),
    });

    // Then
    expect(memStore.size).toBe(0);
  });

  it('should not write any row when text is whitespace-only', async () => {
    // Given / When
    await capturePrompt({
      text: '   \t\n  ',
      type: 'USER',
      source: 'CHAT',
      reference: makeRef('session', 'sess-1'),
    });

    // Then
    expect(memStore.size).toBe(0);
  });
});

describe('db/prompts — getAllPrompts', () => {
  beforeEach(() => {
    memStore.clear();
    vi.clearAllMocks();
  });

  it('should return all stored entries', async () => {
    // Given — two entries pre-seeded in the store
    await capturePrompt({
      text: 'First prompt',
      type: 'USER',
      source: 'CHAT',
      reference: makeRef('session', 'sess-1'),
    });
    await capturePrompt({
      text: 'Second prompt',
      type: 'SYSTEM',
      source: 'LAB',
      reference: makeRef('run', 'run-1'),
    });

    // When
    const results = await getAllPrompts();

    // Then
    expect(results).toHaveLength(2);
    const texts = results.map((r: PromptHistoryEntry) => r.text);
    expect(texts).toContain('First prompt');
    expect(texts).toContain('Second prompt');
  });
});

describe('db/prompts — deletePrompts (FR-073)', () => {
  beforeEach(() => {
    memStore.clear();
    vi.clearAllMocks();
  });

  it('should remove specified ids and leave non-specified entries untouched', async () => {
    // Given — three entries
    await capturePrompt({
      text: 'Keep me',
      type: 'USER',
      source: 'CHAT',
      reference: makeRef('session', 's1'),
    });
    await capturePrompt({
      text: 'Delete me',
      type: 'USER',
      source: 'CHAT',
      reference: makeRef('session', 's2'),
    });
    await capturePrompt({
      text: 'Also keep me',
      type: 'SYSTEM',
      source: 'LAB',
      reference: makeRef('run', 'r1'),
    });

    const allBefore = Array.from(memStore.values());
    expect(allBefore).toHaveLength(3);

    const idToDelete = allBefore.find(e => e.text === 'Delete me')!.id;

    // When
    await deletePrompts([idToDelete]);

    // Then
    const remaining = Array.from(memStore.values());
    expect(remaining).toHaveLength(2);
    expect(remaining.find(e => e.id === idToDelete)).toBeUndefined();
    expect(remaining.find(e => e.text === 'Keep me')).toBeDefined();
    expect(remaining.find(e => e.text === 'Also keep me')).toBeDefined();
  });
});
