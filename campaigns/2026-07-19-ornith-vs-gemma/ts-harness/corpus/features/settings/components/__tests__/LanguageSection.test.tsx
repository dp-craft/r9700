import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LanguageSectionProps } from '../LanguageSection';
import { LanguageSection } from '../LanguageSection';

// -- Builders --

const buildProps = (overrides?: Partial<LanguageSectionProps>): LanguageSectionProps => ({
  uiLanguage: 'en',
  conversationLanguage: 'en',
  promptLanguage: 'en',
  onUiLanguageChange: vi.fn(),
  onConversationLanguageChange: vi.fn(),
  onPromptLanguageChange: vi.fn(),
  isTranslationNeeded: false,
  translationModelSlot: <div data-testid="translation-model-slot">Translation Model</div>,
  uiLanguageLabel: 'UI Language',
  conversationLanguageLabel: 'Conversation Language',
  modelLanguageLabel: 'Model Language',
  sectionTitle: 'Language Settings',
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LanguageSection', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<LanguageSection {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render section title as a heading', () => {
    render(<LanguageSection {...buildProps()} />);

    expect(screen.getByRole('heading', { name: 'Language Settings' })).toBeInTheDocument();
  });

  it('should render custom section title text', () => {
    render(<LanguageSection {...buildProps({ sectionTitle: 'Nyelvi beállítások' })} />);

    expect(screen.getByRole('heading', { name: 'Nyelvi beállítások' })).toBeInTheDocument();
  });

  it('should render three select triggers for language dropdowns', () => {
    render(<LanguageSection {...buildProps()} />);

    const comboboxes = screen.getAllByRole('combobox');

    expect(comboboxes).toHaveLength(3);
  });

  it('should render the UI Language label', () => {
    render(<LanguageSection {...buildProps()} />);

    expect(screen.getByText('UI Language')).toBeInTheDocument();
  });

  it('should render the Conversation Language label', () => {
    render(<LanguageSection {...buildProps()} />);

    expect(screen.getByText('Conversation Language')).toBeInTheDocument();
  });

  it('should render the Model Language label', () => {
    render(<LanguageSection {...buildProps()} />);

    expect(screen.getByText('Model Language')).toBeInTheDocument();
  });

  it('should render custom label text for each dropdown', () => {
    render(
      <LanguageSection
        {...buildProps({
          uiLanguageLabel: 'Felület nyelve',
          conversationLanguageLabel: 'Beszélgetés nyelve',
          modelLanguageLabel: 'Modell nyelve',
        })}
      />
    );

    expect(screen.getByText('Felület nyelve')).toBeInTheDocument();
    expect(screen.getByText('Beszélgetés nyelve')).toBeInTheDocument();
    expect(screen.getByText('Modell nyelve')).toBeInTheDocument();
  });

  // -- Callback tests --

  it('should call onUiLanguageChange when user selects a UI language option', async () => {
    const user = userEvent.setup();
    const onUiLanguageChange = vi.fn();
    render(
      <LanguageSection
        {...buildProps({
          uiLanguage: 'en',
          onUiLanguageChange,
        })}
      />
    );

    const comboboxes = screen.getAllByRole('combobox');
    await user.click(comboboxes[0]);

    const listbox = screen.getByRole('listbox');
    const huOption = within(listbox).getByRole('option', { name: /magyar/i });
    await user.click(huOption);

    expect(onUiLanguageChange).toHaveBeenCalledOnce();
    expect(onUiLanguageChange).toHaveBeenCalledWith('hu');
  });

  it('should call onConversationLanguageChange when user selects a conversation language option', async () => {
    const user = userEvent.setup();
    const onConversationLanguageChange = vi.fn();
    render(
      <LanguageSection
        {...buildProps({
          conversationLanguage: 'en',
          onConversationLanguageChange,
        })}
      />
    );

    const comboboxes = screen.getAllByRole('combobox');
    await user.click(comboboxes[2]);

    const listbox = screen.getByRole('listbox');
    const huOption = within(listbox).getByRole('option', { name: /magyar/i });
    await user.click(huOption);

    expect(onConversationLanguageChange).toHaveBeenCalledOnce();
    expect(onConversationLanguageChange).toHaveBeenCalledWith('hu');
  });

  it('should call onPromptLanguageChange when user selects a model language option', async () => {
    const user = userEvent.setup();
    const onPromptLanguageChange = vi.fn();
    render(
      <LanguageSection
        {...buildProps({
          promptLanguage: 'en',
          onPromptLanguageChange,
        })}
      />
    );

    const comboboxes = screen.getAllByRole('combobox');
    await user.click(comboboxes[1]);

    const listbox = screen.getByRole('listbox');
    const huOption = within(listbox).getByRole('option', { name: /magyar/i });
    await user.click(huOption);

    expect(onPromptLanguageChange).toHaveBeenCalledOnce();
    expect(onPromptLanguageChange).toHaveBeenCalledWith('hu');
  });

  it('should not call any onChange callback on initial render', () => {
    const onUiLanguageChange = vi.fn();
    const onConversationLanguageChange = vi.fn();
    const onPromptLanguageChange = vi.fn();
    render(
      <LanguageSection
        {...buildProps({
          onUiLanguageChange,
          onConversationLanguageChange,
          onPromptLanguageChange,
        })}
      />
    );

    expect(onUiLanguageChange).not.toHaveBeenCalled();
    expect(onConversationLanguageChange).not.toHaveBeenCalled();
    expect(onPromptLanguageChange).not.toHaveBeenCalled();
  });

  // -- Conditional rendering tests --

  it('should show translation model slot when isTranslationNeeded is true', () => {
    render(
      <LanguageSection
        {...buildProps({
          isTranslationNeeded: true,
          translationModelSlot: <div data-testid="translation-model-slot">Pick a model</div>,
        })}
      />
    );

    expect(screen.getByTestId('translation-model-slot')).toBeInTheDocument();
    expect(screen.getByText('Pick a model')).toBeInTheDocument();
  });

  it('should hide translation model slot when isTranslationNeeded is false', () => {
    render(
      <LanguageSection
        {...buildProps({
          isTranslationNeeded: false,
          translationModelSlot: <div data-testid="translation-model-slot">Pick a model</div>,
        })}
      />
    );

    expect(screen.queryByTestId('translation-model-slot')).not.toBeInTheDocument();
  });

  it('should toggle translation model slot visibility on rerender', () => {
    const props = buildProps({
      isTranslationNeeded: false,
      translationModelSlot: <div data-testid="translation-model-slot">Model Picker</div>,
    });
    const { rerender } = render(<LanguageSection {...props} />);

    expect(screen.queryByTestId('translation-model-slot')).not.toBeInTheDocument();

    rerender(
      <LanguageSection
        {...buildProps({
          isTranslationNeeded: true,
          translationModelSlot: <div data-testid="translation-model-slot">Model Picker</div>,
        })}
      />
    );

    expect(screen.getByTestId('translation-model-slot')).toBeInTheDocument();
  });

  it('should handle translationModelSlot as null when isTranslationNeeded is true', () => {
    const { container } = render(
      <LanguageSection
        {...buildProps({
          isTranslationNeeded: true,
          translationModelSlot: null,
        })}
      />
    );

    expect(container).toBeTruthy();
  });

  // -- Edge cases --

  it('should render with Hungarian selected for all languages', () => {
    render(
      <LanguageSection
        {...buildProps({
          uiLanguage: 'hu',
          conversationLanguage: 'hu',
          promptLanguage: 'hu',
        })}
      />
    );

    const comboboxes = screen.getAllByRole('combobox');

    expect(comboboxes).toHaveLength(3);
  });

  it('should render with mixed language selections', () => {
    render(
      <LanguageSection
        {...buildProps({
          uiLanguage: 'hu',
          conversationLanguage: 'en',
          promptLanguage: 'hu',
        })}
      />
    );

    const comboboxes = screen.getAllByRole('combobox');

    expect(comboboxes).toHaveLength(3);
  });

  it('should render with empty string labels without crashing', () => {
    const { container } = render(
      <LanguageSection
        {...buildProps({
          uiLanguageLabel: '',
          conversationLanguageLabel: '',
          modelLanguageLabel: '',
          sectionTitle: '',
        })}
      />
    );

    expect(container).toBeTruthy();
  });

  it('should render labels with special characters', () => {
    render(
      <LanguageSection
        {...buildProps({
          sectionTitle: 'Nyelvi beállítások (új)',
          uiLanguageLabel: 'Felület <nyelve>',
        })}
      />
    );

    expect(screen.getByRole('heading', { name: 'Nyelvi beállítások (új)' })).toBeInTheDocument();
    expect(screen.getByText('Felület <nyelve>')).toBeInTheDocument();
  });

  // -- Snapshot --

  it('should match snapshot with default props', () => {
    const { asFragment } = render(
      <LanguageSection
        {...buildProps({
          onUiLanguageChange: vi.fn(),
          onConversationLanguageChange: vi.fn(),
          onPromptLanguageChange: vi.fn(),
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
