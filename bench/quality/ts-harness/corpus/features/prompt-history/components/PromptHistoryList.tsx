import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type PromptHistoryRowVM = {
  readonly id: string;
  readonly text: string;
  readonly type: 'USER' | 'SYSTEM';
  readonly source: 'CHAT' | 'LAB';
  readonly useCount: number;
  readonly selected: boolean;
};

export type PromptHistoryListProps = {
  readonly rows: readonly PromptHistoryRowVM[];
  readonly onToggleSelect: (id: string) => void;
  readonly listAria?: string;
  readonly selectPrefix?: string;
  readonly className?: string;
};

const PREVIEW_MAX_LENGTH = 80;

const TYPE_VARIANT: Record<PromptHistoryRowVM['type'], 'default' | 'secondary'> = {
  USER: 'default',
  SYSTEM: 'secondary',
};

const SOURCE_VARIANT: Record<PromptHistoryRowVM['source'], 'outline' | 'secondary'> = {
  CHAT: 'outline',
  LAB: 'secondary',
};

const truncateText = (text: string): string =>
  text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text;

const handleToggleFactory = (onToggleSelect: (id: string) => void, id: string) => (): void => {
  onToggleSelect(id);
};

const handleKeyDownFactory =
  (onToggleSelect: (id: string) => void, id: string) =>
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggleSelect(id);
      }
    };

const renderRow = (
  row: PromptHistoryRowVM,
  onToggleSelect: (id: string) => void,
  selectPrefix: string
): ReactElement => (
  <div
    key={row.id}
    role="option"
    aria-selected={row.selected}
    tabIndex={0}
    className={cn(
      'flex items-center gap-3 rounded-md border px-3 py-2 transition-colors',
      'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      row.selected && 'bg-muted border-primary/30'
    )}
    onClick={handleToggleFactory(onToggleSelect, row.id)}
    onKeyDown={handleKeyDownFactory(onToggleSelect, row.id)}
  >
    <input
      type="checkbox"
      checked={row.selected}
      onChange={handleToggleFactory(onToggleSelect, row.id)}
      aria-label={`${selectPrefix}: ${truncateText(row.text)}`}
      className="size-4 shrink-0 rounded border-border accent-primary"
      tabIndex={-1}
    />
    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
      {truncateText(row.text)}
    </span>
    <Badge variant={TYPE_VARIANT[row.type]} className="shrink-0 text-[10px]">
      {row.type}
    </Badge>
    <Badge variant={SOURCE_VARIANT[row.source]} className="shrink-0 text-[10px]">
      {row.source}
    </Badge>
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">×{row.useCount}</span>
  </div>
);

export const PromptHistoryList = ({
  rows,
  onToggleSelect,
  listAria = 'Prompt history entries',
  selectPrefix = 'Select prompt',
  className,
}: PromptHistoryListProps): ReactElement => (
  <div
    role="listbox"
    aria-label={listAria}
    aria-multiselectable="true"
    className={cn('flex flex-col gap-1 overflow-y-auto p-2', className)}
  >
    {rows.map(row => renderRow(row, onToggleSelect, selectPrefix))}
  </div>
);
