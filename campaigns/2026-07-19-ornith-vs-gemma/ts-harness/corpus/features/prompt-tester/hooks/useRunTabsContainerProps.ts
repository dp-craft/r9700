import { useShallow } from 'zustand/react/shallow';

import type { ViewMode } from '../components/ResultsViewToggle';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';

type RunTabVM = { readonly id: string; readonly label: string };

export type RunTabsContainerProps = {
  readonly tabs: readonly RunTabVM[];
  readonly activeId: string;
  readonly editingId: string | null;
  readonly canCloseActive: boolean;
  readonly viewMode: ViewMode;
  readonly setViewMode: (mode: ViewMode) => void;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onRenameStart: (id: string) => void;
  readonly onRenameCommit: (id: string, name: string) => void;
  readonly onRenameCancel: () => void;
  readonly onAdd: () => void;
  readonly handleRenameClick: (id: string) => () => void;
};

export const useRunTabsContainerProps = (): RunTabsContainerProps => {
  const {
    runs,
    activeRunId,
    editingRunId,
    createEmptyTab,
    closeTab,
    setActiveRun,
    setEditingRun,
    renameRun,
    setViewMode,
  } = usePromptTesterStore(
    useShallow(s => ({
      runs: s.runs,
      activeRunId: s.activeRunId,
      editingRunId: s.editingRunId,
      createEmptyTab: s.createEmptyTab,
      closeTab: s.closeTab,
      setActiveRun: s.setActiveRun,
      setEditingRun: s.setEditingRun,
      renameRun: s.renameRun,
      setViewMode: s.setViewMode,
    }))
  );

  const viewMode: ViewMode = runs.find(r => r.id === activeRunId)?.viewMode ?? 'list';

  const tabs = runs.map(r => ({ id: String(r.id), label: r.label }));
  const handleActivate = (id: string): void => {
    setActiveRun(Number(id));
  };
  const handleClose = (id: string): void => {
    void closeTab(Number(id));
  };
  const handleRenameCommit = (id: string, name: string): void => {
    renameRun(Number(id), name);
    setEditingRun(null);
  };
  const handleRenameCancel = (): void => {
    setEditingRun(null);
  };
  const handleAdd = (): void => {
    createEmptyTab();
  };
  const handleRenameClick = (id: string) => (): void => {
    setEditingRun(id);
  };

  return {
    tabs,
    activeId: String(activeRunId),
    editingId: editingRunId,
    canCloseActive: true,
    viewMode,
    setViewMode,
    onActivate: handleActivate,
    onClose: handleClose,
    onRenameStart: setEditingRun,
    onRenameCommit: handleRenameCommit,
    onRenameCancel: handleRenameCancel,
    onAdd: handleAdd,
    handleRenameClick,
  };
};
