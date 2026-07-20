import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface TutorialFabProps {
  readonly completedCount: number;
  readonly totalCount: number;
  readonly onToggle: () => void;
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function TutorialFab({
  completedCount,
  totalCount,
  onToggle,
  ariaLabel = `Tutorial progress: ${completedCount} of ${totalCount} completed`,
  className,
}: TutorialFabProps): React.ReactElement {
  const progressText = `${completedCount}/${totalCount}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={ariaLabel}
      data-testid="tutorial-fab"
      className={cn(
        'fixed top-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full',
        'bg-primary text-primary-foreground shadow-lg',
        'transition-transform hover:scale-110',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        className
      )}
    >
      <span className="text-sm font-semibold">{progressText}</span>
    </button>
  );
}
