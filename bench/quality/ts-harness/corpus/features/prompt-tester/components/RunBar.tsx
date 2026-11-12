import React from 'react';

import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type RunBarLabels = {
  readonly runAll: string;
  readonly runChanged: string;
  readonly parallelOn: string;
  readonly abort?: string;
};

export type RunBarProps = {
  readonly formulaLabel: string;
  readonly runParallel: boolean;
  readonly onToggleParallel: (v: boolean) => void;
  readonly parallelTooltip: string;
  readonly hasChanges: boolean;
  readonly isRunning: boolean;
  readonly onRunAll: () => void;
  readonly onRunChanged: () => void;
  readonly onAbort: () => void;
  readonly labels: RunBarLabels;
  readonly className?: string;
};

const RUN_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';
const RUN_ALL_CLASS: string = cn(
  RUN_BUTTON_CLASS,
  'flex-1 bg-accent text-accent-foreground hover:bg-accent/90'
);
const RUN_CHANGED_CLASS: string = cn(
  RUN_BUTTON_CLASS,
  'flex-1 border border-accent text-accent hover:bg-accent/10'
);
const ABORT_CLASS: string = cn(
  RUN_BUTTON_CLASS,
  'flex-1 border border-destructive text-destructive hover:bg-destructive/10'
);

export const RunBar: React.NamedExoticComponent<RunBarProps> = React.memo(function RunBar(
  props: RunBarProps
): React.ReactElement {
  return (
    <div className={cn('px-4 pt-2 pb-3.5 bg-bg border-t border-line', props.className)}>
      <div className="flex items-center text-xs text-muted-foreground mb-2">
        <span>{props.formulaLabel}</span>
      </div>
      <TooltipProvider>
        <div className="flex items-center gap-2 mb-2">
          <Switch
            checked={props.runParallel}
            onCheckedChange={props.onToggleParallel}
            aria-label={props.labels.parallelOn}
          />
          <span className="text-sm text-foreground">{props.labels.parallelOn}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground"
                aria-label={props.parallelTooltip}
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{props.parallelTooltip}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      <div className="flex items-center gap-2">
        <button type="button" className={RUN_ALL_CLASS} onClick={props.onRunAll}>
          {props.labels.runAll}
        </button>
        {props.hasChanges ? (
          <button type="button" className={RUN_CHANGED_CLASS} onClick={props.onRunChanged}>
            {props.labels.runChanged}
          </button>
        ) : null}
        {props.isRunning ? (
          <button
            type="button"
            className={ABORT_CLASS}
            onClick={props.onAbort}
            aria-label={props.labels.abort ?? 'Abort'}
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
});
