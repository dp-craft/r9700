import type { SettingsAnchor, SettingsSection } from '../types';

export interface MigrationResult {
  readonly section: SettingsSection;
  readonly anchor?: SettingsAnchor;
}

const VALID_SECTIONS: readonly SettingsSection[] = [
  'general',
  'api-models',
  'appearance',
  'defaults',
  'prompt-lab',
];

export const LEGACY_SETTINGS_SECTION_MIGRATION: Readonly<Record<string, MigrationResult>> = {
  'global:workspace': { section: 'general' },
  'global:members': { section: 'general' },
  'global:billing': { section: 'general' },
  'global:language': { section: 'general' },
  'global:appearance': { section: 'appearance' },
  'global:keyboard': { section: 'general' },
  'mf-chat:memory': { section: 'general' },
  'mf-chat:providers': { section: 'api-models' },
  'mf-chat:defaults': { section: 'defaults' },
  'mf-lab:eval-categories': { section: 'general' },
  'mf-lab:privacy': { section: 'general' },
  'mf-lab:retention': { section: 'defaults', anchor: 'lab-retention' },
  'mf-lab:defaults': { section: 'defaults' },
};

const isValidSection = (raw: string): raw is SettingsSection =>
  (VALID_SECTIONS as readonly string[]).includes(raw);

export const migrateLegacySection = (raw: string): MigrationResult | null => {
  if (isValidSection(raw)) {
    return { section: raw };
  }
  return LEGACY_SETTINGS_SECTION_MIGRATION[raw] ?? null;
};
