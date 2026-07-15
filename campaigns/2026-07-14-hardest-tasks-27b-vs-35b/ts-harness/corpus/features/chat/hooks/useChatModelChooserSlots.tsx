import type { ReactNode } from 'react';

import { ModelMetadataPopover } from '@/features/settings';
import { useTranslation } from '@/i18n';
import { formatContextLength, formatPricing, getNonTextModalities } from '@/lib/model-format';
import type { Model } from '@/services/llm/types';

import { ModelBadges } from '../components/ModelBadges';
import { WebSearchToggle } from '../components/WebSearchToggle';
import { ModelParamsPopoverContainer } from '../containers/ModelParamsPopoverContainer';
import { useChatModelDetails } from './useChatModelDetails';

export interface ChatModelChooserLabels {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly emptyProviderText: string;
  readonly loadingModelsText: string;
  readonly noModelsText: string;
  readonly modelLoadErrorText: string;
  readonly retryText: string;
  readonly infoLabel: string;
  readonly modelCardTitle: string;
  readonly addProviderText: string;
}

export interface ChatModelChooserSlots {
  readonly badgesSlot?: ReactNode;
  readonly paramsSlot?: ReactNode;
  readonly modelDetailsSlot?: ReactNode;
  readonly webSearchSlot?: ReactNode;
  readonly labels: ChatModelChooserLabels;
}

export interface ChatModelChooserSlotsInput {
  readonly activeModel: Model | undefined;
  readonly thinkingEnabled?: boolean;
  readonly webSearchVisible: boolean;
  readonly webSearchEnabled: boolean;
  readonly onWebSearchToggle: (enabled: boolean) => void;
  readonly onViewJson: () => void;
}

export function useChatModelChooserSlots({
  activeModel,
  thinkingEnabled,
  webSearchVisible,
  webSearchEnabled,
  onWebSearchToggle,
  onViewJson,
}: ChatModelChooserSlotsInput): ChatModelChooserSlots {
  const t = useTranslation();
  const modelDetails = useChatModelDetails(activeModel);

  const badgesSlot = activeModel ? (
    <ModelBadges
      contextLength={formatContextLength(activeModel.contextLength)}
      pricing={formatPricing(activeModel.pricing)}
      modalities={getNonTextModalities(activeModel)}
      supportsThinking={activeModel.supportsThinking}
      thinkingEnabled={thinkingEnabled}
    />
  ) : undefined;

  const paramsSlot = activeModel ? (
    <ModelParamsPopoverContainer supportsThinking={activeModel.supportsThinking === true} />
  ) : undefined;

  const modelDetailsSlot = activeModel ? (
    <ModelMetadataPopover
      title={modelDetails.title}
      rows={modelDetails.rows}
      triggerLabel={modelDetails.triggerLabel}
      triggerTestId="chat-model-details"
      supportsThinking={modelDetails.supportsThinking}
      thinkingEnabled={modelDetails.thinkingEnabled}
      onThinkingToggle={modelDetails.onThinkingToggle}
      onViewJson={onViewJson}
      thinkingLabel={modelDetails.thinkingLabel}
      jsonLabel={modelDetails.jsonLabel}
    />
  ) : undefined;

  const webSearchSlot = webSearchVisible ? (
    <WebSearchToggle
      enabled={webSearchEnabled}
      onToggle={onWebSearchToggle}
      visible
      tooltipText={t('chat.webSearchTooltip')}
      ariaLabel={t('chat.toggleWebSearch')}
    />
  ) : undefined;

  const labels: ChatModelChooserLabels = {
    providerLabel: t('chat.selectProvider'),
    modelLabel: t('chat.selectModel'),
    emptyProviderText: t('chat.configureProvider'),
    loadingModelsText: t('chat.loadingModels'),
    noModelsText: t('chat.noModels'),
    modelLoadErrorText: t('chat.modelLoadError'),
    retryText: t('chat.retry'),
    infoLabel: t('chat.modelInfo'),
    modelCardTitle: t('chat.header.model'),
    addProviderText: t('chat.header.addProvider'),
  };

  return { badgesSlot, paramsSlot, modelDetailsSlot, webSearchSlot, labels };
}
