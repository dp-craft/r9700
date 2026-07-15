import type * as React from 'react';
import { useCallback, useEffect } from 'react';

import type { SkillSnapshot } from '@/domain/entities';
import { useSettingsStore } from '@/features/settings';
import { useSkillStore } from '@/features/skills';
import { buildSnapshot } from '@/lib/prompt-composer';

import { SessionSidebar } from '../components/SessionSidebar';
import { useFormattedSessions } from '../hooks/useFormattedSessions';
import { useInlineEdit } from '../hooks/useInlineEdit';
import { useSessionLabels } from '../hooks/useSessionLabels';
import { useSessionStore } from '../stores/useSessionStore';

export interface SessionSidebarContainerProps {
  readonly header?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly skillSlot?: React.ReactNode;
}

export function SessionSidebarContainer({
  header,
  footer,
  skillSlot,
}: SessionSidebarContainerProps): React.ReactElement {
  const labels = useSessionLabels();
  const loadSessions = useSessionStore(s => s.loadSessions);

  // useEffect: store-load — loads session list on mount
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const sessionList = useSessionStore(s => s.sessionList);
  const activeSessionId = useSessionStore(s => s.activeSessionId);
  const createSession = useSessionStore(s => s.createSession);
  const setActiveSession = useSessionStore(s => s.setActiveSession);
  const deleteSession = useSessionStore(s => s.deleteSession);

  const activeProviderId = useSettingsStore(s => s.activeProviderId);
  const activeModelId = useSettingsStore(s => s.activeModelId);
  const defaultContainerId = useSettingsStore(s => s.defaultContainerId);
  const containers = useSkillStore(s => s.containers);
  const resolveContainerSkills = useSkillStore(s => s.resolveContainerSkills);

  const updateSessionTitle = useSessionStore(s => s.updateSessionTitle);
  const editingSessionId = useSessionStore(s => s.editingSessionId);
  const setEditingSession = useSessionStore(s => s.setEditingSession);

  const displaySessions = useFormattedSessions(sessionList);
  const canCreateSession = Boolean(activeProviderId && activeModelId);

  const { isEditing, editValue, setEditValue, confirmEdit, cancelEdit } = useInlineEdit(
    editingSessionId ?? ''
  );

  const handleDoubleClickSession = useCallback(
    (sessionId: string): void => {
      const session = sessionList.find(s => s.id === sessionId);
      if (!session) return;
      setEditingSession(sessionId);
      setEditValue(session.title);
    },
    [sessionList, setEditValue, setEditingSession]
  );

  const handleConfirmEdit = useCallback((): void => {
    const trimmed = confirmEdit();
    if (trimmed !== null && editingSessionId !== null) {
      void updateSessionTitle(editingSessionId, trimmed);
    }
  }, [confirmEdit, editingSessionId, updateSessionTitle]);

  const handleCancelEdit = useCallback((): void => {
    cancelEdit();
  }, [cancelEdit]);

  const resolveSnapshot = useCallback((): SkillSnapshot | null => {
    if (!defaultContainerId) return null;
    const container = containers.find(c => c.id === defaultContainerId);
    if (!container) return null;
    const skills = resolveContainerSkills(container.id);
    return buildSnapshot(container.id, container.name, skills);
  }, [defaultContainerId, containers, resolveContainerSkills]);

  const handleNewChat = useCallback((): void => {
    if (activeProviderId && activeModelId) {
      void createSession(activeProviderId, activeModelId, resolveSnapshot());
    }
  }, [activeProviderId, activeModelId, createSession, resolveSnapshot]);

  const handleSelectSession = useCallback(
    (sessionId: string): void => {
      void setActiveSession(sessionId);
    },
    [setActiveSession]
  );

  const handleDeleteSession = useCallback(
    (sessionId: string): void => {
      void deleteSession(sessionId);
    },
    [deleteSession]
  );

  return (
    <SessionSidebar
      sessions={displaySessions}
      activeSessionId={activeSessionId}
      canCreateSession={canCreateSession}
      onNewChat={handleNewChat}
      onSelectSession={handleSelectSession}
      onDeleteSession={handleDeleteSession}
      editingSessionId={isEditing ? editingSessionId : null}
      editValue={editValue}
      onEditValueChange={setEditValue}
      onDoubleClickSession={handleDoubleClickSession}
      onConfirmEdit={handleConfirmEdit}
      onCancelEdit={handleCancelEdit}
      header={header}
      footer={footer}
      skillSlot={skillSlot}
      {...labels}
    />
  );
}
