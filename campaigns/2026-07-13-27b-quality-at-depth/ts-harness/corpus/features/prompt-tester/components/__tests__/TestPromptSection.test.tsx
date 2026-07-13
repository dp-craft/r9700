import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestPromptSection, type TestPromptSectionProps } from '../TestPromptSection';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildProps(overrides: Partial<TestPromptSectionProps> = {}): TestPromptSectionProps {
  return {
    value: '',
    onChange: vi.fn(),
    tokens: 0,
    maxTokens: 2048,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TestPromptSection', () => {
  it('should render the user-prompt textarea with the provided value', () => {
    // Given: a value is passed as a prop
    const props = buildProps({ value: 'Hello world prompt' });

    // When: the component is rendered
    render(<TestPromptSection {...props} />);

    // Then: the textarea displays the provided value
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Hello world prompt');
  });

  it('should fall back to default label when labels prop is omitted', () => {
    // Given: no labels prop is provided
    const props = buildProps();

    // When: the component is rendered
    render(<TestPromptSection {...props} />);

    // Then: a default label text is rendered (component defines its own default)
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    // The label element must exist and be associated with the textarea
    expect(textarea).toHaveAccessibleName();
  });

  it('should call onChange with the new text when the user types', async () => {
    // Given: an onChange handler and an empty initial value
    const onChange = vi.fn();
    const props = buildProps({ value: '', onChange });
    const user = userEvent.setup();

    // When: the component is rendered and the user types into the textarea
    render(<TestPromptSection {...props} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'abc');

    // Then: onChange is called for each character typed
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('c'));
  });

  it('should accept a className prop and apply it to the root element', () => {
    // Given: a className is passed
    const props = buildProps({ className: 'custom-class-xyz' });

    // When: the component is rendered
    const { container } = render(<TestPromptSection {...props} />);

    // Then: the root element carries the custom class
    expect(container.firstChild).toHaveClass('custom-class-xyz');
  });
});

describe('Token counter (FR-012)', () => {
  it('should display token count and max in "N / M tok" format', () => {
    // Given: tokens=150 and maxTokens=2048
    const props = buildProps({ tokens: 150, maxTokens: 2048 });

    // When: the component is rendered
    render(<TestPromptSection {...props} />);

    // Then: "150 / 2048 tok" is visible
    expect(screen.getByText(/150\s*\/\s*2048\s*tok/)).toBeInTheDocument();
  });

  it('should apply text-destructive class when tokens exceed maxTokens', () => {
    // Given: tokens=3000 exceeds maxTokens=2048
    const props = buildProps({ tokens: 3000, maxTokens: 2048 });

    // When: the component is rendered
    const { container } = render(<TestPromptSection {...props} />);

    // Then: the counter element carries text-destructive
    const counter = container.querySelector('.text-destructive');
    expect(counter).not.toBeNull();
    expect(counter?.textContent).toMatch(/3000\s*\/\s*2048\s*tok/);
  });

  it('should apply text-muted-foreground class when tokens are within maxTokens', () => {
    // Given: tokens=100 is within maxTokens=2048
    const props = buildProps({ tokens: 100, maxTokens: 2048 });

    // When: the component is rendered
    const { container } = render(<TestPromptSection {...props} />);

    // Then: the counter element carries text-muted-foreground (not text-destructive)
    const counter = container.querySelector('.text-muted-foreground:last-child');
    expect(counter).not.toBeNull();
    expect(container.querySelector('.text-destructive')).toBeNull();
  });

  it('should render "változó" and "fájl" footer pills', () => {
    // Given: minimal props
    const props = buildProps({ tokens: 0, maxTokens: 2048 });

    // When: the component is rendered
    render(<TestPromptSection {...props} />);

    // Then: both footer pill labels are visible
    expect(screen.getByText('változó')).toBeInTheDocument();
    expect(screen.getByText('fájl')).toBeInTheDocument();
  });

  it('should display the textarea value and call onChange when user types', () => {
    // Given: value="hello" and an onChange spy
    const onChange = vi.fn();
    const props = buildProps({ value: 'hello', onChange, tokens: 10, maxTokens: 2048 });

    // When: the component is rendered
    const { container } = render(<TestPromptSection {...props} />);
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea).toHaveValue('hello');

    // When: the user types a character
    fireEvent.change(textarea as HTMLTextAreaElement, { target: { value: 'hello!' } });

    // Then: onChange is called with the new value
    expect(onChange).toHaveBeenCalledWith('hello!');
  });
});
