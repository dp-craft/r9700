import type * as React from 'react';
import { useMemo } from 'react';

import { useTranslation } from '@/i18n';
import { getVisibleProviderOrder, PROVIDER_META } from '@/services/llm/provider-meta';

import type { Provider } from '../components/ProviderSelector';
import { ProviderSelector } from '../components/ProviderSelector';
import { useFeatureFlagStore } from '../stores/useFeatureFlagStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { ProviderFormContainer } from './ProviderFormContainer';

export function ProviderSelectorContainer(): React.ReactElement {
  const t = useTranslation();
  const activeProviderId = useSettingsStore(s => s.activeProviderId);
  const setActiveProvider = useSettingsStore(s => s.setActiveProvider);
  const showCorsProviders = useFeatureFlagStore(s => s.flags['show-cors-providers']);

  const providers = useMemo<readonly Provider[]>(
    () =>
      getVisibleProviderOrder(showCorsProviders).map(key => ({
        id: key,
        label: PROVIDER_META[key].name,
      })),
    [showCorsProviders]
  );

  return (
    <ProviderSelector
      providers={providers}
      activeProviderId={activeProviderId}
      onProviderChange={setActiveProvider}
      selectProviderAria={t('settings.selectProvider')}
      providerForm={<ProviderFormContainer key={activeProviderId} providerId={activeProviderId} />}
    />
  );
}
