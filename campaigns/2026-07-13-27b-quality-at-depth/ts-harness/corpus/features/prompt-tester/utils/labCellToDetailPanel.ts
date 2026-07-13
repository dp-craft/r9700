import { computeTier1Metrics } from '@/lib/tier1-metrics';

import type { CellResult, CellStatus, ModelEntry, RunAnalysisVM, Tier1MetricsVM } from '../types';
import { buildRunAnalysis } from './buildRunAnalysis';

type DetailPanelStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'aborted';

export type LabCellToDetailPanelInput = {
  readonly cell: CellResult;
  readonly model: ModelEntry;
  readonly systemPrompt: string | undefined;
  readonly userPrompt: string;
};

export type LabCellToDetailPanelOutput = {
  readonly cellKey: string;
  readonly modelName: string;
  readonly systemPrompt: string | null;
  readonly responseText: string;
  readonly status: DetailPanelStatus;
  readonly error: string | null;
  readonly tier1: Tier1MetricsVM | null;
  /** Real TTF in ms; null when not captured (degrade-gracefully signal for UI). */
  readonly timeToFirstTokenMs: number | null;
  /** Real tokens-per-second; null when not captured. */
  readonly tps: number | null;
  readonly reasoning: string;
  readonly runAnalysis: RunAnalysisVM | null;
};

const STATUS_MAP: Readonly<Record<CellStatus, DetailPanelStatus>> = {
  idle: 'pending',
  streaming: 'streaming',
  done: 'completed',
  error: 'failed',
  aborted: 'aborted',
};

const hasUsableOutput = (cell: CellResult): boolean =>
  cell.status !== 'error' && cell.status !== 'idle';

const computeTier1ForCell = (cell: CellResult, ttfMs: number | null): Tier1MetricsVM | null => {
  if (!hasUsableOutput(cell)) return null;
  return computeTier1Metrics(cell.output, {
    requestStartedAt: 0,
    firstTokenAt: ttfMs ?? 0,
    completedAt: cell.latencyMs,
  });
};

export const labCellToDetailPanelProps = (
  input: LabCellToDetailPanelInput
): LabCellToDetailPanelOutput => {
  const { cell, model, systemPrompt } = input;
  const isError = cell.status === 'error';
  const ttfMs = cell.ttfMs ?? null;

  return {
    cellKey: cell.id,
    modelName: model.name,
    systemPrompt: systemPrompt ?? null,
    responseText: isError ? '' : cell.output,
    status: STATUS_MAP[cell.status],
    error: isError ? (cell.error ?? null) : null,
    tier1: computeTier1ForCell(cell, ttfMs),
    timeToFirstTokenMs: ttfMs,
    tps: cell.tps ?? null,
    reasoning: cell.reasoning ?? '',
    runAnalysis: hasUsableOutput(cell) ? buildRunAnalysis(cell.output) : null,
  };
};
