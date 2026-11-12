import { Check, X } from 'lucide-react';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { ResultCellVM } from '../types';
import { formatTps, formatTtfSeconds } from '../utils/resultCellVM';

export type { ResultCellVM } from '../types';

export type StatusLabels = Readonly<Record<ResultCellVM['status'], string>>;

export type ResultsGridProps = {
  readonly cells: readonly ResultCellVM[];
  readonly activeCellId: string | null;
  readonly selectedCellIds: readonly string[];
  readonly emptyLabel: string;
  readonly errorLabel: string;
  readonly deleteCellAriaLabel: string;
  readonly selectAriaLabel: string;
  readonly compareLabel?: string;
  readonly ttfLabel: string;
  readonly tpsLabel: string;
  readonly listAriaLabel: string;
  readonly unresolvedAriaLabel: string;
  readonly statusLabels: StatusLabels;
  readonly onCellClick: (cellId: string) => void;
  readonly onCellDelete: (cellId: string) => void;
  readonly onSelectToggle: (cellId: string) => void;
  readonly className?: string;
};

const STATUS_BADGE_CLASS: Record<ResultCellVM['status'], string> = {
  idle: 'bg-muted text-muted-foreground',
  streaming: 'bg-blue-500/15 text-blue-500 animate-pulse',
  done: 'bg-green-500/15 text-green-500',
  error: 'bg-destructive/15 text-destructive',
  aborted: 'bg-yellow-500/15 text-yellow-500',
};

const handleCellClick =
  (onCellClick: (cellId: string) => void, cellId: string): (() => void) =>
    (): void => {
      onCellClick(cellId);
    };

const handleDelete =
  (onCellDelete: (cellId: string) => void, cellId: string): ((e: React.MouseEvent) => void) =>
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      onCellDelete(cellId);
    };

const handleToggle =
  (onSelectToggle: (cellId: string) => void, cellId: string): (() => void) =>
    (): void => {
      onSelectToggle(cellId);
    };

const formatLatency = (ms: number): string => (ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '—');

const formatTokens = (tokens: number): string => (tokens > 0 ? `${tokens} tok` : '—');

const isActive = (activeCellId: string | null, cellId: string): boolean => activeCellId === cellId;

const cellCardClassName = (active: boolean): string =>
  cn(
    'relative flex w-full flex-col gap-1.5 rounded-md border border-border p-3 text-left transition-colors',
    'hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    active && 'border-primary bg-accent'
  );

const compareButtonClassName = (selected: boolean): string =>
  cn(
    'mt-1.5 mr-1 inline-flex shrink-0 items-center gap-1 self-start rounded-full border px-3 py-1',
    'text-xs font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected
      ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
      : 'border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground'
  );

const ResultCellRow = ({
  cell,
  active,
  selected,
  errorLabel,
  deleteCellAriaLabel,
  selectAriaLabel,
  compareLabel,
  ttfLabel,
  tpsLabel,
  unresolvedAriaLabel,
  statusLabels,
  onCellClick,
  onCellDelete,
  onSelectToggle,
}: {
  readonly cell: ResultCellVM;
  readonly active: boolean;
  readonly selected: boolean;
  readonly errorLabel: string;
  readonly deleteCellAriaLabel: string;
  readonly selectAriaLabel: string;
  readonly compareLabel?: string;
  readonly ttfLabel: string;
  readonly tpsLabel: string;
  readonly unresolvedAriaLabel: string;
  readonly statusLabels: StatusLabels;
  readonly onCellClick: (cellId: string) => void;
  readonly onCellDelete: (cellId: string) => void;
  readonly onSelectToggle: (cellId: string) => void;
}): ReactElement => {
  const statusClass = STATUS_BADGE_CLASS[cell.status];
  const statusLabel = statusLabels[cell.status];

  return (
    <li aria-current={active ? 'true' : undefined} data-state={active ? 'active' : undefined}>
      <article className="flex items-start gap-2 rounded-md border border-border bg-card p-1">
        <button
          type="button"
          className={cn('flex-1', cellCardClassName(active))}
          onClick={handleCellClick(onCellClick, cell.id)}
          aria-label={`${cell.title} — ${statusLabel}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium">{cell.title}</span>
              {cell.warning === 'unresolved' && (
                <span
                  role="img"
                  className="text-yellow-500"
                  aria-label={unresolvedAriaLabel}
                  title={unresolvedAriaLabel}
                >
                  !
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant="outline" className={cn('shrink-0', statusClass)}>
                {statusLabel}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                aria-label={deleteCellAriaLabel}
                onClick={handleDelete(onCellDelete, cell.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {cell.status === 'error' && cell.error !== null ? (
            <p className="text-xs text-destructive" role="alert">
              <span className="font-medium">{errorLabel}:</span> {cell.error}
            </p>
          ) : (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {cell.outputPreview || '—'}
            </p>
          )}

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{formatLatency(cell.latencyMs)}</span>
            <span>{formatTokens(cell.tokens)}</span>
          </div>

          {(cell.ttfMs !== null || cell.tps !== null) && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {cell.ttfMs !== null && (
                <span>
                  {ttfLabel} {formatTtfSeconds(cell.ttfMs ?? undefined)}
                </span>
              )}
              {cell.tps !== null && (
                <span>
                  {tpsLabel} {formatTps(cell.tps ?? undefined)}
                </span>
              )}
            </div>
          )}
        </button>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={selectAriaLabel}
          onClick={handleToggle(onSelectToggle, cell.id)}
          data-affords="toggle-compare-selection"
          data-testid="compare-select-toggle"
          className={compareButtonClassName(selected)}
        >
          {selected && <Check className="h-3 w-3" aria-hidden="true" />}
          <span>{compareLabel}</span>
        </button>
      </article>
    </li>
  );
};

export const ResultsGrid = ({
  cells,
  activeCellId,
  selectedCellIds,
  emptyLabel,
  errorLabel,
  deleteCellAriaLabel,
  selectAriaLabel,
  compareLabel,
  ttfLabel,
  tpsLabel,
  listAriaLabel,
  unresolvedAriaLabel,
  statusLabels,
  onCellClick,
  onCellDelete,
  onSelectToggle,
  className,
}: ResultsGridProps): ReactElement => {
  if (cells.length === 0) {
    return (
      <output
        className={cn(
          'flex items-center justify-center p-8 text-sm text-muted-foreground',
          className
        )}
      >
        {emptyLabel}
      </output>
    );
  }

  return (
    <ScrollArea className={cn('h-full', className)}>
      <ul aria-label={listAriaLabel} className="flex flex-col gap-2 p-2">
        {cells.map(cell => (
          <ResultCellRow
            key={cell.id}
            cell={cell}
            active={isActive(activeCellId, cell.id)}
            selected={selectedCellIds.includes(cell.id)}
            errorLabel={errorLabel}
            deleteCellAriaLabel={deleteCellAriaLabel}
            selectAriaLabel={selectAriaLabel}
            compareLabel={compareLabel}
            ttfLabel={ttfLabel}
            tpsLabel={tpsLabel}
            unresolvedAriaLabel={unresolvedAriaLabel}
            statusLabels={statusLabels}
            onCellClick={onCellClick}
            onCellDelete={onCellDelete}
            onSelectToggle={onSelectToggle}
          />
        ))}
      </ul>
    </ScrollArea>
  );
};
