import type * as React from 'react';

import { useSessionStore } from '@/features/sessions';
import { useFeatureFlagStore, useSettingsStore } from '@/features/settings';
import { PROVIDER_META } from '@/services/llm/provider-meta';
import type { ProviderKey } from '@/services/llm/types';
import { useUIStore } from '@/stores/useUIStore';

import { ChatModelChooser } from '../components/ChatModelChooser';
import { useChatChooserActions } from '../hooks/useChatChooserActions';
import { useChatModelChooserSlots } from '../hooks/useChatModelChooserSlots';
import { useChatModelList } from '../hooks/useChatModelList';
import { buildConfiguredProviders } from '../lib/buildConfiguredProviders';
import { ModelInfoContainer } from './ModelInfoContainer';

export function ChatModelChooserContainer(): React.ReactElement {
  const activeSessionId = useSessionStore(s => s.activeSessionId);
  const sessionList = useSessionStore(s => s.sessionList);
  const providerConfigs = useSettingsStore(s => s.providerConfigs);
  const showCorsProviders = useFeatureFlagStore(s => s.flags['show-cors-providers']);
  const webSearchFlagOn = useFeatureFlagStore(s => s.flags['web-search-enabled']);
  const infoOpen = useUIStore(s => s.activeDialog === 'model-info');

  const activeSession = sessionList.find(s => s.id === activeSessionId);
  const sessionProviderId = activeSession?.providerId ?? '';
  const sessionModelId = activeSession?.model ?? '';

  const { models, isLoadingModels, modelLoadError, reload } = useChatModelList(
    sessionProviderId,
    sessionModelId
  );
  const configuredProviders = buildConfiguredProviders(showCorsProviders, providerConfigs);
  const activeModel = models.find(m => m.id === sessionModelId);

  const providerSearchSupport =
    PROVIDER_META[sessionProviderId as ProviderKey]?.searchSupport ?? 'none';
  const webSearchVisible = webSearchFlagOn && providerSearchSupport !== 'none';

  const actions = useChatChooserActions(activeSessionId);

  const slots = useChatModelChooserSlots({
    activeModel,
    thinkingEnabled: activeSession?.modelParams?.thinkingEnabled,
    webSearchVisible,
    webSearchEnabled: activeSession?.webSearchEnabled === true,
    onWebSearchToggle: actions.onWebSearchToggle,
    onViewJson: actions.onInfoClick,
  });

  return (
    <>
      <ChatModelChooser
        providers={configuredProviders}
        activeProviderId={sessionProviderId}
        onProviderChange={actions.onProviderChange}
        models={models}
        activeModelId={sessionModelId}
        onModelChange={actions.onModelChange}
        isLoadingModels={isLoadingModels}
        modelLoadError={modelLoadError}
        onRetryModels={reload}
        onInfoClick={actions.onInfoClick}
        onAddProviderClick={actions.onAddProvider}
        badgesSlot={slots.badgesSlot}
        webSearchSlot={slots.webSearchSlot}
        paramsSlot={slots.paramsSlot}
        modelDetailsSlot={slots.modelDetailsSlot}
        {...slots.labels}
      />
      <ModelInfoContainer open={infoOpen} onOpenChange={actions.onInfoOpenChange} />
    </>
  );
}
