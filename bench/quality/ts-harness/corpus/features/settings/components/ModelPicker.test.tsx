import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelViewModel } from '../types';
import type { ModelPickerProps } from './ModelPicker';
import { ModelPicker } from './ModelPicker';

// -- Builders --

const buildModel = (overrides?: Partial<ModelViewModel>): ModelViewModel => ({
  id: 'model-1',
  name: 'Test Model',
  ...overrides,
});

const buildProps = (overrides?: Partial<ModelPickerProps>): ModelPickerProps => ({
  models: [buildModel()],
  activeModelId: 'model-1',
  onModelChange: vi.fn(),
  isLoading: false,
  error: null,
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModelPicker', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<ModelPicker {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Label removal test (TDD Red — label still exists, will pass after T018 removes it) --

  it('should not render a label element for the model select', () => {
    const { container } = render(<ModelPicker {...buildProps()} />);

    const labels = container.querySelectorAll('label');

    expect(labels).toHaveLength(0);
  });

  // -- Accessibility test --

  it('should have aria-label on the select trigger', () => {
    render(<ModelPicker {...buildProps()} />);

    const trigger = screen.getByRole('combobox');

    expect(trigger).toHaveAttribute('aria-label', 'Select model');
  });

  // -- Content tests --

  it('should render model options', async () => {
    const user = userEvent.setup();
    const models = [
      buildModel({ id: 'gpt-4', name: 'GPT-4' }),
      buildModel({ id: 'claude-3', name: 'Claude 3' }),
    ];
    render(<ModelPicker {...buildProps({ models, activeModelId: 'gpt-4' })} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: 'GPT-4' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude 3' })).toBeInTheDocument();
  });

  // -- Callback tests --

  it('should call onModelChange when a model is selected', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    const models = [
      buildModel({ id: 'model-a', name: 'Model A' }),
      buildModel({ id: 'model-b', name: 'Model B' }),
    ];
    render(<ModelPicker {...buildProps({ models, activeModelId: 'model-a', onModelChange })} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Model B' }));

    expect(onModelChange).toHaveBeenCalledOnce();
    expect(onModelChange).toHaveBeenCalledWith('model-b');
  });

  // -- Conditional rendering tests --

  it('should show loading placeholder when isLoading is true', () => {
    render(<ModelPicker {...buildProps({ isLoading: true, models: [], activeModelId: '' })} />);

    expect(screen.getByText('Loading models\u2026')).toBeInTheDocument();
  });

  it('should show error message when error is provided', () => {
    render(<ModelPicker {...buildProps({ error: 'Failed to load models' })} />);

    const alert = screen.getByRole('alert');

    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Failed to load models');
  });

  // -- Edge cases --

  it('should not show error element when error is null', () => {
    render(<ModelPicker {...buildProps({ error: null })} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should render empty state when models array is empty', async () => {
    const user = userEvent.setup();
    render(<ModelPicker {...buildProps({ models: [], activeModelId: '' })} />);

    await user.click(screen.getByRole('combobox'));

    const option = screen.getByRole('option');
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveTextContent('No compatible models');
  });

  it('should disable the select trigger when isLoading is true', () => {
    render(<ModelPicker {...buildProps({ isLoading: true, models: [], activeModelId: '' })} />);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  // -- Regression: NEW:settings.model-chooser-cleanup --

  it('should not render a raw-JSON pill when model has full metadata', () => {
    const modelWithMetadata = buildModel({
      id: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      description: '200K token context',
      contextLength: 200000,
      pricing: { promptPrice: 3.0, completionPrice: 15.0 },
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
    });
    const { container } = render(
      <ModelPicker
        {...buildProps({ models: [modelWithMetadata], activeModelId: 'claude-3-5-sonnet' })}
      />
    );

    expect(container.textContent).not.toMatch(/\{"|\{"contextLength":/);
    expect(container.querySelector('[data-testid*="json"]')).toBeNull();
  });

  it('should retain tooltip on context-size control when contextSizeTooltip prop is provided', () => {
    const tooltip = 'Context: 200K tokens';
    const { container } = render(
      <ModelPicker
        {...buildProps()}
        contextSize={8192}
        onContextSizeChange={vi.fn()}
        contextSizeLabel="Context size"
        contextSizeTooltip={tooltip}
      />
    );

    const labelEl = container.querySelector('label[for="model-context-size"]');
    const inputEl = container.querySelector('input#model-context-size');

    expect(labelEl).toHaveAttribute('title', tooltip);
    expect(inputEl).toHaveAttribute('title', tooltip);
  });
});
