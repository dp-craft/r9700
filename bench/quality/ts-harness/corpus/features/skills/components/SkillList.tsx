import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { SkillListItemVM } from '../types';

export interface SkillListLabels {
  readonly listAriaLabel: string;
  readonly selectSkillAriaPrefix: string;
  readonly builtinBadgeLabel: string;
  readonly uncategorizedBadgeLabel: string;
}

export interface SkillListProps {
  readonly skills: readonly SkillListItemVM[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly labels?: SkillListLabels;
  readonly className?: string;
}

const getItemClassName = (isSelected: boolean): string =>
  cn(
    'flex w-full cursor-pointer flex-col gap-1 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    isSelected && 'bg-accent font-medium'
  );

const getCategoryBadge = (
  category: SkillListItemVM['category'],
  uncategorizedLabel: string
): React.ReactElement =>
  category !== null ? (
    <Badge variant="secondary">{category}</Badge>
  ) : (
    <Badge variant="outline">{uncategorizedLabel}</Badge>
  );

const handleItemClick =
  (id: string, onSelect: (id: string) => void): (() => void) =>
    (): void =>
      onSelect(id);

const DEFAULT_LABELS: SkillListLabels = {
  listAriaLabel: 'Skills list',
  selectSkillAriaPrefix: 'Select skill:',
  builtinBadgeLabel: 'built-in',
  uncategorizedBadgeLabel: 'uncategorized',
};

export function SkillList({
  skills,
  selectedId,
  onSelect,
  labels = DEFAULT_LABELS,
  className,
}: SkillListProps): React.ReactElement {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-2', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label={labels.listAriaLabel} className="flex flex-col gap-1">
          {skills.map(skill => {
            const isSelected = skill.id === selectedId;

            return (
              <button
                key={skill.id}
                type="button"
                className={getItemClassName(isSelected)}
                data-selected={isSelected ? 'true' : undefined}
                aria-pressed={isSelected}
                onClick={handleItemClick(skill.id, onSelect)}
                aria-label={`${labels.selectSkillAriaPrefix} ${skill.name}`}
              >
                <span className="truncate font-medium">{skill.name}</span>
                {skill.description !== null && (
                  <span className="text-muted-foreground truncate text-xs">
                    {skill.description}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-1">
                  {skill.type === 'builtin' && (
                    <Badge variant="outline">{labels.builtinBadgeLabel}</Badge>
                  )}
                  {getCategoryBadge(skill.category, labels.uncategorizedBadgeLabel)}
                  {skill.commandPrefix !== null && (
                    <span className="text-muted-foreground font-mono text-xs">
                      {skill.commandPrefix}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </nav>
      </ScrollArea>
    </div>
  );
}
