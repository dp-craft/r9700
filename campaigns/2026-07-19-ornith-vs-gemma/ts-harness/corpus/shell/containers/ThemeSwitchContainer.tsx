import type React from 'react';

import { useSettingsStore } from '@/features/settings';

import { ThemeSwitch } from '../components/ThemeSwitch';

export function ThemeSwitchContainer(): React.ReactElement {
  const themeMode = useSettingsStore(s => s.themeMode);
  const setThemeMode = useSettingsStore(s => s.setThemeMode);

  return <ThemeSwitch currentMode={themeMode} onModeChange={setThemeMode} />;
}
