import { GripVertical, X } from 'lucide-react';
import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { SkillCategory } from '../types';

export interface SortableSkillItemLabels {
  readonly dragToReorderAriaLabel: string;
  readonly removeAriaLabel: string;
}

export interface SortableSkillItemProps {
  readonly name: string;
  readonly category: SkillCategory | null;
  readonly hasOrderingIssue: boolean;
  readonly onRemove: () => void;
  readonly nodeRef: React.Ref<HTMLElement>;
  readonly style: React.CSSProperties;
  readonly dragHandleListeners: Record<string, unknown> | undefined;
  readonly isDragging: boolean;
  readonly labels?: SortableSkillItemLabels;
  readonly className?: string;
}

const getRootClassName = (
  isDragging: boolean,
  hasOrderingIssue: boolean,
  className?: string
): string =>
  cn(
    'flex items-center gap-2 rounded-md border bg-card px-3 py-2',
    isDragging && 'opacity-50',
    hasOrderingIssue && 'border-amber-500',
    className
  );

const getCategoryLabel = (category: SkillCategory | null): string => category ?? '\u2014';

const getCategoryVariant = (category: SkillCategory | null): 'secondary' | 'outline' =>
  category === null ? 'outline' : 'secondary';

const getWarningAttribute = (hasOrderingIssue: boolean): 'true' | undefined =>
  hasOrderingIssue ? 'true' : undefined;

const DEFAULT_LABELS: SortableSkillItemLabels = {
  dragToReorderAriaLabel: 'Drag to reorder',
  removeAriaLabel: 'Remove',
};

export function SortableSkillItem({
  name,
  category,
  hasOrderingIssue,
  onRemove,
  nodeRef,
  style,
  dragHandleListeners,
  isDragging,
  labels = DEFAULT_LABELS,
  className,
}: SortableSkillItemProps): React.ReactElement {
  const rootClassName = getRootClassName(isDragging, hasOrderingIssue, className);
  const categoryLabel = getCategoryLabel(category);
  const categoryVariant = getCategoryVariant(category);
  const warningAttribute = getWarningAttribute(hasOrderingIssue);

  return (
    <li
      ref={nodeRef as React.Ref<HTMLLIElement>}
      style={style}
      className={rootClassName}
      data-warning={warningAttribute}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 cursor-grab touch-none"
        aria-label={labels.dragToReorderAriaLabel}
        {...dragHandleListeners}
      >
        <GripVertical className="h-4 w-4" />
      </Button>

      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>

      <Badge variant={categoryVariant}>{categoryLabel}</Badge>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        aria-label={labels.removeAriaLabel}
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </Button>
    </li>
  );
}
