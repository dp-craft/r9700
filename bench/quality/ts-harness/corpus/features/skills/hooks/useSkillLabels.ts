import { useMemo } from 'react';

import { useTranslation } from '@/i18n';

import type { CanonicalOrderInfoLabels } from '../components/CanonicalOrderInfo';
import type { ContainerEditorLabels } from '../components/ContainerEditor';
import type { ContainerListLabels } from '../components/ContainerList';
import type { PromptPreviewLabels } from '../components/PromptPreview';
import type { SessionSkillIndicatorLabels } from '../components/SessionSkillIndicator';
import type { SkillEditorLabels } from '../components/SkillEditor';
import type { SkillListLabels } from '../components/SkillList';
import type { SkillsPageLabels } from '../components/SkillsPage';
import type { SortableSkillItemLabels } from '../components/SortableSkillItem';
import type { TokenCounterLabels } from '../components/TokenCounter';

export interface SkillLabels {
  readonly skillsPage: SkillsPageLabels;
  readonly skillList: SkillListLabels;
  readonly skillEditor: SkillEditorLabels;
  readonly containerList: ContainerListLabels;
  readonly containerEditor: ContainerEditorLabels;
  readonly sessionSkillIndicator: SessionSkillIndicatorLabels;
  readonly sortableSkillItem: SortableSkillItemLabels;
  readonly canonicalOrderInfo: CanonicalOrderInfoLabels;
  readonly promptPreview: PromptPreviewLabels;
  readonly tokenCounter: TokenCounterLabels;
  readonly newSkillLabel: string;
  readonly newSkillAriaLabel: string;
  readonly newContainerLabel: string;
  readonly newContainerAriaLabel: string;
}

export function useSkillLabels(): SkillLabels {
  const t = useTranslation();

  return useMemo(
    (): SkillLabels => ({
      skillsPage: {
        tabContainersLabel: t('skills.tabContainers'),
        tabSkillsLabel: t('skills.tabSkills'),
      },
      skillList: {
        listAriaLabel: t('skills.skillsList'),
        selectSkillAriaPrefix: t('skills.selectSkill', { name: '' }).replace(/\s*$/, ''),
        builtinBadgeLabel: t('skills.builtinBadge'),
        uncategorizedBadgeLabel: t('skills.uncategorizedBadge'),
      },
      skillEditor: {
        emptyStateMessage: t('skills.editorEmpty'),
        uncategorizedWarning: t('skills.uncategorizedWarning'),
        fieldNameLabel: t('skills.fieldName'),
        fieldDescriptionLabel: t('skills.fieldDescription'),
        fieldDescriptionPlaceholder: t('skills.fieldDescriptionPlaceholder'),
        fieldPromptLabel: t('skills.fieldPrompt'),
        fieldCommandPrefixLabel: t('skills.fieldCommandPrefix'),
        fieldCategoryLabel: t('skills.fieldCategory'),
        categoryNoneLabel: t('skills.categoryNone'),
        categoryPersonaLabel: t('skills.categoryPersona'),
        categoryContextLabel: t('skills.categoryContext'),
        categoryConstraintsLabel: t('skills.categoryConstraints'),
        categoryFormatLabel: t('skills.categoryFormat'),
        categoryExamplesLabel: t('skills.categoryExamples'),
        saveLabel: t('common.save'),
        createLabel: t('common.create'),
        deleteLabel: t('common.delete'),
        duplicateLabel: t('skills.duplicate'),
        cancelLabel: t('common.cancel'),
        actionsAriaLabel: t('skills.skillActions'),
      },
      containerList: {
        listAriaLabel: t('skills.containersList'),
        selectContainerAriaPrefix: t('skills.selectContainer', { name: '' }).replace(/\s*$/, ''),
        skillCountSingularLabel: t('skills.skillCountSingular'),
        skillCountPluralLabel: t('skills.skillCountPlural', { count: '{{count}}' }),
      },
      containerEditor: {
        fieldNameLabel: t('skills.containerFieldName'),
        fieldSkillsLabel: t('skills.containerFieldSkills'),
        autoSortLabel: t('skills.autoSort'),
        addSkillPlaceholder: t('skills.addSkillPlaceholder'),
        addSkillAriaLabel: t('skills.addSkillAria'),
        tokenCountSuffix: t('skills.tokenCount', { count: '{{count}}' }),
        softLimitWarning: t('skills.tokenLimitWarning'),
        hardLimitError: t('skills.tokenLimitError'),
        actionsAriaLabel: t('skills.containerActions'),
        saveLabel: t('common.save'),
        createLabel: t('common.create'),
        cancelLabel: t('common.cancel'),
        deleteLabel: t('common.delete'),
      },
      sessionSkillIndicator: {
        skillSetLabel: t('skills.skillSetLabel'),
        changeAriaLabel: t('skills.changeSkillSet'),
        selectSkillSetLabel: t('skills.selectSkillSet'),
        noSkillsInContainerLabel: t('skills.noSkillsInContainer'),
        noSkillsActiveLabel: t('skills.noSkillsActive'),
        noSkillsOptionLabel: t('skills.noSkillsOption'),
        approximateTokenCountSuffix: t('skills.approximateTokenCount', { count: '{{count}}' }),
        skillCountSingularLabel: t('skills.skillCountSingular'),
        skillCountPluralLabel: t('skills.skillCountPlural', { count: '{{count}}' }),
        packagesSectionLabel: t('skills.packagesSection'),
        individualSkillsSectionLabel: t('skills.individualSkillsSection'),
      },
      sortableSkillItem: {
        dragToReorderAriaLabel: t('skills.dragToReorder'),
        removeAriaLabel: t('skills.remove'),
      },
      canonicalOrderInfo: {
        buttonAriaLabel: t('skills.orderInfoButton'),
        dialogTitle: t('skills.orderInfoTitle'),
        dialogDescription: t('skills.orderInfoDescription'),
        layersAriaLabel: t('skills.orderInfoLayersAria'),
        layerPersonaName: t('skills.layerPersonaName'),
        layerPersonaDescription: t('skills.layerPersonaDescription'),
        layerContextName: t('skills.layerContextName'),
        layerContextDescription: t('skills.layerContextDescription'),
        layerConstraintsName: t('skills.layerConstraintsName'),
        layerConstraintsDescription: t('skills.layerConstraintsDescription'),
        layerFormatName: t('skills.layerFormatName'),
        layerFormatDescription: t('skills.layerFormatDescription'),
        layerExamplesName: t('skills.layerExamplesName'),
        layerExamplesDescription: t('skills.layerExamplesDescription'),
      },
      promptPreview: {
        ariaLabel: t('skills.promptPreview'),
      },
      tokenCounter: {
        approximateTokenCountSuffix: t('skills.approximateTokenCount', { count: '{{count}}' }),
      },
      newSkillLabel: t('skills.newSkill'),
      newSkillAriaLabel: t('skills.newSkill'),
      newContainerLabel: t('skills.newContainer'),
      newContainerAriaLabel: t('skills.newContainer'),
    }),
    [t]
  );
}
