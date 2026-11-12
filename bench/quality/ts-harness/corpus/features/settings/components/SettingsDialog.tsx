import { Settings } from 'lucide-react';
import type * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly keyboardHint: string;
  readonly navSlot: React.ReactNode;
  readonly mobileNavSlot: React.ReactNode;
  readonly contentSlot: React.ReactNode;
}

export function SettingsDialog({
  open,
  onOpenChange,
  title,
  description,
  keyboardHint,
  navSlot,
  mobileNavSlot,
  contentSlot,
}: SettingsDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden p-0 sm:max-w-[640px] md:w-[640px]">
        <DialogHeader className="shrink-0 flex-row items-center gap-2 border-b border-border px-4 py-3">
          <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <DialogTitle className="flex-1 text-left">{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
          <kbd className="mr-6 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {keyboardHint}
          </kbd>
        </DialogHeader>
        {mobileNavSlot}
        <div className="flex min-h-0 flex-1 flex-row">
          <div className="hidden sm:flex sm:shrink-0">{navSlot}</div>
          <section data-testid="settings-content-pane" className="flex-1 overflow-y-auto p-4">
            {contentSlot}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
