import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { ContainerListItemVM } from '../types';

export interface ContainerListLabels {
  readonly listAriaLabel: string;
  readonly selectContainerAriaPrefix: string;
  readonly skillCountSingularLabel: string;
  readonly skillCountPluralLabel: string;
}

export interface ContainerListProps {
  readonly containers: readonly ContainerListItemVM[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly labels?: ContainerListLabels;
  readonly className?: string;
}

const getItemClassName = (isSelected: boolean): string =>
  cn(
    'flex w-full cursor-pointer flex-col gap-1 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    isSelected && 'bg-accent font-medium'
  );

const DEFAULT_LABELS: ContainerListLabels = {
  listAriaLabel: 'Containers list',
  selectContainerAriaPrefix: 'Select container:',
  skillCountSingularLabel: '1 skill',
  skillCountPluralLabel: '{{count}} skills',
};

const getSkillCountLabel = (count: number, singularLabel: string, pluralLabel: string): string =>
  count === 1 ? singularLabel : pluralLabel.replace('{{count}}', String(count));

const handleItemClick =
  (id: string, onSelect: (id: string) => void): (() => void) =>
    (): void =>
      onSelect(id);

export function ContainerList({
  containers,
  selectedId,
  onSelect,
  labels = DEFAULT_LABELS,
  className,
}: ContainerListProps): React.ReactElement {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-2', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label={labels.listAriaLabel} className="flex flex-col gap-1">
          {containers.map(container => {
            const isSelected = container.id === selectedId;

            return (
              <button
                key={container.id}
                type="button"
                className={getItemClassName(isSelected)}
                data-selected={isSelected ? 'true' : undefined}
                aria-pressed={isSelected}
                onClick={handleItemClick(container.id, onSelect)}
                aria-label={`${labels.selectContainerAriaPrefix} ${container.name}`}
              >
                <span className="truncate font-medium">{container.name}</span>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="secondary">
                    {getSkillCountLabel(
                      container.skillCount,
                      labels.skillCountSingularLabel,
                      labels.skillCountPluralLabel
                    )}
                  </Badge>
                </div>
              </button>
            );
          })}
        </nav>
      </ScrollArea>
    </div>
  );
}
