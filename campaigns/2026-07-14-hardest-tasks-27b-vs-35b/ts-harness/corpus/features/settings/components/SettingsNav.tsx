import { memo, type MemoExoticComponent, type ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface SettingsNavItem {
  readonly id: string;
  readonly labelKey: string;
}

export interface SettingsNavGroup {
  readonly labelKey?: string;
  readonly items: readonly SettingsNavItem[];
}

export interface SettingsNavProps {
  readonly groups: readonly SettingsNavGroup[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
  readonly ariaLabel: string;
}

function SettingsNavBase(props: SettingsNavProps): ReactElement {
  const { groups, activeId, onSelect, ariaLabel } = props;

  const handleClick =
    (id: string): (() => void) =>
      (): void =>
        onSelect(id);

  return (
    <nav
      aria-label={ariaLabel}
      className="flex w-full flex-col gap-1 border-r border-border bg-card py-3 sm:w-[180px] sm:shrink-0"
    >
      {groups.flatMap(group =>
        group.items.map(item => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={handleClick(item.id)}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`settings-nav-${item.id}`}
              className={cn(
                'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                isActive
                  ? 'bg-accent font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {item.labelKey}
            </button>
          );
        })
      )}
    </nav>
  );
}

export const SettingsNav: MemoExoticComponent<typeof SettingsNavBase> = memo(SettingsNavBase);
