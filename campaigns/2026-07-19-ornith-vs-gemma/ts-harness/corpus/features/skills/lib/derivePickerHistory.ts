import type { LabRunRow } from '@/db/labRuns';
import type { AtomicSkillDTO } from '@/domain/entities';

export type { PickerHistoryItem } from '@/domain/picker-history';

import type { PickerHistoryItem } from '@/domain/picker-history';

const HISTORY_CAP = 100;
const WHITESPACE_RUN = /\s+/g;

export function normalizeWhitespace(text: string): string {
  return text.replace(WHITESPACE_RUN, ' ').trim();
}

interface RawEntry {
  readonly runId: string;
  readonly recordedAt: number;
  readonly normalized: string;
}

function extractEntries(run: LabRunRow): readonly RawEntry[] {
  return run.configSnapshot.prompts.flatMap(entry => {
    if (entry.kind !== 'custom') return [];
    const normalized = normalizeWhitespace(entry.text);
    if (normalized === '') return [];
    return [{ runId: run.id, recordedAt: run.updatedAt, normalized }];
  });
}

export function derivePickerHistory(
  runs: ReadonlyArray<LabRunRow>,
  skills: ReadonlyArray<AtomicSkillDTO>
): ReadonlyArray<PickerHistoryItem> {
  const skillPromptSet = new Set(skills.map(skill => normalizeWhitespace(skill.prompt)));

  const rawEntries = runs.flatMap(extractEntries);

  const manualEntries = rawEntries.filter(entry => !skillPromptSet.has(entry.normalized));

  const byNormalized = manualEntries.reduce<Map<string, PickerHistoryItem>>((acc, entry) => {
    const existing = acc.get(entry.normalized);
    if (!existing || entry.recordedAt > existing.recordedAt) {
      acc.set(entry.normalized, {
        runId: entry.runId,
        prompt: entry.normalized,
        recordedAt: entry.recordedAt,
      });
    }
    return acc;
  }, new Map());

  const deduped = Array.from(byNormalized.values());
  const sorted = [...deduped].sort((a, b) => b.recordedAt - a.recordedAt);
  return sorted.slice(0, HISTORY_CAP);
}
