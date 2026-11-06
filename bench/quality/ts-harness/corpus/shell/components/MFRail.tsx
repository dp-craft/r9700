import { memo, type ReactElement, type ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { MFInnerRailItem } from '../types';

export interface MFRailProps {
  readonly items: readonly MFInnerRailItem[];
  readonly activePanelKey: string | null;
  readonly onPanelChange: (panelKey: string) => void;
  readonly narrow?: boolean;
  readonly footerSlot?: ReactNode;
}

const getRailWrapperClasses = (narrow: boolean): string =>
  narrow
    ? 'flex flex-row items-center w-full h-12 border-b border-border bg-card px-1 gap-1'
    : 'flex flex-col items-center w-14 h-full border-r border-border bg-card py-2 gap-1';

const getRailClasses = (narrow: boolean): string =>
  narrow ? 'flex flex-row items-center gap-1' : 'flex flex-col items-center gap-1';

const getItemClasses = (isActive: boolean, narrow: boolean): string =>
  cn(
    'relative flex items-center justify-center rounded-md transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    narrow ? 'h-10 w-10' : 'h-8 w-8',
    isActive
      ? 'bg-accent/40 text-accent-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  );

const getAccentBarClasses = (narrow: boolean): string =>
  cn(
    'absolute bg-foreground rounded-full pointer-events-none',
    narrow ? 'bottom-0 left-1 right-1 h-0.5' : 'left-0 top-1 bottom-1 w-0.5'
  );

const getDisabledClasses = (disabled: boolean): string =>
  disabled ? 'opacity-50 pointer-events-none' : '';

const getFooterClasses = (narrow: boolean): string =>
  narrow ? 'ml-auto flex items-center' : 'mt-auto flex flex-col items-center';

const handleItemClick =
  (panelKey: string, disabled: boolean, onPanelChange: (key: string) => void) => (): void => {
    if (disabled) return;
    onPanelChange(panelKey);
  };

const MFRailImpl = ({
  items,
  activePanelKey,
  onPanelChange,
  narrow = false,
  footerSlot,
}: MFRailProps): ReactElement => {
  const tooltipSide = narrow ? 'bottom' : 'right';
  return (
    <TooltipProvider delayDuration={700}>
      <div className={getRailWrapperClasses(narrow)}>
        <nav className={getRailClasses(narrow)}>
          {items.map(item => {
            const isActive = item.panelKey === activePanelKey;
            const isDisabled = item.disabled === true;
            const Icon = item.icon;
            const badgeText = item.badge !== undefined ? String(item.badge) : null;
            const buttonLabel =
              badgeText !== null ? `${item.labelKey} (${badgeText})` : item.labelKey;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={buttonLabel}
                    aria-current={isActive ? 'page' : undefined}
                    aria-disabled={isDisabled ? 'true' : undefined}
                    onClick={handleItemClick(item.panelKey, isDisabled, onPanelChange)}
                    className={cn(getItemClasses(isActive, narrow), getDisabledClasses(isDisabled))}
                    data-testid={`mf-rail-${item.id}`}
                  >
                    {isActive ? (
                      <span className={getAccentBarClasses(narrow)} aria-hidden="true" />
                    ) : null}
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {badgeText !== null ? (
                      <span
                        aria-hidden="true"
                        className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-medium flex items-center justify-center"
                      >
                        {badgeText}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side={tooltipSide}>{item.labelKey}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
        {footerSlot !== undefined ? (
          <div className={getFooterClasses(narrow)}>{footerSlot}</div>
        ) : null}
      </div>
    </TooltipProvider>
  );
};

export const MFRail: React.MemoExoticComponent<(props: MFRailProps) => ReactElement> =
  memo(MFRailImpl);
