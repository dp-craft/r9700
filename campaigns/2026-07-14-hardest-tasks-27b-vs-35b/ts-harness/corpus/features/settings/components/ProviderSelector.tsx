import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface Provider {
  readonly id: string;
  readonly label: string;
}

export interface ProviderSelectorProps {
  readonly providers: readonly Provider[];
  readonly activeProviderId: string;
  readonly onProviderChange: (providerId: string) => void;
  readonly providerForm: React.ReactNode;
  readonly className?: string;
  readonly selectProviderAria?: string;
}

function getButtonVariant(activeProviderId: string, id: string): 'default' | 'outline' {
  return activeProviderId === id ? 'default' : 'outline';
}

function createClickHandler(
  onProviderChange: (providerId: string) => void,
  id: string
): () => void {
  return () => onProviderChange(id);
}

export function ProviderSelector({
  providers,
  activeProviderId,
  onProviderChange,
  providerForm,
  className,
  selectProviderAria = 'Select provider',
}: ProviderSelectorProps): React.ReactElement {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <fieldset
        className="flex gap-2 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-0 p-0"
        aria-label={selectProviderAria}
        data-testid="settings-provider-select"
      >
        {providers.map(({ id, label }) => (
          <Button
            key={id}
            variant={getButtonVariant(activeProviderId, id)}
            size="sm"
            className="flex-shrink-0"
            onClick={createClickHandler(onProviderChange, id)}
            aria-pressed={activeProviderId === id}
            data-testid={`settings-provider-${id}`}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      {providerForm}
    </div>
  );
}
