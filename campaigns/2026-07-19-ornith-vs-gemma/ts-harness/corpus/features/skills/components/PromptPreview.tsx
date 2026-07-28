import type * as React from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface PromptPreviewLabels {
  readonly ariaLabel: string;
}

export interface PromptPreviewProps {
  readonly text: string;
  readonly labels?: PromptPreviewLabels;
  readonly className?: string;
}

const DEFAULT_LABELS: PromptPreviewLabels = {
  ariaLabel: 'System prompt preview',
};

export function PromptPreview({
  text,
  labels = DEFAULT_LABELS,
  className,
}: PromptPreviewProps): React.ReactElement {
  if (!text) {
    return <div className={className} />;
  }

  return (
    <ScrollArea className={cn('rounded-md border', className)}>
      <pre
        className="text-muted-foreground p-4 font-mono text-sm break-words whitespace-pre-wrap"
        title={labels.ariaLabel}
      >
        {text}
      </pre>
    </ScrollArea>
  );
}
