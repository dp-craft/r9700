import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Boundary mocks (declared before imports per Vitest hoisting rules) --

vi.mock('@/db/providerConfigs', () => ({
  getAllProviderConfigs: vi.fn(),
  getProviderConfig: vi.fn(),
  putProviderConfig: vi.fn(),
  setProviderThinkingCapabilities: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn(),
  putAppSetting: vi.fn(),
  getAllAppSettings: vi.fn(),
  getPaletteBorderColor: vi.fn(),
  putPaletteBorderColor: vi.fn(),
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

import {
  applyFontSizeClass,
  applyPalette,
  DEFAULT_PALETTE_BORDER_COLOR,
  type FontSize,
  useSettingsStore
} from '../useSettingsStore';

// -- Mock accessors --

const mockGetAllProviderConfigs = providerConfigsDb.getAllProviderConfigs as ReturnType<
  typeof vi.fn
>;
const mockGetAppSetting = appSettingsDb.getAppSetting as ReturnType<typeof vi.fn>;
const mockPutAppSetting = appSettingsDb.putAppSetting as ReturnType<typeof vi.fn>;
const mockGetPaletteBorderColor = appSettingsDb.getPaletteBorderColor as ReturnType<typeof vi.fn>;
const mockPutPaletteBorderColor = appSettingsDb.putPaletteBorderColor as ReturnType<typeof vi.fn>;

// -- Helpers --

const getStoreState = () => useSettingsStore.getState();

const TEXT_SCALE_CLASSES: readonly string[] = ['text-scale-sm', 'text-scale-md', 'text-scale-lg'];

const clearAppearanceDom = (): void => {
  const root = document.documentElement;
  for (const cls of TEXT_SCALE_CLASSES) {
    root.classList.remove(cls);
  }
  root.style.removeProperty('--line');
};

const installMatchMediaStub = (): void => {
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
};

const setupEmptyIdb = (): void => {
  mockGetAllProviderConfigs.mockResolvedValue([]);
  mockGetAppSetting.mockResolvedValue(null);
  mockPutAppSetting.mockResolvedValue(undefined);
  mockGetPaletteBorderColor.mockResolvedValue(null);
  mockPutPaletteBorderColor.mockResolvedValue(undefined);
};

// ===========================================================================
// Test Suite
// ===========================================================================

describe('Settings Store — appearance side-effects (font size + palette)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMatchMediaStub();
    clearAppearanceDom();
    setupEmptyIdb();
  });

  // =========================================================================
  // applyFontSizeClass (FR-010)
  // =========================================================================

  describe('applyFontSizeClass', () => {
    it('should set text-scale-lg class on documentElement when size is lg', () => {
      applyFontSizeClass('lg');

      expect(document.documentElement.classList.contains('text-scale-lg')).toBe(true);
    });

    it('should clear other text-scale classes when switching size', () => {
      applyFontSizeClass('lg');

      applyFontSizeClass('sm');

      expect(document.documentElement.classList.contains('text-scale-lg')).toBe(false);
      expect(document.documentElement.classList.contains('text-scale-sm')).toBe(true);
    });
  });

  // =========================================================================
  // setFontSize calls applyFontSizeClass + persists (FR-010, case 1)
  // =========================================================================

  describe('setFontSize', () => {
    it('should apply the text-scale class to documentElement', async () => {
      await act(async () => {
        await getStoreState().setFontSize('lg');
      });

      expect(document.documentElement.classList.contains('text-scale-lg')).toBe(true);
    });

    it('should persist the font size to appSettings', async () => {
      await act(async () => {
        await getStoreState().setFontSize('sm' as FontSize);
      });

      expect(mockPutAppSetting).toHaveBeenCalledWith('font-size', 'sm');
    });
  });

  // =========================================================================
  // applyPalette (NEW:settings.global-color-palette)
  // =========================================================================

  describe('applyPalette', () => {
    it('should set the --line custom property to the palette border color', () => {
      applyPalette({ borderColor: '#abcdef' });

      expect(document.documentElement.style.getPropertyValue('--line')).toBe('#abcdef');
    });

    it('should not set --line when the border color is empty (R-010 guard)', () => {
      applyPalette({ borderColor: '' });

      expect(document.documentElement.style.getPropertyValue('--line')).toBe('');
    });

    it('should remove a previously-set inline --line when border color is reset to empty string', () => {
      // Arrange — simulate a prior inline override (the bug: this was never cleared)
      document.documentElement.style.setProperty('--line', '#ff0000');

      // Act
      applyPalette({ borderColor: DEFAULT_PALETTE_BORDER_COLOR });

      // Assert — inline override is gone; per-theme stylesheet cascade takes over
      expect(document.documentElement.style.getPropertyValue('--line')).toBe('');
    });
  });

  // =========================================================================
  // palette slice default
  // =========================================================================

  describe('palette slice', () => {
    it('should default borderColor to DEFAULT_PALETTE_BORDER_COLOR', () => {
      expect(getStoreState().palette.borderColor).toBe(DEFAULT_PALETTE_BORDER_COLOR);
    });
  });

  // =========================================================================
  // setPaletteColor (case 3)
  // =========================================================================

  describe('setPaletteColor', () => {
    it('should update the palette slice borderColor', async () => {
      await act(async () => {
        await getStoreState().setPaletteColor('borderColor', '#123456');
      });

      expect(getStoreState().palette.borderColor).toBe('#123456');
    });

    it('should persist the color via putPaletteBorderColor', async () => {
      await act(async () => {
        await getStoreState().setPaletteColor('borderColor', '#123456');
      });

      expect(mockPutPaletteBorderColor).toHaveBeenCalledWith('#123456');
    });

    it('should apply the color to the --line custom property', async () => {
      await act(async () => {
        await getStoreState().setPaletteColor('borderColor', '#123456');
      });

      expect(document.documentElement.style.getPropertyValue('--line')).toBe('#123456');
    });

    it('should fall back to the design-gray default when given an empty value (case 4)', async () => {
      await act(async () => {
        await getStoreState().setPaletteColor('borderColor', '');
      });

      expect(getStoreState().palette.borderColor).toBe(DEFAULT_PALETTE_BORDER_COLOR);
      expect(mockPutPaletteBorderColor).toHaveBeenCalledWith(DEFAULT_PALETTE_BORDER_COLOR);
    });

    it('should remove the inline --line override when resetting to empty after a real color was set', async () => {
      // Arrange — set a real custom color first
      await act(async () => {
        await getStoreState().setPaletteColor('borderColor', '#abc123');
      });
      expect(document.documentElement.style.getPropertyValue('--line')).toBe('#abc123');

      // Act — reset to unset sentinel
      await act(async () => {
        await getStoreState().setPaletteColor('borderColor', '');
      });

      // Assert — inline override is removed; theme stylesheet cascade owns --line again
      expect(document.documentElement.style.getPropertyValue('--line')).toBe('');
    });
  });

  // =========================================================================
  // loadAppSettings applies font-size + palette on bootstrap (case 2)
  // =========================================================================

  describe('loadAppSettings', () => {
    it('should apply the persisted font-size class', async () => {
      mockGetAppSetting.mockImplementation((key: string) =>
        Promise.resolve(key === 'font-size' ? 'lg' : null)
      );

      await act(async () => {
        await getStoreState().loadAppSettings();
      });

      expect(document.documentElement.classList.contains('text-scale-lg')).toBe(true);
    });

    it('should read the persisted palette color into the slice', async () => {
      mockGetPaletteBorderColor.mockResolvedValue('#0a0b0c');

      await act(async () => {
        await getStoreState().loadAppSettings();
      });

      expect(getStoreState().palette.borderColor).toBe('#0a0b0c');
    });

    it('should apply the persisted palette color to the --line property', async () => {
      mockGetPaletteBorderColor.mockResolvedValue('#0a0b0c');

      await act(async () => {
        await getStoreState().loadAppSettings();
      });

      expect(document.documentElement.style.getPropertyValue('--line')).toBe('#0a0b0c');
    });

    it('should default the palette slice to design-gray when IDB has no stored color', async () => {
      mockGetPaletteBorderColor.mockResolvedValue(null);

      await act(async () => {
        await getStoreState().loadAppSettings();
      });

      expect(getStoreState().palette.borderColor).toBe(DEFAULT_PALETTE_BORDER_COLOR);
    });

    it('should not leave an inline --line when IDB has no stored palette color (bug regression)', async () => {
      // Arrange — simulate a stale inline override present before load (the bug scenario)
      document.documentElement.style.setProperty('--line', '#stale');
      mockGetPaletteBorderColor.mockResolvedValue(null);

      // Act
      await act(async () => {
        await getStoreState().loadAppSettings();
      });

      // Assert — inline --line removed so per-theme stylesheet cascade is unobstructed
      expect(document.documentElement.style.getPropertyValue('--line')).toBe('');
    });
  });
});
