import type React from 'react';
import { useEffect } from 'react';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTranslation } from '@/i18n';

import { LeftColumn } from '../components/LeftColumn';
import { useLeftColumnSections } from '../hooks/useLeftColumnSections';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';

const DESKTOP_QUERY = '(min-width: 1024px)';

export function LeftColumnContainer(): React.ReactElement {
  const loadSectionCollapse = usePromptTesterStore(s => s.loadSectionCollapse);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const t = useTranslation();

  // useEffect: store-load — section collapse hydration
  useEffect(() => {
    loadSectionCollapse();
  }, [loadSectionCollapse]);

  const { modellekSection, systemSkillSection, userPromptSection, runBar } =
    useLeftColumnSections();

  return (
    <LeftColumn
      isDesktop={isDesktop}
      modellekSection={modellekSection}
      systemSkillSection={systemSkillSection}
      userPromptSection={userPromptSection}
      runBar={runBar}
      desktopOnlyLabel={t('lab.desktopOnly')}
    />
  );
}
