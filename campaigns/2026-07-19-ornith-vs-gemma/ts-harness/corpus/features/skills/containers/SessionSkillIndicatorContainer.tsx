import type * as React from 'react';
import { useCallback } from 'react';

import { useSessionStore } from '@/features/sessions';
import { buildSnapshot, estimateTokens } from '@/lib/prompt-composer';

import { SessionSkillIndicator } from '../components/SessionSkillIndicator';
import { useSkillLabels } from '../hooks/useSkillLabels';
import { useSkillStore } from '../stores/useSkillStore';
import { deriveIndividualSkillOptions } from '../utils/individualSkills';

const NONE_VALUE = '__none__';
const PKG_PREFIX = 'pkg:';
const SKILL_PREFIX = 'skill:';

export function SessionSkillIndicatorContainer(): React.ReactElement | null {
  const activeSessionId = useSessionStore(s => s.activeSessionId);
  const sessionList = useSessionStore(s => s.sessionList);
  const updateSessionSnapshot = useSessionStore(s => s.updateSessionSnapshot);
  const containers = useSkillStore(s => s.containers);
  const skills = useSkillStore(s => s.skills);
  const resolveContainerSkills = useSkillStore(s => s.resolveContainerSkills);
  const labels = useSkillLabels();

  const activeSession = sessionList.find(s => s.id === activeSessionId) ?? null;
  const skillSnapshot = activeSession?.skillSnapshot ?? null;
  const containerName = skillSnapshot?.containerName ?? null;
  const skillNames = skillSnapshot?.skillNames ?? [];
  const tokenCount = skillSnapshot?.composedPrompt
    ? estimateTokens(skillSnapshot.composedPrompt)
    : 0;
  const containerOptions = containers.map(c => ({ id: c.id, name: c.name }));
  const individualSkills = deriveIndividualSkillOptions(skills, skillNames);

  const matchedContainerId =
    containerName !== null
      ? (skillSnapshot?.containerId ?? containers.find(c => c.name === containerName)?.id ?? null)
      : null;
  const firstSelectedSkill = individualSkills.find(s => s.selected) ?? null;
  const selectedValue =
    matchedContainerId !== null
      ? `${PKG_PREFIX}${matchedContainerId}`
      : firstSelectedSkill !== null
        ? `${SKILL_PREFIX}${firstSelectedSkill.id}`
        : NONE_VALUE;

  const handleSelect = useCallback(
    (value: string): void => {
      if (!activeSessionId) return;
      if (value === NONE_VALUE) {
        void updateSessionSnapshot(activeSessionId, null);
        return;
      }
      if (value.startsWith(PKG_PREFIX)) {
        const containerId = value.slice(PKG_PREFIX.length);
        const container = containers.find(c => c.id === containerId);
        if (!container) return;
        const containerSkills = resolveContainerSkills(containerId);
        const snapshot = buildSnapshot(container.id, container.name, containerSkills);
        void updateSessionSnapshot(activeSessionId, snapshot);
        return;
      }
      if (value.startsWith(SKILL_PREFIX)) {
        const skillId = value.slice(SKILL_PREFIX.length);
        const skill = skills.find(s => s.id === skillId);
        if (!skill) return;
        const snapshot = buildSnapshot('', '', [skill]);
        void updateSessionSnapshot(activeSessionId, snapshot);
      }
    },
    [activeSessionId, containers, skills, resolveContainerSkills, updateSessionSnapshot]
  );

  if (!activeSessionId) return null;

  return (
    <SessionSkillIndicator
      selectedValue={selectedValue}
      onSelect={handleSelect}
      containers={containerOptions}
      individualSkills={individualSkills}
      skillNames={skillNames}
      tokenCount={tokenCount}
      labels={labels.sessionSkillIndicator}
    />
  );
}
