import { type KeyboardEvent, memo, type MouseEvent } from 'react';

import { cn } from '@/lib/utils';

export type Picker1ItemKind = 'skill' | 'history';

export interface Picker1ItemLabels {
  readonly skillBadge: string;
  readonly historyBadge: string;
  readonly togglePinAria: string;
}

export interface Picker1ItemProps {
  readonly kind: Picker1ItemKind;
  readonly name: string;
  readonly meta: string;
  readonly pinned?: boolean;
  readonly selected: boolean;
  readonly onActivate?: () => void;
  readonly onShiftActivate?: () => void;
  readonly onTogglePin?: () => void;
  readonly labels: Picker1ItemLabels;
  readonly className?: string;
}

const getBadgeClasses = (kind: Picker1ItemKind): string =>
  kind === 'skill' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground';

const getBadgeText = (kind: Picker1ItemKind, labels: Picker1ItemLabels): string =>
  kind === 'skill' ? labels.skillBadge : labels.historyBadge;

const Picker1ItemImpl = ({
  kind,
  name,
  meta,
  pinned = false,
  selected,
  onActivate,
  onTogglePin,
  labels,
  className,
}: Picker1ItemProps): React.JSX.Element => {
  const handleRowClick = onActivate
    ? (): void => {
        onActivate();
      }
    : undefined;

  const handleRowKeyDown = onActivate
    ? (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }
    : undefined;

  const handlePinClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (onTogglePin) {
      onTogglePin();
    }
  };

  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid={`picker1-item-${kind}`}
      data-picker-selected={selected}
      tabIndex={-1}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
      className={cn(
        'flex flex-row items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer',
        'data-[picker-selected=true]:bg-accent data-[picker-selected=true]:text-accent-foreground',
        className
      )}
    >
      <span
        data-testid={`picker1-item-badge-${kind}`}
        className={cn(
          'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
          getBadgeClasses(kind)
        )}
      >
        {getBadgeText(kind, labels)}
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{meta}</span>
      </div>

      {pinned ? (
        <span aria-hidden="true" className="shrink-0 text-xs">
          📌
        </span>
      ) : null}

      {onTogglePin ? (
        <button
          type="button"
          aria-label={labels.togglePinAria}
          data-testid="picker1-item-pin-toggle"
          onClick={handlePinClick}
          className="shrink-0 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          📌
        </button>
      ) : null}

      <kbd className="ml-auto shrink-0 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
        ↵
      </kbd>
    </div>
  );
};

export const Picker1Item: React.MemoExoticComponent<typeof Picker1ItemImpl> = memo(Picker1ItemImpl);
