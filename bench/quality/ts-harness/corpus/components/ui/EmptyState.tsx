import type { ReactNode } from 'react';
import React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  readonly icon: ReactNode;
  readonly headline: string;
  readonly hint?: string;
  readonly cta?: ReactNode;
  readonly className?: string;
}

export const EmptyState = React.memo(function EmptyState(props: EmptyStateProps) {
  const { icon, headline, hint, cta, className } = props;

  return (
    <output
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className
      )}
    >
      <div className="text-muted-foreground [&_svg]:h-12 [&_svg]:w-12" aria-hidden="true">
        {icon}
      </div>
      <h3 className="text-lg font-medium text-foreground">{headline}</h3>
      {hint != null && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {cta != null && <div className="mt-2">{cta}</div>}
    </output>
  );
});
