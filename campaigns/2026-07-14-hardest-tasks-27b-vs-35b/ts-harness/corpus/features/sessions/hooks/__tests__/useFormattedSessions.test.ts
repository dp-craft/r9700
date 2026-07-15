import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n';
import { formatDateTime } from '@/i18n';

// -- Boundary mock: i18n hooks --

const mockLocale = vi.fn<() => Locale>().mockReturnValue('hu');
const mockTranslationFn = vi.fn((key: string, params?: Record<string, unknown>) => {
  const count = params?.count as number | undefined;
  const translations: Readonly<Record<string, string>> = {
    'sessions.chatTitlePrefix': 'Beszélgetés',
    'sessions.metaNow': 'now',
    'sessions.metaMin': `${count} min`,
    'sessions.metaHour': `${count} h`,
    'sessions.metaDay': `${count} d`,
  };
  return translations[key] ?? key;
});
const mockUseTranslation = vi.fn().mockReturnValue(mockTranslationFn);

vi.mock('@/i18n', async importOriginal => {
  const original = await importOriginal<typeof import('@/i18n')>();
  return {
    ...original,
    useLocale: () => mockLocale(),
    useTranslation: () => mockUseTranslation(),
  };
});

import { useFormattedSessions } from '../useFormattedSessions';

// -- Constants --

const TEST_DATE = new Date(2026, 1, 28, 10, 30, 0);
const TEST_TIMESTAMP = TEST_DATE.getTime();
const SECOND_TIMESTAMP = new Date(2026, 0, 15, 14, 0, 0).getTime();
const BASE_NOW = new Date(2026, 3, 1, 12, 0, 0).getTime();

// -- Builder --

interface TestSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly model?: string;
}

const buildSession = (overrides?: Partial<TestSession>): TestSession => ({
  id: 'session-1',
  title: 'Test Session',
  createdAt: TEST_TIMESTAMP,
  ...overrides,
});

// -- Tests --

