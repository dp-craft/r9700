import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MessageViewModel,
  PipelineStepTraceViewModel,
  PipelineTraceViewModel
} from '../../types';
import type { MessageBubbleProps } from '../MessageBubble';
import { MessageBubble } from '../MessageBubble';

// -- Builders --

const buildPipelineStepTraceViewModel = (
  overrides?: Partial<PipelineStepTraceViewModel>
): PipelineStepTraceViewModel => ({
  stepId: 'some-step',
  label: 'Some step',
  input: 'some input',
  output: 'some output',
  status: 'completed',
  ...overrides,
});

const buildPipelineTraceViewModel = (
  overrides?: Partial<PipelineTraceViewModel>
): PipelineTraceViewModel => ({
  pipelineId: 'pipe-1',
  agentType: 'translation',
  status: 'completed',
  steps: [
    buildPipelineStepTraceViewModel({
      stepId: 'translate-input',
      label: 'Translating input',
      input: 'Original user input',
      output: 'Translated to English',
    }),
    buildPipelineStepTraceViewModel({
      stepId: 'main-llm',
      label: 'Generating response',
      input: 'Translated to English',
      output: 'Original English response',
    }),
    buildPipelineStepTraceViewModel({
      stepId: 'translate-output',
      label: 'Translating response',
      input: 'Original English response',
      output: 'Translated response',
    }),
  ],
  ...overrides,
});

const buildMessage = (overrides?: Partial<MessageViewModel>): MessageViewModel => ({
  id: 'msg-1',
  sessionId: 'sess-1',
  role: 'assistant',
  content: 'Translated response',
  createdAt: 1000000,
  // pipelineTrace is not yet on MessageViewModel — will fail until T043 extends the type
  ...(overrides as Record<string, unknown>),
});

const buildProps = (overrides?: Partial<MessageBubbleProps>): MessageBubbleProps => ({
  message: buildMessage(),
  onCopy: vi.fn(),
  ...overrides,
});

// -- Helpers --

const getToggleButton = (label = /show original/i): HTMLElement =>
  screen.getByRole('button', { name: label });

