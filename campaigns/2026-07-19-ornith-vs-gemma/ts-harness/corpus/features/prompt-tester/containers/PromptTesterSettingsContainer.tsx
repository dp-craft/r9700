import type React from 'react';
import { useEffect } from 'react';

import type { FeatureFlagKey } from '@/domain/feature-flags';
import { useFeatureFlagStore } from '@/features/settings';
import { useTranslation } from '@/i18n';

import {
  type LabFlagViewModel,
  PromptTesterSettingsSection
} from '../components/PromptTesterSettingsSection';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';

const buildLabFlag = (
  key: FeatureFlagKey,
  enabled: boolean,
  t: (key: string) => string
): LabFlagViewModel => ({
  key,
  name: t(`featureFlags.${key}-name`),
  description: t(`featureFlags.${key}-description`),
  enabled,
});

export function PromptTesterSettingsContainer(): React.ReactElement {
  const t = useTranslation();
  const parallelismMode = usePromptTesterStore(s => s.parallelismMode);
  const setParallelismMode = usePromptTesterStore(s => s.setParallelismMode);
  const loadParallelRunsSettings = usePromptTesterStore(s => s.loadParallelRunsSettings);

  const perplexityEnabled = useFeatureFlagStore(s => s.flags['lab-perplexity-enabled']);
  const textAnalysisEnabled = useFeatureFlagStore(s => s.flags['lab-text-analysis-enabled']);
  const toggleFlag = useFeatureFlagStore(s => s.toggleFlag);

  // useEffect: store-load — hydrate prompt-lab concurrency settings

  useEffect(() => {
    void loadParallelRunsSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand action refs are stable; empty deps per UI.md store-load rule
  }, []);

  const flags: readonly LabFlagViewModel[] = [
    buildLabFlag('lab-perplexity-enabled', perplexityEnabled, t),
    buildLabFlag('lab-text-analysis-enabled', textAnalysisEnabled, t),
  ];

  const handleToggleFlag = (key: string): void => {
    void toggleFlag(key as FeatureFlagKey);
  };

  return (
    <PromptTesterSettingsSection
      parallelismMode={parallelismMode}
      onModeChange={setParallelismMode}
      flags={flags}
      onToggleFlag={handleToggleFlag}
      labels={{
        heading: t('lab.settings.title'),
        help: t('lab.settings.modeHelp'),
        sameModel: t('lab.settings.sameModel'),
        everything: t('lab.settings.everything'),
      }}
    />
  );
}
