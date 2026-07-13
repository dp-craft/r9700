import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FontSize } from '../../../../specs/002-ui-bugfix/contracts/font-size';
import type { FontSizePickerProps } from './FontSizePicker';
import { FontSizePicker } from './FontSizePicker';

// -- Builders --

const buildProps = (overrides?: Partial<FontSizePickerProps>): FontSizePickerProps => ({
  fontSize: 'md',
  onFontSizeChange: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FontSizePicker', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<FontSizePicker {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Accessibility test --

  it('should have aria-label on the select trigger', () => {
    render(<FontSizePicker {...buildProps()} />);

    const trigger = screen.getByRole('combobox');

    expect(trigger).toHaveAttribute('aria-label', 'Select font size');
  });

  // -- Content tests --

  it('should render all three font size options when opened', async () => {
    const user = userEvent.setup();
    render(<FontSizePicker {...buildProps()} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: 'Small' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Medium' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Large' })).toBeInTheDocument();
  });

  it('should render exactly three options when opened', async () => {
    const user = userEvent.setup();
    render(<FontSizePicker {...buildProps()} />);

    await user.click(screen.getByRole('combobox'));

    const options = screen.getAllByRole('option');

    expect(options).toHaveLength(3);
  });

  // -- Callback tests --

  it('should call onFontSizeChange with "sm" when Small is selected', async () => {
    const user = userEvent.setup();
    const onFontSizeChange = vi.fn();
    render(<FontSizePicker {...buildProps({ fontSize: 'md', onFontSizeChange })} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Small' }));

    expect(onFontSizeChange).toHaveBeenCalledOnce();
    expect(onFontSizeChange).toHaveBeenCalledWith('sm');
  });

  it('should call onFontSizeChange with "lg" when Large is selected', async () => {
    const user = userEvent.setup();
    const onFontSizeChange = vi.fn();
    render(<FontSizePicker {...buildProps({ fontSize: 'md', onFontSizeChange })} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Large' }));

    expect(onFontSizeChange).toHaveBeenCalledOnce();
    expect(onFontSizeChange).toHaveBeenCalledWith('lg');
  });

  it('should call onFontSizeChange with "md" when Medium is selected', async () => {
    const user = userEvent.setup();
    const onFontSizeChange = vi.fn();
    render(<FontSizePicker {...buildProps({ fontSize: 'sm', onFontSizeChange })} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Medium' }));

    expect(onFontSizeChange).toHaveBeenCalledOnce();
    expect(onFontSizeChange).toHaveBeenCalledWith('md');
  });

  // -- Conditional rendering tests --

  it('should show "Small" as selected value when fontSize is "sm"', () => {
    render(<FontSizePicker {...buildProps({ fontSize: 'sm' })} />);

    const trigger = screen.getByRole('combobox');

    expect(trigger).toHaveTextContent('Small');
  });

  it('should show "Medium" as selected value when fontSize is "md"', () => {
    render(<FontSizePicker {...buildProps({ fontSize: 'md' })} />);

    const trigger = screen.getByRole('combobox');

    expect(trigger).toHaveTextContent('Medium');
  });

  it('should show "Large" as selected value when fontSize is "lg"', () => {
    render(<FontSizePicker {...buildProps({ fontSize: 'lg' })} />);

    const trigger = screen.getByRole('combobox');

    expect(trigger).toHaveTextContent('Large');
  });

  // -- Edge cases --

  it('should render correctly with each valid font size as initial value', () => {
    const sizes: readonly FontSize[] = ['sm', 'md', 'lg'];
    const expectedLabels: Record<FontSize, string> = {
      sm: 'Small',
      md: 'Medium',
      lg: 'Large',
    };

    sizes.forEach(size => {
      const { unmount } = render(<FontSizePicker {...buildProps({ fontSize: size })} />);

      const trigger = screen.getByRole('combobox');

      expect(trigger).toHaveTextContent(expectedLabels[size]);

      unmount();
    });
  });

  it('should not call onFontSizeChange on initial render', () => {
    const onFontSizeChange = vi.fn();
    render(<FontSizePicker {...buildProps({ onFontSizeChange })} />);

    expect(onFontSizeChange).not.toHaveBeenCalled();
  });

  // -- Snapshot --

  it('should match inline snapshot in default state', () => {
    const { asFragment } = render(
      <FontSizePicker
        {...buildProps({
          fontSize: 'md',
          onFontSizeChange: vi.fn(),
        })}
      />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <button
          aria-autocomplete="none"
          aria-expanded="false"
          aria-label="Select font size"
          data-size="default"
          data-slot="select-trigger"
          data-state="closed"
          dir="ltr"
          role="combobox"
          type="button"
        >
          <span
            data-slot="select-value"
          >
            Medium
          </span>
          <svg
            aria-hidden="true"
            fill="none"
            height="24"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            viewBox="0 0 24 24"
            width="24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="m6 9 6 6 6-6"
            />
          </svg>
        </button>
      </DocumentFragment>
    `);
  });
});
