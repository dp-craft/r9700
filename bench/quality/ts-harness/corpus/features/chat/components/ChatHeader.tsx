import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface ChatHeaderProps {
  readonly badgesSlot?: React.ReactNode;
  readonly className?: string;
}

export function ChatHeader({ badgesSlot, className }: ChatHeaderProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3 border-b border-line bg-bg px-4 py-3',
        className
      )}
    >
      {badgesSlot}
    </div>
  );
}
