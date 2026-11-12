import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface DeviceCodeModalProps {
  readonly isOpen: boolean;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly onOpenGitHub: () => void;
  readonly onCopyCode: () => void;
  readonly onCancel: () => void;
  readonly isWaiting: boolean;
  readonly error: string | null;
  readonly labels: {
    readonly title: string;
    readonly step1: string;
    readonly step2: string;
    readonly copyButton: string;
    readonly openGitHub: string;
    readonly cancel: string;
    readonly waiting: string;
    readonly codeCopied: string;
  };
}

function preventEvent(e: Event): void {
  e.preventDefault();
}

function StatusIndicator({
  isWaiting,
  error,
  waitingLabel,
}: {
  readonly isWaiting: boolean;
  readonly error: string | null;
  readonly waitingLabel: string;
}): React.ReactElement | null {
  if (error !== null) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  }

  if (isWaiting) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>{waitingLabel}</span>
      </div>
    );
  }

  return null;
}

export function DeviceCodeModal({
  isOpen,
  userCode,
  verificationUri,
  onOpenGitHub,
  onCopyCode,
  onCancel,
  isWaiting,
  error,
  labels,
}: DeviceCodeModalProps): React.ReactElement {
  return (
    <Dialog open={isOpen}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={preventEvent}
        onEscapeKeyDown={preventEvent}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription className="sr-only">{labels.step1}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-medium">1.</span> {labels.step1}
            </p>
            <div className="flex items-center gap-2">
              <code
                className={cn(
                  'rounded-md border bg-muted px-4 py-2',
                  'font-mono text-xl font-bold tracking-widest',
                  'select-all'
                )}
              >
                {userCode}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCopyCode}
                aria-label={labels.copyButton}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{labels.copyButton}</span>
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm">
              <span className="font-medium">2.</span> {labels.step2}
            </p>
            <p className="text-muted-foreground text-xs">{verificationUri}</p>
          </div>

          <StatusIndicator isWaiting={isWaiting} error={error} waitingLabel={labels.waiting} />
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button type="button" onClick={onOpenGitHub} aria-label={labels.openGitHub}>
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            {labels.openGitHub}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} aria-label={labels.cancel}>
            {labels.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
