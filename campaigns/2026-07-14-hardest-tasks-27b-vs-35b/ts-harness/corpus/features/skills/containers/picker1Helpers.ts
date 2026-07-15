import type { AtomicSkillDTO } from '@/domain/entities';
import type { TranslationFunction } from '@/i18n/types';

import type { Picker1DialogLabels } from '../components/Picker1Dialog';
import type { Picker1Filter } from '../components/Picker1FilterChips';
import type { PickerHistoryItem } from '../lib/derivePickerHistory';

export interface Picker1Counts {
  readonly skills: number;
  readonly history: number;
  readonly pinned: number;
}

const COUNT_PLACEHOLDER = '{count}';

const formatCount = (template: string, count: number): string =>
  template.replace(COUNT_PLACEHOLDER, String(count));

export function buildPicker1Labels(
  t: TranslationFunction,
  counts: Picker1Counts
): Picker1DialogLabels {
  return {
    title: t('picker1.title'),
    searchPlaceholder: t('picker1.search-placeholder'),
    empty: t('picker1.empty'),
    groupSkills: t('picker1.group.skills'),
    groupHistory: t('picker1.group.history'),
    footerNavigate: t('picker1.footer.navigate'),
    footerSelect: t('picker1.footer.select'),
    footerEditNew: t('picker1.footer.edit-new'),
    footerNewBlank: t('picker1.footer.new-blank'),
    chips: {
      all: t('picker1.filter.all'),
      skills: formatCount(t('picker1.filter.skills'), counts.skills),
      history: formatCount(t('picker1.filter.history'), counts.history),
      pinned: formatCount(t('picker1.filter.pinned'), counts.pinned),
      blank: t('picker1.filter.blank'),
    },
    item: {
      skillBadge: t('picker1.badge.skill'),
      historyBadge: t('picker1.badge.history'),
      togglePinAria: t('picker1.aria.toggle-pin'),
    },
  };
}

export function buildSkillMeta(skill: AtomicSkillDTO): string {
  if (skill.category) return skill.category;
  return skill.description ?? '';
}

const HISTORY_META_LIMIT = 80;

export function buildHistoryMeta(item: PickerHistoryItem): string {
  const date = new Date(item.recordedAt).toISOString().slice(0, 10);
  const preview =
    item.prompt.length > HISTORY_META_LIMIT
      ? `${item.prompt.slice(0, HISTORY_META_LIMIT)}…`
      : item.prompt;
  return `${date} · ${preview}`;
}

function includes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function filterSkills(
  skills: ReadonlyArray<AtomicSkillDTO>,
  query: string,
  filter: Picker1Filter
): ReadonlyArray<AtomicSkillDTO> {
  if (filter === 'history' || filter === 'blank' || filter === 'pinned') return [];
  const trimmed = query.trim();
  if (trimmed === '') return skills;
  return skills.filter(skill => includes(skill.name, trimmed) || includes(skill.prompt, trimmed));
}

export function filterHistory(
  history: ReadonlyArray<PickerHistoryItem>,
  query: string,
  filter: Picker1Filter
): ReadonlyArray<PickerHistoryItem> {
  if (filter === 'skills' || filter === 'pinned' || filter === 'blank') return [];
  const trimmed = query.trim();
  if (trimmed === '') return history;
  return history.filter(item => includes(item.prompt, trimmed));
}
