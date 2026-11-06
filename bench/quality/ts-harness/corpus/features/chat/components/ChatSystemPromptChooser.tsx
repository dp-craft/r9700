import { Layers } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface ChatSystemPromptChooserProps {
  readonly title: string;
  readonly skillSlot: ReactNode;
  readonly className?: string;
}

export const ChatSystemPromptChooser = ({
  title,
  skillSlot,
  className,
}: ChatSystemPromptChooserProps): ReactElement => {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Layers className="text-muted-foreground h-3 w-3" aria-hidden="true" />
        <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {title}
        </span>
      </div>
      {skillSlot}
    </div>
  );
};
