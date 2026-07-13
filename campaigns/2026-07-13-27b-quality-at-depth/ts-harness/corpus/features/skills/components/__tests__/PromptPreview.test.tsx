import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PromptPreviewProps } from '../PromptPreview';
import { PromptPreview } from '../PromptPreview';

// -- Builders --

const buildProps = (overrides?: Partial<PromptPreviewProps>): PromptPreviewProps => ({
  text: 'You are a helpful assistant.\nRespond concisely.',
  ...overrides,
});

// -- Tests --

describe('PromptPreview', () => {
  // -- Smoke tests --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<PromptPreview {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should display the text content when text is provided', () => {
    render(<PromptPreview {...buildProps({ text: 'Be a code reviewer.' })} />);

    expect(screen.getByText('Be a code reviewer.')).toBeInTheDocument();
  });

  it('should display multiline text preserving line structure', () => {
    const multilineText = 'Line one.\nLine two.\nLine three.';
    render(<PromptPreview {...buildProps({ text: multilineText })} />);

    expect(screen.getByText(/Line one\./)).toBeInTheDocument();
    expect(screen.getByText(/Line three\./)).toBeInTheDocument();
  });

  it('should apply custom className when provided', () => {
    const { container } = render(
      <PromptPreview {...buildProps({ className: 'my-custom-class' })} />
    );

    expect(container.querySelector('.my-custom-class')).toBeInTheDocument();
  });

  // -- Edge cases --

  it('should render without crashing when text is an empty string', () => {
    const { container } = render(<PromptPreview {...buildProps({ text: '' })} />);

    expect(container).toBeTruthy();
  });

  it('should not display meaningful content when text is empty', () => {
    const { container } = render(<PromptPreview {...buildProps({ text: '' })} />);

    const textContent = container.textContent?.trim() ?? '';
    expect(textContent.length).toBeLessThanOrEqual(0);
  });

  it('should render very long text without crashing', () => {
    const longText = 'A'.repeat(10000);
    render(<PromptPreview {...buildProps({ text: longText })} />);

    expect(screen.getByText(longText)).toBeInTheDocument();
  });

  it('should render text with special characters', () => {
    const specialText = '<script>alert("xss")</script> & "quotes" \'single\'';
    render(<PromptPreview {...buildProps({ text: specialText })} />);

    expect(screen.getByText(specialText)).toBeInTheDocument();
  });

  it('should render whitespace-only text', () => {
    const { container } = render(<PromptPreview {...buildProps({ text: '   ' })} />);

    expect(container).toBeTruthy();
  });

  it('should render without className when it is not provided', () => {
    const { container } = render(<PromptPreview {...buildProps({ className: undefined })} />);

    expect(container).toBeTruthy();
  });

  // -- Snapshot --

  it('should match inline snapshot with default props', () => {
    const { asFragment } = render(
      <PromptPreview {...buildProps({ text: 'Snapshot prompt text.' })} />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <div
          data-slot="scroll-area"
          dir="ltr"
        >
          <style>
            [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}
          </style>
          <div
            data-radix-scroll-area-viewport=""
            data-slot="scroll-area-viewport"
          >
            <div>
              <pre
                title="System prompt preview"
              >
                Snapshot prompt text.
              </pre>
            </div>
          </div>
        </div>
      </DocumentFragment>
    `);
  });
});
