import { Archive } from 'lucide-react';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';

import { RunHistoryList, type RunHistoryListLabels, type RunHistoryRowVM } from './RunHistoryList';

export type RunHistoryBodyProps = {
  readonly loadError: string | null;
  readonly rows: readonly RunHistoryRowVM[];
  readonly labels: RunHistoryListLabels;
  readonly onToggleSelect: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly errorLabel: string;
  readonly emptyHeadline: string;
  readonly emptyHint: string;
};

export function RunHistoryBody(props: RunHistoryBodyProps): ReactElement {
  if (props.loadError !== null) {
    return (
      <p role="alert" className="px-4 py-6 text-sm text-destructive">
        {props.errorLabel}
      </p>
    );
  }
  if (props.rows.length > 0) {
    return (
      <RunHistoryList
        rows={props.rows}
        onToggleSelect={props.onToggleSelect}
        onOpen={props.onOpen}
        labels={props.labels}
      />
    );
  }
  return (
    <EmptyState
      icon={<Archive aria-hidden="true" />}
      headline={props.emptyHeadline}
      hint={props.emptyHint}
    />
  );
}
