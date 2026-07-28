import { memo, type ReactElement } from 'react';

export interface ComingSoonPanelProps {
  readonly labelKey: string;
  readonly bodyText: string;
}

export const ComingSoonPanel: React.MemoExoticComponent<
  (props: ComingSoonPanelProps) => ReactElement
> = memo(
  ({ labelKey, bodyText }: ComingSoonPanelProps): ReactElement => (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="rounded-lg border border-border bg-card p-8 text-center max-w-md">
        <h2 className="text-lg font-semibold text-foreground">{labelKey}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{bodyText}</p>
      </div>
    </div>
  )
);

ComingSoonPanel.displayName = 'ComingSoonPanel';
