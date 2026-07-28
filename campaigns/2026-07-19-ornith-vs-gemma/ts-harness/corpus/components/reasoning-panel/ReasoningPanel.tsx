import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface ReasoningPanelProps {
  readonly reasoning: string;
  readonly title: string;
  readonly defaultExpanded?: boolean;
  readonly className?: string;
}

export const ReasoningPanel = ({
  reasoning,
  title,
  defaultExpanded = false,
  className,
}: ReasoningPanelProps): ReactNode => {
  if (reasoning === '') {
    return null;
  }

  return (
    <Collapsible
      defaultOpen={defaultExpanded}
      data-testid="reasoning-panel"
      className={cn('rounded-md border border-border bg-muted/30', className)}
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
        aria-label={title}
      >
        <ChevronRight
          className="h-4 w-4 shrink-0 transition-transform duration-200 [[data-state=open]>&]:rotate-90"
          aria-hidden="true"
        />
        <span>{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border px-3 py-2">
          <pre className="whitespace-pre-wrap break-words font-mono text-sm text-muted-foreground">
            {reasoning}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
