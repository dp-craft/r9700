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
import { useUIStore } from '@/stores/useUIStore';

import { useSettingsStore } from '../useSettingsStore';

// -- Mock accessors --

const mockGetAppSetting = appSettingsDb.getAppSetting as ReturnType<typeof vi.fn>;
const mockGetAllProviderConfigs = providerConfigsDb.getAllProviderConfigs as ReturnType<
  typeof vi.fn
>;

// -- DOM boundary: polyfill window.matchMedia (not available in jsdom) --

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// -- Helpers --

const resetStores = (): void => {
  act(() => {
    useUIStore.setState({ workspace: 'chat', activeDialog: null, dialogPayload: null });
  });
};

const setupIdbWithActivePage = (activePageValue: string | null): void => {
  mockGetAllProviderConfigs.mockResolvedValue([]);
  mockGetAppSetting.mockImplementation((key: string) => {
    if (key === 'active-page') return Promise.resolve(activePageValue);
    return Promise.resolve(null);
  });
};

// ===========================================================================
// loadAppSettings — workspace rehydration with sanitization
// ===========================================================================

describe('useSettingsStore.loadAppSettings — workspace rehydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it('should set workspace to prompt-lab when IDB returns prompt-lab', async () => {
    // Given: IDB has 'active-page' = 'prompt-lab'
    setupIdbWithActivePage('prompt-lab');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: useUIStore workspace is 'prompt-lab'
    expect(useUIStore.getState().workspace).toBe('prompt-lab');
  });

  it('should set workspace to chat when IDB returns null', async () => {
    // Given: IDB has no 'active-page' entry (null)
    setupIdbWithActivePage(null);

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: useUIStore workspace falls back to 'chat'
    expect(useUIStore.getState().workspace).toBe('chat');
  });

  it('should set workspace to chat when IDB returns an invalid value', async () => {
    // Given: IDB has 'active-page' = 'invalid' (unknown literal)
    setupIdbWithActivePage('invalid');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: useUIStore workspace falls back to 'chat'
    expect(useUIStore.getState().workspace).toBe('chat');
  });

  it('should set workspace to chat when IDB returns run-history (legacy page value)', async () => {
    // Given: IDB has 'active-page' = 'run-history' (legacy value, not a valid Workspace)
    setupIdbWithActivePage('run-history');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: useUIStore workspace falls back to 'chat' via sanitizeWorkspace
    expect(useUIStore.getState().workspace).toBe('chat');
  });

  it('should set workspace to chat when IDB returns skills (legacy page value)', async () => {
    // Given: IDB has 'active-page' = 'skills' (removed from Workspace union)
    setupIdbWithActivePage('skills');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: useUIStore workspace falls back to 'chat'
    expect(useUIStore.getState().workspace).toBe('chat');
  });

  it('should set workspace to chat when IDB returns prompt-history (legacy page value)', async () => {
    // Given: IDB has 'active-page' = 'prompt-history' (legacy value)
    setupIdbWithActivePage('prompt-history');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: useUIStore workspace falls back to 'chat'
    expect(useUIStore.getState().workspace).toBe('chat');
  });

  it('should preserve existing workspace as chat when IDB returns chat', async () => {
    // Given: IDB has 'active-page' = 'chat'
    setupIdbWithActivePage('chat');

    // When: loadAppSettings is called
    await act(async () => {
      await useSettingsStore.getState().loadAppSettings();
    });

    // Then: useUIStore workspace is 'chat'
    expect(useUIStore.getState().workspace).toBe('chat');
  });
});
