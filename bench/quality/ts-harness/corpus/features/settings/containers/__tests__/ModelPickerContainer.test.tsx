import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Boundary mocks (declared before imports per Vitest hoisting rules) --

const mockSetModelMetadataOpen = vi.fn();
const mockSetModelThinkingEnabled = vi.fn();

let mockActiveModelId = 'anthropic/claude-3.5-sonnet';
let mockThinkingCapableModels: Record<string, boolean> = {};

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('../../hooks/useModelList', () => ({
  useModelList: () => ({
    models: [
      {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        supportsThinking: true,
      },
    ],
    isLoading: false,
    error: null,
    contextSize: 200000,
    handleModelChange: vi.fn(),
    handleContextSizeChange: vi.fn(),
  }),
}));

vi.mock('../../utils/modelMetadataRows', () => ({
  buildModelMetadataRows: () => [],
}));

const buildState = (): Record<string, unknown> => ({
  activeModelId: mockActiveModelId,
  activeProviderId: 'openrouter',
  providerConfigs: {
    openrouter: { thinkingCapableModels: mockThinkingCapableModels },
  },
  modelMetadataOpen: true,
  setModelMetadataOpen: mockSetModelMetadataOpen,
  setModelThinkingEnabled: mockSetModelThinkingEnabled,
});

vi.mock('../../stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) => selector(buildState()),
}));

// -- Import after mocks --

import { ModelPickerContainer } from '../ModelPickerContainer';

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  mockActiveModelId = 'anthropic/claude-3.5-sonnet';
  mockThinkingCapableModels = {};
});

describe('ModelPickerContainer', () => {
  it('should render the model JSON button when a model is active', () => {
    render(<ModelPickerContainer />);
    expect(screen.getByTestId('model-json-button')).toBeInTheDocument();
  });

  it('should open the metadata JSON view when the JSON button is clicked', () => {
    render(<ModelPickerContainer />);
    fireEvent.click(screen.getByTestId('model-json-button'));
    expect(mockSetModelMetadataOpen).toHaveBeenCalledWith(true);
  });

  it('should render the thinking-mode toggle when the active model supports thinking', () => {
    render(<ModelPickerContainer />);
    expect(screen.getByTestId('thinking-mode-toggle')).toBeInTheDocument();
  });

  it('should toggle per-model thinking-enabled state via the store when the switch is clicked', () => {
    render(<ModelPickerContainer />);
    fireEvent.click(screen.getByTestId('thinking-mode-toggle'));
    expect(mockSetModelThinkingEnabled).toHaveBeenCalledWith(
      'openrouter',
      'anthropic/claude-3.5-sonnet',
      true
    );
  });
});
