import { RotateCcw } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface UserPromptHistoryItem {
  readonly runId: string;
  readonly prompt: string;
  readonly recordedAt: number;
}

export interface UserPromptHistoryLabels {
  readonly historyTrigger: string;
  readonly empty: string;
  readonly ariaLabel: string;
}

export interface UserPromptHistoryDropdownProps {
  readonly items: readonly UserPromptHistoryItem[];
  readonly onSelect: (prompt: string) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly labels: UserPromptHistoryLabels;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function UserPromptHistoryDropdown({
  items,
  onSelect,
  open,
  onOpenChange,
  labels,
  disabled,
  className,
}: UserPromptHistoryDropdownProps): React.ReactElement {
  const handleSelect = (prompt: string) => (): void => {
    onSelect(prompt);
    onOpenChange(false);
  };

  const isEmpty = items.length === 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={labels.ariaLabel}
          data-testid="user-prompt-history-trigger"
          className={cn('h-7 px-2 text-xs gap-1', className)}
        >
          <RotateCcw size={14} aria-hidden="true" />
          <span>
            {labels.historyTrigger} ({items.length})
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="p-0 w-[420px] max-h-[360px] overflow-y-auto"
        data-slot="user-prompt-history-content"
      >
        {isEmpty ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">{labels.empty}</div>
        ) : (
          <ul className="py-1">
            {items.map(item => (
              <li key={item.runId}>
                <button
                  type="button"
                  onClick={handleSelect(item.prompt)}
                  title={item.prompt}
                  className="w-full text-left px-2 py-1.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  <span className="font-mono text-xs truncate whitespace-nowrap block text-left">
                    {item.prompt}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
