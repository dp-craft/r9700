import type {
  AppSettingDTO,
  AtomicSkillDTO,
  ChatMessage,
  ChatSession,
  LLMProviderConfig,
  SkillContainerDTO,
  TestRunDTO
} from './idb';
import { DB_VERSION, getDb, promisifyRequest, transactionComplete } from './idb';

export interface DatabaseExportStores {
  readonly sessions: readonly ChatSession[];
  readonly messages: readonly ChatMessage[];
  readonly providerConfigs: readonly LLMProviderConfig[];
  readonly skills: readonly AtomicSkillDTO[];
  readonly containers: readonly SkillContainerDTO[];
  readonly appSettings: readonly AppSettingDTO[];
  readonly testRuns: readonly TestRunDTO[];
}

export interface DatabaseExport {
  readonly version: number;
  readonly exportedAt: number;
  readonly stores: DatabaseExportStores;
}

export interface ImportValidation {
  readonly valid: boolean;
  readonly error?: string;
}

const STORE_NAMES = [
  'sessions',
  'messages',
  'providerConfigs',
  'skills',
  'containers',
  'appSettings',
  'testRuns',
] as const;

function getAllFromStore<T>(tx: IDBTransaction, name: string): Promise<readonly T[]> {
  return promisifyRequest(tx.objectStore(name).getAll()) as Promise<readonly T[]>;
}

/** Exports all IDB stores. API keys in providerConfigs are encrypted at rest (008-encrypted-key-store). */
export async function exportAll(): Promise<DatabaseExport> {
  const db = await getDb();
  const tx = db.transaction([...STORE_NAMES], 'readonly');

  const [sessions, messages, providerConfigs, skills, containers, appSettings, testRuns] =
    await Promise.all([
      getAllFromStore<ChatSession>(tx, 'sessions'),
      getAllFromStore<ChatMessage>(tx, 'messages'),
      getAllFromStore<LLMProviderConfig>(tx, 'providerConfigs'),
      getAllFromStore<AtomicSkillDTO>(tx, 'skills'),
      getAllFromStore<SkillContainerDTO>(tx, 'containers'),
      getAllFromStore<AppSettingDTO>(tx, 'appSettings'),
      getAllFromStore<TestRunDTO>(tx, 'testRuns'),
    ]);

  return {
    version: DB_VERSION,
    exportedAt: Date.now(),
    stores: { sessions, messages, providerConfigs, skills, containers, appSettings, testRuns },
  };
}

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateImport(data: unknown): ImportValidation {
  if (!isNonNullObject(data)) {
    return { valid: false, error: 'Import data must be a non-null object' };
  }
  if (typeof data.version !== 'number' || data.version !== DB_VERSION) {
    return { valid: false, error: `Unsupported version: expected ${DB_VERSION}` };
  }
  if (!isNonNullObject(data.stores)) {
    return { valid: false, error: 'Missing or invalid stores object' };
  }
  const stores = data.stores;
  const missingStore = STORE_NAMES.find(name => !Array.isArray(stores[name]));
  if (missingStore !== undefined) {
    return { valid: false, error: `Store "${missingStore}" is missing or not an array` };
  }
  return { valid: true };
}

export async function importAll(data: DatabaseExport): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([...STORE_NAMES], 'readwrite');

  await Promise.all(STORE_NAMES.map(name => promisifyRequest(tx.objectStore(name).clear())));

  await Promise.all(
    STORE_NAMES.flatMap(name => {
      const store = tx.objectStore(name);
      return (data.stores[name] as readonly unknown[]).map(record =>
        promisifyRequest(store.put(record))
      );
    })
  );

  await transactionComplete(tx);
}
