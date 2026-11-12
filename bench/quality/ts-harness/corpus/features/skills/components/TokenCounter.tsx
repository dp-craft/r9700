import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface TokenCounterLabels {
  readonly approximateTokenCountSuffix: string;
}

export interface TokenCounterProps {
  readonly tokenCount: number;
  readonly exceedsSoftLimit: boolean;
  readonly exceedsHardLimit: boolean;
  readonly labels?: TokenCounterLabels;
  readonly className?: string;
}

const DEFAULT_LABELS: TokenCounterLabels = {
  approximateTokenCountSuffix: '~{{count}} tokens',
};

const formatCount = (n: number, suffix: string): string =>
  suffix.replace('{{count}}', n.toLocaleString());

type LimitStatus = 'normal' | 'warning' | 'error';

const getLimitStatus = (exceedsSoftLimit: boolean, exceedsHardLimit: boolean): LimitStatus => {
  if (exceedsHardLimit) return 'error';
  if (exceedsSoftLimit) return 'warning';
  return 'normal';
};

const STATUS_VARIANT: Record<LimitStatus, 'secondary' | 'outline' | 'destructive'> = {
  normal: 'secondary',
  warning: 'outline',
  error: 'destructive',
};

const STATUS_CLASS: Record<LimitStatus, string> = {
  normal: 'text-muted-foreground',
  warning: 'border-amber-500/50 text-amber-500',
  error: '',
};

const getDataAttributes = (status: LimitStatus): Record<string, string> => {
  if (status === 'error') return { 'data-error': 'true' };
  if (status === 'warning') return { 'data-warning': 'true' };
  return {};
};

export function TokenCounter({
  tokenCount,
  exceedsSoftLimit,
  exceedsHardLimit,
  labels = DEFAULT_LABELS,
  className,
}: TokenCounterProps): React.ReactElement {
  const status = getLimitStatus(exceedsSoftLimit, exceedsHardLimit);
  const variant = STATUS_VARIANT[status];
  const statusClass = STATUS_CLASS[status];
  const dataAttrs = getDataAttributes(status);
  const label = formatCount(tokenCount, labels.approximateTokenCountSuffix);

  return (
    <Badge
      variant={variant}
      className={cn(statusClass, className)}
      aria-label={label}
      {...dataAttrs}
    >
      {label}
    </Badge>
  );
}
