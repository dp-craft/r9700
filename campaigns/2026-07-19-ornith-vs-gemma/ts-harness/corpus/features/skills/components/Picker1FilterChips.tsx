import { memo } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type Picker1Filter = 'all' | 'skills' | 'history' | 'pinned' | 'blank';

export interface Picker1FilterChipsLabels {
  readonly all: string;
  readonly skills: string;
  readonly history: string;
  readonly pinned: string;
  readonly blank: string;
}

export interface Picker1FilterChipsProps {
  readonly activeFilter: Picker1Filter;
  readonly onFilterChange: (filter: Picker1Filter) => void;
  readonly labels: Picker1FilterChipsLabels;
  readonly groupAriaLabel?: string;
  readonly className?: string;
}

interface ChipDescriptor {
  readonly key: Picker1Filter;
  readonly labelKey: keyof Picker1FilterChipsLabels;
}

const CHIPS: readonly ChipDescriptor[] = [
  { key: 'all', labelKey: 'all' },
  { key: 'skills', labelKey: 'skills' },
  { key: 'history', labelKey: 'history' },
  { key: 'pinned', labelKey: 'pinned' },
  { key: 'blank', labelKey: 'blank' },
] as const;

const Picker1FilterChipsImpl = ({
  activeFilter,
  onFilterChange,
  labels,
  groupAriaLabel,
  className,
}: Picker1FilterChipsProps): React.JSX.Element => {
  const handleClick =
    (filter: Picker1Filter): (() => void) =>
      (): void => {
        onFilterChange(filter);
      };

  return (
    <div
      role="toolbar"
      aria-label={groupAriaLabel ?? labels.all}
      className={cn('flex flex-row flex-wrap items-center gap-2', className)}
    >
      {CHIPS.map(chip => {
        const isActive = activeFilter === chip.key;
        return (
          <Button
            key={chip.key}
            type="button"
            size="sm"
            variant={isActive ? 'default' : 'outline'}
            aria-pressed={isActive}
            data-testid={`picker1-filter-${chip.key}`}
            onClick={handleClick(chip.key)}
          >
            {labels[chip.labelKey]}
          </Button>
        );
      })}
    </div>
  );
};

export const Picker1FilterChips: React.MemoExoticComponent<typeof Picker1FilterChipsImpl> =
  memo(Picker1FilterChipsImpl);
