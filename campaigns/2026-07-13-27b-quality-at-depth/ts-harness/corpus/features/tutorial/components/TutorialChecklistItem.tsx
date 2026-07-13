import { CheckCircle2, Circle } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { TutorialGoalId } from '../types';

export interface TutorialChecklistItemProps {
  readonly id: TutorialGoalId;
  readonly title: string;
  readonly description: string;
  readonly isCompleted: boolean;
  readonly isHighlighted: boolean;
  readonly statusCompletedLabel?: string;
  readonly statusPendingLabel?: string;
  readonly className?: string;
}

const completedIcon: React.ReactElement = (
  <CheckCircle2 className="size-5 shrink-0 text-green-500" aria-hidden="true" />
);

const pendingIcon: React.ReactElement = (
  <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
);

export function TutorialChecklistItem({
  id,
  title,
  description,
  isCompleted,
  isHighlighted,
  statusCompletedLabel = 'completed',
  statusPendingLabel = 'pending',
  className,
}: TutorialChecklistItemProps): React.ReactElement {
  return (
    <li
      data-testid={`tutorial-checklist-item-${id}`}
      aria-label={`${title} — ${isCompleted ? statusCompletedLabel : statusPendingLabel}`}
      className={cn(
        'flex items-start gap-3 rounded-md px-3 py-2 transition-colors',
        isHighlighted && 'bg-accent',
        className
      )}
    >
      {isCompleted ? completedIcon : pendingIcon}
      <div className="flex flex-col gap-0.5">
        <span
          className={cn(
            'text-sm font-medium leading-tight',
            isCompleted && 'text-muted-foreground'
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            'text-xs leading-snug text-muted-foreground',
            isCompleted && 'text-muted-foreground/70'
          )}
        >
          {description}
        </span>
      </div>
    </li>
  );
}
