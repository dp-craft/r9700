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
  getLabEvalProvider: vi.fn(),
  setLabEvalProvider: vi.fn(),
  getLabEvalModel: vi.fn(),
  setLabEvalModel: vi.fn(),
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

import { useSettingsStore } from '../useSettingsStore';

// -- Mock accessors --

const mockGetLabEvalProvider = appSettingsDb.getLabEvalProvider as ReturnType<typeof vi.fn>;
const mockSetLabEvalProvider = appSettingsDb.setLabEvalProvider as ReturnType<typeof vi.fn>;
const mockGetLabEvalModel = appSettingsDb.getLabEvalModel as ReturnType<typeof vi.fn>;
const mockSetLabEvalModel = appSettingsDb.setLabEvalModel as ReturnType<typeof vi.fn>;

const getStoreState = () => useSettingsStore.getState();

describe('Settings Store — eval-config slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLabEvalProvider.mockResolvedValue(null);
    mockSetLabEvalProvider.mockResolvedValue(undefined);
    mockGetLabEvalModel.mockResolvedValue(null);
    mockSetLabEvalModel.mockResolvedValue(undefined);
    useSettingsStore.setState({ labEvalModelId: null, labEvalProviderId: null });
  });

  describe('setLabEvalProvider', () => {
    it('should set the provider id', async () => {
      await act(async () => {
        await getStoreState().setLabEvalProvider('openrouter');
      });

      expect(getStoreState().labEvalProviderId).toBe('openrouter');
    });

    it('should clear the model id when provider changes (atomic)', async () => {
      useSettingsStore.setState({ labEvalModelId: 'gpt-4o' });

      await act(async () => {
        await getStoreState().setLabEvalProvider('openrouter');
      });

      expect(getStoreState().labEvalModelId).toBeNull();
    });

    it('should persist the provider via setLabEvalProvider accessor', async () => {
      await act(async () => {
        await getStoreState().setLabEvalProvider('openrouter');
      });

      expect(mockSetLabEvalProvider).toHaveBeenCalledWith('openrouter');
    });

    it('should persist the cleared model via setLabEvalModel accessor', async () => {
      useSettingsStore.setState({ labEvalModelId: 'gpt-4o' });

      await act(async () => {
        await getStoreState().setLabEvalProvider('openrouter');
      });

      expect(mockSetLabEvalModel).toHaveBeenCalledWith(null);
    });
  });

  describe('setLabEvalModel', () => {
    it('should set the model id', async () => {
      await act(async () => {
        await getStoreState().setLabEvalModel('gpt-4o-mini');
      });

      expect(getStoreState().labEvalModelId).toBe('gpt-4o-mini');
    });

    it('should persist the model via setLabEvalModel accessor', async () => {
      await act(async () => {
        await getStoreState().setLabEvalModel('gpt-4o-mini');
      });

      expect(mockSetLabEvalModel).toHaveBeenCalledWith('gpt-4o-mini');
    });
  });

  describe('loadLabEvalConfig', () => {
    it('should read the persisted provider into the slice', async () => {
      mockGetLabEvalProvider.mockResolvedValue('gemini');

      await act(async () => {
        await getStoreState().loadLabEvalConfig();
      });

      expect(getStoreState().labEvalProviderId).toBe('gemini');
    });

    it('should read the persisted model into the slice', async () => {
      mockGetLabEvalModel.mockResolvedValue('gemini-2.0-flash');

      await act(async () => {
        await getStoreState().loadLabEvalConfig();
      });

      expect(getStoreState().labEvalModelId).toBe('gemini-2.0-flash');
    });

    it('should leave the slice null when IDB has no stored eval config', async () => {
      await act(async () => {
        await getStoreState().loadLabEvalConfig();
      });

      expect(getStoreState().labEvalProviderId).toBeNull();
      expect(getStoreState().labEvalModelId).toBeNull();
    });
  });
});
