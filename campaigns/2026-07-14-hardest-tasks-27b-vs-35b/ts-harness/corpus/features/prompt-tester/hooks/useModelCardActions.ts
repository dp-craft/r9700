import { useEffect, useState } from 'react';

import { usePromptTesterStore } from '../stores/usePromptTesterStore';
import type { SliderValues } from '../types';

export interface ModelCardActions {
  readonly handleSetParam: (key: keyof SliderValues, value: number) => void;
  readonly handleClampParam: (key: keyof SliderValues) => void;
  readonly handleToggleThinking: () => void;
  readonly handleToggleExpanded: () => void;
  readonly handleClose: () => void;
  readonly handleConfirmRemove: () => void;
  readonly amberFlash: boolean;
  readonly showConfirm: boolean;
  readonly setShowConfirm: (open: boolean) => void;
}

export const useModelCardActions = (modelId: string): ModelCardActions => {
  const modelCount = usePromptTesterStore(s => s.models.length);
  const setModelParam = usePromptTesterStore(s => s.setModelParam);
  const clampModelParam = usePromptTesterStore(s => s.clampModelParam);
  const toggleModelThinking = usePromptTesterStore(s => s.toggleModelThinking);
  const toggleModelExpanded = usePromptTesterStore(s => s.toggleModelExpanded);
  const removeModel = usePromptTesterStore(s => s.removeModel);
  const showConfirm = usePromptTesterStore(s => s.confirmingRemoveModelId === modelId);
  const setConfirmingRemoveModel = usePromptTesterStore(s => s.setConfirmingRemoveModel);

  const [amberFlash, setAmberFlash] = useState(false);

  const setShowConfirm = (open: boolean): void => {
    setConfirmingRemoveModel(open ? modelId : null);
  };

  // useEffect: cleanup — 200ms amber flash timeout
  useEffect(() => {
    if (!amberFlash) return;
    const timer = setTimeout(() => setAmberFlash(false), 200);
    return () => clearTimeout(timer);
  }, [amberFlash]);

  const handleSetParam = (key: keyof SliderValues, value: number): void => {
    setModelParam(modelId, key, value);
  };

  const handleClampParam = (key: keyof SliderValues): void => {
    clampModelParam(modelId, key);
    setAmberFlash(true);
  };

  const handleToggleThinking = (): void => {
    toggleModelThinking(modelId);
  };

  const handleToggleExpanded = (): void => {
    toggleModelExpanded(modelId);
  };

  const handleClose = (): void => {
    if (modelCount === 1) {
      setConfirmingRemoveModel(modelId);
      return;
    }
    removeModel(modelId);
  };

  const handleConfirmRemove = (): void => {
    removeModel(modelId);
    setConfirmingRemoveModel(null);
  };

  return {
    handleSetParam,
    handleClampParam,
    handleToggleThinking,
    handleToggleExpanded,
    handleClose,
    handleConfirmRemove,
    amberFlash,
    showConfirm,
    setShowConfirm,
  };
};
