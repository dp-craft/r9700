import type { SkillContainerDTO } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';

export interface CreateContainerInput {
  readonly name: string;
  readonly skillIds: readonly string[];
}

export interface UpdateContainerInput {
  readonly name?: string;
  readonly skillIds?: readonly string[];
}

const CONTAINER_STORE = 'containers' as const;

export async function getAllContainers(): Promise<readonly SkillContainerDTO[]> {
  const db = await getDb();
  const tx = db.transaction(CONTAINER_STORE, 'readonly');
  const store = tx.objectStore(CONTAINER_STORE);
  const containers = await promisifyRequest<SkillContainerDTO[]>(store.getAll());
  return [...containers].sort((a, b) => a.createdAt - b.createdAt);
}

export async function getContainer(id: string): Promise<SkillContainerDTO | undefined> {
  const db = await getDb();
  const tx = db.transaction(CONTAINER_STORE, 'readonly');
  const store = tx.objectStore(CONTAINER_STORE);
  return promisifyRequest<SkillContainerDTO | undefined>(store.get(id));
}

export async function createContainer(input: CreateContainerInput): Promise<SkillContainerDTO> {
  if (!input.name.trim()) {
    throw new Error('Container name must not be empty');
  }

  const db = await getDb();
  const tx = db.transaction(CONTAINER_STORE, 'readwrite');
  const store = tx.objectStore(CONTAINER_STORE);
  const now = Date.now();
  const container: SkillContainerDTO = {
    id: crypto.randomUUID(),
    name: input.name,
    skillIds: [...input.skillIds],
    createdAt: now,
    updatedAt: now,
  };
  store.put(container);
  await transactionComplete(tx);
  return container;
}

export async function updateContainer(
  id: string,
  input: UpdateContainerInput
): Promise<SkillContainerDTO> {
  const db = await getDb();
  const tx = db.transaction(CONTAINER_STORE, 'readwrite');
  const store = tx.objectStore(CONTAINER_STORE);
  const existing = await promisifyRequest<SkillContainerDTO | undefined>(store.get(id));

  if (!existing) {
    throw new Error(`Container not found: ${id}`);
  }

  const updated: SkillContainerDTO = {
    ...existing,
    ...('name' in input ? { name: input.name } : {}),
    ...('skillIds' in input ? { skillIds: input.skillIds } : {}),
    updatedAt: Date.now(),
  };
  store.put(updated);
  await transactionComplete(tx);
  return updated;
}

export async function deleteContainer(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(CONTAINER_STORE, 'readwrite');
  const store = tx.objectStore(CONTAINER_STORE);
  store.delete(id);
  await transactionComplete(tx);
}

export async function removeSkillFromAllContainers(skillId: string): Promise<readonly string[]> {
  const db = await getDb();
  const tx = db.transaction(CONTAINER_STORE, 'readwrite');
  const store = tx.objectStore(CONTAINER_STORE);
  const containers = await promisifyRequest<SkillContainerDTO[]>(store.getAll());

  const affected = containers.filter(c => c.skillIds.includes(skillId));

  const now = Date.now();
  affected.forEach(c => {
    const updated: SkillContainerDTO = {
      ...c,
      skillIds: c.skillIds.filter(sid => sid !== skillId),
      updatedAt: now,
    };
    store.put(updated);
  });

  await transactionComplete(tx);
  return affected.map(c => c.name);
}
