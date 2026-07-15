import type { ReactNode } from 'react';
import React from 'react';

import { cn } from '@/lib/utils';

import { Button } from './button';
import { Input } from './input';

export interface BulkActionToolbarProps {
  readonly searchValue: string;
  readonly onSearchChange: (v: string) => void;
  readonly selectedCount: number;
  readonly onBulkDelete: () => void;
  readonly onBulkExport: () => void;
  readonly filterSlots?: ReactNode;
  readonly className?: string;
}

const SELECTED_COUNT_THRESHOLD = 0;

function handleSearchInput(
  onSearchChange: (v: string) => void
): (e: React.ChangeEvent<HTMLInputElement>) => void {
  return e => onSearchChange(e.target.value);
}

export const BulkActionToolbar = React.memo(function BulkActionToolbar(
  props: BulkActionToolbarProps
) {
  const {
    searchValue,
    onSearchChange,
    selectedCount,
    onBulkDelete,
    onBulkExport,
    filterSlots,
    className,
  } = props;

  const hasSelection = selectedCount > SELECTED_COUNT_THRESHOLD;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={cn(
        'flex items-center gap-2 border-b border-border bg-background px-3 py-2',
        className
      )}
    >
      <Input
        type="search"
        value={searchValue}
        onChange={handleSearchInput(onSearchChange)}
        aria-label="Search"
        className="h-8 max-w-xs text-sm"
      />
      {filterSlots != null && <div className="flex items-center gap-2">{filterSlots}</div>}
      <div className="ml-auto flex items-center gap-2">
        {hasSelection && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-foreground">
            {selectedCount}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasSelection}
          onClick={onBulkExport}
          aria-label="Export selected"
        >
          Export
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={!hasSelection}
          onClick={onBulkDelete}
          aria-label="Delete selected"
        >
          Delete
        </Button>
      </div>
    </div>
  );
});
