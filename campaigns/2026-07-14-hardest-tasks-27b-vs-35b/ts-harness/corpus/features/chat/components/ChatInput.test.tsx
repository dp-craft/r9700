import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatInputProps } from './ChatInput';
import { ChatInput } from './ChatInput';

// -- Builders --

const buildProps = (overrides?: Partial<ChatInputProps>): ChatInputProps => ({
  value: '',
  onValueChange: vi.fn(),
  onSubmit: vi.fn(),
  onAbort: vi.fn(),
  isStreaming: false,
  canSend: true,
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChatInput', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<ChatInput {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render the textarea with Message input label', () => {
    render(<ChatInput {...buildProps()} />);

    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeInTheDocument();
  });

  it('should render the Send button', () => {
    render(<ChatInput {...buildProps()} />);

    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('should display the current value in the textarea', () => {
    render(<ChatInput {...buildProps({ value: 'Hello world' })} />);

    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveValue('Hello world');
  });

  // -- Callback tests --

  it('should call onSubmit when Enter is pressed without Shift', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChatInput {...buildProps({ onSubmit })} />);

    const textarea = screen.getByRole('textbox', { name: 'Message input' });
    await user.click(textarea);
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('should not call onSubmit when Shift+Enter is pressed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChatInput {...buildProps({ onSubmit })} />);

    const textarea = screen.getByRole('textbox', { name: 'Message input' });
    await user.click(textarea);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should call onSubmit when Send button is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChatInput {...buildProps({ onSubmit })} />);

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('should call onValueChange when text is typed into the textarea', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ChatInput {...buildProps({ onValueChange })} />);

    const textarea = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textarea, 'a');

    expect(onValueChange).toHaveBeenCalledWith('a');
  });

  it('should call onAbort when Stop button is clicked during streaming', async () => {
    const user = userEvent.setup();
    const onAbort = vi.fn();
    render(<ChatInput {...buildProps({ isStreaming: true, onAbort })} />);

    await user.click(screen.getByRole('button', { name: 'Stop generation' }));

    expect(onAbort).toHaveBeenCalledOnce();
  });

  // -- Conditional rendering tests --

  it('should show Stop button when isStreaming is true', () => {
    render(<ChatInput {...buildProps({ isStreaming: true })} />);

    expect(screen.getByRole('button', { name: /^Stop generation$/ })).toBeInTheDocument();
  });

  it('should not show Stop button when isStreaming is false', () => {
    render(<ChatInput {...buildProps({ isStreaming: false })} />);

    expect(screen.queryByRole('button', { name: /^Stop generation$/ })).not.toBeInTheDocument();
  });

  it('should show Send button when isStreaming is false', () => {
    render(<ChatInput {...buildProps({ isStreaming: false })} />);

    expect(screen.getByRole('button', { name: /^Send message$/ })).toBeInTheDocument();
  });

  it('should not show Send button when isStreaming is true', () => {
    render(<ChatInput {...buildProps({ isStreaming: true })} />);

    expect(screen.queryByRole('button', { name: /^Send message$/ })).not.toBeInTheDocument();
  });

  it('should disable Send button when canSend is false', () => {
    render(<ChatInput {...buildProps({ canSend: false })} />);

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('should enable Send button when canSend is true', () => {
    render(<ChatInput {...buildProps({ canSend: true })} />);

    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('should disable textarea when isStreaming is true', () => {
    render(<ChatInput {...buildProps({ isStreaming: true })} />);

    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeDisabled();
  });

  // -- textareaRef prop tests (TDD Red — prop does not exist yet) --

  describe('textareaRef prop', () => {
    it('should forward textareaRef to the underlying textarea element', () => {
      const ref = React.createRef<HTMLTextAreaElement | null>();
      const props = {
        ...buildProps(),
        textareaRef: ref,
      } as ChatInputProps & { readonly textareaRef: React.RefObject<HTMLTextAreaElement | null> };

      render(<ChatInput {...props} />);

      const textarea = screen.getByRole('textbox', { name: 'Message input' });

      expect(ref.current).toBe(textarea);
    });

    it('should allow focus() to be called on the forwarded ref', () => {
      const ref = React.createRef<HTMLTextAreaElement | null>();
      const props = {
        ...buildProps(),
        textareaRef: ref,
      } as ChatInputProps & { readonly textareaRef: React.RefObject<HTMLTextAreaElement | null> };

      render(<ChatInput {...props} />);

      ref.current?.focus();

      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message input' }));
    });

    it('should render correctly without textareaRef prop (backward compatibility)', () => {
      render(<ChatInput {...buildProps()} />);

      expect(screen.getByRole('textbox', { name: 'Message input' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    });

    it('should accept a callback ref as textareaRef', () => {
      let capturedElement: HTMLTextAreaElement | null = null;
      const callbackRef = (el: HTMLTextAreaElement | null): void => {
        capturedElement = el;
      };
      const props = {
        ...buildProps(),
        textareaRef: callbackRef,
      } as ChatInputProps & { readonly textareaRef: (el: HTMLTextAreaElement | null) => void };

      render(<ChatInput {...props} />);

      const textarea = screen.getByRole('textbox', { name: 'Message input' });

      expect(capturedElement).toBe(textarea);
    });
  });

  // -- onTestInLabClick (🧪 button) tests --

  it('should render Test in Lab button and enabled when onTestInLabClick provided and value is non-empty', () => {
    render(<ChatInput {...buildProps({ value: 'some prompt', onTestInLabClick: vi.fn() })} />);

    expect(screen.getByRole('button', { name: /^Test in Lab$/ })).toBeEnabled();
  });

  it('should render Test in Lab button disabled when onTestInLabClick provided and value is empty', () => {
    render(<ChatInput {...buildProps({ value: '', onTestInLabClick: vi.fn() })} />);

    expect(screen.getByRole('button', { name: /^Test in Lab$/ })).toBeDisabled();
  });

  it('should render Test in Lab button disabled when onTestInLabClick provided and value is whitespace only', () => {
    render(<ChatInput {...buildProps({ value: '   ', onTestInLabClick: vi.fn() })} />);

    expect(screen.getByRole('button', { name: /^Test in Lab$/ })).toBeDisabled();
  });

  it('should not render Test in Lab button when onTestInLabClick is undefined', () => {
    render(<ChatInput {...buildProps({ onTestInLabClick: undefined })} />);

    expect(screen.queryByRole('button', { name: /^Test in Lab$/ })).not.toBeInTheDocument();
  });

  it('should call onTestInLabClick once when Test in Lab button is clicked', async () => {
    const user = userEvent.setup();
    const onTestInLabClick = vi.fn();
    render(<ChatInput {...buildProps({ value: 'hello', onTestInLabClick })} />);

    await user.click(screen.getByRole('button', { name: /^Test in Lab$/ }));

    expect(onTestInLabClick).toHaveBeenCalledOnce();
  });

  it('should use custom testInLabAriaLabel when provided', () => {
    render(
      <ChatInput
        {...buildProps({ value: 'hello', onTestInLabClick: vi.fn(), testInLabAriaLabel: 'Custom' })}
      />
    );

    expect(screen.getByRole('button', { name: /^Custom$/ })).toBeInTheDocument();
  });

  // -- Edge cases --

  it('should render with empty string value', () => {
    render(<ChatInput {...buildProps({ value: '' })} />);

    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveValue('');
  });

  it('should render with very long text value', () => {
    const longText = 'a'.repeat(10000);
    render(<ChatInput {...buildProps({ value: longText })} />);

    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveValue(longText);
  });

  it('should apply custom className when provided', () => {
    const { container } = render(<ChatInput {...buildProps({ className: 'custom-class' })} />);

    expect(container.firstElementChild?.className).toContain('custom-class');
  });

  // -- Snapshot --

  it('should match inline snapshot', () => {
    const { asFragment } = render(
      <ChatInput
        {...buildProps({
          value: 'Test message',
          isStreaming: false,
          canSend: true,
        })}
      />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <div
          data-testid="chat-input"
        >
          <textarea
            aria-disabled="false"
            aria-label="Message input"
            data-slot="textarea"
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            rows="3"
          >
            Test message
          </textarea>
          <button
            aria-label="Send message"
            data-size="default"
            data-slot="button"
            data-testid="chat-input-send"
            data-variant="default"
          >
            Send
          </button>
        </div>
      </DocumentFragment>
    `);
  });
});
