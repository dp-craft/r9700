import { FileText } from 'lucide-react';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';

import { PromptHistoryList, type PromptHistoryRowVM } from './PromptHistoryList';

export type PromptHistoryBodyProps = {
  readonly loadError: string | null;
  readonly rows: readonly PromptHistoryRowVM[];
  readonly onToggleSelect: (id: string) => void;
  readonly errorLabel: string;
  readonly emptyHeadline: string;
  readonly emptyHint: string;
  readonly listAria?: string;
  readonly selectPrefix?: string;
};

export function PromptHistoryBody(props: PromptHistoryBodyProps): ReactElement {
  if (props.loadError !== null) {
    return (
      <p role="alert" className="px-4 py-3 text-sm text-destructive">
        {props.errorLabel}
      </p>
    );
  }
  if (props.rows.length > 0) {
    return (
      <PromptHistoryList
        rows={props.rows}
        onToggleSelect={props.onToggleSelect}
        listAria={props.listAria}
        selectPrefix={props.selectPrefix}
      />
    );
  }
  return (
    <EmptyState
      icon={<FileText aria-hidden="true" />}
      headline={props.emptyHeadline}
      hint={props.emptyHint}
    />
  );
}
