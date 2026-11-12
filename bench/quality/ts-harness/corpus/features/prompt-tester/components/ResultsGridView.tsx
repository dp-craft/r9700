import { Star, X } from 'lucide-react';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import type {
  GridCellVM,
  GridTableSkillRow,
  GridTableVM,
  ResultCellVM,
  StarMetricId,
  StarRow
} from '../types';
import { ROW_NAME_MAX_WIDTH } from '../utils/gridLayout';

export type { GridCellVM };

export type GridStatusLabels = Readonly<Record<ResultCellVM['status'], string>>;

export interface ResultsGridViewProps {
  readonly table: GridTableVM;
  readonly cornerLabel: string;
  readonly emptyLabel: string;
  readonly statusLabels: GridStatusLabels;
  readonly resultAriaLabel: (label: string) => string;
  readonly selectAriaLabel: (label: string) => string;
  readonly ratingAriaLabel: (mean: number) => string;
  readonly criterionLabel?: (name: StarMetricId) => string;
  readonly tpsLabel?: string;
  readonly ttsLabel?: string;
  readonly metricEmpty?: string;
  readonly deleteCellAriaLabel: string;
  readonly onCellClick: (cellId: string) => void;
  readonly onCellDelete: (cellId: string) => void;
  readonly onSelectToggle: (cellId: string) => void;
  readonly className?: string;
}

const STATUS_INDICATOR_CLASS: Record<ResultCellVM['status'], string> = {
  idle: 'bg-muted text-muted-foreground',
  streaming: 'bg-blue-500/15 text-blue-500 animate-pulse',
  done: 'bg-green-500/15 text-green-500',
  error: 'bg-destructive/15 text-destructive',
  aborted: 'bg-yellow-500/15 text-yellow-500',
};

const OUTPUT_PREVIEW_MAX_LENGTH = 120;
const RATING_STARS = [0, 1, 2, 3, 4] as const;
const RATING_MAX = 5;

const clampFilledStars = (mean: number): number =>
  Math.min(RATING_MAX, Math.max(0, Math.round(mean)));

const starClassName = (index: number, filled: number): string =>
  cn('h-3.5 w-3.5', index < filled ? 'fill-current text-yellow-500' : 'text-muted-foreground');

const renderRatingStars = (
  mean: number,
  ratingAriaLabel: (mean: number) => string
): ReactElement => {
  const filled = clampFilledStars(mean);
  return (
    <div
      data-testid="grid-cell-rating"
      data-rating={mean}
      role="img"
      aria-label={ratingAriaLabel(mean)}
      className="flex items-center gap-0.5"
    >
      {RATING_STARS.map(index => (
        <Star key={index} aria-hidden="true" className={starClassName(index, filled)} />
      ))}
    </div>
  );
};

const truncatePreview = (text: string): string =>
  text.length > OUTPUT_PREVIEW_MAX_LENGTH ? `${text.slice(0, OUTPUT_PREVIEW_MAX_LENGTH)}…` : text;

const handleCellClick =
  (onCellClick: (cellId: string) => void, cellId: string): (() => void) =>
    (): void => {
      onCellClick(cellId);
    };

const handleSelectToggle =
  (onSelectToggle: (cellId: string) => void, cellId: string): (() => void) =>
    (): void => {
      onSelectToggle(cellId);
    };

const handleDelete =
  (onCellDelete: (cellId: string) => void, cellId: string): ((e: React.MouseEvent) => void) =>
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      onCellDelete(cellId);
    };

const handleCheckboxClick = (e: React.MouseEvent): void => {
  e.stopPropagation();
};

const handleCheckboxKeyDown =
  (onSelectToggle: (cellId: string) => void, cellId: string): ((e: React.KeyboardEvent) => void) =>
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        onSelectToggle(cellId);
      }
    };

const renderPreview = (cell: ResultCellVM): string =>
  cell.status === 'error' ? (cell.error ?? '') : truncatePreview(cell.outputPreview);

const starRowClassName = (index: number, filled: number): string =>
  cn('h-3 w-3', index < filled ? 'fill-current text-yellow-500' : 'text-muted-foreground/40');

const renderStarRow = (
  starRow: StarRow,
  ratingAriaLabel: (mean: number) => string,
  criterionLabel?: (name: StarMetricId) => string
): ReactElement => {
  const filled = clampFilledStars(starRow.score);
  const label = criterionLabel ? criterionLabel(starRow.category) : starRow.category;
  return (
    <li key={starRow.category} className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        role="img"
        aria-label={ratingAriaLabel(starRow.score)}
        className="flex items-center gap-0.5"
      >
        {RATING_STARS.map(index => (
          <Star key={index} aria-hidden="true" className={starRowClassName(index, filled)} />
        ))}
      </span>
    </li>
  );
};

const formatMetric = (value: number | null, empty: string): string =>
  value === null ? empty : String(Math.round(value));

