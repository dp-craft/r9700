import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Boundary mocks (declared before imports per Vitest hoisting rules) --

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
  getAllAppSettings: vi.fn(),
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

// -- Import after mocks --

import type { FeatureFlagKey } from '@/domain/feature-flags';
import { FEATURE_FLAG_REGISTRY } from '@/domain/feature-flags';

import { useFeatureFlagStore } from '../../stores/useFeatureFlagStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useCorsProviderFallback } from '../useCorsProviderFallback';

// -- Helpers --

const buildDefaultFlags = (): Readonly<Record<FeatureFlagKey, boolean>> => {
  const flags = {} as Record<FeatureFlagKey, boolean>;
  const keys = Object.keys(FEATURE_FLAG_REGISTRY) as readonly FeatureFlagKey[];
  keys.forEach(key => {
    flags[key] = FEATURE_FLAG_REGISTRY[key].defaultValue;
  });
  return flags;
};

const resetFlagStore = (): void => {
  useFeatureFlagStore.setState({ flags: buildDefaultFlags() });
};

const setupSettingsStoreSpy = (activeProviderId: string) => {
  const setActiveProviderSpy = vi.fn();
  const setActiveModelSpy = vi.fn();
  useSettingsStore.setState({
    activeProviderId,
    setActiveProvider: setActiveProviderSpy,
    setActiveModel: setActiveModelSpy,
  });
  return { setActiveProviderSpy, setActiveModelSpy };
};

// ===========================================================================
// Test Suite
// ===========================================================================

describe('useCorsProviderFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFlagStore();
  });

  it('should fall back to Ollama when toggling CORS flag OFF and active provider is CORS-blocked', async () => {
    // Arrange
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
    const { setActiveProviderSpy } = setupSettingsStoreSpy('claude');

    renderHook(() => useCorsProviderFallback());

    // Act -- simulate flag transitioning from true -> false
    await act(async () => {
      useFeatureFlagStore.setState({
        flags: {
          'show-cors-providers': false,
          'tutorial-enabled': false,
          'web-search-enabled': false,
          'prompt-lab-enabled': true,
          'lab-perplexity-enabled': false,
          'lab-text-analysis-enabled': false,
        },
      });
    });

    // Assert
    expect(setActiveProviderSpy).toHaveBeenCalledWith('ollama');
  });

  it('should reset active model when falling back', async () => {
    // Arrange
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
    const { setActiveModelSpy } = setupSettingsStoreSpy('claude');

    renderHook(() => useCorsProviderFallback());

    // Act
    await act(async () => {
      useFeatureFlagStore.setState({
        flags: {
          'show-cors-providers': false,
          'tutorial-enabled': false,
          'web-search-enabled': false,
          'prompt-lab-enabled': true,
          'lab-perplexity-enabled': false,
          'lab-text-analysis-enabled': false,
        },
      });
    });

    // Assert
    expect(setActiveModelSpy).toHaveBeenCalledWith('');
  });

  it('should NOT fall back when toggling CORS flag OFF and active provider is CORS-native', async () => {
    // Arrange
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
    const { setActiveProviderSpy } = setupSettingsStoreSpy('ollama');

    renderHook(() => useCorsProviderFallback());

    // Act
    await act(async () => {
      useFeatureFlagStore.setState({
        flags: {
          'show-cors-providers': false,
          'tutorial-enabled': false,
          'web-search-enabled': false,
          'prompt-lab-enabled': true,
          'lab-perplexity-enabled': false,
          'lab-text-analysis-enabled': false,
        },
      });
    });

    // Assert
    expect(setActiveProviderSpy).not.toHaveBeenCalled();
  });

  it('should NOT fall back when toggling CORS flag ON', async () => {
    // Arrange -- flag starts OFF (default), active provider is CORS-blocked
    const { setActiveProviderSpy } = setupSettingsStoreSpy('claude');

    renderHook(() => useCorsProviderFallback());

    // Act -- toggle ON (false -> true)
    await act(async () => {
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
    });

    // Assert
    expect(setActiveProviderSpy).not.toHaveBeenCalled();
  });

  it('should NOT fall back when active provider is OpenRouter', async () => {
    // Arrange -- OpenRouter is CORS-native
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
    const { setActiveProviderSpy } = setupSettingsStoreSpy('openrouter');

    renderHook(() => useCorsProviderFallback());

    // Act
    await act(async () => {
      useFeatureFlagStore.setState({
        flags: {
          'show-cors-providers': false,
          'tutorial-enabled': false,
          'web-search-enabled': false,
          'prompt-lab-enabled': true,
          'lab-perplexity-enabled': false,
          'lab-text-analysis-enabled': false,
        },
      });
    });

    // Assert
    expect(setActiveProviderSpy).not.toHaveBeenCalled();
  });
});
