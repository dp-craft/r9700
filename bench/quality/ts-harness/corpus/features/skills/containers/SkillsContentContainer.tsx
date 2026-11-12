import type * as React from 'react';
import { useEffect } from 'react';

import { useTranslation } from '@/i18n';

import { SkillsHeaderAction } from '../components/SkillsHeaderAction';
import { SkillsPage } from '../components/SkillsPage';
import { useSkillLabels } from '../hooks/useSkillLabels';
import { useSkillStore } from '../stores/useSkillStore';
import type { SkillsTab } from '../types';
import { ContainerEditorContainer } from './ContainerEditorContainer';
import { ContainerListContainer } from './ContainerListContainer';
import { SkillEditorContainer } from './SkillEditorContainer';
import { SkillListContainer } from './SkillListContainer';

const isValidTab = (value: string): value is SkillsTab =>
  value === 'skills' || value === 'containers';

export function SkillsContentContainer(): React.ReactElement {
  const activeTab = useSkillStore(s => s.activeTab);
  const setActiveTab = useSkillStore(s => s.setActiveTab);
  const selectSkill = useSkillStore(s => s.selectSkill);
  const selectContainer = useSkillStore(s => s.selectContainer);
  const selectedSkillId = useSkillStore(s => s.selectedSkillId);
  const selectedContainerId = useSkillStore(s => s.selectedContainerId);
  const labels = useSkillLabels();
  const t = useTranslation();

  // useEffect: store-load — loads skills + containers on mount
  useEffect(() => {
    void useSkillStore.getState().loadSkills();
    void useSkillStore.getState().loadContainers();
  }, []);

  const handleTabChange = (tab: string): void => {
    if (isValidTab(tab)) setActiveTab(tab);
  };

  const isSkillsTab = activeTab === 'skills';
  const listSlot = isSkillsTab ? <SkillListContainer /> : <ContainerListContainer />;
  const editorSlot = isSkillsTab ? (
    <SkillEditorContainer key={selectedSkillId ?? '__new'} />
  ) : (
    <ContainerEditorContainer key={selectedContainerId ?? '__new'} />
  );
  const headerActionSlot = isSkillsTab ? (
    <SkillsHeaderAction
      label={labels.newSkillLabel}
      ariaLabel={labels.newSkillAriaLabel}
      onClick={(): void => selectSkill(null)}
    />
  ) : (
    <SkillsHeaderAction
      label={labels.newContainerLabel}
      ariaLabel={labels.newContainerAriaLabel}
      onClick={(): void => selectContainer(null)}
    />
  );

  return (
    <SkillsPage
      activeTab={activeTab}
      onTabChange={handleTabChange}
      listSlot={listSlot}
      editorSlot={editorSlot}
      headerActionSlot={headerActionSlot}
      leftColumnAriaLabel={t('skills.layout.listAria')}
      rightColumnAriaLabel={t('skills.layout.editorAria')}
      labels={labels.skillsPage}
    />
  );
}
