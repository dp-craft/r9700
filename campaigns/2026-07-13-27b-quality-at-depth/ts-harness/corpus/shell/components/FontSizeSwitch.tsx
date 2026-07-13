import { memo, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type FontSize = 'sm' | 'md' | 'lg';

export interface FontSizeLabels {
  readonly sm: string;
  readonly md: string;
  readonly lg: string;
  readonly group: string;
}

export interface FontSizeSwitchProps {
  readonly fontSize: FontSize;
  readonly onFontSizeChange: (size: FontSize) => void;
  readonly labels: FontSizeLabels;
  readonly className?: string;
}

interface SegmentDef {
  readonly size: FontSize;
  readonly glyph: string;
  readonly glyphClass: string;
}

const SEGMENTS: readonly SegmentDef[] = [
  { size: 'sm', glyph: 'A−', glyphClass: 'text-xs' },
  { size: 'md', glyph: 'A', glyphClass: 'text-sm' },
  { size: 'lg', glyph: 'A+', glyphClass: 'text-base' },
];

const labelFor = (size: FontSize, labels: FontSizeLabels): string => labels[size];

const segmentClass = (isActive: boolean): string =>
  cn(
    'h-8 w-8 rounded-none border-0 px-0 font-medium',
    isActive
      ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  );

const handleClickFor =
  (size: FontSize, onFontSizeChange: (s: FontSize) => void): (() => void) =>
    (): void => {
      onFontSizeChange(size);
    };

export const FontSizeSwitch: React.MemoExoticComponent<
  (props: FontSizeSwitchProps) => ReactElement
> = memo(({ fontSize, onFontSizeChange, labels, className }: FontSizeSwitchProps): ReactElement => {
  return (
    <fieldset
      aria-label={labels.group}
      className={cn(
        'm-0 min-w-0 border-0 p-0 inline-flex items-center overflow-hidden rounded-md border border-border',
        className
      )}
    >
      {SEGMENTS.map(({ size, glyph, glyphClass }) => {
        const isActive = fontSize === size;
        return (
          <Button
            key={size}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={labelFor(size, labels)}
            aria-pressed={isActive}
            onClick={handleClickFor(size, onFontSizeChange)}
            className={segmentClass(isActive)}
          >
            <span className={glyphClass} aria-hidden="true">
              {glyph}
            </span>
          </Button>
        );
      })}
    </fieldset>
  );
});

FontSizeSwitch.displayName = 'FontSizeSwitch';
