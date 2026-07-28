import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationModelPickerProps } from '../TranslationModelPicker';
import { TranslationModelPicker } from '../TranslationModelPicker';

// -- Test Data --

interface TranslationModelOption {
  readonly id: string;
  readonly name: string;
  readonly sizeLabel: string;
}

interface RecommendedModelInfo {
  readonly id: string;
  readonly name: string;
  readonly sizeLabel: string;
  readonly tier: 'lightweight' | 'balanced' | 'high-quality';
  readonly isDefault: boolean;
  readonly description: string;
}

const SAMPLE_MODELS: readonly TranslationModelOption[] = [
  { id: 'gemma3:1b', name: 'gemma3:1b', sizeLabel: '~815MB' },
  { id: 'translategemma:4b', name: 'translategemma:4b', sizeLabel: '~3.3GB' },
  { id: 'gemma3:4b', name: 'gemma3:4b', sizeLabel: '~3.3GB' },
];

const SAMPLE_RECOMMENDED: readonly RecommendedModelInfo[] = [
  {
    id: 'gemma3:1b',
    name: 'Gemma 3 1B',
    sizeLabel: '~815MB',
    tier: 'lightweight',
    isDefault: false,
    description: 'Smallest viable, 140+ languages',
  },
  {
    id: 'translategemma:4b',
    name: 'TranslateGemma 4B',
    sizeLabel: '~3.3GB',
    tier: 'balanced',
    isDefault: true,
    description: 'Purpose-built for translation',
  },
];

// -- Builders --

