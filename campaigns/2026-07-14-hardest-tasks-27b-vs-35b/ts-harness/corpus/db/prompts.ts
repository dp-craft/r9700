import type { PromptHistoryEntry, PromptReference, PromptSource, PromptType } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';

// -- Constants --

export const PROMPT_REFERENCE_CAP = 50;

const STORE_NAME = 'prompts';

// -- Input types --

export interface CapturePromptInput {
  readonly text: string;
  readonly type: PromptType;
  readonly source: PromptSource;
  readonly reference: PromptReference;
}

// -- Pure helpers --

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

// -- Exported functions --

export const computePromptId = async (text: string, type: PromptType): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${text}\0${type}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
};

export const getAllPrompts = async (): Promise<readonly PromptHistoryEntry[]> => {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return promisifyRequest(store.getAll());
};

export const capturePrompt = async (input: CapturePromptInput): Promise<void> => {
  try {
    if (input.text.trim().length === 0) return;

    const id = await computePromptId(input.text, input.type);
    const now = input.reference.usedAt;
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const existing: PromptHistoryEntry | undefined = await promisifyRequest(store.get(id));

    const entry: PromptHistoryEntry = existing
      ? {
          ...existing,
          useCount: existing.useCount + 1,
          lastUsedAt: now,
          references: [input.reference, ...existing.references].slice(0, PROMPT_REFERENCE_CAP),
        }
      : {
          id,
          text: input.text,
          type: input.type,
          firstSource: input.source,
          useCount: 1,
          firstUsedAt: now,
          lastUsedAt: now,
          references: [input.reference],
        };

    await promisifyRequest(store.put(entry));
    await transactionComplete(tx);
  } catch (err: unknown) {
    console.error('[prompts] capturePrompt failed:', err);
  }
};

export const deletePrompts = async (ids: readonly string[]): Promise<void> => {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  ids.forEach(id => {
    store.delete(id);
  });
  await transactionComplete(tx);
};
