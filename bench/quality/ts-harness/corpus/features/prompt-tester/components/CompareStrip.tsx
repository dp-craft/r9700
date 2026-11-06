import { Info } from 'lucide-react';
import type React from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { CompareCellVM, CompareMetricRow } from '../types';
import { ANALYZING_SENTINEL } from '../utils/buildCompareRows';
import { ROW_NAME_MAX_WIDTH } from '../utils/gridLayout';
import type { PerplexityBand } from '../utils/perplexityQuality';
import { ModelParamsReadOnlyBlock } from './ModelParamsReadOnlyBlock';

type CompareMode = 'diff' | 'table' | 'both';

export interface CompareQualityLabels {
  readonly good: string;
  readonly average: string;
  readonly bad: string;
}

export interface CompareStripProps {
  readonly mode: CompareMode;
  readonly modeLabels: {
    readonly diff: string;
    readonly table: string;
    readonly both: string;
  };
  readonly title: string;
  readonly diffPanes: readonly { readonly label: string; readonly text: string }[];
  readonly metricRows: readonly CompareMetricRow[];
  readonly metricsHeaderLabel: string;
  readonly metricColAriaLabel: (modelLabel: string) => string;
  readonly estimateLabel: string;
  readonly cellCards: readonly CompareCellVM[];
  readonly metricTooltips: Readonly<Record<string, string>>;
  readonly fieldInfoLabel: (metricLabel: string) => string;
  readonly calculatingLabel: string;
  readonly qualityLabels: CompareQualityLabels;
  readonly isEmpty: boolean;
  readonly emptyStateLabel: string;
  readonly onModeChange: (mode: CompareMode) => void;
  readonly className?: string;
}

const MODES: readonly CompareMode[] = ['diff', 'table', 'both'];

const QUALITY_NUMBER_CLASS: Readonly<Record<PerplexityBand, string>> = {
  good: 'text-green-500',
  average: 'text-amber-500',
  bad: 'text-red-500',
};

const QUALITY_PILL_CLASS: Readonly<Record<PerplexityBand, string>> = {
  good: 'border-green-500/30 bg-green-500/10',
  average: 'border-amber-500/30 bg-amber-500/10',
  bad: 'border-red-500/30 bg-red-500/10',
};

const QUALITY_DOT_CLASS: Readonly<Record<PerplexityBand, string>> = {
  good: 'bg-green-500 ring-green-500/30',
  average: 'bg-amber-500 ring-amber-500/30',
  bad: 'bg-red-500 ring-red-500/30',
};

const ROW_NAME_HEADER_STYLE: React.CSSProperties = { maxWidth: ROW_NAME_MAX_WIDTH };

const showDiff = (mode: CompareMode): boolean => mode === 'diff' || mode === 'both';

const showTable = (mode: CompareMode): boolean => mode === 'table' || mode === 'both';

const handleModeClick =
  (mode: CompareMode, onModeChange: (m: CompareMode) => void): (() => void) =>
    (): void => {
      onModeChange(mode);
    };

const qualityLabelFor = (band: PerplexityBand, labels: CompareQualityLabels): string =>
  band === 'good' ? labels.good : band === 'average' ? labels.average : labels.bad;

const renderQualityCell = (
  value: string,
  band: PerplexityBand,
  labels: CompareQualityLabels
): React.ReactNode => {
  const label = qualityLabelFor(band, labels);
  return (
    <output
      data-testid={`perplexity-quality-${band}`}
      data-quality={band}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1',
        QUALITY_PILL_CLASS[band]
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 shrink-0 rounded-full ring-2', QUALITY_DOT_CLASS[band])}
      />
      <span className={cn('text-sm font-semibold', QUALITY_NUMBER_CLASS[band])}>{value}</span>
    </output>
  );
};

const renderCalculatingCell = (label: string): React.ReactNode => (
  <output
    data-testid="perplexity-cell-calculating"
    className="inline-flex items-center gap-2 text-sm text-muted-foreground"
  >
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent"
    />
    <span className="text-xs">{label}</span>
  </output>
);

const renderCellValue = (
  value: string,
  band: PerplexityBand | undefined,
  props: CompareStripProps
): React.ReactNode => {
  if (value === ANALYZING_SENTINEL) {
    return renderCalculatingCell(props.calculatingLabel);
  }
  if (band !== undefined) {
    return renderQualityCell(value, band, props.qualityLabels);
  }
  return value;
};

