import { Monitor, Moon, Sun } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeToggleLabels {
  readonly selectionAria: string;
  readonly light: string;
  readonly dark: string;
  readonly system: string;
}

export interface ThemeToggleProps {
  readonly theme: ThemeMode;
  readonly onThemeChange: (mode: ThemeMode) => void;
  readonly labels?: ThemeToggleLabels;
  readonly 'data-testid'?: string;
}

interface ThemeOption {
  readonly mode: ThemeMode;
  readonly label: string;
  readonly icon: React.ReactElement;
}

const DEFAULT_THEME_LABELS: ThemeToggleLabels = {
  selectionAria: 'Theme selection',
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const buildThemeOptions = (labels: ThemeToggleLabels): readonly ThemeOption[] => [
  { mode: 'light', label: labels.light, icon: <Sun className="h-4 w-4" /> },
  { mode: 'dark', label: labels.dark, icon: <Moon className="h-4 w-4" /> },
  { mode: 'system', label: labels.system, icon: <Monitor className="h-4 w-4" /> },
];

const getButtonVariant = (currentTheme: ThemeMode, optionMode: ThemeMode): 'default' | 'outline' =>
  currentTheme === optionMode ? 'default' : 'outline';

const createClickHandler =
  (onThemeChange: (mode: ThemeMode) => void, mode: ThemeMode) => (): void => {
    onThemeChange(mode);
  };

export function ThemeToggle({
  theme,
  onThemeChange,
  labels = DEFAULT_THEME_LABELS,
  'data-testid': testId,
}: ThemeToggleProps): React.ReactElement {
  const themeOptions = buildThemeOptions(labels);
  return (
    <fieldset
      className="flex gap-2 border-0 p-0 m-0"
      data-testid={testId}
      aria-label={labels.selectionAria}
    >
      {themeOptions.map(({ mode, label, icon }) => (
        <Button
          key={mode}
          data-testid={`theme-option-${mode}`}
          variant={getButtonVariant(theme, mode)}
          size="sm"
          onClick={createClickHandler(onThemeChange, mode)}
          aria-pressed={theme === mode}
          className={cn('gap-1.5', theme === mode && 'pointer-events-none')}
        >
          {icon}
          {label}
        </Button>
      ))}
    </fieldset>
  );
}
