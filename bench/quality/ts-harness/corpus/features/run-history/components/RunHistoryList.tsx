import { Pin } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type RunHistoryRowVM = {
  readonly id: string;
  readonly label: string;
  readonly archivedAt: number;
  readonly cellCount: number;
  readonly pinned: boolean;
  readonly selected: boolean;
};

export type RunHistoryListLabels = {
  readonly cells: string;
  readonly open: string;
  readonly justNow: string;
  readonly minutesAgo: (m: number) => string;
  readonly hoursAgo: (h: number) => string;
  readonly daysAgo: (d: number) => string;
  readonly listAria?: string;
  readonly pinned?: string;
  readonly selectPrefix?: string;
};

export type RunHistoryListProps = {
  readonly rows: readonly RunHistoryRowVM[];
  readonly onToggleSelect: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly labels: RunHistoryListLabels;
  readonly className?: string;
};

const formatRelativeTime = (timestamp: number, labels: RunHistoryListLabels): string => {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return labels.daysAgo(days);
  if (hours > 0) return labels.hoursAgo(hours);
  if (minutes > 0) return labels.minutesAgo(minutes);
  return labels.justNow;
};

const handleToggleFactory = (onToggleSelect: (id: string) => void, id: string) => (): void => {
  onToggleSelect(id);
};

const handleOpenFactory = (onOpen: (id: string) => void, id: string) => (): void => {
  onOpen(id);
};

export const RunHistoryList = ({
  rows,
  onToggleSelect,
  onOpen,
  labels,
  className,
}: RunHistoryListProps): ReactElement => (
  <div
    role="listbox"
    aria-label={labels.listAria ?? 'Run history'}
    className={cn('flex flex-col', className)}
  >
    {rows.map(row => (
      <div
        key={row.id}
        role="option"
        aria-selected={row.selected}
        tabIndex={0}
        className={cn(
          'flex items-center gap-3 border-b border-border px-4 py-2 text-sm',
          row.selected && 'bg-accent'
        )}
      >
        <input
          type="checkbox"
          checked={row.selected}
          onChange={handleToggleFactory(onToggleSelect, row.id)}
          aria-label={`${labels.selectPrefix ?? 'Select'} ${row.label}`}
          className="h-4 w-4 shrink-0"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {row.pinned && (
            <Pin
              aria-label={labels.pinned ?? 'Pinned'}
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
          )}
          <span className="truncate font-medium">{row.label}</span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {String(row.cellCount)} {labels.cells}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(row.archivedAt, labels)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleOpenFactory(onOpen, row.id)}
          aria-label={`${labels.open} ${row.label}`}
        >
          {labels.open}
        </Button>
      </div>
    ))}
  </div>
);
