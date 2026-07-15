import { Monitor, Moon, Sun } from 'lucide-react';
import { memo, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeSwitchProps {
  readonly currentMode: ThemeMode;
  readonly onModeChange: (mode: ThemeMode) => void;
  readonly className?: string;
}

interface SegmentDef {
  readonly mode: ThemeMode;
  readonly label: string;
  readonly Icon: typeof Monitor;
}

const SEGMENTS: readonly SegmentDef[] = [
  { mode: 'system', label: 'System theme', Icon: Monitor },
  { mode: 'light', label: 'Light theme', Icon: Sun },
  { mode: 'dark', label: 'Dark theme', Icon: Moon },
];

const segmentClass = (isActive: boolean): string =>
  cn(
    'h-8 w-8 rounded-none border-0 px-0',
    isActive
      ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  );

const handleClickFor = (mode: ThemeMode, onModeChange: (m: ThemeMode) => void) => (): void => {
  onModeChange(mode);
};

export const ThemeSwitch: React.MemoExoticComponent<(props: ThemeSwitchProps) => ReactElement> =
  memo(({ currentMode, onModeChange, className }: ThemeSwitchProps): ReactElement => {
    return (
      <div
        className={cn(
          'inline-flex items-center overflow-hidden rounded-md border border-border',
          className
        )}
      >
        {SEGMENTS.map(({ mode, label, Icon }) => {
          const isActive = currentMode === mode;
          return (
            <Button
              key={mode}
              type="button"
              variant="ghost"
              size="sm"
              aria-label={label}
              aria-pressed={isActive}
              onClick={handleClickFor(mode, onModeChange)}
              className={segmentClass(isActive)}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </Button>
          );
        })}
      </div>
    );
  });

ThemeSwitch.displayName = 'ThemeSwitch';
