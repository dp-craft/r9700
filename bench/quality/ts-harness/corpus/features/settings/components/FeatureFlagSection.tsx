import type * as React from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface FeatureFlagViewModel {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
}

export interface FeatureFlagSectionProps {
  readonly flags: readonly FeatureFlagViewModel[];
  readonly onToggle: (key: string) => void;
  readonly heading: string;
  readonly className?: string;
}

function FlagCard({
  flag,
  onCheckedChange,
}: {
  readonly flag: FeatureFlagViewModel;
  readonly onCheckedChange: () => void;
}): React.ReactElement {
  const switchId = `flag-${flag.key}`;

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={switchId} className="text-sm font-medium">
          {flag.name}
        </Label>
        <p id={`${switchId}-description`} className="text-muted-foreground text-sm">
          {flag.description}
        </p>
      </div>
      <Switch
        id={switchId}
        checked={flag.enabled}
        onCheckedChange={onCheckedChange}
        aria-label={flag.name}
        aria-describedby={`${switchId}-description`}
      />
    </div>
  );
}

export function FeatureFlagSection({
  flags,
  onToggle,
  heading,
  className,
}: FeatureFlagSectionProps): React.ReactElement {
  const handleToggle =
    (key: string): (() => void) =>
      (): void =>
        onToggle(key);

  return (
    <section
      className={cn('space-y-3', className)}
      aria-labelledby="settings-feature-flags-heading"
    >
      <h3 id="settings-feature-flags-heading" className="text-muted-foreground text-sm font-medium">
        {heading}
      </h3>
      <div className="flex flex-col gap-4">
        {flags.map(flag => (
          <FlagCard key={flag.key} flag={flag} onCheckedChange={handleToggle(flag.key)} />
        ))}
      </div>
    </section>
  );
}
