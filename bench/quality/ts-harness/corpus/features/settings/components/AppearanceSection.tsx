import type * as React from 'react';

export interface AppearanceSectionProps {
  readonly themeSlot: React.ReactNode;
  readonly fontSizeSlot: React.ReactNode;
  readonly colorPaletteSlot: React.ReactNode;
  readonly featureFlagsSlot: React.ReactNode;
}

export const AppearanceSection = ({
  themeSlot,
  fontSizeSlot,
  colorPaletteSlot,
  featureFlagsSlot,
}: AppearanceSectionProps): React.ReactElement => {
  return (
    <div className="flex flex-col gap-6">
      {fontSizeSlot}
      {themeSlot}
      {colorPaletteSlot}
      {featureFlagsSlot}
    </div>
  );
};
