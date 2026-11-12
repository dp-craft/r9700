import type { ParallelismMode } from '@/domain/run-controls';

import type { AppSettingDTO } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';

const STORE_NAME = 'appSettings' as const;

export async function getAppSetting(id: string): Promise<string | null> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const result = await promisifyRequest<AppSettingDTO | undefined>(store.get(id));
  return result?.value ?? null;
}

export async function putAppSetting(id: string, value: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const dto: AppSettingDTO = { id, value };
  store.put(dto);
  await transactionComplete(tx);
}

export async function getAllAppSettings(): Promise<readonly AppSettingDTO[]> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return promisifyRequest(store.getAll());
}

// --- Typed accessors (024) ---

const LAB_OPEN_TABS_KEY = 'lab-open-tabs' as const;
const LAB_ACTIVE_TAB_KEY = 'lab-active-tab' as const;
const LAB_ACTIVE_RAIL_PANEL_KEY = 'lab-active-rail-panel' as const;
const TUTORIAL_RESET_V024_KEY = 'tutorial-reset-v024' as const;

export async function getLabOpenTabs(): Promise<readonly string[]> {
  const raw = await getAppSetting(LAB_OPEN_TABS_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

export async function putLabOpenTabs(tabs: readonly string[]): Promise<void> {
  await putAppSetting(LAB_OPEN_TABS_KEY, JSON.stringify(tabs));
}

export async function getLabActiveTab(): Promise<string | null> {
  const raw = await getAppSetting(LAB_ACTIVE_TAB_KEY);
  return raw === null || raw === '' ? null : raw;
}

export async function putLabActiveTab(id: string | null): Promise<void> {
  await putAppSetting(LAB_ACTIVE_TAB_KEY, id ?? '');
}

export async function getLabActiveRailPanel(): Promise<string | null> {
  const raw = await getAppSetting(LAB_ACTIVE_RAIL_PANEL_KEY);
  return raw === null || raw === '' ? null : raw;
}

export async function putLabActiveRailPanel(panel: string): Promise<void> {
  await putAppSetting(LAB_ACTIVE_RAIL_PANEL_KEY, panel);
}

export async function getTutorialResetV024(): Promise<boolean> {
  const raw = await getAppSetting(TUTORIAL_RESET_V024_KEY);
  return raw === 'true';
}

export async function putTutorialResetV024(flag: boolean): Promise<void> {
  await putAppSetting(TUTORIAL_RESET_V024_KEY, flag ? 'true' : 'false');
}

// --- Lab section collapse persistence (025) ---

const LAB_SECTION_MODELLEK_KEY = 'lab-section-modellek-collapsed' as const;
const LAB_SECTION_SYSTEM_SKILL_KEY = 'lab-section-system-skill-collapsed' as const;
const LAB_SECTION_USER_PROMPT_KEY = 'lab-section-user-prompt-collapsed' as const;

export async function getLabSectionCollapse(): Promise<Record<string, boolean>> {
  const [modellek, systemSkill, userPrompt] = await Promise.all([
    getAppSetting(LAB_SECTION_MODELLEK_KEY),
    getAppSetting(LAB_SECTION_SYSTEM_SKILL_KEY),
    getAppSetting(LAB_SECTION_USER_PROMPT_KEY),
  ]);
  return {
    modellek: modellek === 'true',
    systemSkill: systemSkill === 'true',
    userPrompt: userPrompt === 'true',
  };
}

export async function putLabSectionCollapse(data: Record<string, boolean>): Promise<void> {
  const entries: readonly [string, string][] = [
    [LAB_SECTION_MODELLEK_KEY, String(data.modellek ?? false)],
    [LAB_SECTION_SYSTEM_SKILL_KEY, String(data.systemSkill ?? false)],
    [LAB_SECTION_USER_PROMPT_KEY, String(data.userPrompt ?? false)],
  ];
  await Promise.all(entries.map(([key, value]) => putAppSetting(key, value)));
}

// --- Lab run-controls persistence (036) ---

const LAB_RUN_PARALLEL_KEY = 'lab-run-parallel' as const;
const LAB_PARALLELISM_MODE_KEY = 'lab-parallelism-mode' as const;
const DEFAULT_PARALLELISM_MODE: ParallelismMode = 'same-model';
const PARALLELISM_MODES: readonly ParallelismMode[] = ['same-model', 'everything'];

export async function getLabRunParallel(): Promise<boolean> {
  const raw = await getAppSetting(LAB_RUN_PARALLEL_KEY);
  return raw === null ? true : raw === 'true';
}

export async function putLabRunParallel(v: boolean): Promise<void> {
  await putAppSetting(LAB_RUN_PARALLEL_KEY, v ? 'true' : 'false');
}

export async function getLabParallelismMode(): Promise<ParallelismMode> {
  const raw = await getAppSetting(LAB_PARALLELISM_MODE_KEY);
  return PARALLELISM_MODES.find(mode => mode === raw) ?? DEFAULT_PARALLELISM_MODE;
}

export async function putLabParallelismMode(m: ParallelismMode): Promise<void> {
  await putAppSetting(LAB_PARALLELISM_MODE_KEY, m);
}

// --- Skills seed + palette persistence (037) ---

const SEED_BUILTINS_DONE_KEY = 'seed-builtins-done' as const;
const PALETTE_BORDER_COLOR_KEY = 'palette-border-color' as const;

// --- Evaluator model config persistence ---

const LAB_EVAL_PROVIDER_KEY = 'lab-eval-provider' as const;
const LAB_EVAL_MODEL_KEY = 'lab-eval-model' as const;

export async function getSeedBuiltinsDone(): Promise<boolean> {
  const raw = await getAppSetting(SEED_BUILTINS_DONE_KEY);
  return raw === 'true';
}

export async function putSeedBuiltinsDone(flag: boolean): Promise<void> {
  await putAppSetting(SEED_BUILTINS_DONE_KEY, flag ? 'true' : 'false');
}

export async function getPaletteBorderColor(): Promise<string | null> {
  const raw = await getAppSetting(PALETTE_BORDER_COLOR_KEY);
  return raw === null || raw === '' ? null : raw;
}

export async function putPaletteBorderColor(color: string): Promise<void> {
  await putAppSetting(PALETTE_BORDER_COLOR_KEY, color);
}

// --- Evaluator model config accessors ---

export async function getLabEvalProvider(): Promise<string | null> {
  const raw = await getAppSetting(LAB_EVAL_PROVIDER_KEY);
  return raw === null || raw === '' ? null : raw;
}

export async function setLabEvalProvider(providerId: string | null): Promise<void> {
  await putAppSetting(LAB_EVAL_PROVIDER_KEY, providerId ?? '');
}

export async function getLabEvalModel(): Promise<string | null> {
  const raw = await getAppSetting(LAB_EVAL_MODEL_KEY);
  return raw === null || raw === '' ? null : raw;
}

export async function setLabEvalModel(modelId: string | null): Promise<void> {
  await putAppSetting(LAB_EVAL_MODEL_KEY, modelId ?? '');
}
