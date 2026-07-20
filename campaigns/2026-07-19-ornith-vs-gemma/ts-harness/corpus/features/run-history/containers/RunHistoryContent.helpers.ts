import type { ArchivedLabRun } from '@/db/archivedRuns';

import type { RunHistoryRowVM } from '../components/RunHistoryList';

export const EXPORT_FILENAME = 'run-history-export.json';

export const buildRows = (
  runs: readonly ArchivedLabRun[],
  search: string,
  selectedIds: readonly string[]
): readonly RunHistoryRowVM[] => {
  const filtered =
    search === ''
      ? runs
      : runs.filter(r => (r.label ?? r.id).toLowerCase().includes(search.toLowerCase()));
  const selectedIdSet = new Set(selectedIds);
  return filtered.map(r => ({
    id: r.id,
    label: r.label ?? r.id,
    archivedAt: r.archivedAt,
    cellCount: (r.cells ?? []).length,
    pinned: false,
    selected: selectedIdSet.has(r.id),
  }));
};
