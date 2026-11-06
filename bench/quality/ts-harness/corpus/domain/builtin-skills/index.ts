import type { Locale } from '@/i18n/types';

import en from './en';
import hu from './hu';
import type { PromptTranslationEntry, PromptTranslations } from './types';

const LOCALE_CONTENT: Readonly<Record<Locale, PromptTranslations>> = {
  hu,
  en,
};

export function getBuiltinSkillContent(locale: Locale): PromptTranslations {
  return LOCALE_CONTENT[locale];
}

export type { PromptTranslationEntry, PromptTranslations };
