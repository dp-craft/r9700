import { downloadJson } from '@/lib/download';

import type { PromptHistoryRowVM } from '../components/PromptHistoryList';
import type {
  PromptHistoryEntry,
  PromptSortKey,
  PromptSource,
  PromptType
} from '../stores/usePromptHistoryStore';

export const EXPORT_FILENAME = 'prompt-history-export.json';

export const filterAndSortEntries = (
  entries: readonly PromptHistoryEntry[],
  search: string,
  typeFilter: PromptType | 'ALL',
  sourceFilter: PromptSource | 'ALL',
  sort: PromptSortKey
): readonly PromptHistoryEntry[] => {
  if (!entries) return [];
  const lowerSearch = search.toLowerCase();
  const filtered = entries.filter(e => {
    const matchesSearch = lowerSearch === '' || e.text.toLowerCase().includes(lowerSearch);
    const matchesType = typeFilter === 'ALL' || e.type === typeFilter;
    const matchesSource = sourceFilter === 'ALL' || e.firstSource === sourceFilter;
    return matchesSearch && matchesType && matchesSource;
  });
  return [...filtered].sort((a, b) => {
    if (sort === 'first-used') return a.firstUsedAt - b.firstUsedAt;
    if (sort === 'use-count') return b.useCount - a.useCount;
    if (sort === 'length') return b.text.length - a.text.length;
    return b.lastUsedAt - a.lastUsedAt;
  });
};

export const toRow = (
  e: PromptHistoryEntry,
  selectedIdSet: ReadonlySet<string>
): PromptHistoryRowVM => ({
  id: e.id,
  text: e.text,
  type: e.type,
  source: e.firstSource,
  useCount: e.useCount,
  selected: selectedIdSet.has(e.id),
});

export type BuildRowsParams = {
  readonly entries: readonly PromptHistoryEntry[];
  readonly search: string;
  readonly typeFilter: PromptType | 'ALL';
  readonly sourceFilter: PromptSource | 'ALL';
  readonly sort: PromptSortKey;
  readonly selectedIds: readonly string[];
};

export const buildRows = (params: BuildRowsParams): readonly PromptHistoryRowVM[] => {
  const filtered = filterAndSortEntries(
    params.entries,
    params.search,
    params.typeFilter,
    params.sourceFilter,
    params.sort
  );
  const selectedIdSet = new Set(params.selectedIds);
  return filtered.map(e => toRow(e, selectedIdSet));
};

export const TYPE_CYCLE: readonly (PromptType | 'ALL')[] = ['ALL', 'USER', 'SYSTEM'];
export const SOURCE_CYCLE: readonly (PromptSource | 'ALL')[] = ['ALL', 'CHAT', 'LAB'];

export const TYPE_LABEL_KEYS: Record<PromptType | 'ALL', string> = {
  ALL: 'promptHistory.filter.typeAll',
  USER: 'promptHistory.filter.typeUser',
  SYSTEM: 'promptHistory.filter.typeSystem',
};

export const SOURCE_LABEL_KEYS: Record<PromptSource | 'ALL', string> = {
  ALL: 'promptHistory.filter.sourceAll',
  CHAT: 'promptHistory.filter.sourceChat',
  LAB: 'promptHistory.filter.sourceLab',
};

export const nextInCycle = <T>(cycle: readonly T[], current: T): T => {
  const idx = cycle.indexOf(current);
  return cycle[(idx + 1) % cycle.length];
};

export const exportAndDownload = (data: unknown): void => {
  downloadJson(EXPORT_FILENAME, data);
};
