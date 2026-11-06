import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FEATURE_FLAG_REGISTRY, type FeatureFlagKey } from '@/domain/feature-flags';

// -- Boundary mocks (declared before imports per Vitest hoisting rules) --

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn().mockResolvedValue(null),
  putAppSetting: vi.fn().mockResolvedValue(undefined),
}));

// -- Import after mocks --

import { useFeatureFlagStore } from '../../stores/useFeatureFlagStore';
// The container under test does NOT exist yet (TDD Red).
// This import will fail until the implementation is created.
import { FeatureFlagSectionContainer } from '../FeatureFlagSectionContainer';

// -- Store state snapshot for reset --

const initialFlagState = useFeatureFlagStore.getState();

// -- Constants derived from real registry --

const FLAG_KEYS = Object.keys(FEATURE_FLAG_REGISTRY) as readonly FeatureFlagKey[];

// These 2 flags were relocated to the Prompt Lab settings block.
const RELOCATED_LAB_FLAGS = ['lab-perplexity-enabled', 'lab-text-analysis-enabled'] as const;
const RELOCATED = RELOCATED_LAB_FLAGS.length;
const VISIBLE_FLAG_KEYS = FLAG_KEYS.filter(
  k => !RELOCATED_LAB_FLAGS.includes(k as (typeof RELOCATED_LAB_FLAGS)[number])
);

// -- Setup --

beforeEach(() => {
  vi.clearAllMocks();
  useFeatureFlagStore.setState(initialFlagState, true);
});

// -- Tests --

describe('FeatureFlagSectionContainer', () => {
  // =========================================================================
  // Smoke test
  // =========================================================================

  it('should render without crashing', () => {
    const { container } = render(<FeatureFlagSectionContainer />);

    expect(container).toBeTruthy();
  });

  // =========================================================================
  // Heading from i18n
  // =========================================================================

  it('should render section heading from i18n translation key', () => {
    render(<FeatureFlagSectionContainer />);

    const heading = screen.getByRole('heading', { level: 3 });

    expect(heading).toHaveTextContent('featureFlags.sectionHeading');
  });

  // =========================================================================
  // Flag view models: localized names and descriptions
  // =========================================================================

  describe('flag view model mapping', () => {
    it('should render a switch for each non-relocated flag in the registry', () => {
      render(<FeatureFlagSectionContainer />);

      const switches = screen.getAllByRole('switch');

      expect(switches).toHaveLength(FLAG_KEYS.length - RELOCATED);
    });

    it('should not render switches for relocated lab flags', () => {
      render(<FeatureFlagSectionContainer />);

      expect(
        screen.queryByRole('switch', { name: 'featureFlags.lab-perplexity-enabled-name' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('switch', { name: 'featureFlags.lab-text-analysis-enabled-name' })
      ).not.toBeInTheDocument();
    });

    it('should pass localized name from i18n for each visible flag', () => {
      render(<FeatureFlagSectionContainer />);

      VISIBLE_FLAG_KEYS.forEach(key => {
        expect(
          screen.getByRole('switch', { name: `featureFlags.${key}-name` })
        ).toBeInTheDocument();
      });
    });

    it('should pass localized description from i18n for each visible flag', () => {
      render(<FeatureFlagSectionContainer />);

      VISIBLE_FLAG_KEYS.forEach(key => {
        expect(screen.getByText(`featureFlags.${key}-description`)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Flag enabled state from store
  // =========================================================================

  describe('flag enabled state', () => {
    it('should render switch as unchecked when flag is disabled in store', () => {
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

      render(<FeatureFlagSectionContainer />);

      const toggle = screen.getByRole('switch', {
        name: 'featureFlags.show-cors-providers-name',
      });

      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('should render switch as checked when flag is enabled in store', () => {
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

      render(<FeatureFlagSectionContainer />);

      const toggle = screen.getByRole('switch', {
        name: 'featureFlags.show-cors-providers-name',
      });

      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });

  // =========================================================================
  // Callback wiring: toggleFlag
  // =========================================================================

  describe('onToggle callback', () => {
    it('should call toggleFlag when a switch is clicked', async () => {
      const mockToggleFlag = vi.fn().mockResolvedValue(undefined);
      useFeatureFlagStore.setState({
        flags: {
          'show-cors-providers': false,
          'tutorial-enabled': false,
          'web-search-enabled': false,
          'prompt-lab-enabled': true,

          'lab-perplexity-enabled': false,
          'lab-text-analysis-enabled': false,
        },
        toggleFlag: mockToggleFlag,
      });
      const user = userEvent.setup();

      render(<FeatureFlagSectionContainer />);

      const toggle = screen.getByRole('switch', {
        name: 'featureFlags.show-cors-providers-name',
      });
      await user.click(toggle);

      expect(mockToggleFlag).toHaveBeenCalledOnce();
      expect(mockToggleFlag).toHaveBeenCalledWith('show-cors-providers');
    });
  });

  // =========================================================================
  // State transitions: toggle updates rendered state
  // =========================================================================

  describe('state transitions', () => {
    it('should update switch state after toggling from disabled to enabled', () => {
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

      const { rerender } = render(<FeatureFlagSectionContainer />);

      const toggle = screen.getByRole('switch', {
        name: 'featureFlags.show-cors-providers-name',
      });
      expect(toggle).toHaveAttribute('aria-checked', 'false');

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
      rerender(<FeatureFlagSectionContainer />);

      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('should update switch state after toggling from enabled to disabled', () => {
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

      const { rerender } = render(<FeatureFlagSectionContainer />);

      const toggle = screen.getByRole('switch', {
        name: 'featureFlags.show-cors-providers-name',
      });
      expect(toggle).toHaveAttribute('aria-checked', 'true');

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
      rerender(<FeatureFlagSectionContainer />);

      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('should render correct number of flags excluding the 2 relocated lab flags', () => {
      render(<FeatureFlagSectionContainer />);

      const switches = screen.getAllByRole('switch');

      expect(switches).toHaveLength(Object.keys(FEATURE_FLAG_REGISTRY).length - RELOCATED);
    });

    it('should use default flag values from store initial state for visible flags', () => {
      render(<FeatureFlagSectionContainer />);

      VISIBLE_FLAG_KEYS.forEach(key => {
        const toggle = screen.getByRole('switch', {
          name: `featureFlags.${key}-name`,
        });
        const expectedDefault = FEATURE_FLAG_REGISTRY[key].defaultValue;
        expect(toggle).toHaveAttribute('aria-checked', String(expectedDefault));
      });
    });
  });
});