const renderRatingsBlock = (
  gridCell: GridCellVM,
  ratingAriaLabel: (mean: number) => string,
  criterionLabel: ((name: StarMetricId) => string) | undefined,
  tpsLabel: string,
  ttsLabel: string,
  metricEmpty: string
): ReactElement => (
  <div data-testid="grid-card-ratings" className="flex flex-col gap-2">
    <ul className="flex flex-col gap-1">
      {gridCell.starRows.map(starRow => renderStarRow(starRow, ratingAriaLabel, criterionLabel))}
    </ul>
    <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
      <span data-testid="grid-card-tps">
        <span className="text-foreground">{formatMetric(gridCell.tps, metricEmpty)}</span>{' '}
        {tpsLabel}
      </span>
      <span data-testid="grid-card-tts">
        <span className="text-foreground">
          {formatMetric(gridCell.timeToFirstTokenMs, metricEmpty)}
        </span>{' '}
        {ttsLabel}
      </span>
    </div>
  </div>
);

const renderCell = (gridCell: GridCellVM, props: ResultsGridViewProps): ReactElement => {
  const {
    statusLabels,
    resultAriaLabel,
    selectAriaLabel,
    ratingAriaLabel,
    criterionLabel,
    tpsLabel,
    ttsLabel,
    metricEmpty,
    deleteCellAriaLabel,
    onCellClick,
    onCellDelete,
    onSelectToggle,
  } = props;
  const statusClass = STATUS_INDICATOR_CLASS[gridCell.cell.status];
  const statusLabel = statusLabels[gridCell.cell.status];
  return (
    <div
      className={cn(
        'relative flex w-full flex-col rounded-md border border-border',
        gridCell.cell.isOutdated && 'opacity-60',
        gridCell.selected && 'ring-2 ring-primary'
      )}
    >
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        <input
          type="checkbox"
          checked={gridCell.selected}
          onChange={handleSelectToggle(onSelectToggle, gridCell.id)}
          onClick={handleCheckboxClick}
          onKeyDown={handleCheckboxKeyDown(onSelectToggle, gridCell.id)}
          aria-label={selectAriaLabel(gridCell.cell.modelLabel)}
          className="h-4 w-4 cursor-pointer accent-primary"
        />
        <button
          type="button"
          aria-label={deleteCellAriaLabel}
          onClick={handleDelete(onCellDelete, gridCell.id)}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        data-testid={`result-cell-${gridCell.id}`}
        aria-label={resultAriaLabel(gridCell.cell.modelLabel)}
        className={cn(
          'flex w-full flex-col gap-2 rounded-md p-3 cursor-pointer text-left',
          'transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
        )}
        onClick={handleCellClick(onCellClick, gridCell.id)}
      >
        <div className="flex items-center gap-2 pr-16">
          <Badge className={cn('text-xs', statusClass)}>{statusLabel}</Badge>
          {renderRatingStars(gridCell.cell.meanRating, ratingAriaLabel)}
        </div>
        <p className="text-sm text-foreground line-clamp-3 min-h-[3lh]">
          {renderPreview(gridCell.cell)}
        </p>
        {renderRatingsBlock(
          gridCell,
          ratingAriaLabel,
          criterionLabel,
          tpsLabel ?? '',
          ttsLabel ?? '',
          metricEmpty ?? '—'
        )}
      </button>
    </div>
  );
};

const renderBodyCell = (
  gridCell: GridCellVM | null,
  index: number,
  props: ResultsGridViewProps
): ReactElement => {
  if (gridCell === null) {
    return (
      <td key={`empty-${index}`} className="p-2 text-center align-top text-muted-foreground">
        —
      </td>
    );
  }
  return (
    <td key={gridCell.id} className="p-2 align-top">
      {renderCell(gridCell, props)}
    </td>
  );
};

const renderRow = (skillRow: GridTableSkillRow, props: ResultsGridViewProps): ReactElement => (
  <tr key={skillRow.skillKey}>
    <th
      scope="row"
      style={{ maxWidth: ROW_NAME_MAX_WIDTH }}
      className="sticky left-0 z-10 overflow-hidden text-ellipsis break-words bg-background p-2 text-left align-top text-sm font-medium"
    >
      {skillRow.label}
    </th>
    {skillRow.cells.map((gridCell, index) => renderBodyCell(gridCell, index, props))}
  </tr>
);

export const ResultsGridView = (props: ResultsGridViewProps): ReactElement => {
  const { table, cornerLabel, emptyLabel, className } = props;

  if (table.modelColumns.length === 0 || table.skillRows.length === 0) {
    return (
      <div className={cn('flex items-center justify-center p-8 text-muted-foreground', className)}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={cn('overflow-auto', className)}>
      <table className="w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-20 bg-background">
          <tr>
            <th scope="col" className="p-2 text-left text-sm font-semibold">
              {cornerLabel}
            </th>
            {table.modelColumns.map(column => (
              <th key={column.modelId} scope="col" className="p-2 text-left text-sm font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{table.skillRows.map(skillRow => renderRow(skillRow, props))}</tbody>
      </table>
    </div>
  );
};
