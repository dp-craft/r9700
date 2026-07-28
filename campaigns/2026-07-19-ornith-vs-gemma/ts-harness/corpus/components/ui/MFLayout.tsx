import type { ReactNode } from 'react';
import React from 'react';

import { cn } from '@/lib/utils';

export interface MFLayoutProps {
  readonly headerSlot?: ReactNode;
  readonly leftRailSlot?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export const MFLayout = React.memo(function MFLayout(props: MFLayoutProps) {
  const { headerSlot, leftRailSlot, children, className } = props;

  return (
    <div className={cn('flex h-full w-full flex-col overflow-hidden bg-background', className)}>
      {headerSlot != null && (
        <header className="shrink-0 border-b border-border" data-slot="mf-header">
          {headerSlot}
        </header>
      )}
      <div className="flex min-h-0 flex-1">
        {leftRailSlot != null && (
          <aside
            className="shrink-0 border-r border-border"
            data-slot="mf-left-rail"
            aria-label="Navigation rail"
          >
            {leftRailSlot}
          </aside>
        )}
        <main className="min-w-0 flex-1 overflow-auto" data-slot="mf-content">
          {children}
        </main>
      </div>
    </div>
  );
});
