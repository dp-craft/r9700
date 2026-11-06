import { type ReactNode, useEffect, useState } from 'react';

import { CommandItem } from '@/components/ui/command';
import type { AtomicSkillDTO } from '@/domain/entities';
import { usePromptTesterStore } from '@/features/prompt-tester';
import { useTranslation } from '@/i18n';
import { useUIStore } from '@/stores/useUIStore';

import { Picker1Dialog } from '../components/Picker1Dialog';
import type { Picker1Filter } from '../components/Picker1FilterChips';
import { Picker1Item } from '../components/Picker1Item';
import type { PickerHistoryItem } from '../lib/derivePickerHistory';
import { useSkillStore } from '../stores/useSkillStore';
import {
  buildHistoryMeta,
  buildPicker1Labels,
  buildSkillMeta,
  filterHistory,
  filterSkills
} from './picker1Helpers';

export interface Picker1DialogContainerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function Picker1DialogContainer({
  open,
  onOpenChange,
}: Picker1DialogContainerProps): ReactNode {
  const skills = useSkillStore(s => s.skills);
  const t = useTranslation();

  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Picker1Filter>('all');
  const history = usePromptTesterStore(s => s.pickerHistory);

  // useEffect: subscribe — close picker on MF switch (FR-047)
  useEffect(() => {
    const unsub = useUIStore.subscribe(
      s => s.workspace,
      (cur, prev) => {
        if (cur !== prev && open) onOpenChange(false);
      }
    );
    return unsub;
  }, [open, onOpenChange]);

  const skillsToShow = filterSkills(skills, query, activeFilter);
  const historyToShow = filterHistory(history, query, activeFilter);
  const labels = buildPicker1Labels(t, {
    skills: skills.length,
    history: history.length,
    pinned: 0,
  });

  const handleActivateSkill =
    (skill: AtomicSkillDTO): (() => void) =>
      (): void => {
        usePromptTesterStore.getState().addSystemPromptToActiveRun({
          kind: 'skill',
          skillId: skill.id,
          name: skill.name,
          prompt: skill.prompt,
        });
        onOpenChange(false);
      };

  const handleActivateHistory =
    (item: PickerHistoryItem): (() => void) =>
      (): void => {
        usePromptTesterStore.getState().addSystemPromptToActiveRun({
          kind: 'history',
          runId: item.runId,
          prompt: item.prompt,
        });
        onOpenChange(false);
      };

  const handleNewBlank = (): void => {
    usePromptTesterStore.getState().addSystemPromptToActiveRun({ kind: 'blank' });
    onOpenChange(false);
  };

  const skillsSlot = skillsToShow.map(skill => (
    <CommandItem key={skill.id} value={`skill:${skill.id}`} onSelect={handleActivateSkill(skill)}>
      <Picker1Item
        kind="skill"
        name={skill.name}
        meta={buildSkillMeta(skill)}
        selected={false}
        labels={labels.item}
      />
    </CommandItem>
  ));

  const historySlot = historyToShow.map(item => (
    <CommandItem
      key={item.runId}
      value={`history:${item.runId}`}
      onSelect={handleActivateHistory(item)}
    >
      <Picker1Item
        kind="history"
        name={item.prompt}
        meta={buildHistoryMeta(item)}
        selected={false}
        labels={labels.item}
      />
    </CommandItem>
  ));

  return (
    <Picker1Dialog
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQueryChange={setQuery}
      activeFilter={activeFilter}
      onFilterChange={setActiveFilter}
      skillsSlot={skillsSlot}
      historySlot={historySlot}
      onNewBlank={handleNewBlank}
      hasResults={skillsToShow.length + historyToShow.length > 0 || activeFilter === 'blank'}
      labels={labels}
    />
  );
}
