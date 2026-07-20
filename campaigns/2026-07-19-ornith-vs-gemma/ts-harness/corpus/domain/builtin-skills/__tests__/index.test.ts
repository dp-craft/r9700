import { describe, expect, it } from 'vitest';

import type { PromptTranslationEntry } from '@/domain/builtin-skills';
import type { Locale } from '@/i18n/types';

import { getBuiltinSkillContent } from '../index';

// -- Constants --

const EXPECTED_SKILL_KEYS = [
  'reasoning-coach',
  'translator',
  'concise-writer',
  'eli5-explainer',
] as const;

const ALL_LOCALES: readonly Locale[] = ['hu', 'en'] as const;

// -- getBuiltinSkillContent --

describe('getBuiltinSkillContent', () => {
  // -- Positive paths --

  it('should return PromptTranslations for hu locale', () => {
    const result = getBuiltinSkillContent('hu');

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('should return PromptTranslations for en locale', () => {
    const result = getBuiltinSkillContent('en');

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('should include all 4 built-in skills for each locale', () => {
    for (const locale of ALL_LOCALES) {
      const result = getBuiltinSkillContent(locale);
      const keys = Object.keys(result);

      expect(keys).toHaveLength(4);
    }
  });

  it('should include keys: reasoning-coach, translator, concise-writer, eli5-explainer', () => {
    const result = getBuiltinSkillContent('en');
    const keys = Object.keys(result).sort();

    expect(keys).toEqual([...EXPECTED_SKILL_KEYS].sort());
  });

  // -- Content validation --

  it('should have non-empty name and prompt for each entry in hu', () => {
    const result = getBuiltinSkillContent('hu');

    for (const key of EXPECTED_SKILL_KEYS) {
      const entry: PromptTranslationEntry = result[key];

      expect(entry.name.trim().length).toBeGreaterThan(0);
      expect(entry.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it('should have non-empty name and prompt for each entry in en', () => {
    const result = getBuiltinSkillContent('en');

    for (const key of EXPECTED_SKILL_KEYS) {
      const entry: PromptTranslationEntry = result[key];

      expect(entry.name.trim().length).toBeGreaterThan(0);
      expect(entry.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it('should return different content for hu vs en (names differ)', () => {
    const huResult = getBuiltinSkillContent('hu');
    const enResult = getBuiltinSkillContent('en');

    const huNames = EXPECTED_SKILL_KEYS.map(key => huResult[key].name);
    const enNames = EXPECTED_SKILL_KEYS.map(key => enResult[key].name);

    expect(huNames).not.toEqual(enNames);
  });

  // -- Immutability --

  it('should return frozen/readonly object (Object.isFrozen)', () => {
    const result = getBuiltinSkillContent('en');

    expect(Object.isFrozen(result)).toBe(true);
  });

  // -- Edge cases --

  it('should return consistent results on repeated calls with the same locale', () => {
    const first = getBuiltinSkillContent('hu');
    const second = getBuiltinSkillContent('hu');

    expect(first).toEqual(second);
  });

  it('should return entries where each entry has exactly name and prompt fields', () => {
    const result = getBuiltinSkillContent('en');

    for (const key of EXPECTED_SKILL_KEYS) {
      const entry = result[key];
      const entryKeys = Object.keys(entry).sort();

      expect(entryKeys).toEqual(['name', 'prompt']);
    }
  });

  it('should have same keys for hu and en locales', () => {
    const huKeys = Object.keys(getBuiltinSkillContent('hu')).sort();
    const enKeys = Object.keys(getBuiltinSkillContent('en')).sort();

    expect(huKeys).toEqual(enKeys);
  });
});
