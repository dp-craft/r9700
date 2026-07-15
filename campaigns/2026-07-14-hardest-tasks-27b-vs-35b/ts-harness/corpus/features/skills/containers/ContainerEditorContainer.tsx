import type { DragEndEvent } from '@dnd-kit/core';
import { closestCenter, DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type * as React from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { AtomicSkillDTO } from '@/domain/entities';
import {
  autoSort,
  type ComposedPrompt,
  composePrompt,
  detectOrderingIssues,
  EMPTY_COMPOSED_PROMPT
} from '@/lib/prompt-composer';

import { CanonicalOrderInfo } from '../components/CanonicalOrderInfo';
import { ContainerEditor } from '../components/ContainerEditor';
import { useSkillLabels } from '../hooks/useSkillLabels';
import { useSkillStore } from '../stores/useSkillStore';
import type { ComposedPromptVM, SortableSkillItemVM } from '../types';
import { SortableSkillItemContainer } from './SortableSkillItemContainer';

const toSortableSkillVM = (
  skill: AtomicSkillDTO,
  issueIds: ReadonlySet<string>
): SortableSkillItemVM => ({
  id: skill.id,
  name: skill.name,
  category: skill.category,
  hasOrderingIssue: issueIds.has(skill.id),
});

const toAvailableSkill = (
  skill: AtomicSkillDTO
): { readonly id: string; readonly name: string } => ({
  id: skill.id,
  name: skill.name,
});

const toComposedPromptVM = (cp: ComposedPrompt): ComposedPromptVM => ({
  text: cp.text,
  tokenCount: cp.tokenCount,
  exceedsSoftLimit: cp.exceedsSoftLimit,
  exceedsHardLimit: cp.exceedsHardLimit,
});

const reorderSkillIds = (
  skillIds: readonly string[],
  activeId: string,
  overId: string
): readonly string[] => {
  const oldIndex = skillIds.indexOf(activeId);
  const newIndex = skillIds.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1) return skillIds;
  const result = [...skillIds];
  result.splice(oldIndex, 1);
  result.splice(newIndex, 0, activeId);
  return result;
};

const resolveSkillsFromIds = (
  skillIds: readonly string[],
  skillMap: ReadonlyMap<string, AtomicSkillDTO>
): readonly AtomicSkillDTO[] => {
  return skillIds.flatMap(id => {
    const skill = skillMap.get(id);
    return skill ? [skill] : [];
  });
};

export function ContainerEditorContainer(): React.ReactElement {
  const skills = useSkillStore(s => s.skills);
  const containers = useSkillStore(s => s.containers);
  const selectedContainerId = useSkillStore(s => s.selectedContainerId);
  const selectContainer = useSkillStore(s => s.selectContainer);
  const storeCreateContainer = useSkillStore(s => s.createContainer);
  const storeUpdateContainer = useSkillStore(s => s.updateContainer);
  const storeDeleteContainer = useSkillStore(s => s.deleteContainer);

  const labels = useSkillLabels();
  const selectedContainer = containers.find(c => c.id === selectedContainerId);
  const isNew = selectedContainerId === null;

  const [name, setName] = useState(selectedContainer?.name ?? '');
  const [skillIds, setSkillIds] = useState<readonly string[]>(selectedContainer?.skillIds ?? []);

  const skillMap = useMemo(() => new Map(skills.map(s => [s.id, s])), [skills]);

  const resolvedSkills = useMemo(
    () => resolveSkillsFromIds(skillIds, skillMap),
    [skillIds, skillMap]
  );

  const issueSkillIds = useMemo(() => {
    const issues = detectOrderingIssues(resolvedSkills);
    return new Set(issues.map(i => i.skillId));
  }, [resolvedSkills]);

  const composedPrompt = useMemo(
    () =>
      resolvedSkills.length === 0
        ? EMPTY_COMPOSED_PROMPT
        : toComposedPromptVM(composePrompt(resolvedSkills)),
    [resolvedSkills]
  );

  const sortableSkillVMs = useMemo(
    () => resolvedSkills.map(s => toSortableSkillVM(s, issueSkillIds)),
    [resolvedSkills, issueSkillIds]
  );

  const availableSkillVMs = useMemo(() => {
    const usedIds = new Set(skillIds);
    return skills.filter(s => !usedIds.has(s.id)).map(toAvailableSkill);
  }, [skills, skillIds]);

  const handleAddSkill = useCallback((skillId: string): void => {
    setSkillIds(prev => [...prev, skillId]);
  }, []);

  const handleRemoveSkill = useCallback((skillId: string): void => {
    setSkillIds(prev => prev.filter(id => id !== skillId));
  }, []);

  const handleAutoSort = useCallback((): void => {
    const sorted = autoSort(resolvedSkills);
    setSkillIds(sorted.map(s => s.id));
  }, [resolvedSkills]);

  const handleDragEnd = useCallback((event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSkillIds(prev => reorderSkillIds(prev, String(active.id), String(over.id)));
  }, []);

  const handleSave = useCallback((): void => {
    const input = { name, skillIds: [...skillIds] };
    if (isNew) {
      void storeCreateContainer(input);
    } else if (selectedContainerId) {
      void storeUpdateContainer(selectedContainerId, input);
    }
  }, [isNew, selectedContainerId, name, skillIds, storeCreateContainer, storeUpdateContainer]);

  const handleCancel = useCallback((): void => {
    setName(selectedContainer?.name ?? '');
    setSkillIds(selectedContainer?.skillIds ?? []);
    if (!selectedContainer) selectContainer(null);
  }, [selectedContainer, selectContainer]);

  const handleDelete = useCallback((): void => {
    if (selectedContainerId) {
      void storeDeleteContainer(selectedContainerId);
    }
  }, [selectedContainerId, storeDeleteContainer]);

  const createRemoveHandler = useCallback(
    (skillId: string) => (): void => handleRemoveSkill(skillId),
    [handleRemoveSkill]
  );

  const sortableListSlot = (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={skillIds as string[]} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1">
          {sortableSkillVMs.map(skill => (
            <SortableSkillItemContainer
              key={skill.id}
              id={skill.id}
              name={skill.name}
              category={skill.category}
              hasOrderingIssue={skill.hasOrderingIssue}
              onRemove={createRemoveHandler(skill.id)}
              labels={labels.sortableSkillItem}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );

  const infoSlot = <CanonicalOrderInfo labels={labels.canonicalOrderInfo} />;

  return (
    <ContainerEditor
      name={name}
      onNameChange={setName}
      skills={sortableSkillVMs}
      availableSkills={availableSkillVMs}
      onAddSkill={handleAddSkill}
      onRemoveSkill={handleRemoveSkill}
      onAutoSort={handleAutoSort}
      composedPrompt={composedPrompt}
      onSave={handleSave}
      onCancel={handleCancel}
      onDelete={isNew ? null : handleDelete}
      isNew={isNew}
      sortableListSlot={sortableListSlot}
      infoSlot={infoSlot}
      labels={labels.containerEditor}
    />
  );
}
