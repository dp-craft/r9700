import type * as React from 'react';

import { useTranslation } from '@/i18n';

import { FontSizePicker } from '../components/FontSizePicker';
import type { FontSize } from '../stores/useSettingsStore';
import { useSettingsStore } from '../stores/useSettingsStore';

const VALID_FONT_SIZES: readonly FontSize[] = ['sm', 'md', 'lg'];
const isFontSize = (value: string): value is FontSize =>
  VALID_FONT_SIZES.includes(value as FontSize);

export function FontSizePickerContainer(): React.ReactElement {
  const t = useTranslation();
  const fontSize = useSettingsStore(s => s.fontSize);
  const setFontSize = useSettingsStore(s => s.setFontSize);

  const handleFontSizeChange = (size: string): void => {
    if (isFontSize(size)) {
      void setFontSize(size);
    }
  };

  return (
    <FontSizePicker
      fontSize={fontSize}
      onFontSizeChange={handleFontSizeChange}
      smallLabel={t('settings.fontSizeSmall')}
      mediumLabel={t('settings.fontSizeMedium')}
      largeLabel={t('settings.fontSizeLarge')}
      selectFontSizeAria={t('settings.selectFontSize')}
    />
  );
}
