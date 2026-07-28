import type * as React from 'react';
import type { ReactNode } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import type { ModelViewModel } from '../types';

const DESCRIPTION_MAX_LENGTH = 60;

export interface ModelPickerProps {
  readonly models: readonly ModelViewModel[];
  readonly activeModelId: string;
  readonly onModelChange: (modelId: string) => void;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly loadingLabel?: string;
  readonly selectPlaceholder?: string;
  readonly selectModelAria?: string;
  readonly noModelsLabel?: string;
  readonly contextSize?: number;
  readonly onContextSizeChange?: (value: number) => void;
  readonly contextSizeLabel?: string;
  readonly contextSizeTooltip?: string;
  readonly infoSlot?: ReactNode;
}

function handleContextSizeInput(
  onContextSizeChange: (value: number) => void
): (e: React.ChangeEvent<HTMLInputElement>) => void {
  return (e: React.ChangeEvent<HTMLInputElement>): void => {
    const parsed = Number(e.target.value);
    if (!Number.isNaN(parsed)) {
      onContextSizeChange(parsed);
    }
  };
}

function renderContextSize(
  contextSize: number | undefined,
  onContextSizeChange: ((value: number) => void) | undefined,
  label: string | undefined,
  tooltip: string | undefined
): React.ReactElement | null {
  if (contextSize === undefined || onContextSizeChange === undefined) {
    return null;
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <label
        htmlFor="model-context-size"
        className="text-sm font-medium text-foreground"
        title={tooltip}
      >
        {label}
      </label>
      <input
        id="model-context-size"
        type="number"
        value={contextSize}
        onChange={handleContextSizeInput(onContextSizeChange)}
        min={512}
        max={131072}
        step={512}
        title={tooltip}
        aria-label={label}
        className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-right text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

function getPlaceholder(
  isLoading: boolean,
  loadingLabel: string,
  selectPlaceholder: string
): string {
  return isLoading ? loadingLabel : selectPlaceholder;
}

function truncateDescription(description: string): string {
  if (description.length <= DESCRIPTION_MAX_LENGTH) {
    return description;
  }
  return `${description.slice(0, DESCRIPTION_MAX_LENGTH)}…`;
}

function renderModelItem(model: ModelViewModel): React.ReactElement {
  const description = model.description ? truncateDescription(model.description) : null;

  if (description === null) {
    return (
      <SelectItem key={model.id} value={model.id}>
        {model.name}
      </SelectItem>
    );
  }

  return (
    <SelectItem key={model.id} value={model.id}>
      <div className="flex flex-col gap-0.5 py-0.5">
        <span className="font-medium">{model.name}</span>
        <span className="text-muted-foreground text-[11px] leading-tight">{description}</span>
      </div>
    </SelectItem>
  );
}

export function ModelPicker({
  models,
  activeModelId,
  onModelChange,
  isLoading,
  error,
  loadingLabel = 'Loading models\u2026',
  selectPlaceholder = 'Select a model',
  selectModelAria = 'Select model',
  noModelsLabel = 'No compatible models',
  contextSize,
  onContextSizeChange,
  contextSizeLabel,
  contextSizeTooltip,
  infoSlot,
}: ModelPickerProps): React.ReactElement {
  const placeholder = getPlaceholder(isLoading, loadingLabel, selectPlaceholder);
  const isEmpty = models.length === 0 && !isLoading;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select value={activeModelId} onValueChange={onModelChange} disabled={isLoading}>
          <SelectTrigger
            id="model-select"
            className="w-full"
            aria-label={selectModelAria}
            aria-busy={isLoading}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {isEmpty && (
              <SelectItem value="__empty__" disabled>
                <span className="text-muted-foreground">{noModelsLabel}</span>
              </SelectItem>
            )}
            {models.map(renderModelItem)}
          </SelectContent>
        </Select>
        {infoSlot}
      </div>
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {renderContextSize(contextSize, onContextSizeChange, contextSizeLabel, contextSizeTooltip)}
    </div>
  );
}
