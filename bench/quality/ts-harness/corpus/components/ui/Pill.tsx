import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type PillProps = {
  readonly accent?: boolean;
  readonly filled?: boolean;
  readonly onDot?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'>;

export const Pill = ({
  accent,
  filled,
  onDot,
  children,
  className,
  ...rest
}: PillProps): ReactElement => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 text-sm font-medium leading-3.5',
      'border rounded-full whitespace-nowrap cursor-pointer',
      accent ? 'border-accent' : 'border-line',
      filled ? 'bg-accent text-white' : accent ? 'text-accent bg-panel' : 'text-ink2 bg-panel',
      className
    )}
    {...rest}
  >
    {onDot && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
    <span>{children}</span>
  </span>
);
