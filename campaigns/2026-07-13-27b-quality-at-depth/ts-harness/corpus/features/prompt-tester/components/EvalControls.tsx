import { type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TESTID_PER_OUTPUT = 'eval-per-output-btn';
const TESTID_BATCH = 'eval-batch-btn';
const TESTID_COPY = 'copy-eval-prompt';
const TESTID_BATCH_RESULT = 'eval-batch-result';

export interface EvalRankingRow {
  readonly label: string;
  readonly rank: number;
  readonly reasoning: string;
}

export interface EvalComparisonView {
  readonly winnerLabel: string | null;
  readonly ranking: readonly EvalRankingRow[];
  readonly overallReasoning: string;
  readonly error: string | null;
}

export interface EvalControlsLabels {
  readonly heading: string;
  readonly description: string;
  readonly perOutput: string;
  readonly compareAll: string;
  readonly copyPrompt: string;
  readonly disabledHint: string;
  readonly verdictLabel: string;
}

export interface EvalControlsProps {
  readonly visible: boolean;
  readonly inAppEvalEnabled: boolean;
  readonly comparison: EvalComparisonView | null;
  readonly labels: EvalControlsLabels;
  readonly onEvaluatePerOutput: () => void;
  readonly onCompareAll: () => void;
  readonly onCopyPrompt: () => void;
  readonly className?: string;
}

const sortByRank = (rows: readonly EvalRankingRow[]): readonly EvalRankingRow[] =>
  [...rows].sort((a, b) => a.rank - b.rank);

const renderRankingItem = (row: EvalRankingRow): ReactElement => (
  <li key={`${row.rank}-${row.label}`} className="rounded bg-soft px-3 py-2">
    <span className="font-medium text-accent">{row.rank}.</span>{' '}
    <span className="font-medium text-ink">{row.label}</span>{' '}
    <span className="text-ink2">{row.reasoning}</span>
  </li>
);

export const EvalControls = ({
  visible,
  inAppEvalEnabled,
  comparison,
  labels,
  onEvaluatePerOutput,
  onCompareAll,
  onCopyPrompt,
  className,
}: EvalControlsProps): ReactElement | null => {
  if (!visible) {
    return null;
  }

  return (
    <section className={cn('mx-auto max-w-3xl space-y-4', className)}>
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-ink">{labels.heading}</h2>
        <p className="text-sm text-ink2">{labels.description}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid={TESTID_PER_OUTPUT}
          disabled={!inAppEvalEnabled}
          onClick={onEvaluatePerOutput}
        >
          {labels.perOutput}
        </Button>
        <Button
          type="button"
          data-testid={TESTID_BATCH}
          disabled={!inAppEvalEnabled}
          onClick={onCompareAll}
        >
          {labels.compareAll}
        </Button>
        <Button type="button" variant="outline" data-testid={TESTID_COPY} onClick={onCopyPrompt}>
          {labels.copyPrompt}
        </Button>
      </div>

      {!inAppEvalEnabled ? <p className="text-sm text-ink2">{labels.disabledHint}</p> : null}

      {comparison !== null ? (
        <section
          data-testid={TESTID_BATCH_RESULT}
          className="space-y-3 rounded-md border border-line bg-panel p-4"
          aria-live="polite"
        >
          <output className="block space-y-3">
            <p className="text-sm text-ink">
              <span className="text-ink2">{labels.verdictLabel}</span>{' '}
              <span className="text-accent">{comparison.winnerLabel}</span>
            </p>
            <ol className="space-y-2 text-sm">{sortByRank(comparison.ranking).map(renderRankingItem)}</ol>
          </output>
        </section>
      ) : null}
    </section>
  );
};
