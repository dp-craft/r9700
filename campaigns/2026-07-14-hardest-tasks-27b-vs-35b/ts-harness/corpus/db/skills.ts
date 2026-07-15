import { getBuiltinSkillContent } from '@/domain/builtin-skills';
import type { Locale } from '@/i18n/types';

import { getSeedBuiltinsDone, putSeedBuiltinsDone } from './appSettings';
import type { AtomicSkillDTO, SkillCategory } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';

// -- Input types --

export interface CreateSkillInput {
  readonly name: string;
  readonly prompt: string;
  readonly category: SkillCategory | null;
  readonly commandPrefix: string | null;
  readonly description?: string | null;
}

export interface UpdateSkillInput {
  readonly name?: string;
  readonly prompt?: string;
  readonly category?: SkillCategory | null;
  readonly commandPrefix?: string | null;
  readonly description?: string | null;
}

// -- Constants --

const COPY_SUFFIX = ' (Copy)';

interface BuiltinSkillTemplate {
  readonly key: string;
  readonly category: SkillCategory;
  readonly commandPrefix: string;
}

const BUILTIN_SKILL_TEMPLATES: readonly BuiltinSkillTemplate[] = [
  { key: 'reasoning-coach', category: 'constraints', commandPrefix: '/reason' },
  { key: 'translator', category: 'persona', commandPrefix: '/translate' },
  { key: 'concise-writer', category: 'format', commandPrefix: '/concise' },
  { key: 'eli5-explainer', category: 'persona', commandPrefix: '/eli5' },
];

// -- Validation helpers --

function validatePromptNotEmpty(prompt: string): void {
  if (prompt.trim().length === 0) {
    throw new Error('Skill prompt must not be empty');
  }
}

function validateNameUnique(
  name: string,
  existing: readonly AtomicSkillDTO[],
  excludeId?: string
): void {
  const duplicate = existing.find(s => s.name === name && s.id !== excludeId);
  if (duplicate) {
    throw new Error(`Skill name "${name}" is already taken`);
  }
}

function validatePrefixUnique(
  prefix: string | null,
  existing: readonly AtomicSkillDTO[],
  excludeId?: string
): void {
  if (prefix === null) return;
  const duplicate = existing.find(s => s.commandPrefix === prefix && s.id !== excludeId);
  if (duplicate) {
    throw new Error(`Command prefix "${prefix}" is already taken`);
  }
}

function validateSkillExists(
  skill: AtomicSkillDTO | undefined,
  id: string
): asserts skill is AtomicSkillDTO {
  if (!skill) {
    throw new Error(`Skill "${id}" not found`);
  }
}

function validateNotBuiltin(skill: AtomicSkillDTO): void {
  if (skill.type === 'builtin') {
    throw new Error('Cannot modify a builtin skill');
  }
}

// -- Merge helper --

function applyDefinedFields(existing: AtomicSkillDTO, input: UpdateSkillInput): AtomicSkillDTO {
  const now = Date.now();
  return {
    ...existing,
    ...('name' in input ? { name: input.name as string } : {}),
    ...('prompt' in input ? { prompt: input.prompt as string } : {}),
    ...('category' in input ? { category: input.category as SkillCategory | null } : {}),
    ...('commandPrefix' in input ? { commandPrefix: input.commandPrefix as string | null } : {}),
    ...('description' in input ? { description: input.description as string | null } : {}),
    updatedAt: now,
  };
}

// -- CRUD operations --

export async function getAllSkills(): Promise<readonly AtomicSkillDTO[]> {
  const db = await getDb();
  const tx = db.transaction('skills', 'readonly');
  return promisifyRequest<AtomicSkillDTO[]>(tx.objectStore('skills').getAll());
}

export async function getSkill(id: string): Promise<AtomicSkillDTO | undefined> {
  const db = await getDb();
  const tx = db.transaction('skills', 'readonly');
  return promisifyRequest<AtomicSkillDTO | undefined>(tx.objectStore('skills').get(id));
}

export async function getSkillByCommandPrefix(prefix: string): Promise<AtomicSkillDTO | undefined> {
  const db = await getDb();
  const tx = db.transaction('skills', 'readonly');
  const all = await promisifyRequest<AtomicSkillDTO[]>(tx.objectStore('skills').getAll());
  return all.find(s => s.commandPrefix === prefix);
}

