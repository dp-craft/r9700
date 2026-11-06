import { Info } from 'lucide-react';
import type { JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

export type ModelMetadataRow = {
  readonly label: string;
  readonly value: string;
};

export type ModelMetadataPopoverProps = {
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly title: string;
  readonly rows: readonly ModelMetadataRow[];
  readonly triggerLabel: string;
  readonly triggerTestId?: string;
  readonly supportsThinking?: boolean;
  readonly thinkingEnabled?: boolean;
  readonly onThinkingToggle?: () => void;
  readonly onViewJson?: () => void;
  readonly thinkingLabel?: string;
  readonly jsonLabel?: string;
};

export function ModelMetadataPopover({
  open,
  onOpenChange,
  title,
  rows,
  triggerLabel,
  triggerTestId = 'model-info',
  supportsThinking,
  thinkingEnabled,
  onThinkingToggle,
  onViewJson,
  thinkingLabel,
  jsonLabel,
}: ModelMetadataPopoverProps): JSX.Element {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={triggerLabel}
          data-testid={triggerTestId}
          className="size-7 text-muted-foreground hover:text-foreground"
        >
          <Info className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        sideOffset={4}
        align="end"
        data-testid="model-metadata-popover"
        className="w-72 space-y-1"
      >
        <PopoverTitle className="text-sm font-medium">{title}</PopoverTitle>
        <dl className="space-y-1">
          {rows.map(row => (
            <div key={row.label} className="flex justify-between gap-2 text-xs">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="text-foreground text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
        <footer className="flex items-center gap-3 border-t pt-2">
          {onViewJson ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={jsonLabel}
              data-testid="model-json-button"
              onClick={onViewJson}
            >
              {jsonLabel}
            </Button>
          ) : null}
          {supportsThinking ? (
            <div className="flex items-center gap-2 text-xs text-foreground">
              <Switch
                checked={thinkingEnabled}
                onCheckedChange={onThinkingToggle}
                aria-label={thinkingLabel}
                data-testid="thinking-mode-toggle"
              />
              <span>{thinkingLabel}</span>
            </div>
          ) : null}
        </footer>
      </PopoverContent>
    </Popover>
  );
}
