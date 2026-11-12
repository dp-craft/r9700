import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type * as React from 'react';

import type { SkillCategory } from '@/domain/entities';

import type { SortableSkillItemLabels } from '../components/SortableSkillItem';
import { SortableSkillItem } from '../components/SortableSkillItem';

export interface SortableSkillItemContainerProps {
  readonly id: string;
  readonly name: string;
  readonly category: SkillCategory | null;
  readonly hasOrderingIssue: boolean;
  readonly onRemove: () => void;
  readonly labels?: SortableSkillItemLabels;
}

export function SortableSkillItemContainer({
  id,
  name,
  category,
  hasOrderingIssue,
  onRemove,
  labels,
}: SortableSkillItemContainerProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };

  return (
    <SortableSkillItem
      name={name}
      category={category}
      hasOrderingIssue={hasOrderingIssue}
      onRemove={onRemove}
      nodeRef={setNodeRef}
      style={style}
      dragHandleListeners={listeners}
      isDragging={isDragging}
      labels={labels}
      {...attributes}
    />
  );
}
