import { useCallback, useMemo } from 'react';

// Direct store import to avoid circular dependency through settings barrel
// (barrel re-exports SettingsDialogContainer which imports @/i18n)
import { useSettingsStore } from '@/features/settings/stores/useSettingsStore';

import en from './locales/en';
import type { TranslationStructure } from './locales/hu';
import hu from './locales/hu';
import type { Locale, TranslationFunction } from './types';

const TRANSLATIONS: Readonly<Record<Locale, TranslationStructure>> = { hu, en } as const;

const FALLBACK_LOCALE: Locale = 'hu';

const isObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
  v !== null && typeof v === 'object';

function resolveKey(
  translations: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const parts = key.split('.');

  return parts
    .map((_, i) => parts.length - i)
    .map(descentDepth => {
      const head = parts.slice(0, descentDepth);
      const tailKey = parts.slice(descentDepth).join('.');
      const node = head.reduce<unknown>(
        (acc, p) => (isObject(acc) ? acc[p] : undefined),
        translations
      );
      if (tailKey === '') {
        return typeof node === 'string' ? node : undefined;
      }
      if (isObject(node)) {
        const candidate = node[tailKey];
        return typeof candidate === 'string' ? candidate : undefined;
      }
      return undefined;
    })
    .find(result => result !== undefined);
}

function interpolate(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return template;

  return Object.entries(params).reduce<string>(
    (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)),
    template
  );
}

export function createT(locale: Locale): TranslationFunction {
  const primary = TRANSLATIONS[locale];
  const fallback = TRANSLATIONS[FALLBACK_LOCALE];

  return (key: string, params?: Readonly<Record<string, string | number>>): string => {
    if (key === '') return '';

    const resolved = resolveKey(primary, key) ?? resolveKey(fallback, key) ?? key;
    return interpolate(resolved, params);
  };
}

export function useTranslation(): TranslationFunction {
  const locale: Locale = useSettingsStore(s => s.uiLanguage) ?? FALLBACK_LOCALE;

  return useMemo(() => createT(locale), [locale]);
}

export function useLocale(): Locale {
  return useSettingsStore(s => s.uiLanguage) ?? FALLBACK_LOCALE;
}

export function useSetLocale(): (locale: Locale) => void {
  return useCallback((newLocale: Locale) => {
    useSettingsStore.getState().setUiLanguage(newLocale);
  }, []);
}

export function getT(): TranslationFunction {
  const locale: Locale = useSettingsStore.getState().uiLanguage ?? FALLBACK_LOCALE;
  return createT(locale);
}
