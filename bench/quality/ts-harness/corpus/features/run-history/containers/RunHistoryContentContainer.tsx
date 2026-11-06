import { type ReactElement, useEffect } from 'react';

import { BulkActionToolbar } from '@/components/ui/BulkActionToolbar';
import { useTranslation } from '@/i18n';
import { downloadJson } from '@/lib/download';

import { RunHistoryBody } from '../components/RunHistoryBody';
import type { RunHistoryListLabels } from '../components/RunHistoryList';
import { useRunHistoryStore } from '../stores/useRunHistoryStore';
import { buildRows, EXPORT_FILENAME } from './RunHistoryContent.helpers';

export function RunHistoryContentContainer(): ReactElement {
  const t = useTranslation();
  const runs = useRunHistoryStore(s => s.runs);
  const search = useRunHistoryStore(s => s.search);
  const setSearch = useRunHistoryStore(s => s.setSearch);
  const selectedIds = useRunHistoryStore(s => s.selectedIds);
  const deleteRuns = useRunHistoryStore(s => s.deleteRuns);
  const exportRuns = useRunHistoryStore(s => s.exportRuns);
  const loadRuns = useRunHistoryStore(s => s.loadRuns);
  const loadError = useRunHistoryStore(s => s.loadError);
  const toggleSelect = useRunHistoryStore(s => s.toggleSelect);
  const openInLab = useRunHistoryStore(s => s.openInLab);

  // useEffect: store-load — hydrate archived runs on mount

  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable store action
  }, []);

  const handleBulkDelete = (): void => void deleteRuns(selectedIds);
  const handleBulkExport = (): void => downloadJson(EXPORT_FILENAME, exportRuns(selectedIds));
  const handleOpen = (id: string): void => void openInLab(id);

  const rows = buildRows(runs, search, selectedIds);
  const labels: RunHistoryListLabels = {
    cells: t('runHistory.list.cells'),
    open: t('runHistory.list.open'),
    justNow: t('runHistory.list.justNow'),
    minutesAgo: (m: number) => t('runHistory.list.minutesAgo', { m: String(m) }),
    hoursAgo: (h: number) => t('runHistory.list.hoursAgo', { h: String(h) }),
    daysAgo: (d: number) => t('runHistory.list.daysAgo', { d: String(d) }),
    listAria: t('runHistory.list.aria'),
    pinned: t('runHistory.list.pinned'),
    selectPrefix: t('runHistory.list.selectPrefix'),
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BulkActionToolbar
        searchValue={search}
        onSearchChange={setSearch}
        selectedCount={selectedIds.length}
        onBulkDelete={handleBulkDelete}
        onBulkExport={handleBulkExport}
      />
      <RunHistoryBody
        loadError={loadError}
        rows={rows}
        labels={labels}
        onToggleSelect={toggleSelect}
        onOpen={handleOpen}
        errorLabel={t('runHistory.loadError')}
        emptyHeadline={t('runHistory.empty.headline')}
        emptyHint={t('runHistory.empty.hint')}
      />
    </div>
  );
}
