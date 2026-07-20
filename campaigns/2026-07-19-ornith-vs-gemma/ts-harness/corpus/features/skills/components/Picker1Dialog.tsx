import { memo, type ReactNode } from 'react';

import { Command, CommandGroup, CommandInput, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import {
  type Picker1Filter,
  Picker1FilterChips,
  type Picker1FilterChipsLabels
} from './Picker1FilterChips';
import type { Picker1ItemLabels } from './Picker1Item';

export interface Picker1DialogLabels {
  readonly title: string;
  readonly searchPlaceholder: string;
  readonly empty: string;
  readonly groupSkills: string;
  readonly groupHistory: string;
  readonly footerNavigate: string;
  readonly footerSelect: string;
  readonly footerEditNew: string;
  readonly footerNewBlank: string;
  readonly chips: Picker1FilterChipsLabels;
  readonly item: Picker1ItemLabels;
}

export interface Picker1DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  readonly activeFilter: Picker1Filter;
  readonly onFilterChange: (f: Picker1Filter) => void;
  readonly skillsSlot: ReactNode;
  readonly historySlot: ReactNode;
  readonly onNewBlank: () => void;
  readonly hasResults: boolean;
  readonly labels: Picker1DialogLabels;
  readonly className?: string;
}

const Picker1DialogImpl = ({
  open,
  onOpenChange,
  query,
  onQueryChange,
  activeFilter,
  onFilterChange,
  skillsSlot,
  historySlot,
  onNewBlank,
  hasResults,
  labels,
  className,
}: Picker1DialogProps): React.JSX.Element => {
  const handleNewBlankClick = (): void => {
    onNewBlank();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="picker1-dialog"
        showCloseButton={false}
        className={cn(
          'flex flex-col gap-0 p-0 md:w-[520px] md:max-w-[520px] max-h-[80vh]',
          className
        )}
      >
        <DialogTitle className="px-4 pt-4 pb-2 text-sm font-semibold">{labels.title}</DialogTitle>

        <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col">
          <CommandInput
            value={query}
            onValueChange={onQueryChange}
            placeholder={labels.searchPlaceholder}
          />

          <div className="border-b px-3 py-2">
            <Picker1FilterChips
              activeFilter={activeFilter}
              onFilterChange={onFilterChange}
              labels={labels.chips}
            />
          </div>

          <CommandList className="min-h-0 flex-1">
            {hasResults ? (
              <>
                <CommandGroup heading={labels.groupSkills}>{skillsSlot}</CommandGroup>
                <CommandGroup heading={labels.groupHistory}>{historySlot}</CommandGroup>
              </>
            ) : (
              <div data-slot="command-empty-fallback" className="py-6 text-center text-sm">
                {labels.empty}
              </div>
            )}
          </CommandList>
        </Command>

        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                ↑↓
              </kbd>{' '}
              {labels.footerNavigate}
            </span>
            <span>
              <kbd className="rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                ↵
              </kbd>{' '}
              {labels.footerSelect}
            </span>
            <span>
              <kbd className="rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                ⇧↵
              </kbd>{' '}
              {labels.footerEditNew}
            </span>
          </div>
          <button
            type="button"
            data-testid="picker1-new-blank"
            onClick={handleNewBlankClick}
            className="rounded-sm px-2 py-1 font-medium text-foreground hover:bg-muted hover:text-foreground"
          >
            {labels.footerNewBlank}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const Picker1Dialog: React.MemoExoticComponent<typeof Picker1DialogImpl> =
  memo(Picker1DialogImpl);
