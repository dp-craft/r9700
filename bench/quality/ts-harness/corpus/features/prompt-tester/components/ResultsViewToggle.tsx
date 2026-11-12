import type { JSX } from 'react';

import { cn } from '@/lib/utils';

export type ViewMode = 'list' | 'grid';

export type ResultsViewToggleProps = {
  readonly viewMode: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
  readonly labels: { readonly list: string; readonly grid: string };
};

const buttonBase = 'px-3 py-1 text-sm rounded-md';
const activeClass = 'bg-panel text-ink border border-line';
const inactiveClass = 'bg-transparent text-ink2';

function getButtonClass(isActive: boolean): string {
  return cn(buttonBase, isActive ? activeClass : inactiveClass);
}

export function ResultsViewToggle(props: ResultsViewToggleProps): JSX.Element {
  const { viewMode, onChange, labels } = props;

  const handleSelect = (mode: ViewMode): (() => void) => {
    return (): void => {
      onChange(mode);
    };
  };

  return (
    <nav
      data-testid="view-mode-toggle"
      className="inline-flex rounded-lg border border-line bg-soft p-0.5"
    >
      <button
        type="button"
        data-testid="view-mode-list"
        aria-pressed={viewMode === 'list'}
        className={getButtonClass(viewMode === 'list')}
        onClick={handleSelect('list')}
      >
        {labels.list}
      </button>
      <button
        type="button"
        data-testid="view-mode-grid"
        aria-pressed={viewMode === 'grid'}
        className={getButtonClass(viewMode === 'grid')}
        onClick={handleSelect('grid')}
      >
        {labels.grid}
      </button>
    </nav>
  );
}
