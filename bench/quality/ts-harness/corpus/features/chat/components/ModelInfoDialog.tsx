import type * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import type { CuratedModelViewModel } from '../types';

export interface ModelInfoDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly models: readonly CuratedModelViewModel[];
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly titleLabel: string;
  readonly searchPlaceholder: string;
  readonly showingModelsLabel: string;
  readonly nameLabel: string;
  readonly sizeLabel: string;
  readonly descriptionLabel: string;
  readonly prosLabel: string;
  readonly consLabel: string;
  readonly availableLabel?: string;
  readonly providerGuidance?: string | null;
  readonly className?: string;
}

const HEADER_CELL_CLASS =
  'px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider';
const BODY_CELL_CLASS = 'px-3 py-2 text-sm text-foreground';
const NAME_CELL_CLASS = 'px-3 py-2 text-sm font-medium text-foreground whitespace-nowrap';

function handleSearchInput(onSearchChange: (query: string) => void) {
  return (e: React.ChangeEvent<HTMLInputElement>): void => {
    onSearchChange(e.target.value);
  };
}

function getRowClassName(isAvailable: boolean | undefined): string {
  return cn(
    'border-border border-b transition-colors last:border-0',
    isAvailable === false ? 'opacity-50' : 'hover:bg-muted/50'
  );
}

function AvailabilityBadge({
  isAvailable,
  availableLabel,
}: {
  readonly isAvailable?: boolean;
  readonly availableLabel: string;
}): React.ReactElement | null {
  if (isAvailable === undefined) return null;
  if (isAvailable) {
    return (
      <span role="img" className="ml-1 text-xs text-green-500" aria-label={availableLabel}>
        ✓
      </span>
    );
  }
  return null;
}

function renderModelRow(model: CuratedModelViewModel, availableLabel: string): React.ReactElement {
  return (
    <tr key={model.baseName} className={getRowClassName(model.isAvailable)}>
      <td className={NAME_CELL_CLASS}>
        {model.displayName}
        <AvailabilityBadge isAvailable={model.isAvailable} availableLabel={availableLabel} />
      </td>
      <td className={cn(BODY_CELL_CLASS, 'whitespace-nowrap')}>{model.approxSize}</td>
      <td className={BODY_CELL_CLASS}>{model.description}</td>
      <td className={BODY_CELL_CLASS}>{model.pros}</td>
      <td className={BODY_CELL_CLASS}>{model.cons}</td>
    </tr>
  );
}

export function ModelInfoDialog({
  open,
  onOpenChange,
  models,
  searchQuery,
  onSearchChange,
  titleLabel,
  searchPlaceholder,
  showingModelsLabel,
  nameLabel,
  sizeLabel,
  descriptionLabel,
  prosLabel,
  consLabel,
  availableLabel = 'Available',
  providerGuidance,
  className,
}: ModelInfoDialogProps): React.ReactElement {
  const rows = models.map(model => renderModelRow(model, availableLabel));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-4xl', className)}>
        <DialogHeader>
          <DialogTitle>{titleLabel}</DialogTitle>
          <DialogDescription className="sr-only">{titleLabel}</DialogDescription>
        </DialogHeader>

        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchInput(onSearchChange)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="border-input placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
        />

        {providerGuidance !== undefined && providerGuidance !== null && (
          <p className="bg-muted/60 text-muted-foreground rounded-md px-3 py-2 text-xs">
            {providerGuidance}
          </p>
        )}

        <div className="border-border max-h-[60vh] overflow-y-auto rounded-md border">
          <table className="w-full border-collapse">
            <thead className="bg-muted/80 sticky top-0 backdrop-blur-sm">
              <tr>
                <th className={HEADER_CELL_CLASS}>{nameLabel}</th>
                <th className={HEADER_CELL_CLASS}>{sizeLabel}</th>
                <th className={HEADER_CELL_CLASS}>{descriptionLabel}</th>
                <th className={HEADER_CELL_CLASS}>{prosLabel}</th>
                <th className={HEADER_CELL_CLASS}>{consLabel}</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>

        <p className="text-muted-foreground text-center text-xs">{showingModelsLabel}</p>
      </DialogContent>
    </Dialog>
  );
}
