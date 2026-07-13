import { WifiOff } from 'lucide-react';
import type * as React from 'react';
import { useEffect } from 'react';

import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/sonner';
import { runV5Migration } from '@/db/migrations';
import { seedBuiltinSkills } from '@/db/skills';
import { UnlockModalContainer, useFeatureFlagStore, useSettingsStore } from '@/features/settings';
import { useSkillStore } from '@/features/skills';
import { TutorialContainer, useTutorialStore } from '@/features/tutorial';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTranslation } from '@/i18n';
import { ShellLayout } from '@/shell';
import { useUIStore } from '@/stores/useUIStore';

function App(): React.ReactElement {
  const isOnline = useOnlineStatus();
  const t = useTranslation();
  // useEffect: store-load — one-time app bootstrap: v5 migration + hydrate stores + DEV-only deep-link hook
  useEffect(() => {
    void runV5Migration().then(() => {
      void useSettingsStore.getState().loadAppSettings();
      void useTutorialStore.getState().loadTutorialProgress();
    });
    void useSettingsStore
      .getState()
      .loadEncryptionMetadata()
      .then(() => useSettingsStore.getState().loadProviderConfigs());
    void useFeatureFlagStore.getState().loadFeatureFlags();
    void useSkillStore.getState().loadContainers();
    void seedBuiltinSkills().then(() => {
      void useSkillStore.getState().loadSkills();
    });
    if (import.meta.env.DEV) {
      (
        window as unknown as {
          __uiStore?: { openDialog: ReturnType<typeof useUIStore.getState>['openDialog'] };
        }
      ).__uiStore = { openDialog: useUIStore.getState().openDialog };
    }
  }, []);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      {!isOnline && (
        <div className="border-border bg-muted/50 flex items-center justify-center gap-2 border-b px-4 py-2">
          <Badge variant="outline" className="gap-1.5">
            <WifiOff className="h-3.5 w-3.5" />
            <span>{t('common.offline')}</span>
          </Badge>
          <span className="text-muted-foreground text-sm">{t('common.offlineMessage')}</span>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <ShellLayout />
      </div>
      <UnlockModalContainer />
      <TutorialContainer />
      <Toaster />
    </div>
  );
}

export default App;
