import type * as React from 'react';

import type { SkillContainerDTO } from '@/domain/entities';

import { ContainerList } from '../components/ContainerList';
import { useSkillLabels } from '../hooks/useSkillLabels';
import { useSkillStore } from '../stores/useSkillStore';
import type { ContainerListItemVM } from '../types';

const toContainerListItem = (dto: SkillContainerDTO): ContainerListItemVM => ({
  id: dto.id,
  name: dto.name,
  skillCount: dto.skillIds.length,
});

export function ContainerListContainer(): React.ReactElement {
  const containers = useSkillStore(s => s.containers);
  const selectedContainerId = useSkillStore(s => s.selectedContainerId);
  const selectContainer = useSkillStore(s => s.selectContainer);
  const labels = useSkillLabels();

  const containerVMs = containers.map(toContainerListItem);

  return (
    <ContainerList
      containers={containerVMs}
      selectedId={selectedContainerId}
      onSelect={selectContainer}
      labels={labels.containerList}
    />
  );
}
