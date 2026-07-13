import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Provider, ProviderSelectorProps } from '../ProviderSelector';
import { ProviderSelector } from '../ProviderSelector';

// -- Test Data --

const ALL_PROVIDERS: readonly Provider[] = [
  { id: 'ollama', label: 'Ollama' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'perplexity', label: 'Perplexity' },
];

// -- Builders --

const buildProps = (overrides?: Partial<ProviderSelectorProps>): ProviderSelectorProps => ({
  providers: ALL_PROVIDERS,
  activeProviderId: 'ollama',
  onProviderChange: vi.fn(),
  providerForm: <div data-testid="provider-form" />,
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProviderSelector', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<ProviderSelector {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render all 6 provider tabs when given 6 providers', () => {
    render(<ProviderSelector {...buildProps()} />);

    const buttons = screen.getAllByRole('button');

    expect(buttons).toHaveLength(6);
    expect(screen.getByText('Ollama')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Kimi')).toBeInTheDocument();
    expect(screen.getByText('Perplexity')).toBeInTheDocument();
  });

  it('should render the providerForm slot content', () => {
    render(
      <ProviderSelector
        {...buildProps({ providerForm: <div data-testid="provider-form">Custom Form</div> })}
      />
    );

    expect(screen.getByTestId('provider-form')).toBeInTheDocument();
    expect(screen.getByText('Custom Form')).toBeInTheDocument();
  });

  // -- Active/Inactive state tests --

  it('should mark the active provider with aria-pressed true', () => {
    render(<ProviderSelector {...buildProps({ activeProviderId: 'claude' })} />);

    expect(screen.getByText('Claude')).toHaveAttribute('aria-pressed', 'true');
  });

  it('should mark non-active providers with aria-pressed false', () => {
    render(<ProviderSelector {...buildProps({ activeProviderId: 'ollama' })} />);

    expect(screen.getByText('OpenRouter')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('ChatGPT')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Claude')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Kimi')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Perplexity')).toHaveAttribute('aria-pressed', 'false');
  });

  it('should have exactly one provider with aria-pressed true', () => {
    render(<ProviderSelector {...buildProps({ activeProviderId: 'kimi' })} />);

    const allButtons = screen.getAllByRole('button');
    const pressedButtons = allButtons.filter(btn => btn.getAttribute('aria-pressed') === 'true');

    expect(pressedButtons).toHaveLength(1);
    expect(pressedButtons[0]).toHaveTextContent('Kimi');
  });

  // -- Tab group accessibility --

  it('should render the tab bar with role group and an accessible label', () => {
    render(<ProviderSelector {...buildProps()} />);

    const group = screen.getByRole('group');

    expect(group).toBeInTheDocument();
    expect(group).toHaveAccessibleName();
  });

  // -- Callback tests --

  it('should call onProviderChange with the provider id when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onProviderChange = vi.fn();
    render(<ProviderSelector {...buildProps({ onProviderChange })} />);

    await user.click(screen.getByText('ChatGPT'));

    expect(onProviderChange).toHaveBeenCalledOnce();
    expect(onProviderChange).toHaveBeenCalledWith('chatgpt');
  });

  it('should call onProviderChange with the correct id for each provider', async () => {
    const user = userEvent.setup();
    const onProviderChange = vi.fn();
    render(<ProviderSelector {...buildProps({ onProviderChange })} />);

    await user.click(screen.getByText('Perplexity'));

    expect(onProviderChange).toHaveBeenCalledWith('perplexity');
  });

  it('should call onProviderChange when clicking the already-active provider', async () => {
    const user = userEvent.setup();
    const onProviderChange = vi.fn();
    render(<ProviderSelector {...buildProps({ activeProviderId: 'ollama', onProviderChange })} />);

    await user.click(screen.getByText('Ollama'));

    expect(onProviderChange).toHaveBeenCalledOnce();
    expect(onProviderChange).toHaveBeenCalledWith('ollama');
  });

  it('should not call onProviderChange on initial render', () => {
    const onProviderChange = vi.fn();
    render(<ProviderSelector {...buildProps({ onProviderChange })} />);

    expect(onProviderChange).not.toHaveBeenCalled();
  });

  // -- Conditional rendering tests --

  it('should update aria-pressed when activeProviderId changes via rerender', () => {
    const props = buildProps({ activeProviderId: 'ollama' });
    const { rerender } = render(<ProviderSelector {...props} />);

    expect(screen.getByText('Ollama')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Claude')).toHaveAttribute('aria-pressed', 'false');

    rerender(<ProviderSelector {...buildProps({ activeProviderId: 'claude' })} />);

    expect(screen.getByText('Ollama')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Claude')).toHaveAttribute('aria-pressed', 'true');
  });

  it('should render different providerForm content when prop changes', () => {
    const { rerender } = render(
      <ProviderSelector {...buildProps({ providerForm: <span>Form A</span> })} />
    );

    expect(screen.getByText('Form A')).toBeInTheDocument();

    rerender(<ProviderSelector {...buildProps({ providerForm: <span>Form B</span> })} />);

    expect(screen.queryByText('Form A')).not.toBeInTheDocument();
    expect(screen.getByText('Form B')).toBeInTheDocument();
  });

  // -- Edge cases --

  it('should render with an empty providers array', () => {
    const { container } = render(<ProviderSelector {...buildProps({ providers: [] })} />);

    expect(container).toBeTruthy();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should render with a single provider', () => {
    const singleProvider: readonly Provider[] = [{ id: 'ollama', label: 'Ollama' }];
    render(
      <ProviderSelector
        {...buildProps({ providers: singleProvider, activeProviderId: 'ollama' })}
      />
    );

    const buttons = screen.getAllByRole('button');

    expect(buttons).toHaveLength(1);
    expect(screen.getByText('Ollama')).toHaveAttribute('aria-pressed', 'true');
  });

  it('should handle activeProviderId that does not match any provider', () => {
    const { container } = render(
      <ProviderSelector {...buildProps({ activeProviderId: 'nonexistent' })} />
    );

    expect(container).toBeTruthy();

    const allButtons = screen.getAllByRole('button');
    const pressedButtons = allButtons.filter(btn => btn.getAttribute('aria-pressed') === 'true');

    expect(pressedButtons).toHaveLength(0);
  });

  it('should render provider with very long label text', () => {
    const longLabel = 'A'.repeat(200);
    const providers: readonly Provider[] = [{ id: 'long', label: longLabel }];
    render(<ProviderSelector {...buildProps({ providers, activeProviderId: 'long' })} />);

    expect(screen.getByText(longLabel)).toBeInTheDocument();
  });

  it('should render providerForm when it is null', () => {
    const { container } = render(
      <ProviderSelector {...buildProps({ providerForm: null as unknown as React.ReactNode })} />
    );

    expect(container).toBeTruthy();
    expect(screen.queryByTestId('provider-form')).not.toBeInTheDocument();
  });

  it('should render providers with special characters in labels', () => {
    const providers: readonly Provider[] = [{ id: 'special', label: 'Provider <>&"\'@#$' }];
    render(<ProviderSelector {...buildProps({ providers, activeProviderId: 'special' })} />);

    expect(screen.getByText('Provider <>&"\'@#$')).toBeInTheDocument();
  });

  it('should preserve provider order as given in the providers array', () => {
    render(<ProviderSelector {...buildProps()} />);

    const buttons = screen.getAllByRole('button');
    const labels = buttons.map(btn => btn.textContent);

    expect(labels).toEqual(['Ollama', 'OpenRouter', 'ChatGPT', 'Claude', 'Kimi', 'Perplexity']);
  });

  // -- Snapshot --

  it('should match inline snapshot with default props', () => {
    const { asFragment } = render(
      <ProviderSelector
        {...buildProps({
          providers: [
            { id: 'ollama', label: 'Ollama' },
            { id: 'openrouter', label: 'OpenRouter' },
          ],
          activeProviderId: 'ollama',
          onProviderChange: vi.fn(),
          providerForm: <div data-testid="provider-form">Form Content</div>,
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
