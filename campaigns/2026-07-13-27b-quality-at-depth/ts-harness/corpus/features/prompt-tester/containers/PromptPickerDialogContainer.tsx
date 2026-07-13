import { type ReactElement, useState } from 'react';

import type { AtomicSkillDTO, SkillContainerDTO } from '@/db/idb';
import { useSkillStore } from '@/features/skills';
import { useTranslation } from '@/i18n';
import type { TranslationFunction } from '@/i18n/types';
import { composePrompt } from '@/lib/prompt-composer';

import type { PickerListItem } from '../components/PickerListSlot';
import { PickerListSlot, truncateText } from '../components/PickerListSlot';
import {
  PromptPickerDialog,
  type PromptPickerDialogLabels
} from '../components/PromptPickerDialog';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';

const toSkillItems = (skills: readonly AtomicSkillDTO[]): readonly PickerListItem[] =>
  skills.map(s => ({ id: s.id, primary: s.name, secondary: truncateText(s.prompt) }));

const toPackageItems = (
  containers: readonly SkillContainerDTO[],
  countLabel: string
): readonly PickerListItem[] =>
  containers.map(c => ({
    id: c.id,
    primary: c.name,
    secondary: `${c.skillIds.length} ${countLabel}`,
  }));

const toHistoryItems = (
  entries: readonly { readonly id: string; readonly text: string }[]
): readonly PickerListItem[] =>
  entries.map(e => ({ id: e.id, primary: truncateText(e.text), secondary: '' }));

const resolveContainerPrompt = (
  id: string,
  containers: readonly SkillContainerDTO[],
  skills: readonly AtomicSkillDTO[]
): string => {
  const container = containers.find(c => c.id === id);
  const resolved = container
    ? container.skillIds
        .map(sid => skills.find(s => s.id === sid))
        .filter((s): s is AtomicSkillDTO => s !== undefined)
    : [];
  return composePrompt(resolved).text;
};

const buildLabels = (t: TranslationFunction): PromptPickerDialogLabels => ({
  title: t('lab.promptPicker.title'),
  tabSkills: t('lab.promptPicker.tabSkills'),
  tabPackages: t('lab.promptPicker.tabPackages'),
  tabHistory: t('lab.promptPicker.tabHistory'),
  tabBlank: t('lab.promptPicker.tabBlank'),
  confirmBlank: t('lab.promptPicker.confirmBlank'),
  blankPlaceholder: t('lab.promptPicker.blankPlaceholder'),
  blankTextareaLabel: t('lab.promptPicker.blankTextareaLabel'),
});

export function PromptPickerDialogContainer(): ReactElement | null {
  const t = useTranslation();
  const pickerOpen = usePromptTesterStore(s => s.pickerOpen);
  const closePicker = usePromptTesterStore(s => s.closePicker);
  const addSystemPrompt = usePromptTesterStore(s => s.addSystemPromptToActiveRun);
  const activeTab = usePromptTesterStore(s => s.pickerActiveTab);
  const setActiveTab = usePromptTesterStore(s => s.setPickerActiveTab);
  const historyEntries = usePromptTesterStore(s => s.pickerHistoryEntries);
  const skills = useSkillStore(s => s.skills);
  const containers = useSkillStore(s => s.containers);
  const [customPrompt, setCustomPrompt] = useState<string>('');

  const closeAndReset = (): void => {
    setCustomPrompt('');
    closePicker();
  };
  const handleOpenChange = (open: boolean): void => {
    if (!open) closeAndReset();
  };
  const handleSkillClick = (id: string): void => {
    const skill = skills.find(s => s.id === id);
    if (!skill) return;
    addSystemPrompt({ kind: 'skill', skillId: skill.id, name: skill.name, prompt: skill.prompt });
    closePicker();
  };

  const handleHistoryClick = (id: string): void => {
    const entry = historyEntries.find(e => e.id === id);
    if (!entry) return;
    addSystemPrompt({ kind: 'history', runId: entry.id, prompt: entry.text });
    closePicker();
  };

  const handlePackageClick = (containerId: string): void => {
    addSystemPrompt({
      kind: 'container',
      containerId,
      prompt: resolveContainerPrompt(containerId, containers, skills),
    });
    closePicker();
  };

  const handleConfirmBlank = (): void => {
    addSystemPrompt({ kind: 'blank', prompt: customPrompt.trim() });
    closeAndReset();
  };

  return (
    <PromptPickerDialog
      open={pickerOpen}
      onOpenChange={handleOpenChange}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      skillsSlot={(
        <PickerListSlot
          items={toSkillItems(skills)}
          emptyText={t('lab.promptPicker.skillsEmpty')}
          onItemClick={handleSkillClick}
        />
      )}
      packagesSlot={(
        <PickerListSlot
          items={toPackageItems(containers, t('lab.promptPicker.skillCountLabel'))}
          emptyText={t('lab.promptPicker.packagesEmpty')}
          onItemClick={handlePackageClick}
        />
      )}
      historySlot={(
        <PickerListSlot
          items={toHistoryItems(historyEntries)}
          emptyText={t('lab.promptPicker.historyEmpty')}
          onItemClick={handleHistoryClick}
        />
      )}
      onConfirmBlank={handleConfirmBlank}
      customPromptValue={customPrompt}
      onCustomPromptChange={setCustomPrompt}
      labels={buildLabels(t)}
    />
  );
}
