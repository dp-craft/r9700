import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Boundary mocks (hoisted before imports per Vitest rules) --

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
  getAllAppSettings: vi.fn(),
  getPaletteBorderColor: vi.fn().mockResolvedValue(null),
  putPaletteBorderColor: vi.fn(),
}));

vi.mock('@/db/providerConfigs', () => ({
  getAllProviderConfigs: vi.fn(),
  getProviderConfig: vi.fn(),
  putProviderConfig: vi.fn(),
}));

vi.mock('@/db/backup', () => ({
  exportAll: vi.fn(),
  validateImport: vi.fn(),
  importAll: vi.fn(),
}));

vi.mock('@/services/llm/registry', () => ({
  lookupProvider: vi.fn(),
}));

import * as appSettingsDb from '@/db/appSettings';
import * as providerConfigsDb from '@/db/providerConfigs';

import { useSettingsStore } from '../useSettingsStore';

// -- Mock accessors --

const mockGetAppSetting = appSettingsDb.getAppSetting as ReturnType<typeof vi.fn>;
const mockGetAllProviderConfigs = providerConfigsDb.getAllProviderConfigs as ReturnType<
  typeof vi.fn
>;

// -- DOM boundary: matchMedia mock with mutable listener support --

type MediaQueryChangeHandler = (event: MediaQueryListEvent) => void;

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: () => void;
  removeListener: () => void;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: () => boolean;
  _listeners: MediaQueryChangeHandler[];
  _fire: (event: Partial<MediaQueryListEvent>) => void;
}

let mockMql: MockMediaQueryList;

const installMatchMediaMock = (initialMatches: boolean): void => {
  mockMql = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: vi.fn((type: string, handler: MediaQueryChangeHandler) => {
      if (type === 'change') {
        mockMql._listeners.push(handler);
      }
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
    _listeners: [],
    _fire(event: Partial<MediaQueryListEvent>): void {
      for (const listener of mockMql._listeners) {
        listener(event as MediaQueryListEvent);
      }
    },
  };

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (_query: string) => mockMql,
  });
};

// -- IDB setup helpers --

const setupIdbWithThemeMode = (themeMode: string | null): void => {
  mockGetAllProviderConfigs.mockResolvedValue([]);
  mockGetAppSetting.mockImplementation((key: string) => {
    if (key === 'theme-preference') return Promise.resolve(themeMode);
    return Promise.resolve(null);
  });
};

// ===========================================================================
// loadAppSettings — OS prefers-color-scheme listener (FR-004)
// ===========================================================================

describe('useSettingsStore.loadAppSettings — OS prefers-color-scheme listener (FR-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.className = '';
    installMatchMediaMock(false);
  });

  it('should apply dark theme class when OS prefers-color-scheme changes to dark and themeMode is system', async () => {
    // Given: IDB themeMode = 'system', OS initially prefers light
    setupIdbWithThemeMode('system');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: a change handler must have been registered
    const registeredHandler = mockMql._listeners[0];
    expect(registeredHandler).toBeDefined();

    // Pre-condition: dark class is absent (OS reports light)
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // When: OS switches to dark
    mockMql.matches = true;
    act(() => {
      mockMql._fire({ matches: true } as Partial<MediaQueryListEvent>);
    });

    // Then: dark class is added
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // When: OS switches back to light
    mockMql.matches = false;
    act(() => {
      mockMql._fire({ matches: false } as Partial<MediaQueryListEvent>);
    });

    // Then: dark class is removed
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('should NOT react to OS preference changes when themeMode is light', async () => {
    // Given: IDB themeMode = 'light', OS initially prefers light
    setupIdbWithThemeMode('light');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Pre-condition: dark class absent (light mode applied)
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // When: OS switches to dark — handler fires (if registered)
    mockMql.matches = true;
    act(() => {
      mockMql._fire({ matches: true } as Partial<MediaQueryListEvent>);
    });

    // Then: dark class must NOT be added (themeMode is not 'system')
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('should NOT react to OS preference changes when themeMode is dark', async () => {
    // Given: IDB themeMode = 'dark', OS initially prefers dark
    installMatchMediaMock(true);
    setupIdbWithThemeMode('dark');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Pre-condition: dark class present (dark mode applied)
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // When: OS switches to light — handler fires (if registered)
    mockMql.matches = false;
    act(() => {
      mockMql._fire({ matches: false } as Partial<MediaQueryListEvent>);
    });

    // Then: dark class must remain (themeMode is not 'system')
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should attach the prefers-color-scheme listener only ONCE across multiple loadAppSettings calls', async () => {
    // Given: IDB themeMode = 'system'
    setupIdbWithThemeMode('system');

    // When: loadAppSettings is called twice (simulates HMR / double-mount)
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: addEventListener must have been called exactly once with 'change'
    const changeCalls = (mockMql.addEventListener as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'change'
    );
    expect(changeCalls).toHaveLength(1);
  });
});
