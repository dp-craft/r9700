import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const BORDER_COLOR_INPUT_ID = 'settings-border-color';

export interface ColorPaletteSectionProps {
  readonly borderColor: string;
  readonly onBorderColorChange: (hex: string) => void;
  readonly heading: string;
  readonly borderColorLabel: string;
  readonly resetLabel: string;
  readonly onReset: () => void;
}

export const ColorPaletteSection = ({
  borderColor,
  onBorderColorChange,
  heading,
  borderColorLabel,
  resetLabel,
  onReset,
}: ColorPaletteSectionProps): React.ReactElement => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    onBorderColorChange(event.target.value);
  };

  return (
    <section className="flex flex-col gap-3" aria-label={heading}>
      <h3 className="text-sm font-medium">{heading}</h3>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={BORDER_COLOR_INPUT_ID}>{borderColorLabel}</Label>
        <div className="flex items-center gap-2">
          <Input
            id={BORDER_COLOR_INPUT_ID}
            type="color"
            value={borderColor}
            onChange={handleChange}
            aria-label={borderColorLabel}
            className="h-9 w-12 cursor-pointer p-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            {resetLabel}
          </Button>
        </div>
      </div>
    </section>
  );
};
