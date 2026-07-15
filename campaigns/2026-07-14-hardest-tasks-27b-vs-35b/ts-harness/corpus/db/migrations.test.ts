import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSession } from './idb';

// ---------------------------------------------------------------------------
// Module mocks — declared before imports per Vitest hoisting rules
// ---------------------------------------------------------------------------

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
}));

vi.mock('@/db/sessions', () => ({
  getAllSessions: vi.fn(),
  putSession: vi.fn(),
}));

import * as appSettings from '@/db/appSettings';
import * as sessions from '@/db/sessions';

import { runV5Migration } from './migrations';

// ---------------------------------------------------------------------------
// Mock aliases
// ---------------------------------------------------------------------------

const mockGetAppSetting = appSettings.getAppSetting as ReturnType<typeof vi.fn>;
const mockPutAppSetting = appSettings.putAppSetting as ReturnType<typeof vi.fn>;
const mockGetAllSessions = sessions.getAllSessions as ReturnType<typeof vi.fn>;
const mockPutSession = sessions.putSession as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXED_TIMESTAMP = 1_700_000_000_000;
const FIXED_DATE_STRING = new Date(FIXED_TIMESTAMP).toLocaleString();

const LS_FONT_SIZE_KEY = 'app:font-size';
const LS_THEME_KEY = 'theme-preference';
const LS_TUTORIAL_KEY = 'tutorial-progress';
const GUARD_FLAG_KEY = 'migration-v5-done';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
  id: 'session-1',
  title: 'Existing Title',
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  model: 'llama3',
  providerId: 'ollama',
  skillSnapshot: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const buildLocalStorageMock = (initial: Record<string, string> = {}) => {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  };
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('runV5Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: guard flag not set, no sessions
    mockGetAppSetting.mockResolvedValue(null);
    mockPutAppSetting.mockResolvedValue(undefined);
    mockGetAllSessions.mockResolvedValue([]);
    mockPutSession.mockResolvedValue(undefined);

    // Default: localStorage has no migration keys
    vi.stubGlobal('localStorage', buildLocalStorageMock());
  });

  // -------------------------------------------------------------------------
  // Idempotency guard
  // -------------------------------------------------------------------------

  describe('guard flag', () => {
    it('should skip migration when guard flag is already set', async () => {
      mockGetAppSetting.mockResolvedValueOnce('true');

      await runV5Migration();

      expect(mockGetAllSessions).not.toHaveBeenCalled();
      expect(mockPutAppSetting).not.toHaveBeenCalled();
    });

    it('should set guard flag after migration completes', async () => {
      await runV5Migration();

      expect(mockPutAppSetting).toHaveBeenCalledWith(GUARD_FLAG_KEY, 'true');
    });
  });

  // -------------------------------------------------------------------------
  // localStorage → IDB migration
  // -------------------------------------------------------------------------

  describe('localStorage key migration', () => {
    it('should migrate font-size from localStorage to IDB when present', async () => {
      vi.stubGlobal('localStorage', buildLocalStorageMock({ [LS_FONT_SIZE_KEY]: 'large' }));

      await runV5Migration();

      expect(mockPutAppSetting).toHaveBeenCalledWith('font-size', 'large');
    });

    it('should migrate theme-preference from localStorage to IDB when present', async () => {
      vi.stubGlobal('localStorage', buildLocalStorageMock({ [LS_THEME_KEY]: 'dark' }));

      await runV5Migration();

      expect(mockPutAppSetting).toHaveBeenCalledWith('theme-preference', 'dark');
    });

    it('should migrate tutorial-progress from localStorage to IDB when present', async () => {
      vi.stubGlobal(
        'localStorage',
        buildLocalStorageMock({ [LS_TUTORIAL_KEY]: '{"completedGoals":[]}' })
      );

      await runV5Migration();

      expect(mockPutAppSetting).toHaveBeenCalledWith('tutorial-progress', '{"completedGoals":[]}');
    });

    it('should not call putAppSetting for missing localStorage keys', async () => {
      // localStorage has no migration keys — only the guard flag write is expected
      await runV5Migration();

      const putCalls = mockPutAppSetting.mock.calls as [string, string][];
      const migrationKeyCalls = putCalls.filter(([key]) =>
        [LS_FONT_SIZE_KEY, 'font-size', LS_THEME_KEY, LS_TUTORIAL_KEY].includes(key)
      );
      expect(migrationKeyCalls).toHaveLength(0);
    });

    it('should migrate only the keys that exist in localStorage', async () => {
      vi.stubGlobal('localStorage', buildLocalStorageMock({ [LS_FONT_SIZE_KEY]: 'small' }));

      await runV5Migration();

      const putCalls = mockPutAppSetting.mock.calls as [string, string][];
      const dataKeys = putCalls.filter(([key]) => key !== GUARD_FLAG_KEY).map(([key]) => key);
      expect(dataKeys).toEqual(['font-size']);
    });
  });

  // -------------------------------------------------------------------------
  // Session title backfill
  // -------------------------------------------------------------------------

  describe('session title backfill', () => {
    it('should backfill empty string titles with formatted createdAt timestamp', async () => {
      const session = buildSession({ title: '', createdAt: FIXED_TIMESTAMP });
      mockGetAllSessions.mockResolvedValueOnce([session]);

      await runV5Migration();

      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: session.id, title: FIXED_DATE_STRING })
      );
    });

    it('should backfill undefined titles with formatted createdAt timestamp', async () => {
      const session = buildSession({
        title: undefined as unknown as string,
        createdAt: FIXED_TIMESTAMP,
      });
      mockGetAllSessions.mockResolvedValueOnce([session]);

      await runV5Migration();

      expect(mockPutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: session.id, title: FIXED_DATE_STRING })
      );
    });

    it('should not overwrite existing non-empty session titles', async () => {
      const session = buildSession({ title: 'My Conversation', createdAt: FIXED_TIMESTAMP });
      mockGetAllSessions.mockResolvedValueOnce([session]);

      await runV5Migration();

      expect(mockPutSession).not.toHaveBeenCalled();
    });

    it('should backfill only sessions with missing titles when mixed', async () => {
      const needsBackfill = buildSession({
        id: 'session-empty',
        title: '',
        createdAt: FIXED_TIMESTAMP,
      });
      const hasTitle = buildSession({
        id: 'session-titled',
        title: 'Existing',
        createdAt: FIXED_TIMESTAMP,
      });
      mockGetAllSessions.mockResolvedValueOnce([needsBackfill, hasTitle]);

      await runV5Migration();

      expect(mockPutSession).toHaveBeenCalledTimes(1);
      expect(mockPutSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-empty' }));
    });

    it('should preserve all other session fields when backfilling title', async () => {
      const session = buildSession({
        id: 'session-abc',
        title: '',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP + 5000,
        model: 'mistral',
        providerId: 'openrouter',
      });
      mockGetAllSessions.mockResolvedValueOnce([session]);

      await runV5Migration();

      expect(mockPutSession).toHaveBeenCalledWith({
        ...session,
        title: FIXED_DATE_STRING,
      });
    });

    it('should not call putSession when there are no sessions', async () => {
      mockGetAllSessions.mockResolvedValueOnce([]);

      await runV5Migration();

      expect(mockPutSession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // localStorage cleanup
  // -------------------------------------------------------------------------

  describe('localStorage key removal', () => {
    it('should remove app:font-size from localStorage after migration', async () => {
      const localStorageMock = buildLocalStorageMock({ [LS_FONT_SIZE_KEY]: 'medium' });
      vi.stubGlobal('localStorage', localStorageMock);

      await runV5Migration();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(LS_FONT_SIZE_KEY);
    });

    it('should remove theme-preference from localStorage after migration', async () => {
      const localStorageMock = buildLocalStorageMock({ [LS_THEME_KEY]: 'light' });
      vi.stubGlobal('localStorage', localStorageMock);

      await runV5Migration();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(LS_THEME_KEY);
    });

    it('should remove tutorial-progress from localStorage after migration', async () => {
      const localStorageMock = buildLocalStorageMock({ [LS_TUTORIAL_KEY]: '{}' });
      vi.stubGlobal('localStorage', localStorageMock);

      await runV5Migration();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(LS_TUTORIAL_KEY);
    });

    it('should remove all three localStorage keys even when none were present', async () => {
      const localStorageMock = buildLocalStorageMock();
      vi.stubGlobal('localStorage', localStorageMock);

      await runV5Migration();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(LS_FONT_SIZE_KEY);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(LS_THEME_KEY);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(LS_TUTORIAL_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('should not throw when getAppSetting throws', async () => {
      mockGetAppSetting.mockRejectedValueOnce(new Error('IDB unavailable'));

      await expect(runV5Migration()).resolves.toBeUndefined();
    });

    it('should not throw when getAllSessions throws', async () => {
      mockGetAllSessions.mockRejectedValueOnce(new Error('Sessions read failed'));

      await expect(runV5Migration()).resolves.toBeUndefined();
    });

    it('should not throw when putAppSetting throws', async () => {
      mockPutAppSetting.mockRejectedValueOnce(new Error('Write failed'));

      await expect(runV5Migration()).resolves.toBeUndefined();
    });

    it('should not throw when putSession throws for one session', async () => {
      const session = buildSession({ title: '' });
      mockGetAllSessions.mockResolvedValueOnce([session]);
      mockPutSession.mockRejectedValueOnce(new Error('Session write failed'));

      await expect(runV5Migration()).resolves.toBeUndefined();
    });

    it('should log error to console.error when an error occurs', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockGetAppSetting.mockRejectedValueOnce(new Error('IDB unavailable'));

      await runV5Migration();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
