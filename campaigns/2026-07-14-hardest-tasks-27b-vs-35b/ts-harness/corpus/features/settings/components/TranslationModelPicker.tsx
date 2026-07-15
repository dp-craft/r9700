import { Info } from 'lucide-react';
import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface TranslationModelOption {
  readonly id: string;
  readonly name: string;
  readonly sizeLabel: string;
}

export interface RecommendedModelInfo {
  readonly id: string;
  readonly name: string;
  readonly sizeLabel: string;
  readonly tier: 'lightweight' | 'balanced' | 'high-quality';
  readonly isDefault: boolean;
  readonly description: string;
}

export interface TranslationModelPickerProps {
  readonly models: readonly TranslationModelOption[];
  readonly selectedModelId: string;
  readonly onModelChange: (modelId: string) => void;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly recommendedModels: readonly RecommendedModelInfo[];
  readonly translationModelLabel: string;
  readonly recommendedLabel: string;
  readonly loadingText?: string;
  readonly placeholderText?: string;
  readonly defaultModelAria?: string;
  readonly className?: string;
}

const SELECT_ID = 'translation-model-select';
const LOADING_TEXT = 'Loading models\u2026';
const SELECT_PLACEHOLDER = 'Select a model';
const DEFAULT_MODEL_ARIA = 'Default model';
const DEFAULT_INDICATOR = '\u2605';

function formatOptionText(name: string, sizeLabel: string): string {
  return `${name} (${sizeLabel})`;
}

function getPlaceholder(isLoading: boolean, loadingText: string, placeholderText: string): string {
  return isLoading ? loadingText : placeholderText;
}

function hasError(error: string | null): boolean {
  return error !== null && error !== '';
}

function renderModelOption(model: TranslationModelOption): React.ReactElement {
  return (
    <SelectItem key={model.id} value={model.id}>
      {formatOptionText(model.name, model.sizeLabel)}
    </SelectItem>
  );
}

function renderRecommendedItemFactory(
  defaultModelAria: string
): (model: RecommendedModelInfo) => React.ReactElement {
  return (model: RecommendedModelInfo): React.ReactElement => (
    <li
      key={model.id}
      className="flex flex-col gap-0.5"
      data-default={model.isDefault ? '' : undefined}
    >
      <span className="flex items-center gap-2">
        <span className="text-foreground text-sm font-medium">{model.name}</span>
        <span className="text-muted-foreground text-xs">{model.sizeLabel}</span>
        {model.isDefault && (
          <Badge variant="secondary" aria-label={defaultModelAria}>
            {DEFAULT_INDICATOR}
          </Badge>
        )}
      </span>
      <span className="text-muted-foreground text-xs">{model.description}</span>
    </li>
  );
}

export function TranslationModelPicker({
  models,
  selectedModelId,
  onModelChange,
  isLoading,
  error,
  recommendedModels,
  translationModelLabel,
  recommendedLabel,
  loadingText = LOADING_TEXT,
  placeholderText = SELECT_PLACEHOLDER,
  defaultModelAria = DEFAULT_MODEL_ARIA,
  className,
}: TranslationModelPickerProps): React.ReactElement {
  const renderRecommendedItem = renderRecommendedItemFactory(defaultModelAria);
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={SELECT_ID}>{translationModelLabel}</Label>
          {recommendedModels.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={recommendedLabel}
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs p-3">
                  <p className="mb-2 text-sm font-medium">{recommendedLabel}</p>
                  <ul className="flex flex-col gap-2" aria-label={recommendedLabel}>
                    {recommendedModels.map(renderRecommendedItem)}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <Select value={selectedModelId} onValueChange={onModelChange} disabled={isLoading}>
          <SelectTrigger
            id={SELECT_ID}
            className="w-full"
            aria-label={translationModelLabel}
            aria-busy={isLoading}
          >
            <SelectValue placeholder={getPlaceholder(isLoading, loadingText, placeholderText)} />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {models.map(renderModelOption)}
          </SelectContent>
        </Select>
      </div>

      {hasError(error) && (
        <div role="alert" className="text-destructive text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