describe('useFormattedSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale.mockReturnValue('hu');
    mockTranslationFn.mockImplementation((key: string, params?: Record<string, unknown>) => {
      const count = params?.count as number | undefined;
      const translations: Readonly<Record<string, string>> = {
        'sessions.chatTitlePrefix': 'Beszélgetés',
        'sessions.metaNow': 'now',
        'sessions.metaMin': `${count} min`,
        'sessions.metaHour': `${count} h`,
        'sessions.metaDay': `${count} d`,
      };
      return translations[key] ?? key;
    });
    mockUseTranslation.mockReturnValue(mockTranslationFn);
  });

  it('should return empty array when given empty sessions array', () => {
    const { result } = renderHook(() => useFormattedSessions([]));

    expect(result.current).toEqual([]);
  });

  it('should pass through title from session input', () => {
    const sessions = [buildSession({ title: 'My Custom Session' })] as const;

    const { result } = renderHook(() => useFormattedSessions(sessions));

    expect(result.current[0].title).toBe('My Custom Session');
  });

  it('should generate tooltipText from createdAt timestamp using Hungarian locale by default', () => {
    const sessions = [buildSession()] as const;
    const expectedTooltip = `Beszélgetés ${formatDateTime(TEST_TIMESTAMP, 'hu')}`;

    const { result } = renderHook(() => useFormattedSessions(sessions));

    expect(result.current).toHaveLength(1);
    expect(result.current[0].tooltipText).toBe(expectedTooltip);
  });

  it('should format tooltipText using English locale when uiLanguage is en', () => {
    mockLocale.mockReturnValue('en');
    mockTranslationFn.mockImplementation((key: string) => {
      const translations: Readonly<Record<string, string>> = {
        'sessions.chatTitlePrefix': 'Chat',
      };
      return translations[key] ?? key;
    });
    const sessions = [buildSession()] as const;
    const expectedTooltip = `Chat ${formatDateTime(TEST_TIMESTAMP, 'en')}`;

    const { result } = renderHook(() => useFormattedSessions(sessions));

    expect(result.current[0].tooltipText).toBe(expectedTooltip);
  });

  it('should preserve session id in output', () => {
    const sessions = [buildSession({ id: 'custom-id-42' })] as const;

    const { result } = renderHook(() => useFormattedSessions(sessions));

    expect(result.current[0].id).toBe('custom-id-42');
  });

  it('should handle multiple sessions maintaining order', () => {
    const sessions = [
      buildSession({ id: 'first', title: 'First Session', createdAt: TEST_TIMESTAMP }),
      buildSession({ id: 'second', title: 'Second Session', createdAt: SECOND_TIMESTAMP }),
    ] as const;

    const { result } = renderHook(() => useFormattedSessions(sessions));

    expect(result.current).toHaveLength(2);
    expect(result.current[0].id).toBe('first');
    expect(result.current[1].id).toBe('second');
    expect(result.current[0].title).toBe('First Session');
    expect(result.current[1].title).toBe('Second Session');
    expect(result.current[0].tooltipText).toBe(
      `Beszélgetés ${formatDateTime(TEST_TIMESTAMP, 'hu')}`
    );
    expect(result.current[1].tooltipText).toBe(
      `Beszélgetés ${formatDateTime(SECOND_TIMESTAMP, 'hu')}`
    );
  });

  it('should use createdAt timestamp for tooltipText not other fields', () => {
    const createdAt = TEST_TIMESTAMP;
    const differentTimestamp = new Date(2026, 5, 15, 8, 0, 0).getTime();
    const sessions = [buildSession({ createdAt })] as const;

    const { result } = renderHook(() => useFormattedSessions(sessions));

    const expectedFromCreatedAt = `Beszélgetés ${formatDateTime(createdAt, 'hu')}`;
    const notExpectedFromOther = `Beszélgetés ${formatDateTime(differentTimestamp, 'hu')}`;

    expect(result.current[0].tooltipText).toBe(expectedFromCreatedAt);
    expect(result.current[0].tooltipText).not.toBe(notExpectedFromOther);
  });

  it('should not derive title from timestamp — title comes from input only', () => {
    const sessions = [buildSession({ title: 'Explicit Title' })] as const;
    const generatedTitle = `Beszélgetés ${formatDateTime(TEST_TIMESTAMP, 'hu')}`;

    const { result } = renderHook(() => useFormattedSessions(sessions));

    expect(result.current[0].title).toBe('Explicit Title');
    expect(result.current[0].title).not.toBe(generatedTitle);
  });

  describe('metaLine', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(BASE_NOW));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return undefined metaLine when updatedAt and model are both absent', () => {
      const sessions = [buildSession()] as const;

      const { result } = renderHook(() => useFormattedSessions(sessions));

      expect(result.current[0].metaLine).toBeUndefined();
    });

    it('should include "now" in metaLine when updatedAt is 30 seconds ago', () => {
      const sessions = [buildSession({ updatedAt: BASE_NOW - 30_000 })] as const;

      const { result } = renderHook(() => useFormattedSessions(sessions));

      expect(result.current[0].metaLine).toBe('now');
    });

    it('should format metaLine as "<N> min · <model>" when updatedAt is 3 minutes ago', () => {
      const sessions = [
        buildSession({ updatedAt: BASE_NOW - 3 * 60_000, model: 'GPT-5' }),
      ] as const;

      const { result } = renderHook(() => useFormattedSessions(sessions));

      expect(result.current[0].metaLine).toBe('3 min · GPT-5');
    });

    it('should format metaLine as "<N> h · <model>" when updatedAt is 2 hours ago', () => {
      const sessions = [
        buildSession({ updatedAt: BASE_NOW - 2 * 3_600_000, model: 'Claude' }),
      ] as const;

      const { result } = renderHook(() => useFormattedSessions(sessions));

      expect(result.current[0].metaLine).toBe('2 h · Claude');
    });

    it('should format metaLine as "<N> d" when updatedAt is 5 days ago and no model', () => {
      const sessions = [buildSession({ updatedAt: BASE_NOW - 5 * 86_400_000 })] as const;

      const { result } = renderHook(() => useFormattedSessions(sessions));

      expect(result.current[0].metaLine).toBe('5 d');
    });

    it('should return model name as metaLine when only model is provided without updatedAt', () => {
      const sessions = [buildSession({ model: 'gpt-4' })] as const;

      const { result } = renderHook(() => useFormattedSessions(sessions));

      expect(result.current[0].metaLine).toBe('gpt-4');
    });
  });
});
