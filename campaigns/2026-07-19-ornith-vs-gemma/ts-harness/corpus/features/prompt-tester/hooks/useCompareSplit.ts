import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef } from 'react';

import { usePromptTesterStore } from '../stores/usePromptTesterStore';
import type { CompareSplit } from '../types';

type DragCleanup = () => void;

export function useCompareSplit(): CompareSplit {
  const ratio = usePromptTesterStore(s => s.compareSplitRatio);
  const setCompareSplitRatio = usePromptTesterStore(s => s.setCompareSplitRatio);
  const cleanupRef = useRef<DragCleanup | null>(null);

  // useEffect: cleanup — detach any drag listeners still attached on unmount
  useEffect((): (() => void) => {
    const cleanup = (): void => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    return cleanup;
  }, []);

  const onResizeStart = (e: ReactPointerEvent): void => {
    const container = e.currentTarget.parentElement;
    if (container === null) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const ratioAtDragStart = usePromptTesterStore.getState().compareSplitRatio;
    const clientYAtDragStart = e.clientY;
    const onMove = (event: PointerEvent): void => {
      const delta = (event.clientY - clientYAtDragStart) / rect.height;
      setCompareSplitRatio(ratioAtDragStart + delta);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cleanupRef.current = null;
    };
    cleanupRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return { ratio, onResizeStart };
}
