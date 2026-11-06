import type * as React from 'react';

export interface DefaultsSectionProps {
  readonly defaultContainerSlot: React.ReactNode;
  readonly providerSelectorSlot: React.ReactNode;
  readonly modelPickerSlot: React.ReactNode;
  readonly chatDefaultsHeading: string;
  readonly labDefaultsHeading: string;
}

export const DefaultsSection = ({
  defaultContainerSlot,
  providerSelectorSlot,
  modelPickerSlot,
  chatDefaultsHeading,
  labDefaultsHeading,
}: DefaultsSectionProps): React.ReactElement => {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 id="chat-defaults" className="text-sm font-medium">
          {chatDefaultsHeading}
        </h3>
        {defaultContainerSlot}
      </section>

      <hr className="border-border" />

      <section>
        <h3 id="lab-defaults" className="text-sm font-medium">
          {labDefaultsHeading}
        </h3>
        <div className="flex flex-col gap-6">
          {providerSelectorSlot}
          {modelPickerSlot}
        </div>
      </section>
    </div>
  );
};
