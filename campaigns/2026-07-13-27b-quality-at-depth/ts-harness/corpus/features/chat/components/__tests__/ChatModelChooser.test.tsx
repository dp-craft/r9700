import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatModelChooserProps, ChatModelChooserProvider } from '../ChatModelChooser';
import { ChatModelChooser } from '../ChatModelChooser';

const ALL_PROVIDERS: readonly ChatModelChooserProvider[] = [
  { id: 'ollama', name: 'Ollama' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'chatgpt', name: 'ChatGPT' },
];

const SAMPLE_MODELS: readonly { readonly id: string; readonly name: string }[] = [
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
];

const buildProps = (overrides?: Partial<ChatModelChooserProps>): ChatModelChooserProps => ({
  providers: ALL_PROVIDERS,
  activeProviderId: 'chatgpt',
  onProviderChange: vi.fn(),
  models: SAMPLE_MODELS,
  activeModelId: 'gpt-4o',
  onModelChange: vi.fn(),
  isLoadingModels: false,
  ...overrides,
});

const getProviderTrigger = (): HTMLElement =>
  screen.getByRole('combobox', { name: /select provider/i });

const getModelTrigger = (): HTMLElement => screen.getByRole('combobox', { name: /select model/i });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChatModelChooser', () => {
  it('should match snapshot with default props', () => {
    const { asFragment } = render(<ChatModelChooser {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should call onProviderChange when a different provider is selected', async () => {
    const user = userEvent.setup();
    const onProviderChange = vi.fn();
    render(<ChatModelChooser {...buildProps({ activeProviderId: 'chatgpt', onProviderChange })} />);

    await user.click(getProviderTrigger());
    await user.click(screen.getByRole('option', { name: 'Ollama' }));

    expect(onProviderChange).toHaveBeenCalledWith('ollama');
  });

  it('should call onModelChange when a different model is selected', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(<ChatModelChooser {...buildProps({ activeModelId: 'gpt-4o', onModelChange })} />);

    await user.click(getModelTrigger());
    await user.click(screen.getByRole('option', { name: 'GPT-4o Mini' }));

    expect(onModelChange).toHaveBeenCalledWith('gpt-4o-mini');
  });

  it('should call onRetryModels when retry is clicked in error state', async () => {
    const user = userEvent.setup();
    const onRetryModels = vi.fn();
    render(
      <ChatModelChooser
        {...buildProps({
          models: [],
          activeModelId: '',
          isLoadingModels: false,
          modelLoadError: true,
          onRetryModels,
        })}
      />
    );

    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetryModels).toHaveBeenCalledOnce();
  });

  it('should call onInfoClick when the info button is clicked', async () => {
    const user = userEvent.setup();
    const onInfoClick = vi.fn();
    render(<ChatModelChooser {...buildProps({ onInfoClick })} />);

    await user.click(screen.getByRole('button', { name: /model info/i }));

    expect(onInfoClick).toHaveBeenCalledOnce();
  });

  it('should call onAddProviderClick when no providers and add-provider is clicked', async () => {
    const user = userEvent.setup();
    const onAddProviderClick = vi.fn();
    render(
      <ChatModelChooser
        {...buildProps({ providers: [], activeProviderId: '', onAddProviderClick })}
      />
    );

    await user.click(screen.getByRole('button', { name: /add provider/i }));

    expect(onAddProviderClick).toHaveBeenCalledOnce();
  });
});
