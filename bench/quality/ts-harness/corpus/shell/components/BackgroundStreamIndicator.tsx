import { Activity, FlaskConical, MessageSquare, Square } from 'lucide-react';
import type React from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type BackgroundStreamItemVM = {
  readonly id: string;
  readonly origin: 'chat' | 'lab';
  readonly label: string;
  readonly startedAt: number;
};

export type BackgroundStreamIndicatorProps = {
  readonly items: readonly BackgroundStreamItemVM[];
  readonly onStop: (id: string) => void;
  readonly className?: string;
};

const ORIGIN_ICON = {
  chat: MessageSquare,
  lab: FlaskConical,
} as const;

const originIcon = (origin: 'chat' | 'lab'): React.ReactElement => {
  const Icon = ORIGIN_ICON[origin];
  return <Icon size={14} aria-hidden="true" />;
};

const handleStop =
  (onStop: (id: string) => void, id: string) =>
    (e: React.MouseEvent<HTMLButtonElement>): void => {
      e.stopPropagation();
      onStop(id);
    };

const BackgroundStreamIndicator = ({
  items,
  onStop,
  className,
}: BackgroundStreamIndicatorProps): React.ReactElement | null => {
  if (items.length === 0) {
    return null;
  }

  const triggerAriaLabel = `${String(items.length)} active streams`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative', className)}
          aria-label={triggerAriaLabel}
        >
          <Activity size={18} aria-hidden="true" />
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] leading-none text-white">
            {items.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent sideOffset={4} className="w-64 p-1" align="end">
        <ul className="flex flex-col">
          {items.map(item => (
            <li key={item.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5">
              {originIcon(item.origin)}
              <span className="max-w-48 flex-1 truncate text-sm">{item.label}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleStop(onStop, item.id)}
                aria-label="Stop stream"
              >
                <Square size={14} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

export { BackgroundStreamIndicator };
