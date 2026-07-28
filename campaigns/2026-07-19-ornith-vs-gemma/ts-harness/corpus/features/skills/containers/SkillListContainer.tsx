import type * as React from 'react';

import type { AtomicSkillDTO } from '@/domain/entities';

import { SkillList } from '../components/SkillList';
import { useSkillLabels } from '../hooks/useSkillLabels';
import { useSkillStore } from '../stores/useSkillStore';
import type { SkillListItemVM } from '../types';

const toSkillListItem = (dto: AtomicSkillDTO): SkillListItemVM => ({
  id: dto.id,
  name: dto.name,
  type: dto.type,
  category: dto.category,
  commandPrefix: dto.commandPrefix,
  description: dto.description,
});

export function SkillListContainer(): React.ReactElement {
  const skills = useSkillStore(s => s.skills);
  const selectedSkillId = useSkillStore(s => s.selectedSkillId);
  const selectSkill = useSkillStore(s => s.selectSkill);
  const labels = useSkillLabels();

  const skillVMs = skills.map(toSkillListItem);

  return (
    <SkillList
      skills={skillVMs}
      selectedId={selectedSkillId}
      onSelect={selectSkill}
      labels={labels.skillList}
    />
  );
}