export async function createSkill(input: CreateSkillInput): Promise<AtomicSkillDTO> {
  const db = await getDb();
  const readTx = db.transaction('skills', 'readonly');
  const existing = await promisifyRequest<AtomicSkillDTO[]>(readTx.objectStore('skills').getAll());

  validatePromptNotEmpty(input.prompt);
  validateNameUnique(input.name, existing);
  validatePrefixUnique(input.commandPrefix, existing);

  const now = Date.now();
  const skill: AtomicSkillDTO = {
    id: crypto.randomUUID(),
    name: input.name,
    prompt: input.prompt,
    type: 'custom',
    category: input.category,
    commandPrefix: input.commandPrefix,
    conditions: null,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const writeTx = db.transaction('skills', 'readwrite');
  writeTx.objectStore('skills').put(skill);
  await transactionComplete(writeTx);

  return skill;
}

export async function updateSkill(id: string, input: UpdateSkillInput): Promise<AtomicSkillDTO> {
  const db = await getDb();
  const readTx = db.transaction('skills', 'readonly');
  const existing = await promisifyRequest<AtomicSkillDTO | undefined>(
    readTx.objectStore('skills').get(id)
  );

  validateSkillExists(existing, id);
  validateNotBuiltin(existing);

  const allSkills = await promisifyRequest<AtomicSkillDTO[]>(
    db.transaction('skills', 'readonly').objectStore('skills').getAll()
  );

  const nameToCheck = 'name' in input ? (input.name as string) : existing.name;
  const prefixToCheck =
    'commandPrefix' in input ? (input.commandPrefix as string | null) : existing.commandPrefix;

  validateNameUnique(nameToCheck, allSkills, id);
  validatePrefixUnique(prefixToCheck, allSkills, id);

  const updated = applyDefinedFields(existing, input);

  const writeTx = db.transaction('skills', 'readwrite');
  writeTx.objectStore('skills').put(updated);
  await transactionComplete(writeTx);

  return updated;
}

export async function deleteSkill(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('skills', 'readwrite');
  const store = tx.objectStore('skills');
  const existing = await promisifyRequest<AtomicSkillDTO | undefined>(store.get(id));

  validateSkillExists(existing, id);

  store.delete(id);
  await transactionComplete(tx);
}

export async function duplicateSkill(id: string): Promise<AtomicSkillDTO> {
  const db = await getDb();
  const readTx = db.transaction('skills', 'readonly');
  const original = await promisifyRequest<AtomicSkillDTO | undefined>(
    readTx.objectStore('skills').get(id)
  );

  validateSkillExists(original, id);

  const allSkills = await promisifyRequest<AtomicSkillDTO[]>(
    db.transaction('skills', 'readonly').objectStore('skills').getAll()
  );

  const copyName = `${original.name}${COPY_SUFFIX}`;
  validateNameUnique(copyName, allSkills);

  const now = Date.now();
  const copy: AtomicSkillDTO = {
    ...original,
    id: crypto.randomUUID(),
    name: copyName,
    type: 'custom',
    commandPrefix: null,
    createdAt: now,
    updatedAt: now,
  };

  const writeTx = db.transaction('skills', 'readwrite');
  writeTx.objectStore('skills').put(copy);
  await transactionComplete(writeTx);

  return copy;
}

export async function seedBuiltinSkills(locale: Locale = 'hu'): Promise<void> {
  const alreadySeeded = await getSeedBuiltinsDone();
  if (alreadySeeded) return;

  const db = await getDb();
  const content = getBuiltinSkillContent(locale);
  const now = Date.now();
  const writeTx = db.transaction('skills', 'readwrite');
  const store = writeTx.objectStore('skills');
  const existing = await promisifyRequest<AtomicSkillDTO[]>(store.getAll());
  if (existing.some(s => s.type === 'builtin')) {
    await putSeedBuiltinsDone(true);
    return;
  }

  BUILTIN_SKILL_TEMPLATES.forEach(template => {
    const entry = content[template.key];
    const skill: AtomicSkillDTO = {
      id: crypto.randomUUID(),
      name: entry.name,
      prompt: entry.prompt,
      type: 'builtin',
      category: template.category,
      commandPrefix: template.commandPrefix,
      conditions: null,
      description: null,
      createdAt: now,
      updatedAt: now,
    };
    store.put(skill);
  });

  await transactionComplete(writeTx);
  await putSeedBuiltinsDone(true);
}
