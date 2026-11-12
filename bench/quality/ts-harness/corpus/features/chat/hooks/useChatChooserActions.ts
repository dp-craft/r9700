import { useCallback } from 'react';

import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { useUIStore } from '@/stores/useUIStore';

export interface ChatChooserActions {
  readonly onProviderChange: (providerId: string) => void;
  readonly onModelChange: (modelId: string) => void;
  readonly onWebSearchToggle: (enabled: boolean) => void;
  readonly onInfoClick: () => void;
  readonly onAddProvider: () => void;
  readonly onInfoOpenChange: (open: boolean) => void;
}

export function useChatChooserActions(activeSessionId: string | null): ChatChooserActions {
  const setSessionModel = useSessionStore(s => s.setSessionModel);
  const setSessionProviderAndModel = useSessionStore(s => s.setSessionProviderAndModel);
  const setSessionWebSearch = useSessionStore(s => s.setSessionWebSearch);
  const providerConfigs = useSettingsStore(s => s.providerConfigs);
  const openDialog = useUIStore(s => s.openDialog);
  const closeDialog = useUIStore(s => s.closeDialog);

  const onProviderChange = useCallback(
    (providerId: string): void => {
      if (!activeSessionId) return;
      void setSessionProviderAndModel(
        activeSessionId,
        providerId,
        providerConfigs[providerId]?.selectedModel ?? ''
      );
    },
    [activeSessionId, setSessionProviderAndModel, providerConfigs]
  );

  const onModelChange = useCallback(
    (modelId: string): void => {
      if (activeSessionId) void setSessionModel(activeSessionId, modelId);
    },
    [activeSessionId, setSessionModel]
  );

  const onWebSearchToggle = useCallback(
    (enabled: boolean): void => {
      if (activeSessionId) void setSessionWebSearch(activeSessionId, enabled);
    },
    [activeSessionId, setSessionWebSearch]
  );

  const onInfoClick = useCallback((): void => openDialog('model-info'), [openDialog]);

  const onAddProvider = useCallback(
    (): void => openDialog('settings', { section: 'api-models' }),
    [openDialog]
  );

  const onInfoOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) closeDialog();
    },
    [closeDialog]
  );

  return {
    onProviderChange,
    onModelChange,
    onWebSearchToggle,
    onInfoClick,
    onAddProvider,
    onInfoOpenChange,
  };
}
