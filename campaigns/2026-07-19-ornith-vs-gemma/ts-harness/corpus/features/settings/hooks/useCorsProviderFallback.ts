import { useEffect } from 'react';

import { getVisibleProviderOrder } from '@/services/llm/provider-meta';
import type { ProviderKey } from '@/services/llm/types';

import { useFeatureFlagStore } from '../stores/useFeatureFlagStore';
import { DEFAULT_PROVIDER_ID, useSettingsStore } from '../stores/useSettingsStore';

function applyFallbackIfNeeded(): void {
  const { activeProviderId, setActiveProvider, setActiveModel } = useSettingsStore.getState();
  const visibleProviders = getVisibleProviderOrder(false);
  if (!visibleProviders.includes(activeProviderId as ProviderKey)) {
    setActiveProvider(DEFAULT_PROVIDER_ID);
    setActiveModel('');
  }
}

export function useCorsProviderFallback(): void {
  // useEffect: subscribe — feature flag store observer for CORS provider fallback
  useEffect(() => {
    const unsubscribe = useFeatureFlagStore.subscribe((state, prevState) => {
      const wasEnabled = prevState.flags['show-cors-providers'];
      const isDisabled = !state.flags['show-cors-providers'];
      if (wasEnabled && isDisabled) {
        applyFallbackIfNeeded();
      }
    });
    return unsubscribe;
  }, []);
}
