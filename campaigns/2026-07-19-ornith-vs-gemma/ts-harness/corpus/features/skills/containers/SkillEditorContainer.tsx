import type * as React from 'react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type { AtomicSkillDTO, SkillCategory } from '@/domain/entities';
import { useTranslation } from '@/i18n';

import { SkillEditor } from '../components/SkillEditor';
import { useSkillLabels } from '../hooks/useSkillLabels';
import { useSkillStore } from '../stores/useSkillStore';
import type { SkillEditorVM } from '../types';

const VALID_CATEGORIES: readonly string[] = [
  'persona',
  'context',
  'constraints',
  'format',
  'examples',
];

const NEW_SKILL_VM: SkillEditorVM = {
  id: '',
  name: '',
  prompt: '',
  type: 'custom',
  category: null,
  commandPrefix: null,
  description: null,
};

const isValidCategory = (value: string): value is SkillCategory => VALID_CATEGORIES.includes(value);

const toEditorVM = (dto: AtomicSkillDTO): SkillEditorVM => ({
  id: dto.id,
  name: dto.name,
  prompt: dto.prompt,
  type: dto.type,
  category: dto.category,
  commandPrefix: dto.commandPrefix,
  description: dto.description,
});

export function SkillEditorContainer(): React.ReactElement {
  const skills = useSkillStore(s => s.skills);
  const selectedSkillId = useSkillStore(s => s.selectedSkillId);
  const selectSkill = useSkillStore(s => s.selectSkill);
  const storeCreateSkill = useSkillStore(s => s.createSkill);
  const storeUpdateSkill = useSkillStore(s => s.updateSkill);
  const storeDeleteSkill = useSkillStore(s => s.deleteSkill);
  const storeDuplicateSkill = useSkillStore(s => s.duplicateSkill);

  const labels = useSkillLabels();
  const t = useTranslation();
  const selectedSkill = skills.find(s => s.id === selectedSkillId);
  const isNew = selectedSkillId === null;

  const [name, setName] = useState(selectedSkill?.name ?? '');
  const [prompt, setPrompt] = useState(selectedSkill?.prompt ?? '');
  const [category, setCategory] = useState<SkillCategory | null>(selectedSkill?.category ?? null);
  const [commandPrefix, setCommandPrefix] = useState(selectedSkill?.commandPrefix ?? '');
  const [description, setDescription] = useState(selectedSkill?.description ?? '');

  const handleCategoryChange = useCallback((value: string): void => {
    setCategory(isValidCategory(value) ? value : null);
  }, []);

  const handleSave = useCallback((): void => {
    const input = {
      name,
      prompt,
      category,
      commandPrefix: commandPrefix.trim() || null,
      description: description.trim() || null,
    };
    if (isNew) {
      void storeCreateSkill(input);
    } else if (selectedSkillId) {
      void storeUpdateSkill(selectedSkillId, input);
    }
  }, [
    isNew,
    selectedSkillId,
    name,
    prompt,
    category,
    commandPrefix,
    description,
    storeCreateSkill,
    storeUpdateSkill,
  ]);

  const handleDelete = useCallback((): void => {
    if (!selectedSkillId) return;
    void storeDeleteSkill(selectedSkillId).then(affectedNames => {
      if (affectedNames.length > 0) {
        toast.info(
          t('skills.skillRemovedFromContainers', {
            count: String(affectedNames.length),
            names: affectedNames.join(', '),
          })
        );
      }
    });
  }, [selectedSkillId, storeDeleteSkill, t]);

  const handleDuplicate = useCallback((): void => {
    if (selectedSkillId) {
      void storeDuplicateSkill(selectedSkillId);
    }
  }, [selectedSkillId, storeDuplicateSkill]);

  const handleCancel = useCallback((): void => {
    setName(selectedSkill?.name ?? '');
    setPrompt(selectedSkill?.prompt ?? '');
    setCategory(selectedSkill?.category ?? null);
    setCommandPrefix(selectedSkill?.commandPrefix ?? '');
    setDescription(selectedSkill?.description ?? '');
    if (!selectedSkill) {
      selectSkill(null);
    }
  }, [selectedSkill, selectSkill]);

  const skillVM = isNew ? NEW_SKILL_VM : selectedSkill ? toEditorVM(selectedSkill) : null;

  return (
    <SkillEditor
      skill={skillVM}
      isNew={isNew}
      name={name}
      prompt={prompt}
      category={category}
      commandPrefix={commandPrefix}
      description={description}
      onNameChange={setName}
      onDescriptionChange={setDescription}
      onPromptChange={setPrompt}
      onCategoryChange={handleCategoryChange}
      onCommandPrefixChange={setCommandPrefix}
      onSave={handleSave}
      onDelete={handleDelete}
      onDuplicate={handleDuplicate}
      onCancel={handleCancel}
      labels={labels.skillEditor}
    />
  );
}
