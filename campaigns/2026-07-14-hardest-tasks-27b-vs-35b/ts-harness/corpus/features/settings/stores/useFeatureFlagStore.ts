import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { getAppSetting, putAppSetting } from '@/db/appSettings';
import {
  FEATURE_FLAG_REGISTRY,
  type FeatureFlagKey,
  type FeatureFlagStore
} from '@/domain/feature-flags';
import { isElectron } from '@/lib/platform';

const FF_SETTING_PREFIX = 'ff-';

const ELECTRON_DEFAULT_OVERRIDES: Partial<Record<FeatureFlagKey, boolean>> = {
  'show-cors-providers': true,
};

const buildDefaultFlags = (): Record<FeatureFlagKey, boolean> => {
  const electronOverrides = isElectron() ? ELECTRON_DEFAULT_OVERRIDES : {};
  return Object.fromEntries(
    Object.values(FEATURE_FLAG_REGISTRY).map(def => [
      def.key,
      electronOverrides[def.key] ?? def.defaultValue,
    ])
  ) as Record<FeatureFlagKey, boolean>;
};

const parseFlagValue = (raw: string | null, fallback: boolean): boolean => {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
};

export const useFeatureFlagStore = create<FeatureFlagStore>()(
  immer((set, get) => ({
    flags: buildDefaultFlags(),

    loadFeatureFlags: async (): Promise<void> => {
      const electronOverrides = isElectron() ? ELECTRON_DEFAULT_OVERRIDES : {};
      const entries = await Promise.all(
        Object.values(FEATURE_FLAG_REGISTRY).map(async def => {
          const raw = await getAppSetting(`${FF_SETTING_PREFIX}${def.key}`);
          const platformDefault = electronOverrides[def.key] ?? def.defaultValue;
          return [def.key, parseFlagValue(raw, platformDefault)] as const;
        })
      );
      set(state => {
        Object.assign(state.flags, Object.fromEntries(entries));
      });
    },

    toggleFlag: async (key: FeatureFlagKey): Promise<void> => {
      const newValue = !get().flags[key];
      await putAppSetting(`${FF_SETTING_PREFIX}${key}`, String(newValue));
      set(state => {
        state.flags[key] = newValue;
      });
    },

    getFlag: (key: FeatureFlagKey): boolean => get().flags[key],
  }))
);
