import type { Locale } from './types';
import { LOCALE_BCP47_MAP } from './types';

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
} as const;

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
} as const;

export function formatDate(date: Date | number, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_BCP47_MAP[locale], DATE_OPTIONS).format(date);
}

export function formatTime(date: Date | number, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_BCP47_MAP[locale], TIME_OPTIONS).format(date);
}

export function formatDateTime(date: Date | number, locale: Locale): string {
  return `${formatDate(date, locale)} ${formatTime(date, locale)}`;
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_BCP47_MAP[locale]).format(n);
}