const buildProps = (
  overrides?: Partial<TranslationModelPickerProps>
): TranslationModelPickerProps => ({
  models: SAMPLE_MODELS,
  selectedModelId: 'gemma3:1b',
  onModelChange: vi.fn(),
  isLoading: false,
  error: null,
  recommendedModels: SAMPLE_RECOMMENDED,
  translationModelLabel: 'Translation model',
  recommendedLabel: 'Recommended models',
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TranslationModelPicker', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<TranslationModelPicker {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render the translation model label', () => {
    render(<TranslationModelPicker {...buildProps()} />);

    expect(screen.getByText('Translation model')).toBeInTheDocument();
  });

  it('should render a select trigger with combobox role', () => {
    render(<TranslationModelPicker {...buildProps()} />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('should render model options with name when select is opened', async () => {
    const user = userEvent.setup();
    render(<TranslationModelPicker {...buildProps()} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: /gemma3:1b/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /translategemma:4b/i })).toBeInTheDocument();
  });

  it('should render info button for recommended models', () => {
    render(<TranslationModelPicker {...buildProps()} />);

    expect(screen.getByRole('button', { name: 'Recommended models' })).toBeInTheDocument();
  });

  it('should show recommended models in tooltip on hover', async () => {
    const user = userEvent.setup();
    render(<TranslationModelPicker {...buildProps()} />);

    await user.hover(screen.getByRole('button', { name: 'Recommended models' }));

    const tooltipContent = await screen.findByRole('tooltip');
    expect(tooltipContent).toHaveTextContent('Gemma 3 1B');
    expect(tooltipContent).toHaveTextContent('TranslateGemma 4B');
  });

  it('should show recommended model descriptions in tooltip', async () => {
    const user = userEvent.setup();
    render(<TranslationModelPicker {...buildProps()} />);

    await user.hover(screen.getByRole('button', { name: 'Recommended models' }));

    const tooltipContent = await screen.findByRole('tooltip');
    expect(tooltipContent).toHaveTextContent('Smallest viable, 140+ languages');
    expect(tooltipContent).toHaveTextContent('Purpose-built for translation');
  });

  it('should not render info button when no recommended models', () => {
    render(<TranslationModelPicker {...buildProps({ recommendedModels: [] })} />);

    expect(screen.queryByRole('button', { name: 'Recommended models' })).not.toBeInTheDocument();
  });

  // -- Loading state --

  it('should show loading indicator when isLoading is true', () => {
    render(
      <TranslationModelPicker
        {...buildProps({ isLoading: true, models: [], selectedModelId: '' })}
      />
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('should disable the select trigger when isLoading is true', () => {
    render(
      <TranslationModelPicker
        {...buildProps({ isLoading: true, models: [], selectedModelId: '' })}
      />
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  // -- Error state --

  it('should show error message when error prop is non-null', () => {
    render(<TranslationModelPicker {...buildProps({ error: 'Failed to fetch models' })} />);

    const alert = screen.getByRole('alert');

    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Failed to fetch models');
  });

  it('should not show error element when error is null', () => {
    render(<TranslationModelPicker {...buildProps({ error: null })} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // -- Callback tests --

  it('should call onModelChange when a different model is selected', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(
      <TranslationModelPicker
        {...buildProps({
          selectedModelId: 'gemma3:1b',
          onModelChange,
        })}
      />
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /translategemma:4b/i }));

    expect(onModelChange).toHaveBeenCalledOnce();
    expect(onModelChange).toHaveBeenCalledWith('translategemma:4b');
  });

  it('should not call onModelChange on initial render', () => {
    const onModelChange = vi.fn();
    render(<TranslationModelPicker {...buildProps({ onModelChange })} />);

    expect(onModelChange).not.toHaveBeenCalled();
  });

  // -- Conditional rendering tests --

  it('should not show loading indicator when isLoading is false', () => {
    render(<TranslationModelPicker {...buildProps({ isLoading: false })} />);

    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('should show different label text when translationModelLabel changes', () => {
    render(
      <TranslationModelPicker {...buildProps({ translationModelLabel: 'Modele de traduction' })} />
    );

    expect(screen.getByText('Modele de traduction')).toBeInTheDocument();
    expect(screen.queryByText('Translation model')).not.toBeInTheDocument();
  });

  it('should show different recommended heading when recommendedLabel changes', () => {
    render(<TranslationModelPicker {...buildProps({ recommendedLabel: 'Modeles recommandes' })} />);

    expect(screen.getByRole('button', { name: 'Modeles recommandes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recommended models' })).not.toBeInTheDocument();
  });

  // -- Edge cases --

  it('should render with an empty models array', () => {
    const { container } = render(
      <TranslationModelPicker {...buildProps({ models: [], selectedModelId: '' })} />
    );

    expect(container).toBeTruthy();
  });

  it('should show no model options when models array is empty', async () => {
    const user = userEvent.setup();
    render(<TranslationModelPicker {...buildProps({ models: [], selectedModelId: '' })} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('should render with an empty recommendedModels array', () => {
    const { container } = render(
      <TranslationModelPicker {...buildProps({ recommendedModels: [] })} />
    );

    expect(container).toBeTruthy();
  });

  it('should not render recommended section content when recommendedModels is empty', () => {
    render(<TranslationModelPicker {...buildProps({ recommendedModels: [] })} />);

    expect(screen.queryByText('Gemma 3 1B')).not.toBeInTheDocument();
    expect(screen.queryByText('TranslateGemma 4B')).not.toBeInTheDocument();
  });

  it('should handle selectedModelId that does not match any model', () => {
    const { container } = render(
      <TranslationModelPicker {...buildProps({ selectedModelId: 'nonexistent-model' })} />
    );

    expect(container).toBeTruthy();
  });

  it('should handle error as empty string without showing alert', () => {
    render(<TranslationModelPicker {...buildProps({ error: '' })} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should handle very long model names', async () => {
    const longName = 'M'.repeat(200);
    const user = userEvent.setup();
    render(
      <TranslationModelPicker
        {...buildProps({
          models: [{ id: 'long', name: longName, sizeLabel: '~1GB' }],
          selectedModelId: 'long',
        })}
      />
    );

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: new RegExp(longName) })).toBeInTheDocument();
  });

  it('should handle very long error messages', () => {
    const longError = 'Error: '.concat('x'.repeat(500));
    render(<TranslationModelPicker {...buildProps({ error: longError })} />);

    expect(screen.getByRole('alert')).toHaveTextContent(longError);
  });

  // -- Snapshot --

  it('should match inline snapshot with default props', () => {
    const { asFragment } = render(
      <TranslationModelPicker
        {...buildProps({
          models: [{ id: 'gemma3:1b', name: 'gemma3:1b', sizeLabel: '~815MB' }],
          selectedModelId: 'gemma3:1b',
          onModelChange: vi.fn(),
          recommendedModels: [
            {
              id: 'gemma3:1b',
              name: 'Gemma 3 1B',
              sizeLabel: '~815MB',
              tier: 'lightweight' as const,
              isDefault: false,
              description: 'Smallest viable, 140+ languages',
            },
          ],
          translationModelLabel: 'Translation model',
          recommendedLabel: 'Recommended models',
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
