import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureFlagKey } from '@/domain/feature-flags';
import { PROVIDER_META } from '@/services/llm/provider-meta';

// -- Boundary mocks (declared before imports per Vitest hoisting rules) --

const mockSetActiveProvider = vi.fn();

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('../../stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeProviderId: 'ollama',
      setActiveProvider: mockSetActiveProvider,
    }),
}));

let mockFlags: Record<FeatureFlagKey, boolean> = {
  'show-cors-providers': false,
  'tutorial-enabled': false,
  'web-search-enabled': false,
  'prompt-lab-enabled': true,

  'lab-perplexity-enabled': false,
  'lab-text-analysis-enabled': false,
};

vi.mock('../../stores/useFeatureFlagStore', () => ({
  useFeatureFlagStore: (selector: (s: { flags: Record<string, boolean> }) => unknown) =>
    selector({ flags: mockFlags }),
}));

vi.mock('../ProviderFormContainer', () => ({
  ProviderFormContainer: ({ providerId }: { readonly providerId: string }) => (
    <div data-testid="provider-form-stub">Form for {providerId}</div>
  ),
}));

// -- Import after mocks --

import { ProviderSelectorContainer } from '../ProviderSelectorContainer';

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  mockFlags = {
    'show-cors-providers': false,
    'tutorial-enabled': false,
    'web-search-enabled': false,
    'prompt-lab-enabled': true,
    'lab-perplexity-enabled': false,
    'lab-text-analysis-enabled': false,
  };
});

