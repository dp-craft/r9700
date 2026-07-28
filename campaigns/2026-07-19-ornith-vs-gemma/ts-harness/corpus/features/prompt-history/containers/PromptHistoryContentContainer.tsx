import { type ReactElement, useEffect } from 'react';

import { BulkActionToolbar } from '@/components/ui/BulkActionToolbar';
import { useTranslation } from '@/i18n';

import { FilterCycleButton } from '../components/FilterCycleButton';
import { PromptHistoryBody } from '../components/PromptHistoryBody';
import { usePromptHistoryStore } from '../stores/usePromptHistoryStore';
import {
  buildRows,
  exportAndDownload,
  nextInCycle,
  SOURCE_CYCLE,
  SOURCE_LABEL_KEYS,
  TYPE_CYCLE,
  TYPE_LABEL_KEYS
} from './PromptHistoryContent.helpers';

export function PromptHistoryContentContainer(): ReactElement {
  const t = useTranslation();
  const selectedIds = usePromptHistoryStore(s => s.selectedIds);
  const search = usePromptHistoryStore(s => s.search);
  const typeFilter = usePromptHistoryStore(s => s.typeFilter);
  const sourceFilter = usePromptHistoryStore(s => s.sourceFilter);
  const setSearch = usePromptHistoryStore(s => s.setSearch);
  const setTypeFilter = usePromptHistoryStore(s => s.setTypeFilter);
  const setSourceFilter = usePromptHistoryStore(s => s.setSourceFilter);
  const deleteEntries = usePromptHistoryStore(s => s.deleteEntries);
  const exportEntries = usePromptHistoryStore(s => s.exportEntries);
  const entries = usePromptHistoryStore(s => s.entries);
  const sort = usePromptHistoryStore(s => s.sort);
  const loadEntries = usePromptHistoryStore(s => s.loadEntries);
  const loadError = usePromptHistoryStore(s => s.loadError);
  const toggleSelect = usePromptHistoryStore(s => s.toggleSelect);

  const rows = buildRows({ entries, search, typeFilter, sourceFilter, sort, selectedIds });

  // useEffect: store-load — hydrate prompt history entries on mount

  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable store action
  }, []);

  const handleBulkDelete = (): void => {
    void deleteEntries(selectedIds as string[]);
  };
  const handleBulkExport = (): void => {
    exportAndDownload(exportEntries(selectedIds as string[]));
  };
  const cycleType = (): void => setTypeFilter(nextInCycle(TYPE_CYCLE, typeFilter));
  const cycleSource = (): void => setSourceFilter(nextInCycle(SOURCE_CYCLE, sourceFilter));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BulkActionToolbar
        searchValue={search}
        onSearchChange={setSearch}
        selectedCount={selectedIds.length}
        onBulkDelete={handleBulkDelete}
        onBulkExport={handleBulkExport}
        filterSlots={(
          <>
            <FilterCycleButton label={t(TYPE_LABEL_KEYS[typeFilter])} onClick={cycleType} />
            <FilterCycleButton label={t(SOURCE_LABEL_KEYS[sourceFilter])} onClick={cycleSource} />
          </>
        )}
      />
      <PromptHistoryBody
        loadError={loadError}
        rows={rows}
        onToggleSelect={toggleSelect}
        errorLabel={t('promptHistory.loadError')}
        emptyHeadline={t('promptHistory.empty.headline')}
        emptyHint={t('promptHistory.empty.hint')}
        listAria={t('promptHistory.list.aria')}
        selectPrefix={t('promptHistory.list.selectPrefix')}
      />
    </div>
  );
}
