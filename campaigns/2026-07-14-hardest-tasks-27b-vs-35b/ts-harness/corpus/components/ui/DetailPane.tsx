import type { ReactNode } from 'react';
import React from 'react';

import { cn } from '@/lib/utils';

import { ScrollArea } from './scroll-area';

export interface DetailPaneProps {
  readonly headerSlot: ReactNode;
  readonly bodySlot: ReactNode;
  readonly footerActions: ReactNode;
  readonly className?: string;
}

export const DetailPane = React.memo(function DetailPane(props: DetailPaneProps) {
  const { headerSlot, bodySlot, footerActions, className } = props;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="shrink-0 border-b border-border px-4 py-3">{headerSlot}</div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3">{bodySlot}</div>
      </ScrollArea>
      <div className="shrink-0 border-t border-border px-4 py-3">{footerActions}</div>
    </div>
  );
});
