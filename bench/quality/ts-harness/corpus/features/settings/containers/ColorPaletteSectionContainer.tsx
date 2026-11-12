import type * as React from 'react';

import { useTranslation } from '@/i18n';

import { ColorPaletteSection } from '../components/ColorPaletteSection';
import { useSettingsStore } from '../stores/useSettingsStore';

const PALETTE_PICKER_DISPLAY_DEFAULT = '#e7e5e4';

export function ColorPaletteSectionContainer(): React.ReactElement {
  const t = useTranslation();
  const storedBorderColor = useSettingsStore(s => s.palette.borderColor);
  const setPaletteColor = useSettingsStore(s => s.setPaletteColor);

  const borderColor = storedBorderColor === '' ? PALETTE_PICKER_DISPLAY_DEFAULT : storedBorderColor;

  const handleBorderColorChange = (hex: string): void => {
    void setPaletteColor('borderColor', hex);
  };

  const handleReset = (): void => {
    void setPaletteColor('borderColor', '');
  };

  return (
    <ColorPaletteSection
      borderColor={borderColor}
      onBorderColorChange={handleBorderColorChange}
      onReset={handleReset}
      heading={t('settings.paletteHeading')}
      borderColorLabel={t('settings.paletteBorderColorLabel')}
      resetLabel={t('settings.paletteResetLabel')}
    />
  );
}
