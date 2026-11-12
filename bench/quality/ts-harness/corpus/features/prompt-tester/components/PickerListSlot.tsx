import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

const TRUNCATE_LENGTH = 80;

export function truncateText(text: string): string {
  return text.length > TRUNCATE_LENGTH ? `${text.slice(0, TRUNCATE_LENGTH)}…` : text;
}

export interface PickerListItem {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
}

export interface PickerListSlotProps {
  readonly items: readonly PickerListItem[];
  readonly emptyText: string;
  readonly onItemClick: (id: string) => void;
}

export function PickerListSlot({
  items,
  emptyText,
  onItemClick,
}: PickerListSlotProps): ReactElement {
  const handleClick = (id: string) => (): void => {
    onItemClick(id);
  };

  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto py-2" role="listbox">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={false}
          className={cn(
            'w-full rounded-md px-3 py-2 text-left text-sm',
            'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
          )}
          onClick={handleClick(item.id)}
        >
          {item.primary !== '' && <span className="font-medium">{item.primary}</span>}
          {item.secondary !== '' && (
            <span className="block text-xs text-muted-foreground">{item.secondary}</span>
          )}
        </button>
      ))}
    </div>
  );
}
