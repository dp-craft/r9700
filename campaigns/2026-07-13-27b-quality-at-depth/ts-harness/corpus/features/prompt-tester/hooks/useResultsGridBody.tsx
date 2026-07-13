import { useShallow } from 'zustand/react/shallow';

import { useTranslation } from '@/i18n';

import { ResultsGrid } from '../components/ResultsGrid';
import { ResultsGridView } from '../components/ResultsGridView';
import type { ViewMode } from '../components/ResultsViewToggle';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';
import type { StarMetricId } from '../types';
import { buildGridTable } from '../utils/buildGridRows';
import { buildCellVM, djb2Hash } from '../utils/resultCellVM';

const EMPTY_SNAP = { models: [], prompts: [], userPrompt: '' } as const;

export type ResultsGridBody = {
  readonly viewMode: ViewMode;
  readonly setViewMode: (mode: ViewMode) => void;
  readonly body: React.ReactElement;
};

export const useResultsGridBody = (): ResultsGridBody => {
  const t = useTranslation();
  const {
    cells,
    models,
    prompts,
    snap,
    userPrompt,
    detailId,
    viewMode,
    selIds,
    openDetailFor,
    deleteCell,
    toggleCellSelection,
    setViewMode,
  } = usePromptTesterStore(
    useShallow(s => {
      const tab = s.runs.find(r => r.id === s.activeRunId);
      return {
        cells: tab?.cells ?? [],
        models: s.models,
        prompts: s.prompts,
        snap: tab?.configSnapshot ?? EMPTY_SNAP,
        userPrompt: s.userPrompt,
        detailId: s.activeDetailCellId,
        viewMode: tab?.viewMode ?? 'list',
        selIds: tab?.selectedCellIds ?? [],
        openDetailFor: s.openDetailFor,
        deleteCell: s.deleteCell,
        toggleCellSelection: s.toggleCellSelection,
        setViewMode: s.setViewMode,
      };
    })
  );

  const vms = cells.map(c => buildCellVM(c, models, prompts, snap, djb2Hash(userPrompt)));
  const handleDelete = (id: string): void => {
    void deleteCell(id);
  };

  const criterionLabels: Readonly<Record<StarMetricId, string>> = {
    fluency: t('promptLab.starMetrics.fluency'),
    readability: t('promptLab.starMetrics.readability'),
    vocabulary: t('promptLab.starMetrics.vocabulary'),
  };
  const criterionLabel = (name: StarMetricId): string => criterionLabels[name];

  const statusLabels = {
    idle: t('lab.status.idle'),
    streaming: t('lab.status.streaming'),
    done: t('lab.status.done'),
    error: t('lab.status.error'),
    aborted: t('lab.status.aborted'),
  } as const;

  const body =
    viewMode === 'grid' ? (
      <ResultsGridView
        table={buildGridTable(vms, models, prompts, selIds)}
        cornerLabel={t('lab.grid.cornerLabel')}
        deleteCellAriaLabel={t('lab.grid.delete-cell.aria')}
        emptyLabel={t('lab.results.empty')}
        statusLabels={statusLabels}
        resultAriaLabel={(label: string): string => t('lab.results.resultAria', { label })}
        selectAriaLabel={(label: string): string => t('lab.results.selectAria', { label })}
        ratingAriaLabel={(mean: number): string =>
          t('lab.grid.rating.aria', { mean: mean.toFixed(1) })}
        criterionLabel={criterionLabel}
        tpsLabel={t('lab.grid.tps')}
        ttsLabel={t('lab.grid.tts')}
        onCellClick={toggleCellSelection}
        onCellDelete={handleDelete}
        onSelectToggle={toggleCellSelection}
      />
    ) : (
      <ResultsGrid
        cells={vms}
        activeCellId={detailId}
        selectedCellIds={selIds}
        emptyLabel={t('lab.results.empty')}
        errorLabel={t('lab.results.errorLabel')}
        deleteCellAriaLabel={t('lab.grid.delete-cell.aria')}
        selectAriaLabel={t('lab.result.selectAria')}
        compareLabel={t('lab.result.compare')}
        ttfLabel={t('lab.grid.ttf')}
        tpsLabel={t('lab.grid.tps')}
        listAriaLabel={t('lab.results.listAria')}
        unresolvedAriaLabel={t('lab.results.unresolvedAria')}
        statusLabels={statusLabels}
        onCellClick={openDetailFor}
        onCellDelete={handleDelete}
        onSelectToggle={toggleCellSelection}
      />
    );

  return { viewMode, setViewMode, body };
};
