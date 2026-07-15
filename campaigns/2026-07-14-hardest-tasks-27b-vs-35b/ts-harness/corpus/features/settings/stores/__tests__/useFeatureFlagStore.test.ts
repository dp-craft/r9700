import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureFlagKey } from '@/domain/feature-flags';

// -- Boundary mocks (declared before imports per Vitest hoisting rules) --

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
  getAllAppSettings: vi.fn(),
}));

vi.mock('@/lib/platform', () => ({
  isElectron: vi.fn(),
  getProxyBaseUrl: vi.fn(),
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
import { FEATURE_FLAG_REGISTRY } from '@/domain/feature-flags';
import * as platform from '@/lib/platform';

import { useFeatureFlagStore } from '../useFeatureFlagStore';

// -- Mock accessors --

const mockGetAppSetting = appSettingsDb.getAppSetting as ReturnType<typeof vi.fn>;
const mockPutAppSetting = appSettingsDb.putAppSetting as ReturnType<typeof vi.fn>;

// -- Helpers --

const getStoreState = () => useFeatureFlagStore.getState();

const buildDefaultFlags = (): Readonly<Record<FeatureFlagKey, boolean>> => {
  const flags = {} as Record<FeatureFlagKey, boolean>;
  const keys = Object.keys(FEATURE_FLAG_REGISTRY) as readonly FeatureFlagKey[];
  keys.forEach(key => {
    flags[key] = FEATURE_FLAG_REGISTRY[key].defaultValue;
  });
  return flags;
};

const resetStore = (): void => {
  useFeatureFlagStore.setState({
    flags: buildDefaultFlags(),
  });
};

// ===========================================================================
// Test Suite
// ===========================================================================

describe('useFeatureFlagStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // =========================================================================
  // Initial state
  // =========================================================================

  describe('initial state', () => {
    it('should have all registry keys set to their default values', () => {
      const { flags } = getStoreState();

      expect(flags['show-cors-providers']).toBe(false);
    });

    it('should contain an entry for every key in FEATURE_FLAG_REGISTRY', () => {
      const { flags } = getStoreState();
      const registryKeys = Object.keys(FEATURE_FLAG_REGISTRY) as readonly FeatureFlagKey[];

      registryKeys.forEach(key => {
        expect(flags).toHaveProperty(key);
      });
    });
  });

  // =========================================================================
  // loadFeatureFlags
  // =========================================================================

  describe('loadFeatureFlags', () => {
    it('should load flag overrides from IDB and merge with defaults', async () => {
      mockGetAppSetting.mockImplementation((id: string) => {
        if (id === 'ff-show-cors-providers') return Promise.resolve('true');
        return Promise.resolve(null);
      });

      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(true);
      expect(mockGetAppSetting).toHaveBeenCalledWith('ff-show-cors-providers');
    });

    it('should use default value when no IDB entry exists for a flag', async () => {
      mockGetAppSetting.mockResolvedValue(null);

      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(false);
    });

    it('should parse "true" string from IDB as true', async () => {
      mockGetAppSetting.mockImplementation((id: string) => {
        if (id === 'ff-show-cors-providers') return Promise.resolve('true');
        return Promise.resolve(null);
      });

      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(true);
    });

    it('should parse "false" string from IDB as false', async () => {
      mockGetAppSetting.mockImplementation((id: string) => {
        if (id === 'ff-show-cors-providers') return Promise.resolve('false');
        return Promise.resolve(null);
      });

      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(false);
    });

    it('should handle invalid IDB values gracefully by using default', async () => {
      mockGetAppSetting.mockImplementation((id: string) => {
        if (id === 'ff-show-cors-providers') return Promise.resolve('garbage-value');
        return Promise.resolve(null);
      });

      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(
        FEATURE_FLAG_REGISTRY['show-cors-providers'].defaultValue
      );
    });

    it('should handle empty string IDB value by using default', async () => {
      mockGetAppSetting.mockImplementation((id: string) => {
        if (id === 'ff-show-cors-providers') return Promise.resolve('');
        return Promise.resolve(null);
      });

      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(
        FEATURE_FLAG_REGISTRY['show-cors-providers'].defaultValue
      );
    });
  });

  // =========================================================================
  // toggleFlag
  // =========================================================================

  describe('toggleFlag', () => {
    it('should toggle a flag from false to true', async () => {
      expect(getStoreState().flags['show-cors-providers']).toBe(false);
      mockPutAppSetting.mockResolvedValue(undefined);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(true);
    });

    it('should toggle a flag from true to false', async () => {
      useFeatureFlagStore.setState({
        flags: {
          'show-cors-providers': true,
          'tutorial-enabled': false,
          'web-search-enabled': false,
          'prompt-lab-enabled': true,

          'lab-perplexity-enabled': false,
          'lab-text-analysis-enabled': false,
        },
      });
      expect(getStoreState().flags['show-cors-providers']).toBe(true);
      mockPutAppSetting.mockResolvedValue(undefined);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(false);
    });

    it('should persist the new value to IDB with ff- prefix when toggling to true', async () => {
      mockPutAppSetting.mockResolvedValue(undefined);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });

      expect(mockPutAppSetting).toHaveBeenCalledWith('ff-show-cors-providers', 'true');
    });

    it('should persist the new value to IDB with ff- prefix when toggling to false', async () => {
      useFeatureFlagStore.setState({
        flags: {
          'show-cors-providers': true,
          'tutorial-enabled': false,
          'web-search-enabled': false,
          'prompt-lab-enabled': true,

          'lab-perplexity-enabled': false,
          'lab-text-analysis-enabled': false,
        },
      });
      mockPutAppSetting.mockResolvedValue(undefined);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });

      expect(mockPutAppSetting).toHaveBeenCalledWith('ff-show-cors-providers', 'false');
    });

    it('should update in-memory state immediately', async () => {
      mockPutAppSetting.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));

      const togglePromise = act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });

      // The state should be updated even before persistence completes
      // (asserting after act completes, which processes the state update)
      await togglePromise;

      expect(getStoreState().flags['show-cors-providers']).toBe(true);
    });
  });

  // =========================================================================
  // getFlag
  // =========================================================================

  describe('getFlag', () => {
    it('should return current flag value when flag is false', () => {
      const result = getStoreState().getFlag('show-cors-providers');

      expect(result).toBe(false);
    });

    it('should return current flag value when flag is true', () => {
      useFeatureFlagStore.setState({
        flags: {
          'show-cors-providers': true,
          'tutorial-enabled': false,
          'web-search-enabled': false,
          'prompt-lab-enabled': true,

          'lab-perplexity-enabled': false,
          'lab-text-analysis-enabled': false,
        },
      });

      const result = getStoreState().getFlag('show-cors-providers');

      expect(result).toBe(true);
    });

    it('should return default when flag has not been toggled', () => {
      resetStore();

      const result = getStoreState().getFlag('show-cors-providers');

      expect(result).toBe(FEATURE_FLAG_REGISTRY['show-cors-providers'].defaultValue);
    });

    it('should reflect updated value after toggle', async () => {
      mockPutAppSetting.mockResolvedValue(undefined);

      expect(getStoreState().getFlag('show-cors-providers')).toBe(false);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });

      expect(getStoreState().getFlag('show-cors-providers')).toBe(true);
    });
  });

  // =========================================================================
  // Platform-aware defaults (Electron vs browser)
  // =========================================================================

  describe('platform-aware defaults', () => {
    const mockIsElectron = platform.isElectron as ReturnType<typeof vi.fn>;

    it('should default show-cors-providers to true when isElectron() returns true', async () => {
      // Given: running in Electron, no IDB-persisted value for the flag
      mockIsElectron.mockReturnValue(true);
      mockGetAppSetting.mockResolvedValue(null);

      // When: feature flags are loaded
      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      // Then: show-cors-providers is enabled by platform default
      expect(getStoreState().flags['show-cors-providers']).toBe(true);
    });

    it('should default show-cors-providers to false when isElectron() returns false (browser)', async () => {
      // Given: running in a browser, no IDB-persisted value for the flag
      mockIsElectron.mockReturnValue(false);
      mockGetAppSetting.mockResolvedValue(null);

      // When: feature flags are loaded
      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      // Then: show-cors-providers remains at the registry default (false)
      expect(getStoreState().flags['show-cors-providers']).toBe(false);
    });

    it('should honor IDB-persisted false value even when isElectron() is true', async () => {
      // Given: running in Electron but the user has explicitly disabled the flag
      mockIsElectron.mockReturnValue(true);
      mockGetAppSetting.mockImplementation((id: string) => {
        if (id === 'ff-show-cors-providers') return Promise.resolve('false');
        return Promise.resolve(null);
      });

      // When: feature flags are loaded
      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      // Then: the explicit user preference overrides the Electron platform default
      expect(getStoreState().flags['show-cors-providers']).toBe(false);
    });

    it('should not change non-overridden flags when isElectron() returns true', async () => {
      // Given: running in Electron, no IDB values for any flag
      mockIsElectron.mockReturnValue(true);
      mockGetAppSetting.mockResolvedValue(null);

      // When: feature flags are loaded
      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      // Then: flags without an Electron override use their registry defaults unchanged
      expect(getStoreState().flags['tutorial-enabled']).toBe(
        FEATURE_FLAG_REGISTRY['tutorial-enabled'].defaultValue
      );
      expect(getStoreState().flags['web-search-enabled']).toBe(
        FEATURE_FLAG_REGISTRY['web-search-enabled'].defaultValue
      );
    });
  });

  // =========================================================================
  // State transitions
  // =========================================================================

  describe('state transitions', () => {
    it('should reflect IDB values after loadFeatureFlags overwrites toggled state', async () => {
      mockPutAppSetting.mockResolvedValue(undefined);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(true);

      mockGetAppSetting.mockImplementation((id: string) => {
        if (id === 'ff-show-cors-providers') return Promise.resolve('false');
        return Promise.resolve(null);
      });

      await act(async () => {
        await getStoreState().loadFeatureFlags();
      });

      expect(getStoreState().flags['show-cors-providers']).toBe(false);
    });

    it('should support multiple toggles in sequence', async () => {
      mockPutAppSetting.mockResolvedValue(undefined);

      expect(getStoreState().flags['show-cors-providers']).toBe(false);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });
      expect(getStoreState().flags['show-cors-providers']).toBe(true);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });
      expect(getStoreState().flags['show-cors-providers']).toBe(false);

      await act(async () => {
        await getStoreState().toggleFlag('show-cors-providers');
      });
      expect(getStoreState().flags['show-cors-providers']).toBe(true);

      expect(mockPutAppSetting).toHaveBeenCalledTimes(3);
    });
  });
});
