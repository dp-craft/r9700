import type { LLMProviderConfig } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';

export async function getAllProviderConfigs(): Promise<LLMProviderConfig[]> {
  const db = await getDb();
  const tx = db.transaction('providerConfigs', 'readonly');
  return promisifyRequest<LLMProviderConfig[]>(tx.objectStore('providerConfigs').getAll());
}

export async function getProviderConfig(id: string): Promise<LLMProviderConfig | undefined> {
  const db = await getDb();
  const tx = db.transaction('providerConfigs', 'readonly');
  return promisifyRequest<LLMProviderConfig | undefined>(tx.objectStore('providerConfigs').get(id));
}

export async function putProviderConfig(config: LLMProviderConfig): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('providerConfigs', 'readwrite');
  tx.objectStore('providerConfigs').put(config);
  await transactionComplete(tx);
}

export async function setProviderThinkingCapabilities(
  providerId: string,
  capabilities: Readonly<Record<string, boolean>>
): Promise<void> {
  const existing = await getProviderConfig(providerId);
  if (!existing) {
    throw new Error(`Provider config not found: ${providerId}`);
  }
  const merged: LLMProviderConfig = {
    ...existing,
    thinkingCapableModels: { ...existing.thinkingCapableModels, ...capabilities },
  };
  await putProviderConfig(merged);
}
