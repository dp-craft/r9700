import type { ReactNode } from 'react';
import React from 'react';

import { cn } from '@/lib/utils';

export interface SectionProps {
  readonly title: string;
  readonly count?: number;
  readonly action?: ReactNode;
  readonly collapsed: boolean;
  readonly mood?: 'default' | 'accent';
  readonly bodyId: string;
  readonly onToggleCollapse: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

const MOOD_BORDER: Record<NonNullable<SectionProps['mood']>, string> = {
  default: 'border-border',
  accent: 'border-accent',
};

const CARET_COLLAPSED = '▸';
const CARET_EXPANDED = '▾';

function getCaretLabel(title: string, collapsed: boolean): string {
  return collapsed ? `Expand ${title}` : `Collapse ${title}`;
}

export const Section = React.memo(function Section(props: SectionProps) {
  const {
    title,
    count,
    action,
    collapsed,
    mood = 'default',
    bodyId,
    onToggleCollapse,
    children,
    className,
  } = props;

  return (
    <section className={cn('relative rounded-lg border', MOOD_BORDER[mood], className)}>
      <div className="absolute -top-2.5 left-3.5 flex items-center gap-1.5 rounded-full bg-background px-3 py-0.5 text-xs font-medium">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={getCaretLabel(title, collapsed)}
          onClick={onToggleCollapse}
          className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {collapsed ? CARET_COLLAPSED : CARET_EXPANDED}
        </button>
        <span className="uppercase tracking-wide text-foreground">{title}</span>
        {count != null && count > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
            {count}
          </span>
        )}
      </div>
      {action != null && (
        <div className="absolute -top-2.5 right-3.5 flex items-center">{action}</div>
      )}
      <div id={bodyId} hidden={collapsed} className="p-3 pt-4">
        {children}
      </div>
    </section>
  );
});
