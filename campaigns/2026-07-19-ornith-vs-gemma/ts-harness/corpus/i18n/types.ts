export type Locale = 'hu' | 'en';

export type LocaleBcp47 = 'hu-HU' | 'en-US';

export const LOCALE_BCP47_MAP: Readonly<Record<Locale, LocaleBcp47>> = {
  hu: 'hu-HU',
  en: 'en-US',
} as const;

export const LOCALE_LANGUAGE_NAME: Readonly<Record<Locale, string>> = {
  hu: 'Hungarian',
  en: 'English',
} as const;

export type FlattenKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Readonly<Record<string, unknown>>
    ? FlattenKeys<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type ExtractParams<S extends string> = S extends `${string}{{${infer Param}}}${infer Rest}`
  ? Param | ExtractParams<Rest>
  : never;

export type TranslationFunction = (
  key: string,
  params?: Readonly<Record<string, string | number>>
) => string;
