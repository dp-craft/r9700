import { Bot, Info } from 'lucide-react';
import type * as React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { formatPricing } from '@/lib/model-format';
import { cn } from '@/lib/utils';

export interface ChatModelChooserProvider {
  readonly id: string;
  readonly name: string;
}

export interface ChatModelChooserModel {
  readonly id: string;
  readonly name: string;
  readonly pricing?: {
    readonly promptPrice: number;
    readonly completionPrice: number;
  };
}

export interface ChatModelChooserProps {
  readonly providers: readonly ChatModelChooserProvider[];
  readonly activeProviderId: string;
  readonly onProviderChange: (providerId: string) => void;
  readonly models: readonly ChatModelChooserModel[];
  readonly activeModelId: string;
  readonly onModelChange: (modelId: string) => void;
  readonly isLoadingModels: boolean;
  readonly modelLoadError?: boolean;
  readonly onRetryModels?: () => void;
  readonly className?: string;
  readonly providerLabel?: string;
  readonly modelLabel?: string;
  readonly modelCardTitle?: string;
  readonly emptyProviderText?: string;
  readonly loadingModelsText?: string;
  readonly noModelsText?: string;
  readonly modelLoadErrorText?: string;
  readonly retryText?: string;
  readonly onInfoClick?: () => void;
  readonly infoLabel?: string;
  readonly badgesSlot?: React.ReactNode;
  readonly webSearchSlot?: React.ReactNode;
  readonly paramsSlot?: React.ReactNode;
  readonly modelDetailsSlot?: React.ReactNode;
  readonly onAddProviderClick?: () => void;
  readonly addProviderText?: string;
}

const PROVIDER_LABEL = 'Select provider';
const MODEL_LABEL = 'Select model';
const MODEL_CARD_TITLE = 'Model';
const ADD_PROVIDER_TEXT = 'Add provider →';
const EMPTY_PROVIDER_TEXT = 'Configure a provider';
const LOADING_MODELS_TEXT = 'Loading models...';
const NO_MODELS_TEXT = 'No models';
const MODEL_LOAD_ERROR_TEXT = 'Connection failed';
const RETRY_TEXT = 'Retry';

const CARD_CHROME = 'rounded-frame border border-line bg-panel shadow-sm';
// Equal, fixed-height boxes (NEW:chat.model-chooser-box-design): both the model
// and skill-pack boxes share identical fixed height, reduced inner padding, and a
// min-width 1.5× the prior 200px content minimum.
const CARD_SIZING = 'flex h-[88px] min-w-[300px] flex-col p-2';

function findName(
  items: readonly { readonly id: string; readonly name: string }[],
  activeId: string
): string | undefined {
  const match = items.find(item => item.id === activeId);
  return match?.name;
}

function getModelPlaceholder(
  isLoading: boolean,
  models: readonly ChatModelChooserModel[],
  activeModelId: string,
  loadingText: string,
  noModelsText: string
): string {
  if (isLoading) return loadingText;
  if (models.length === 0) return noModelsText;
  return findName(models, activeModelId) ?? '';
}

function isModelDisabled(isLoadingModels: boolean): boolean {
  return isLoadingModels;
}

function renderProviderItem(provider: ChatModelChooserProvider): React.ReactElement {
  return (
    <SelectItem key={provider.id} value={provider.id}>
      {provider.name}
    </SelectItem>
  );
}

function renderModelItem(model: ChatModelChooserModel): React.ReactElement {
  const pricing = formatPricing(model.pricing);
  if (pricing === null) {
    return (
      <SelectItem key={model.id} value={model.id}>
        {model.name}
      </SelectItem>
    );
  }
  return (
    <SelectItem key={model.id} value={model.id}>
      <div className="flex flex-col gap-0.5 py-0.5">
        <span>{model.name}</span>
        <span className="text-muted-foreground text-[11px] leading-tight">{pricing}</span>
      </div>
    </SelectItem>
  );
}

export function ChatModelChooser({
  providers,
  activeProviderId,
  onProviderChange,
  models,
  activeModelId,
  onModelChange,
  isLoadingModels,
  modelLoadError = false,
  onRetryModels,
  className,
  providerLabel = PROVIDER_LABEL,
  modelLabel = MODEL_LABEL,
  modelCardTitle = MODEL_CARD_TITLE,
  emptyProviderText = EMPTY_PROVIDER_TEXT,
  loadingModelsText = LOADING_MODELS_TEXT,
  noModelsText = NO_MODELS_TEXT,
  modelLoadErrorText = MODEL_LOAD_ERROR_TEXT,
  retryText = RETRY_TEXT,
  onInfoClick,
  infoLabel = 'Model info',
  badgesSlot,
  webSearchSlot,
  paramsSlot,
  modelDetailsSlot,
  onAddProviderClick,
  addProviderText = ADD_PROVIDER_TEXT,
}: ChatModelChooserProps): React.ReactElement {
  const hasProviders = providers.length > 0;
  const hasModels = models.length > 0;
  const providerPlaceholder = findName(providers, activeProviderId) ?? '';
  const modelPlaceholder = getModelPlaceholder(
    isLoadingModels,
    models,
    activeModelId,
    loadingModelsText,
    noModelsText
  );
  const modelDisabled = isModelDisabled(isLoadingModels);
  const showModelSelect = hasModels || isLoadingModels;

  const renderEmptyProviders = (): React.ReactElement => {
    if (onAddProviderClick) {
      return (
        <button
          type="button"
          onClick={onAddProviderClick}
          className="text-accent inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          {addProviderText}
        </button>
      );
    }
    return <p className="text-muted-foreground text-sm">{emptyProviderText}</p>;
  };

  return (
    <div className={cn(CARD_CHROME, CARD_SIZING, className)}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Bot className="text-muted-foreground h-3 w-3" aria-hidden="true" />
        <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {modelCardTitle}
        </span>
        {onInfoClick ? (
          <button
            type="button"
            onClick={onInfoClick}
            aria-label={infoLabel}
            className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center justify-center rounded-md p-0.5 transition-colors"
          >
            <Info className="h-3 w-3" />
          </button>
        ) : null}
        {paramsSlot}
        {modelDetailsSlot}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {hasProviders ? (
          <Select value={activeProviderId} onValueChange={onProviderChange}>
            <SelectTrigger
              aria-label={providerLabel}
              className="bg-background/60 h-8 border px-2 text-sm backdrop-blur-sm"
            >
              <SelectValue placeholder={providerPlaceholder} />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {providers.map(renderProviderItem)}
            </SelectContent>
          </Select>
        ) : (
          renderEmptyProviders()
        )}

        {showModelSelect ? (
          <Select value={activeModelId} onValueChange={onModelChange} disabled={modelDisabled}>
            <SelectTrigger
              aria-label={modelLabel}
              disabled={modelDisabled}
              className="bg-background/60 h-8 border px-2 text-sm backdrop-blur-sm"
            >
              <SelectValue placeholder={modelPlaceholder} />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {models.map(renderModelItem)}
            </SelectContent>
          </Select>
        ) : modelLoadError ? (
          <div className="flex items-center gap-1.5">
            <p className="text-destructive text-sm">{modelLoadErrorText}</p>
            {onRetryModels ? (
              <button
                type="button"
                onClick={onRetryModels}
                className="text-muted-foreground hover:text-foreground text-xs underline"
              >
                {retryText}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{noModelsText}</p>
        )}

        {badgesSlot}
        {webSearchSlot}
      </div>
    </div>
  );
}
