import { memo, type MemoExoticComponent, type ReactElement } from 'react';

export interface ShortcutRow {
  readonly keys: string;
  readonly description: string;
}

export interface KeyboardShortcutsListProps {
  readonly heading: string;
  readonly hint?: string;
  readonly rows: readonly ShortcutRow[];
}

function KeyboardShortcutsListImpl(props: KeyboardShortcutsListProps): ReactElement {
  const { heading, hint, rows } = props;

  return (
    <section aria-labelledby="settings-keyboard-heading">
      <h3 id="settings-keyboard-heading" className="text-muted-foreground mb-3 text-sm font-medium">
        {heading}
      </h3>
      {hint !== undefined ? <p className="text-xs text-muted-foreground mb-3">{hint}</p> : null}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(row => (
          <div key={`${row.keys}\0${row.description}`} className="contents">
            <dt>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                {row.keys}
              </kbd>
            </dt>
            <dd>{row.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export const KeyboardShortcutsList: MemoExoticComponent<typeof KeyboardShortcutsListImpl> =
  memo(KeyboardShortcutsListImpl);
