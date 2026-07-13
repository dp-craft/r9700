import type * as React from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import type { ModelGroupVM, ModelOptionVM } from '../types';

export interface ModelPickerDialogLabels {
  readonly title: string;
  readonly search: string;
  readonly empty: string;
}

export interface ModelPickerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groups: readonly ModelGroupVM[];
  readonly onSelect: (model: ModelOptionVM) => void;
  readonly labels: ModelPickerDialogLabels;
  readonly className?: string;
}

function handleSelect(model: ModelOptionVM, onSelect: (m: ModelOptionVM) => void) {
  return (): void => onSelect(model);
}

export function ModelPickerDialog({
  open,
  onOpenChange,
  groups,
  onSelect,
  labels,
  className,
}: ModelPickerDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md', className)} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <Command className="rounded-lg border border-border">
          <CommandInput placeholder={labels.search} aria-label={labels.search} />
          <CommandList>
            <CommandEmpty>{labels.empty}</CommandEmpty>
            {groups.map(group => (
              <CommandGroup key={group.providerName} heading={group.providerName}>
                {group.models.map(model => (
                  <CommandItem
                    key={model.id}
                    value={`${model.providerName} ${model.name}`}
                    onSelect={handleSelect(model, onSelect)}
                  >
                    <span>{model.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
