import type React from 'react';

import { useSettingsStore } from '@/features/settings';
import { useTranslation } from '@/i18n';

import { type FontSizeLabels, FontSizeSwitch } from '../components/FontSizeSwitch';

export function FontSizeSwitchContainer(): React.ReactElement {
  const t = useTranslation();
  const fontSize = useSettingsStore(s => s.fontSize);
  const setFontSize = useSettingsStore(s => s.setFontSize);

  const labels: FontSizeLabels = {
    sm: t('fontSize.small'),
    md: t('fontSize.medium'),
    lg: t('fontSize.large'),
    group: t('fontSize.group'),
  };

  return <FontSizeSwitch fontSize={fontSize} onFontSizeChange={setFontSize} labels={labels} />;
}
