import type * as React from 'react';

export interface ApiModelsSectionProps {
  readonly providerSelectorSlot: React.ReactNode;
  readonly modelPickerSlot: React.ReactNode;
  readonly keySecuritySlot: React.ReactNode;
}

export const ApiModelsSection = ({
  providerSelectorSlot,
  modelPickerSlot,
  keySecuritySlot,
}: ApiModelsSectionProps): React.ReactElement => {
  return (
    <div className="flex flex-col gap-6">
      {providerSelectorSlot}
      {modelPickerSlot}
      {keySecuritySlot}
    </div>
  );
};
