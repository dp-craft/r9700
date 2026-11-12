import { getAppSetting, putAppSetting } from '@/db/appSettings';
import { getAllSessions, putSession } from '@/db/sessions';

const MIGRATION_V5_GUARD_KEY = 'migration-v5-done';
const MIGRATION_V5_GUARD_VALUE = 'true';

const LOCAL_STORAGE_KEY_MAP: readonly (readonly [string, string])[] = [
  ['app:font-size', 'font-size'],
  ['theme-preference', 'theme-preference'],
  ['tutorial-progress', 'tutorial-progress'],
] as const;

function formatSessionTitle(createdAt: number): string {
  return new Date(createdAt).toLocaleString();
}

async function migrateLocalStorageToIdb(): Promise<void> {
  const writes = LOCAL_STORAGE_KEY_MAP.map(
    ([lsKey, idbKey]) => [localStorage.getItem(lsKey), idbKey] as const
  ).filter((entry): entry is readonly [string, string] => entry[0] !== null);

  await Promise.all(writes.map(([value, idbKey]) => putAppSetting(idbKey, value)));
}

async function backfillSessionTitles(): Promise<void> {
  const sessions = await getAllSessions();
  const untitled = sessions.filter(s => !s.title);

  await Promise.all(
    untitled.map(session =>
      putSession({ ...session, title: formatSessionTitle(session.createdAt) })
    )
  );
}

function removeLocalStorageKeys(): void {
  LOCAL_STORAGE_KEY_MAP.forEach(([lsKey]) => {
    localStorage.removeItem(lsKey);
  });
}

export async function runV5Migration(): Promise<void> {
  try {
    const guardValue = await getAppSetting(MIGRATION_V5_GUARD_KEY);
    if (guardValue === MIGRATION_V5_GUARD_VALUE) return;

    await migrateLocalStorageToIdb();
    await backfillSessionTitles();
    await putAppSetting(MIGRATION_V5_GUARD_KEY, MIGRATION_V5_GUARD_VALUE);
    removeLocalStorageKeys();
  } catch (error) {
    console.error('[Migration] V5 migration failed:', error);
  }
}
