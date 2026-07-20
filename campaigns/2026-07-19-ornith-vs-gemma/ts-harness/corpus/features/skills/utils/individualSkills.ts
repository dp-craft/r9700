import type { AtomicSkillDTO, SkillSnapshot } from '@/domain/entities';

import type { IndividualSkillOption } from '../components/SessionSkillIndicator';

export function deriveIndividualSkillOptions(
  skills: readonly AtomicSkillDTO[],
  selectedNames: readonly string[]
): readonly IndividualSkillOption[] {
  const selectedSet = new Set(selectedNames);
  return skills.map(skill => ({
    id: skill.id,
    name: skill.name,
    selected: selectedSet.has(skill.name),
  }));
}

export function selectSkillsByNames(
  skills: readonly AtomicSkillDTO[],
  names: readonly string[]
): readonly AtomicSkillDTO[] {
  const nameSet = new Set(names);
  return skills.filter(skill => nameSet.has(skill.name));
}

export function toggleSelectedNames(
  selectedNames: readonly string[],
  toggledName: string,
  selected: boolean
): readonly string[] {
  return selected
    ? [...selectedNames.filter(name => name !== toggledName), toggledName]
    : selectedNames.filter(name => name !== toggledName);
}

export function snapshotMeta(snapshot: SkillSnapshot | null): {
  readonly containerId: string;
  readonly containerName: string;
} {
  return {
    containerId: snapshot?.containerId ?? '',
    containerName: snapshot?.containerName ?? '',
  };
}
