import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface MfLayoutSkeletonProps {
  readonly headerSlot?: ReactNode;
  readonly leftColumnSlot: ReactNode;
  readonly rightColumnSlot: ReactNode;
  readonly leftColumnAriaLabel: string;
  readonly rightColumnAriaLabel: string;
  readonly className?: string;
}

export function MfLayoutSkeleton({
  headerSlot,
  leftColumnSlot,
  rightColumnSlot,
  leftColumnAriaLabel,
  rightColumnAriaLabel,
  className,
}: MfLayoutSkeletonProps): ReactElement {
  return (
    <div
      data-testid="mf-layout-skeleton"
      className={cn('h-full w-full flex flex-col overflow-hidden', className)}
    >
      {headerSlot != null && <header data-testid="layout-header">{headerSlot}</header>}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside
          data-testid="left-column"
          aria-label={leftColumnAriaLabel}
          className="w-[400px] shrink-0 h-full overflow-hidden"
        >
          {leftColumnSlot}
        </aside>
        <section
          data-testid="right-column"
          aria-label={rightColumnAriaLabel}
          className="flex-1 min-w-0 h-full flex flex-col overflow-hidden"
        >
          {rightColumnSlot}
        </section>
      </div>
    </div>
  );
}
