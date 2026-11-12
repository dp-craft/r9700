import { useCallback, useRef, useState } from 'react';

const MAX_ENTRIES = 50;

export interface InputHistoryState {
  readonly isNavigating: boolean;
  readonly currentEntry: string | null;
}

export interface InputHistoryActions {
  readonly navigateUp: (textarea: HTMLTextAreaElement) => boolean;
  readonly navigateDown: (textarea: HTMLTextAreaElement) => boolean;
  readonly dismiss: () => void;
  readonly addEntry: (content: string) => void;
  readonly reset: (entries?: readonly string[]) => void;
}

export interface UseInputHistoryReturn extends InputHistoryState, InputHistoryActions {}

function isCursorOnFirstLine(textarea: HTMLTextAreaElement): boolean {
  return !textarea.value.slice(0, textarea.selectionStart).includes('\n');
}

export function useInputHistory(currentDraft: string): UseInputHistoryReturn {
  const entriesRef = useRef<readonly string[]>([]);
  const draftRef = useRef<string>('');
  const indexRef = useRef<number>(-1);
  const currentDraftRef = useRef<string>(currentDraft);
  currentDraftRef.current = currentDraft;

  const [isNavigating, setIsNavigating] = useState(false);
  const [currentEntry, setCurrentEntry] = useState<string | null>(null);

  const navigateUp = useCallback((textarea: HTMLTextAreaElement): boolean => {
    if (!isCursorOnFirstLine(textarea)) return false;
    if (entriesRef.current.length === 0) return false;

    if (indexRef.current === -1) {
      draftRef.current = currentDraftRef.current;
      const newIndex = entriesRef.current.length - 1;
      indexRef.current = newIndex;
      setIsNavigating(true);
      setCurrentEntry(entriesRef.current[newIndex] ?? null);
      return true;
    }

    if (indexRef.current > 0) {
      const newIndex = indexRef.current - 1;
      indexRef.current = newIndex;
      setCurrentEntry(entriesRef.current[newIndex] ?? null);
    }

    return true;
  }, []);

  const navigateDown = useCallback((textarea: HTMLTextAreaElement): boolean => {
    if (indexRef.current === -1) return false;
    if (!isCursorOnFirstLine(textarea)) return false;

    if (indexRef.current < entriesRef.current.length - 1) {
      const newIndex = indexRef.current + 1;
      indexRef.current = newIndex;
      setCurrentEntry(entriesRef.current[newIndex] ?? null);
      return true;
    }

    indexRef.current = -1;
    setIsNavigating(false);
    setCurrentEntry(null);
    return true;
  }, []);

  const dismiss = useCallback((): void => {
    if (indexRef.current === -1) return;
    indexRef.current = -1;
    setIsNavigating(false);
    setCurrentEntry(null);
  }, []);

  const addEntry = useCallback((content: string): void => {
    const entries = entriesRef.current;
    if (entries.length > 0 && entries[entries.length - 1] === content) return;

    const updated = [...entries, content];
    entriesRef.current =
      updated.length > MAX_ENTRIES ? updated.slice(updated.length - MAX_ENTRIES) : updated;

    indexRef.current = -1;
    setIsNavigating(false);
    setCurrentEntry(null);
  }, []);

  const reset = useCallback((newEntries?: readonly string[]): void => {
    entriesRef.current = newEntries ? [...newEntries] : [];
    indexRef.current = -1;
    setIsNavigating(false);
    setCurrentEntry(null);
  }, []);

  return {
    isNavigating,
    currentEntry,
    navigateUp,
    navigateDown,
    dismiss,
    addEntry,
    reset,
  };
}
