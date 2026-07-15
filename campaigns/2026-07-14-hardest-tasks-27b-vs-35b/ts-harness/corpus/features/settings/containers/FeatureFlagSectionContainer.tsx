import { type ReactElement, useMemo } from 'react';

import type { FeatureFlagKey } from '@/domain/feature-flags';
import { FEATURE_FLAG_REGISTRY } from '@/domain/feature-flags';
import { useTranslation } from '@/i18n';
import { isElectron } from '@/lib/platform';

import type { FeatureFlagViewModel } from '../components/FeatureFlagSection';
import { FeatureFlagSection } from '../components/FeatureFlagSection';
import { useCorsProviderFallback } from '../hooks/useCorsProviderFallback';
import { useFeatureFlagStore } from '../stores/useFeatureFlagStore';

const ELECTRON_HIDDEN_FLAGS: ReadonlySet<FeatureFlagKey> = new Set(['show-cors-providers']);

const RELOCATED_LAB_FLAGS: ReadonlySet<FeatureFlagKey> = new Set([
  'lab-perplexity-enabled',
  'lab-text-analysis-enabled',
]);

function buildFlagViewModels(
  flags: Readonly<Record<FeatureFlagKey, boolean>>,
  t: (key: string) => string,
  hideFlags: ReadonlySet<FeatureFlagKey>
): readonly FeatureFlagViewModel[] {
  return Object.values(FEATURE_FLAG_REGISTRY)
    .filter(def => !hideFlags.has(def.key))
    .map(def => ({
      key: def.key,
      name: t(`featureFlags.${def.key}-name`),
      description: t(`featureFlags.${def.key}-description`),
      enabled: flags[def.key],
    }));
}

export function FeatureFlagSectionContainer(): ReactElement {
  const flags = useFeatureFlagStore(s => s.flags);
  const toggleFlag = useFeatureFlagStore(s => s.toggleFlag);
  const t = useTranslation();
  useCorsProviderFallback();

  const hiddenFlags = useMemo(
    (): ReadonlySet<FeatureFlagKey> =>
      new Set<FeatureFlagKey>([
        ...(isElectron() ? ELECTRON_HIDDEN_FLAGS : []),
        ...RELOCATED_LAB_FLAGS,
      ]),
    []
  );
  const flagViewModels = useMemo(
    () => buildFlagViewModels(flags, t, hiddenFlags),
    [flags, t, hiddenFlags]
  );

  const handleToggle = (key: string): void => {
    void toggleFlag(key as FeatureFlagKey);
  };

  return (
    <FeatureFlagSection
      flags={flagViewModels}
      onToggle={handleToggle}
      heading={t('featureFlags.sectionHeading')}
    />
  );
}
