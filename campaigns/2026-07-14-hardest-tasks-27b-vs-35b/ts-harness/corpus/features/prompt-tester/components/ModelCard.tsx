import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type React from 'react';

import { Pill } from '@/components/ui/Pill';
import { DEFAULT_MODEL_PARAMS } from '@/lib/model-params';
import { cn } from '@/lib/utils';

import type { ModelEntry, SliderValues } from '../types';
import { axisLabel, MODEL_AXIS_PREFIX } from '../utils/axisLabel';
import type { ModelParamRowVM } from './ModelParamsList';
import { ModelParamsList } from './ModelParamsList';

const SLIDER_CONFIG: readonly {
  readonly key: keyof SliderValues;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}[] = [
  { key: 'temp', min: 0, max: 2, step: 0.1 },
  { key: 'topP', min: 0, max: 1, step: 0.05 },
  { key: 'maxTok', min: 1, max: 32768, step: 256 },
  { key: 'freq', min: 0, max: 2, step: 0.1 },
  { key: 'pres', min: 0, max: 2, step: 0.1 },
  { key: 'contextSize', min: 512, max: 200000, step: 512 },
] as const;

export interface ModelCardParamLabels {
  readonly temp: string;
  readonly topP: string;
  readonly maxTok: string;
  readonly freq: string;
  readonly pres: string;
  readonly contextSize: string;
}

export interface ModelCardLabels {
  readonly thinking: string;
  readonly thinkingOn: string;
  readonly legend: string;
  readonly paramLabels: ModelCardParamLabels;
  readonly cardAria: (name: string) => string;
  readonly toggleAria: (name: string) => string;
  readonly removeAria: (name: string) => string;
}

export interface ModelCardProps {
  readonly entry: ModelEntry;
  readonly onSetParam: (key: keyof SliderValues, value: number) => void;
  readonly onClampParam: (key: keyof SliderValues) => void;
  readonly onToggleThinking: () => void;
  readonly onToggleExpanded: () => void;
  readonly onClose: () => void;
  readonly labels: ModelCardLabels;
  readonly infoSlot?: React.ReactNode;
  readonly className?: string;
}

const formatParamSummary = (params: SliderValues): string =>
  `${params.temp} · ${params.topP} · ${params.maxTok}`;

const buildParamRows = (
  params: SliderValues,
  paramLabels: ModelCardParamLabels
): readonly ModelParamRowVM[] =>
  SLIDER_CONFIG.map(config => ({
    key: config.key,
    label: paramLabels[config.key],
    value: params[config.key] ?? DEFAULT_MODEL_PARAMS.contextSize,
    min: config.min,
    max: config.max,
    step: config.step,
  }));

const handleParamChange =
  (onSetParam: (key: keyof SliderValues, value: number) => void) =>
    (key: string, value: number): void => {
      const config = SLIDER_CONFIG.find(c => c.key === key);
      if (config) onSetParam(config.key, value);
    };

const handleParamBlur =
  (onClampParam: (key: keyof SliderValues) => void) =>
    (key: string): void => {
      const config = SLIDER_CONFIG.find(c => c.key === key);
      if (config) onClampParam(config.key);
    };

const handleThinkingToggle =
  (onToggle: () => void) =>
    (_enabled: boolean): void => {
      onToggle();
    };

const handleCloseClick =
  (onClose: () => void): ((e: React.MouseEvent) => void) =>
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      onClose();
    };

export const ModelCard = ({
  entry,
  onSetParam,
  onClampParam,
  onToggleThinking,
  onToggleExpanded,
  onClose,
  labels,
  infoSlot,
  className,
}: ModelCardProps): React.ReactElement => {
  const containerClasses = cn(
    'rounded-card border border-line bg-panel mb-2 overflow-hidden',
    entry.accent && 'border-accent ring-2 ring-accent/15',
    className
  );

  const summary = formatParamSummary(entry.params);
  const ChevronIcon = entry.expanded ? ChevronDown : ChevronRight;
  const axisPrefix = entry.axisId !== undefined ? axisLabel(MODEL_AXIS_PREFIX, entry.axisId) : null;
  const paramRows = buildParamRows(entry.params, labels.paramLabels);

  return (
    <article className={containerClasses} aria-label={labels.cardAria(entry.name)}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer"
          onClick={onToggleExpanded}
          aria-expanded={entry.expanded}
          aria-label={labels.toggleAria(entry.name)}
        >
          <span
            className={cn('size-2 rounded-full shrink-0', entry.accent ? 'bg-accent' : 'bg-ink3')}
            aria-hidden="true"
          />
          <span className="font-mono font-bold text-sm text-ink truncate">
            {axisPrefix !== null && <span className="text-ink3 mr-1">{axisPrefix}</span>}
            {entry.name}
          </span>
          {!entry.expanded && (
            <span className="font-mono text-xs text-ink3 truncate">{summary}</span>
          )}
        </button>
        <span className="flex items-center gap-1 shrink-0">
          {infoSlot}
          <ChevronIcon className="size-4 text-ink3" aria-hidden="true" />
          <button
            type="button"
            className="p-0.5 rounded hover:bg-ink3/10 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleCloseClick(onClose)}
            aria-label={labels.removeAria(entry.name)}
          >
            <X className="size-3.5 text-ink3" />
          </button>
        </span>
      </div>

      {entry.expanded && (
        <div className="px-3 pb-3 flex flex-col gap-3">
          <ModelParamsList
            rows={paramRows}
            legendLabel={labels.legend}
            editable
            supportsThinking={entry.supportsThinking}
            thinking={entry.thinking}
            onThinkingToggle={handleThinkingToggle(onToggleThinking)}
            onChange={handleParamChange(onSetParam)}
            onBlur={handleParamBlur(onClampParam)}
          />

          {entry.supportsThinking && (
            <div className="flex items-center gap-2">
              <Pill
                accent
                filled={entry.thinking}
                onDot={entry.thinking}
                onClick={onToggleThinking}
                className="cursor-pointer"
              >
                {entry.thinking ? labels.thinkingOn : labels.thinking}
              </Pill>
            </div>
          )}
        </div>
      )}
    </article>
  );
};
