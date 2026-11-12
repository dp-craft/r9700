import type * as React from 'react';

export interface GeneralSectionProps {
  readonly languageSlot: React.ReactNode;
  readonly shortcutsSlot: React.ReactNode;
}

export const GeneralSection = ({
  languageSlot,
  shortcutsSlot,
}: GeneralSectionProps): React.ReactElement => {
  return (
    <div className="flex flex-col gap-6">
      {languageSlot}
      {shortcutsSlot}
    </div>
  );
};
