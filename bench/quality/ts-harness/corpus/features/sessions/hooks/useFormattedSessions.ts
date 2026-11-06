import { useMemo } from 'react';

import type { Locale } from '@/i18n';
import { formatDateTime, useLocale, useTranslation } from '@/i18n';

type Translator = ReturnType<typeof useTranslation>;

interface SessionInput {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly model?: string;
}

export interface DisplaySession {
  readonly id: string;
  readonly title: string;
  readonly tooltipText: string;
  readonly metaLine?: string;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const buildTooltipText = (prefix: string, createdAt: number, locale: Locale): string =>
  `${prefix} ${formatDateTime(createdAt, locale)}`;

const formatRelativeShort = (t: Translator, fromMs: number, now: number): string => {
  const diff = Math.max(0, now - fromMs);
  const seconds = Math.floor(diff / 1000);
  if (seconds < SECONDS_PER_MINUTE) return t('sessions.metaNow');
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return t('sessions.metaMin', { count: minutes });
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return t('sessions.metaHour', { count: hours });
  const days = Math.floor(hours / HOURS_PER_DAY);
  return t('sessions.metaDay', { count: days });
};

const buildMetaLine = (
  t: Translator,
  updatedAt: number | undefined,
  model: string | undefined,
  now: number
): string | undefined => {
  if (updatedAt === undefined && (model === undefined || model === '')) return undefined;
  const relative = updatedAt !== undefined ? formatRelativeShort(t, updatedAt, now) : null;
  const modelPart = model !== undefined && model !== '' ? model : null;
  if (relative !== null && modelPart !== null) return `${relative} · ${modelPart}`;
  return relative ?? modelPart ?? undefined;
};

export function useFormattedSessions(sessions: readonly SessionInput[]): readonly DisplaySession[] {
  const locale = useLocale();
  const t = useTranslation();

  return useMemo(() => {
    const prefix = t('sessions.chatTitlePrefix');
    const now = Date.now();
    return sessions.map(
      (s): DisplaySession => ({
        id: s.id,
        title: s.title,
        tooltipText: buildTooltipText(prefix, s.createdAt, locale),
        metaLine: buildMetaLine(t, s.updatedAt, s.model, now),
      })
    );
  }, [sessions, locale, t]);
}