const renderRow = (row: CompareMetricRow, props: CompareStripProps): React.ReactNode => {
  const tooltip = props.metricTooltips[row.metricKey];
  return (
    <tr
      key={row.metricKey}
      data-testid={row.isEstimate ? 'compare-metric-perplexity' : undefined}
      className="border-b border-border last:border-b-0"
    >
      <th
        scope="row"
        style={ROW_NAME_HEADER_STYLE}
        className="overflow-hidden text-ellipsis px-3 py-1.5 text-left text-xs font-medium text-muted-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="overflow-hidden text-ellipsis">{row.label}</span>
          {row.isEstimate && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-normal text-muted-foreground">
              {props.estimateLabel}
            </span>
          )}
          {tooltip !== undefined && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid={`field-info-${row.metricKey}`}
                  aria-label={props.fieldInfoLabel(row.label)}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-accent"
                >
                  <Info className="h-3 w-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-left">{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </th>
      {row.values.map((value, i) => (
        <td key={`${row.metricKey}-${String(i)}`} className="min-w-[14rem] px-3 py-1.5 text-right">
          {renderCellValue(value, row.qualities?.[i], props)}
        </td>
      ))}
    </tr>
  );
};

export const CompareStrip = (props: CompareStripProps): React.ReactNode => {
  const {
    mode,
    modeLabels,
    title,
    diffPanes,
    metricRows,
    metricsHeaderLabel,
    metricColAriaLabel,
    cellCards,
    isEmpty,
    emptyStateLabel,
    onModeChange,
    className,
  } = props;
  return (
    <section
      data-testid="lab-compare-strip"
      aria-label={title}
      className={cn(
        'flex min-h-0 flex-1 flex-col border-t-2 border-t-accent bg-background',
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex gap-0.5 rounded-md border border-border p-0.5">
          {MODES.map(m => (
            <Button
              key={m}
              variant={m === mode ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={m === mode}
              onClick={handleModeClick(m, onModeChange)}
              className="h-7 px-2.5 text-xs"
            >
              {modeLabels[m]}
            </Button>
          ))}
        </div>
      </div>

      {isEmpty ? (
        <div
          data-testid="compare-strip-empty-state"
          className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4 text-center text-sm text-muted-foreground"
        >
          {emptyStateLabel}
        </div>
      ) : (
        <TooltipProvider>
          <div
            data-testid="compare-strip-scroll"
            className="relative min-h-0 flex-1 overflow-auto px-4 pb-4"
          >
            <div
              className={cn(
                'grid gap-4',
                showDiff(mode) && showTable(mode) ? 'grid-cols-[1.4fr_1fr]' : 'grid-cols-1'
              )}
            >
              {showDiff(mode) && (
                <div className="flex flex-col gap-3">
                  {diffPanes.map((pane, i) => (
                    <div
                      key={`${pane.label}-${String(i)}`}
                      className="min-w-[20rem] rounded-md border border-border p-3"
                    >
                      <p className="mb-1 text-xs font-medium text-muted-foreground">{pane.label}</p>
                      <pre className="whitespace-pre-wrap text-sm">{pane.text}</pre>
                    </div>
                  ))}
                </div>
              )}

              {showTable(mode) && (
                <div className="rounded-md border border-border">
                  <table data-testid="performance-metrics-table" className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border align-bottom">
                        <th
                          scope="col"
                          style={ROW_NAME_HEADER_STYLE}
                          className="overflow-hidden text-ellipsis px-3 py-1.5 text-left align-bottom text-xs font-medium text-muted-foreground"
                        >
                          {metricsHeaderLabel}
                        </th>
                        {cellCards.map((card, i) => (
                          <th
                            key={`col-${card.label}-${String(i)}`}
                            scope="col"
                            aria-label={metricColAriaLabel(card.label)}
                            className="min-w-[14rem] px-3 py-3 text-left align-top font-normal"
                          >
                            <span
                              data-testid="compare-model-card"
                              className="block rounded-md border border-border p-3"
                            >
                              <span className="mb-2 block text-xs font-medium text-muted-foreground">
                                {card.label}
                              </span>
                              <ModelParamsReadOnlyBlock {...card.modelParams} />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>{metricRows.map(row => renderRow(row, props))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </TooltipProvider>
      )}
    </section>
  );
};