const queryToggleButton = (label = /show original/i): HTMLElement | null =>
  screen.queryByRole('button', { name: label });

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageBubble', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<MessageBubble {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  describe('Content', () => {
    it('should display message content for an assistant message', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant', content: 'Hello from AI' }),
          })}
        />
      );

      expect(screen.getByText('Hello from AI')).toBeInTheDocument();
    });

    it('should display message content for a user message', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'user', content: 'Hello from user' }),
          })}
        />
      );

      expect(screen.getByText('Hello from user')).toBeInTheDocument();
    });

    it('should show streaming indicator when isStreaming is true', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant' }),
            isStreaming: true,
            streamingAriaLabel: 'Streaming',
          })}
        />
      );

      expect(screen.getByLabelText('Streaming')).toBeInTheDocument();
    });

    it('should not show streaming indicator when isStreaming is false', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant' }),
            isStreaming: false,
            streamingAriaLabel: 'Streaming',
          })}
        />
      );

      expect(screen.queryByLabelText('Streaming')).not.toBeInTheDocument();
    });
  });

  // -- Callback tests --

  describe('Copy callback', () => {
    it('should render a copy button', () => {
      render(
        <MessageBubble
          {...buildProps({
            copyAriaLabel: 'Copy message to clipboard',
          })}
        />
      );

      expect(screen.getByRole('button', { name: 'Copy message to clipboard' })).toBeInTheDocument();
    });

    it('should call onCopy with message content when copy button is clicked', async () => {
      const user = userEvent.setup();
      const onCopy = vi.fn();
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ content: 'Copy me' }),
            onCopy,
            copyAriaLabel: 'Copy message to clipboard',
          })}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Copy message to clipboard' }));

      expect(onCopy).toHaveBeenCalledOnce();
      expect(onCopy).toHaveBeenCalledWith('Copy me');
    });

    it('should not call onCopy on initial render', () => {
      const onCopy = vi.fn();
      render(<MessageBubble {...buildProps({ onCopy })} />);

      expect(onCopy).not.toHaveBeenCalled();
    });
  });

  // -- Conditional rendering --

  describe('Conditional rendering based on role', () => {
    it('should apply user message aria-label for user role', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'user' }),
            userMessageAria: 'Your message',
          })}
        />
      );

      expect(screen.getByRole('article', { name: 'Your message' })).toBeInTheDocument();
    });

    it('should apply assistant message aria-label for assistant role', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant' }),
            assistantMessageAria: 'Assistant message',
          })}
        />
      );

      expect(screen.getByRole('article', { name: 'Assistant message' })).toBeInTheDocument();
    });

    it('should align items-end for user role and items-start for assistant role', () => {
      const { rerender } = render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'user' }),
            userMessageAria: 'Your message',
          })}
        />
      );

      expect(screen.getByRole('article', { name: 'Your message' })).toHaveClass('items-end');

      rerender(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant' }),
            assistantMessageAria: 'Assistant message',
          })}
        />
      );

      expect(screen.getByRole('article', { name: 'Assistant message' })).toHaveClass('items-start');
    });
  });

  // -- Edge cases --

  describe('Edge cases', () => {
    it('should render with empty string content', () => {
      const { container } = render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ content: '' }),
          })}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should render with very long content without crashing', () => {
      const longContent = 'A'.repeat(5000);
      const { container } = render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ content: longContent }),
          })}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should render content with special characters', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ content: '<script>alert("xss")</script>' }),
          })}
        />
      );

      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument();
    });
  });

  // -- Snapshot --

  it('should match inline snapshot with default assistant message', () => {
    const { asFragment } = render(
      <MessageBubble
        {...buildProps({
          message: buildMessage({ role: 'assistant', content: 'Hello' }),
          copyLabel: 'Copy',
          copyAriaLabel: 'Copy message to clipboard',
          userMessageAria: 'Your message',
          assistantMessageAria: 'Assistant message',
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });

  // -- T038: "Show original" toggle (pipelineTrace) --
  // These tests are in TDD Red phase — they FAIL until:
  //   1. MessageViewModel.pipelineTrace is added (T043 type extension)
  //   2. The toggle UI is implemented in MessageBubble

  // -- Redesign: FR-037–042 (RED phase — fail until implementation) --

  describe('Redesign: neutral bg + no avatar/label + model badge (FR-037–042)', () => {
    it('should not render avatar circle for user messages', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'user', content: 'Hello' }),
          })}
        />
      );

      expect(screen.queryByText('U')).not.toBeInTheDocument();
    });

    it('should not render avatar circle for assistant messages', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant', content: 'Hi' }),
          })}
        />
      );

      expect(screen.queryByText('AI')).not.toBeInTheDocument();
    });

    it('should not render role label badge', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'user', content: 'Hello' }),
          })}
        />
      );

      const article = screen.getByRole('article');
      expect(article.querySelector('[data-slot="badge"]')).toBeNull();
    });

    it('should use neutral background for user messages', () => {
      const { container } = render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'user', content: 'Hello' }),
          })}
        />
      );

      const bubble = container.querySelector('.bg-muted');
      expect(bubble).not.toBeNull();
      expect(bubble?.classList.contains('bg-primary')).toBe(false);
    });

    it('should render model badge when showModelBadge is true', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              model: 'gpt-4',
            } as Partial<MessageViewModel>),
            showModelBadge: true,
          } as unknown as Partial<MessageBubbleProps>)}
        />
      );

      expect(screen.getByTestId('model-badge')).toHaveTextContent('gpt-4');
    });

    it('should not render model badge when showModelBadge is false', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              model: 'gpt-4',
            } as Partial<MessageViewModel>),
            showModelBadge: false,
          } as unknown as Partial<MessageBubbleProps>)}
        />
      );

      expect(screen.queryByTestId('model-badge')).not.toBeInTheDocument();
    });
  });

  describe('Show original toggle (FR-032)', () => {
    // -- Toggle hidden when no pipelineTrace --

    it('should not render the toggle button when pipelineTrace is null', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ pipelineTrace: null }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(queryToggleButton(/show original/i)).not.toBeInTheDocument();
      expect(queryToggleButton(/show translated/i)).not.toBeInTheDocument();
    });

    it('should not render the toggle button when pipelineTrace is undefined', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage(),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(queryToggleButton(/show original/i)).not.toBeInTheDocument();
      expect(queryToggleButton(/show translated/i)).not.toBeInTheDocument();
    });

    // -- Toggle visible when pipelineTrace present --

    it('should render the toggle button when pipelineTrace is present and onToggleOriginal provided', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ pipelineTrace: buildPipelineTraceViewModel() }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(getToggleButton(/show original/i)).toBeInTheDocument();
    });

    // -- Default content is message.content (translated) --

    it('should display message.content by default when pipelineTrace is present', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              content: 'Fordított szöveg',
              pipelineTrace: buildPipelineTraceViewModel(),
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(screen.getByText('Fordított szöveg')).toBeInTheDocument();
      expect(screen.queryByText('Original English response')).not.toBeInTheDocument();
    });

    // -- showingOriginal=true shows original for assistant message --

    it('should show original content from main-llm step output when showingOriginal is true for assistant message', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              content: 'Translated response',
              pipelineTrace: buildPipelineTraceViewModel(),
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            showingOriginal: true,
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(screen.getByText('Original English response')).toBeInTheDocument();
      expect(screen.queryByText('Translated response')).not.toBeInTheDocument();
    });

    // -- Button label reflects showingOriginal prop --

    it('should show "Show translated" label when showingOriginal is true', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              content: 'Translated response',
              pipelineTrace: buildPipelineTraceViewModel(),
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            showingOriginal: true,
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(getToggleButton(/show translated/i)).toBeInTheDocument();
      expect(queryToggleButton(/show original/i)).not.toBeInTheDocument();
    });

    it('should show "Show original" label when showingOriginal is false', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              content: 'Translated response',
              pipelineTrace: buildPipelineTraceViewModel(),
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            showingOriginal: false,
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(getToggleButton(/show original/i)).toBeInTheDocument();
      expect(queryToggleButton(/show translated/i)).not.toBeInTheDocument();
    });

    // -- Clicking toggle calls onToggleOriginal callback --

    it('should call onToggleOriginal when toggle button is clicked', async () => {
      const user = userEvent.setup();
      const handleToggle = vi.fn();
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              content: 'Translated response',
              pipelineTrace: buildPipelineTraceViewModel(),
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            onToggleOriginal: handleToggle,
          } as Partial<MessageBubbleProps>)}
        />
      );

      await user.click(getToggleButton(/show original/i));

      expect(handleToggle).toHaveBeenCalledTimes(1);
    });

    // -- showingOriginal=true shows original for user message --

    it('should show translated text from translate-input step output when showingOriginal is true for user message', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'user',
              content: 'Translated user message',
              pipelineTrace: buildPipelineTraceViewModel(),
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            showingOriginal: true,
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(screen.getByText('Translated to English')).toBeInTheDocument();
      expect(screen.queryByText('Translated user message')).not.toBeInTheDocument();
    });

    // -- showingOriginal=false shows translated content --

    it('should show translated content when showingOriginal is false', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              content: 'Translated response',
              pipelineTrace: buildPipelineTraceViewModel(),
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            showingOriginal: false,
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(screen.getByText('Translated response')).toBeInTheDocument();
      expect(screen.queryByText('Original English response')).not.toBeInTheDocument();
    });

    // -- Edge cases for toggle --

    it('should not render toggle when pipelineTrace has no relevant step for assistant role', () => {
      const traceWithoutMainLlm = buildPipelineTraceViewModel({
        steps: [
          buildPipelineStepTraceViewModel({
            stepId: 'translate-input',
            input: 'Original user input',
            output: 'Translated',
          }),
        ],
      });
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'assistant',
              content: 'Translated response',
              pipelineTrace: traceWithoutMainLlm,
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(queryToggleButton(/show original/i)).not.toBeInTheDocument();
    });

    it('should not render toggle when pipelineTrace has no relevant step for user role', () => {
      const traceWithoutTranslateInput = buildPipelineTraceViewModel({
        steps: [
          buildPipelineStepTraceViewModel({
            stepId: 'main-llm',
            input: 'Some input',
            output: 'Original English response',
          }),
        ],
      });
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({
              role: 'user',
              content: 'Translated user message',
              pipelineTrace: traceWithoutTranslateInput,
            }),
            showOriginalLabel: 'Show original',
            showTranslatedLabel: 'Show translated',
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(queryToggleButton(/show original/i)).not.toBeInTheDocument();
    });

    it('should use default label text when showOriginalLabel prop is not provided', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ pipelineTrace: buildPipelineTraceViewModel() }),
            onToggleOriginal: vi.fn(),
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(getToggleButton(/show original/i)).toBeInTheDocument();
    });

    it('should not render toggle when onToggleOriginal is not provided', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ pipelineTrace: buildPipelineTraceViewModel() }),
            showOriginalLabel: 'Show original',
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(queryToggleButton(/show original/i)).not.toBeInTheDocument();
    });
  });

  // -- T020: Action-button hit-zone fix (FR-021, FR-022, FR-023) --
  // RED phase — fails until:
  //   (a) `-bottom-7` replaced with `top-full` (zero gap, inside group box)
  //   (b) `focus-visible:opacity-100` replaced with `focus-within:opacity-100` on the buttons container

  describe('Action-button hit-zone (T020)', () => {
    const buildHitZoneProps = (): MessageBubbleProps =>
      buildProps({
        message: buildMessage({ role: 'assistant', content: 'AI reply' }),
        showTestInLab: true,
        onTestInLab: vi.fn(),
        testInLabLabel: 'Test in Lab',
        copyAriaLabel: 'Copy message to clipboard',
      } as Partial<MessageBubbleProps>);

    const getActionButtonsWrapper = (container: HTMLElement): Element | null => {
      const copyBtn = container.querySelector('[aria-label="Copy message to clipboard"]');
      return copyBtn?.parentElement ?? null;
    };

    it('should NOT have -bottom-7 class on the action buttons container (gap causes hover dead zone)', () => {
      const { container } = render(<MessageBubble {...buildHitZoneProps()} />);

      const wrapper = getActionButtonsWrapper(container);

      expect(wrapper).not.toBeNull();
      expect(wrapper?.className).not.toMatch(/-bottom-7/);
    });

    it('should have focus-within:opacity-100 on the action buttons container so keyboard focus reveals buttons', () => {
      const { container } = render(<MessageBubble {...buildHitZoneProps()} />);

      const wrapper = getActionButtonsWrapper(container);

      expect(wrapper).not.toBeNull();
      expect(wrapper?.className).toMatch(/focus-within:opacity-100/);
    });

    it('should NOT have focus-visible:opacity-100 on the action buttons container (div is non-focusable)', () => {
      const { container } = render(<MessageBubble {...buildHitZoneProps()} />);

      const wrapper = getActionButtonsWrapper(container);

      expect(wrapper).not.toBeNull();
      expect(wrapper?.className).not.toMatch(/focus-visible:opacity-100/);
    });
  });

  // -- T023: "Test in Lab" hover button (FR-032, FR-037) --
  // RED phase — fails until showTestInLab/onTestInLab/testInLabLabel props are implemented

  describe('Test in Lab hover button (T023)', () => {
    it('should reveal Test in Lab button on hover for an assistant message when showTestInLab is true', async () => {
      const user = userEvent.setup();
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant', content: 'AI reply' }),
            showTestInLab: true,
            onTestInLab: vi.fn(),
            testInLabLabel: 'Test in Lab',
          } as Partial<MessageBubbleProps>)}
        />
      );

      await user.pointer({ target: screen.getByRole('article') });

      expect(screen.getByRole('button', { name: 'Test in Lab' })).toBeInTheDocument();
    });

    it('should reveal Test in Lab button on hover for a user message when showTestInLab is true', async () => {
      const user = userEvent.setup();
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'user', content: 'User prompt' }),
            showTestInLab: true,
            onTestInLab: vi.fn(),
            testInLabLabel: 'Test in Lab',
          } as Partial<MessageBubbleProps>)}
        />
      );

      await user.pointer({ target: screen.getByRole('article') });

      expect(screen.getByRole('button', { name: 'Test in Lab' })).toBeInTheDocument();
    });

    it('should not render Test in Lab button when showTestInLab is false', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant', content: 'AI reply' }),
            showTestInLab: false,
            onTestInLab: vi.fn(),
            testInLabLabel: 'Test in Lab',
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(screen.queryByRole('button', { name: 'Test in Lab' })).not.toBeInTheDocument();
    });

    it('should not render Test in Lab button when showTestInLab is omitted', () => {
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant', content: 'AI reply' }),
            onTestInLab: vi.fn(),
            testInLabLabel: 'Test in Lab',
          } as Partial<MessageBubbleProps>)}
        />
      );

      expect(screen.queryByRole('button', { name: 'Test in Lab' })).not.toBeInTheDocument();
    });

    it('should call onTestInLab when the button is clicked', async () => {
      const user = userEvent.setup();
      const onTestInLab = vi.fn();
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant', content: 'AI reply' }),
            showTestInLab: true,
            onTestInLab,
            testInLabLabel: 'Test in Lab',
          } as Partial<MessageBubbleProps>)}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Test in Lab' }));

      expect(onTestInLab).toHaveBeenCalledOnce();
    });

    it('should render the localized testInLabLabel text on the button', async () => {
      const user = userEvent.setup();
      render(
        <MessageBubble
          {...buildProps({
            message: buildMessage({ role: 'assistant', content: 'AI reply' }),
            showTestInLab: true,
            onTestInLab: vi.fn(),
            testInLabLabel: 'Tester dans le Lab',
          } as Partial<MessageBubbleProps>)}
        />
      );

      await user.pointer({ target: screen.getByRole('article') });

      expect(screen.getByRole('button', { name: 'Tester dans le Lab' })).toBeInTheDocument();
    });
  });
});
