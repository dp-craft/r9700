import type * as React from 'react';

import type { CommandSuggestion } from '@/lib/command-parser';
import { stripLeadingSlashes } from '@/lib/command-parser';
import { cn } from '@/lib/utils';

export interface CommandAutocompleteProps {
  readonly suggestions: readonly CommandSuggestion[];
  readonly onSelect: (prefix: string) => void;
  readonly focusedIndex: number;
  readonly onKeyDown: (e: React.KeyboardEvent) => void;
  readonly className?: string;
  readonly builtinGroupLabel?: string;
  readonly skillsGroupLabel?: string;
}

const normalizeDisplayPrefix = (prefix: string): string =>
  `/${stripLeadingSlashes(prefix).toLowerCase()}`;

const createClickHandler =
  (prefix: string, onSelect: (prefix: string) => void): (() => void) =>
    (): void =>
      onSelect(prefix);

const createOptionKeyHandler =
  (prefix: string, onSelect: (prefix: string) => void): ((e: React.KeyboardEvent) => void) =>
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(prefix);
      }
    };

type GroupedEntry =
  | { readonly kind: 'header'; readonly label: string }
  | { readonly kind: 'item'; readonly suggestion: CommandSuggestion; readonly flatIndex: number };

function buildGroupedEntries(
  suggestions: readonly CommandSuggestion[],
  builtinLabel: string,
  skillsLabel: string
): readonly GroupedEntry[] {
  const builtinItems = suggestions.filter(s => s.group === 'builtin');
  const skillItems = suggestions.filter(s => s.group === 'skill');
  const entries: GroupedEntry[] = [];
  let flatIndex = 0;

  if (builtinItems.length > 0) {
    entries.push({ kind: 'header', label: builtinLabel });
    builtinItems.forEach(suggestion => {
      entries.push({ kind: 'item', suggestion, flatIndex });
      flatIndex += 1;
    });
  }

  if (skillItems.length > 0) {
    entries.push({ kind: 'header', label: skillsLabel });
    skillItems.forEach(suggestion => {
      entries.push({ kind: 'item', suggestion, flatIndex });
      flatIndex += 1;
    });
  }

  return entries;
}

function renderHeader(label: string): React.ReactElement {
  return (
    <div
      key={`header-${label}`}
      role="presentation"
      className="text-muted-foreground text-xs font-medium uppercase tracking-wide px-2 py-1"
    >
      {label}
    </div>
  );
}

export function CommandAutocomplete({
  suggestions,
  onSelect,
  focusedIndex,
  onKeyDown,
  className,
  builtinGroupLabel = '',
  skillsGroupLabel = '',
}: CommandAutocompleteProps): React.ReactElement | null {
  if (suggestions.length === 0) return null;

  const entries = buildGroupedEntries(suggestions, builtinGroupLabel, skillsGroupLabel);

  return (
    <div role="listbox" tabIndex={-1} className={cn(className)} onKeyDown={onKeyDown}>
      {entries.map(entry =>
        entry.kind === 'header' ? (
          renderHeader(entry.label)
        ) : (
          <div
            key={entry.suggestion.skillId}
            role="option"
            aria-selected={entry.flatIndex === focusedIndex}
            tabIndex={0}
            className={cn(
              'flex items-center gap-3 cursor-pointer px-2 py-1.5 rounded-sm',
              entry.flatIndex === focusedIndex
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-muted'
            )}
            onClick={createClickHandler(entry.suggestion.prefix, onSelect)}
            onKeyDown={createOptionKeyHandler(entry.suggestion.prefix, onSelect)}
          >
            <code className="text-primary font-mono text-sm">
              {normalizeDisplayPrefix(entry.suggestion.prefix)}
            </code>
            <span className="text-muted-foreground text-sm">{entry.suggestion.skillName}</span>
          </div>
        )
      )}
    </div>
  );
}
