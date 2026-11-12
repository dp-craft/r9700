import type * as React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import type { FontSize } from '../types';

interface FontSizeOption {
  readonly value: FontSize;
  readonly label: string;
}

function buildFontSizeOptions(
  smallLabel: string,
  mediumLabel: string,
  largeLabel: string
): readonly FontSizeOption[] {
  return [
    { value: 'sm', label: smallLabel },
    { value: 'md', label: mediumLabel },
    { value: 'lg', label: largeLabel },
  ];
}

export interface FontSizePickerProps {
  readonly fontSize: FontSize;
  readonly onFontSizeChange: (size: string) => void;
  readonly smallLabel?: string;
  readonly mediumLabel?: string;
  readonly largeLabel?: string;
  readonly selectFontSizeAria?: string;
}

export function FontSizePicker({
  fontSize,
  onFontSizeChange,
  smallLabel = 'Small',
  mediumLabel = 'Medium',
  largeLabel = 'Large',
  selectFontSizeAria = 'Select font size',
}: FontSizePickerProps): React.ReactElement {
  const options = buildFontSizeOptions(smallLabel, mediumLabel, largeLabel);

  return (
    <Select value={fontSize} onValueChange={onFontSizeChange}>
      <SelectTrigger aria-label={selectFontSizeAria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={4}>
        {options.map(({ value, label }) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
