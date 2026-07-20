import { useCallback, useState } from 'react';

import { useSessionStore } from '../stores/useSessionStore';

export interface UseInlineEditReturn {
  readonly isEditing: boolean;
  readonly editValue: string;
  readonly startEditing: (currentName: string) => void;
  readonly setEditValue: (value: string) => void;
  readonly confirmEdit: () => string | null;
  readonly cancelEdit: () => void;
}

export function useInlineEdit(key: string): UseInlineEditReturn {
  const editingSessionId = useSessionStore(s => s.editingSessionId);
  const setEditingSession = useSessionStore(s => s.setEditingSession);
  const [editValue, setEditValueState] = useState('');

  const isEditing = editingSessionId !== null && editingSessionId === key;

  const startEditing = useCallback(
    (currentName: string): void => {
      setEditingSession(key);
      setEditValueState(currentName);
    },
    [key, setEditingSession]
  );
  // NOTE: startEditing uses the `key` captured at hook-call. Callers that need to start
  // editing a row whose id is NOT the current `key` MUST call `setEditingSession(targetId)`
  // directly on the store before this hook re-renders, then drive editValue via setEditValue.

  const setEditValue = useCallback((value: string): void => {
    setEditValueState(value);
  }, []);

  const confirmEdit = useCallback((): string | null => {
    const trimmed = editValue.trim();
    if (trimmed.length === 0) {
      return null;
    }
    setEditingSession(null);
    setEditValueState('');
    return trimmed;
  }, [editValue, setEditingSession]);

  const cancelEdit = useCallback((): void => {
    setEditingSession(null);
    setEditValueState('');
  }, [setEditingSession]);

  return { isEditing, editValue, startEditing, setEditValue, confirmEdit, cancelEdit };
}