describe('ProviderSelectorContainer', () => {
  // =========================================================================
  // Smoke test
  // =========================================================================

  it('should render without crashing', () => {
    const { container } = render(<ProviderSelectorContainer />);

    expect(container).toBeTruthy();
  });

  // =========================================================================
  // Feature flag: show-cors-providers OFF (default)
  // =========================================================================

  describe('when show-cors-providers flag is OFF', () => {
    beforeEach(() => {
      mockFlags = {
        'show-cors-providers': false,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };
    });

    it('should pass only CORS-native providers to ProviderSelector', () => {
      render(<ProviderSelectorContainer />);

      const buttons = screen.getAllByRole('button');

      expect(buttons).toHaveLength(4);
    });

    it('should show Ollama provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('Ollama')).toBeInTheDocument();
    });

    it('should show OpenRouter provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    });

    it('should show Gemini provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('Gemini')).toBeInTheDocument();
    });

    it('should not show ChatGPT provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.queryByText('ChatGPT')).not.toBeInTheDocument();
    });

    it('should not show Claude provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    });

    it('should not show Kimi provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.queryByText('Kimi')).not.toBeInTheDocument();
    });

    it('should not show Perplexity provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.queryByText('Perplexity')).not.toBeInTheDocument();
    });

    it('should not show Copilot provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.queryByText('Copilot')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Feature flag: show-cors-providers ON
  // =========================================================================

  describe('when show-cors-providers flag is ON', () => {
    beforeEach(() => {
      mockFlags = {
        'show-cors-providers': true,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };
    });

    it('should pass all 9 providers to ProviderSelector', () => {
      render(<ProviderSelectorContainer />);

      const buttons = screen.getAllByRole('button');

      expect(buttons).toHaveLength(9);
    });

    it('should show Ollama provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('Ollama')).toBeInTheDocument();
    });

    it('should show OpenRouter provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    });

    it('should show ChatGPT provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    });

    it('should show Claude provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    it('should show Kimi provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('Kimi')).toBeInTheDocument();
    });

    it('should show Perplexity provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('Perplexity')).toBeInTheDocument();
    });

    it('should show Gemini provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('Gemini')).toBeInTheDocument();
    });

    it('should show Copilot provider', () => {
      render(<ProviderSelectorContainer />);

      expect(screen.getByText('Copilot')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Provider names match PROVIDER_META
  // =========================================================================

  describe('provider label accuracy', () => {
    it('should use PROVIDER_META names as labels when flag is OFF', () => {
      mockFlags = {
        'show-cors-providers': false,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };

      render(<ProviderSelectorContainer />);

      expect(screen.getByText(PROVIDER_META.ollama.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.openrouter.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.gemini.name)).toBeInTheDocument();
    });

    it('should use PROVIDER_META names as labels when flag is ON', () => {
      mockFlags = {
        'show-cors-providers': true,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };

      render(<ProviderSelectorContainer />);

      expect(screen.getByText(PROVIDER_META.ollama.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.openrouter.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.chatgpt.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.claude.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.kimi.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.perplexity.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.gemini.name)).toBeInTheDocument();
      expect(screen.getByText(PROVIDER_META.copilot.name)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Provider ordering
  // =========================================================================

  describe('provider ordering', () => {
    it('should preserve PROVIDER_ORDER when flag is ON', () => {
      mockFlags = {
        'show-cors-providers': true,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };

      render(<ProviderSelectorContainer />);

      const buttons = screen.getAllByRole('button');
      const labels = buttons.map(btn => btn.textContent);

      expect(labels).toEqual([
        'Ollama',
        'OpenRouter',
        'ChatGPT',
        'Claude',
        'Kimi',
        'Perplexity',
        'Gemini',
        'Copilot',
        'Unsloth',
      ]);
    });

    it('should preserve relative order of CORS-native providers when flag is OFF', () => {
      mockFlags = {
        'show-cors-providers': false,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };

      render(<ProviderSelectorContainer />);

      const buttons = screen.getAllByRole('button');
      const labels = buttons.map(btn => btn.textContent);

      expect(labels).toEqual(['Ollama', 'OpenRouter', 'Gemini', 'Unsloth']);
    });
  });

  // =========================================================================
  // State transitions: toggling the flag re-renders
  // =========================================================================

  describe('flag toggle re-render', () => {
    it('should update provider list when flag changes from OFF to ON', () => {
      mockFlags = {
        'show-cors-providers': false,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };

      const { rerender } = render(<ProviderSelectorContainer />);

      expect(screen.getAllByRole('button')).toHaveLength(4);
      expect(screen.queryByText('ChatGPT')).not.toBeInTheDocument();

      mockFlags = {
        'show-cors-providers': true,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };
      rerender(<ProviderSelectorContainer />);

      expect(screen.getAllByRole('button')).toHaveLength(9);
      expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    });

    it('should update provider list when flag changes from ON to OFF', () => {
      mockFlags = {
        'show-cors-providers': true,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };

      const { rerender } = render(<ProviderSelectorContainer />);

      expect(screen.getAllByRole('button')).toHaveLength(9);
      expect(screen.getByText('Claude')).toBeInTheDocument();

      mockFlags = {
        'show-cors-providers': false,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };
      rerender(<ProviderSelectorContainer />);

      expect(screen.getAllByRole('button')).toHaveLength(4);
      expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    });

    it('should retain CORS-native providers after flag toggles OFF to ON to OFF', () => {
      mockFlags = {
        'show-cors-providers': false,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };
      const { rerender } = render(<ProviderSelectorContainer />);

      expect(screen.getAllByRole('button')).toHaveLength(4);

      mockFlags = {
        'show-cors-providers': true,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };
      rerender(<ProviderSelectorContainer />);
      expect(screen.getAllByRole('button')).toHaveLength(9);

      mockFlags = {
        'show-cors-providers': false,
        'tutorial-enabled': false,
        'web-search-enabled': false,
        'prompt-lab-enabled': true,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      };
      rerender(<ProviderSelectorContainer />);

      expect(screen.getAllByRole('button')).toHaveLength(4);
      expect(screen.getByText('Ollama')).toBeInTheDocument();
      expect(screen.getByText('OpenRouter')).toBeInTheDocument();
      expect(screen.getByText('Gemini')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Container wiring: ProviderFormContainer receives activeProviderId
  // =========================================================================

  it('should pass activeProviderId to ProviderFormContainer', () => {
    render(<ProviderSelectorContainer />);

    expect(screen.getByTestId('provider-form-stub')).toHaveTextContent('Form for ollama');
  });
});
