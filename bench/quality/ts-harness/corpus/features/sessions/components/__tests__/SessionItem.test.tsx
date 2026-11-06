import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionItemProps } from '../SessionItem';
import { SessionItem } from '../SessionItem';

// -- Builders --

const buildSession = (
  overrides?: Partial<SessionItemProps['session']>
): SessionItemProps['session'] => ({
  id: 'session-1',
  title: 'My Chat Session',
  ...overrides,
});

const buildProps = (overrides?: Partial<SessionItemProps>): SessionItemProps => ({
  session: buildSession(),
  isActive: false,
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionItem', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<SessionItem {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Title display --

  describe('Title display', () => {
    it('should display the session title text', () => {
      render(
        <SessionItem {...buildProps({ session: buildSession({ title: 'My Chat Session' }) })} />
      );

      expect(screen.getByText('My Chat Session')).toBeInTheDocument();
    });

    it('should render the title span with truncate class for CSS truncation', () => {
      render(<SessionItem {...buildProps()} />);

      const titleSpan = screen.getByText('My Chat Session');

      expect(titleSpan).toHaveClass('truncate');
    });

    it('should render session title with a very long string without crashing', () => {
      const longTitle = 'A'.repeat(500);
      render(<SessionItem {...buildProps({ session: buildSession({ title: longTitle }) })} />);

      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });
  });

  // -- Tooltip (title attribute) --

  describe('Tooltip via title attribute', () => {
    it('should set title attribute on the session button when tooltipText is provided', () => {
      render(<SessionItem {...buildProps({ tooltipText: 'Created: Jan 1, 2025 10:00 AM' })} />);

      const button = screen.getByRole('button', { name: /Select chat/i });

      expect(button).toHaveAttribute('title', 'Created: Jan 1, 2025 10:00 AM');
    });

    it('should not set title attribute when tooltipText is not provided', () => {
      render(<SessionItem {...buildProps()} />);

      const button = screen.getByRole('button', { name: /Select chat/i });

      expect(button).not.toHaveAttribute('title');
    });

    it('should not set title attribute when tooltipText is undefined', () => {
      render(<SessionItem {...buildProps({ tooltipText: undefined })} />);

      const button = screen.getByRole('button', { name: /Select chat/i });

      expect(button).not.toHaveAttribute('title');
    });
  });

  // -- Active state --

  describe('Active state', () => {
    it('should set aria-current="page" when isActive is true', () => {
      render(<SessionItem {...buildProps({ isActive: true })} />);

      const button = screen.getByRole('button', { name: /Select chat/i });

      expect(button).toHaveAttribute('aria-current', 'page');
    });

    it('should not set aria-current when isActive is false', () => {
      render(<SessionItem {...buildProps({ isActive: false })} />);

      const button = screen.getByRole('button', { name: /Select chat/i });

      expect(button).not.toHaveAttribute('aria-current');
    });

    describe('Given isActive=true', () => {
      it('should have border class on the session button when active', () => {
        render(<SessionItem {...buildProps({ isActive: true })} />);

        const button = screen.getByRole('button', { name: /Select chat/i });

        expect(button).toHaveClass('border');
      });
    });
  });

  // -- metaLine prop --

  describe('metaLine prop', () => {
    describe('Given metaLine="3 min · GPT-5" passed to SessionItem', () => {
      it('should render meta text visible in the DOM with font-mono class when metaLine is provided', () => {
        render(<SessionItem {...buildProps({ metaLine: '3 min · GPT-5' })} />);

        const metaSpan = screen.getByText('3 min · GPT-5');

        expect(metaSpan).toBeInTheDocument();
        expect(metaSpan).toHaveClass('font-mono');
      });
    });

    describe('Given metaLine undefined', () => {
      it('should not render any meta-line element when metaLine is not provided', () => {
        render(<SessionItem {...buildProps({ metaLine: undefined })} />);

        expect(screen.queryByText(/·/)).not.toBeInTheDocument();
      });
    });
  });

  // -- Select callback --

  describe('onSelect callback', () => {
    it('should call onSelect when the session button is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<SessionItem {...buildProps({ onSelect })} />);

      const button = screen.getByRole('button', { name: /Select chat/i });
      await user.click(button);

      expect(onSelect).toHaveBeenCalledOnce();
    });

    it('should not call onSelect when delete button is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<SessionItem {...buildProps({ onSelect })} />);

      const deleteButton = screen.getByRole('button', { name: 'Delete chat' });
      await user.click(deleteButton);

      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  // -- Double-click to enter edit mode --

  describe('onDoubleClick callback', () => {
    it('should call onDoubleClick when the session button is double-clicked', async () => {
      const user = userEvent.setup();
      const onDoubleClick = vi.fn();
      render(<SessionItem {...buildProps({ onDoubleClick })} />);

      const button = screen.getByRole('button', { name: /Select chat/i });
      await user.dblClick(button);

      expect(onDoubleClick).toHaveBeenCalledOnce();
    });

    it('should not throw when onDoubleClick is not provided and button is double-clicked', async () => {
      const user = userEvent.setup();
      render(<SessionItem {...buildProps({ onDoubleClick: undefined })} />);

      const button = screen.getByRole('button', { name: /Select chat/i });

      await expect(user.dblClick(button)).resolves.not.toThrow();
    });
  });

  // -- Inline edit mode --

  describe('Inline edit mode (isEditing=true)', () => {
    it('should render an input element when isEditing is true', () => {
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: 'My Chat Session',
            onEditValueChange: vi.fn(),
            onConfirmEdit: vi.fn(),
            onCancelEdit: vi.fn(),
          })}
        />
      );

      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('should not render the session button when isEditing is true', () => {
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: 'My Chat Session',
            onEditValueChange: vi.fn(),
            onConfirmEdit: vi.fn(),
            onCancelEdit: vi.fn(),
          })}
        />
      );

      expect(screen.queryByRole('button', { name: /Select chat/i })).not.toBeInTheDocument();
    });

    it('should display editValue in the input when isEditing is true', () => {
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: 'Edited Title',
            onEditValueChange: vi.fn(),
            onConfirmEdit: vi.fn(),
            onCancelEdit: vi.fn(),
          })}
        />
      );

      expect(screen.getByRole('textbox')).toHaveValue('Edited Title');
    });

    it('should call onEditValueChange when the input value changes', async () => {
      const user = userEvent.setup();
      const onEditValueChange = vi.fn();
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: '',
            onEditValueChange,
            onConfirmEdit: vi.fn(),
            onCancelEdit: vi.fn(),
          })}
        />
      );

      const input = screen.getByRole('textbox');
      await user.type(input, 'N');

      expect(onEditValueChange).toHaveBeenCalled();
    });

    it('should call onConfirmEdit when Enter key is pressed on the input', () => {
      const onConfirmEdit = vi.fn();
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: 'New Title',
            onEditValueChange: vi.fn(),
            onConfirmEdit,
            onCancelEdit: vi.fn(),
          })}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onConfirmEdit).toHaveBeenCalledOnce();
    });

    it('should call onCancelEdit when Escape key is pressed on the input', () => {
      const onCancelEdit = vi.fn();
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: 'My Chat Session',
            onEditValueChange: vi.fn(),
            onConfirmEdit: vi.fn(),
            onCancelEdit,
          })}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(onCancelEdit).toHaveBeenCalledOnce();
    });

    it('should call onConfirmEdit when the input loses focus (blur)', () => {
      const onConfirmEdit = vi.fn();
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: 'My Chat Session',
            onEditValueChange: vi.fn(),
            onConfirmEdit,
            onCancelEdit: vi.fn(),
          })}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.blur(input);

      expect(onConfirmEdit).toHaveBeenCalledOnce();
    });

    it('should not call onConfirmEdit when a non-Enter/Escape key is pressed', () => {
      const onConfirmEdit = vi.fn();
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: 'My Chat Session',
            onEditValueChange: vi.fn(),
            onConfirmEdit,
            onCancelEdit: vi.fn(),
          })}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'a' });

      expect(onConfirmEdit).not.toHaveBeenCalled();
    });

    it('should not call onCancelEdit when a non-Escape key is pressed', () => {
      const onCancelEdit = vi.fn();
      render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: 'My Chat Session',
            onEditValueChange: vi.fn(),
            onConfirmEdit: vi.fn(),
            onCancelEdit,
          })}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCancelEdit).not.toHaveBeenCalled();
    });
  });

  // -- Non-editing mode --

  describe('Non-editing mode (isEditing=false or omitted)', () => {
    it('should render the session button and not an input when isEditing is false', () => {
      render(<SessionItem {...buildProps({ isEditing: false })} />);

      expect(screen.getByRole('button', { name: /Select chat/i })).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('should render the session button and not an input when isEditing is omitted', () => {
      render(<SessionItem {...buildProps()} />);

      expect(screen.getByRole('button', { name: /Select chat/i })).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  // -- Delete dialog --

  describe('Delete dialog', () => {
    it('should call onDelete when the delete confirm button is clicked', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      render(<SessionItem {...buildProps({ onDelete })} />);

      await user.click(screen.getByRole('button', { name: 'Delete chat' }));
      await user.click(screen.getByRole('button', { name: 'Delete' }));

      expect(onDelete).toHaveBeenCalledOnce();
    });

    it('should show the delete dialog when the delete button is clicked', async () => {
      const user = userEvent.setup();
      render(<SessionItem {...buildProps()} />);

      await user.click(screen.getByRole('button', { name: 'Delete chat' }));

      expect(screen.getByText('Delete this chat?')).toBeInTheDocument();
    });
  });

  // -- Labels customisation --

  describe('Custom labels', () => {
    it('should use custom selectChatAriaPrefix in button aria-label', () => {
      render(
        <SessionItem
          {...buildProps({
            labels: { selectChatAriaPrefix: 'Open session:' },
          })}
        />
      );

      expect(
        screen.getByRole('button', { name: 'Open session: My Chat Session' })
      ).toBeInTheDocument();
    });

    it('should use custom deleteChatAriaLabel on the delete button', () => {
      render(
        <SessionItem
          {...buildProps({
            labels: { deleteChatAriaLabel: 'Remove this chat' },
          })}
        />
      );

      expect(screen.getByRole('button', { name: 'Remove this chat' })).toBeInTheDocument();
    });
  });

  // -- Edge cases --

  describe('Edge cases', () => {
    it('should render with an empty title without crashing', () => {
      const { container } = render(
        <SessionItem {...buildProps({ session: buildSession({ title: '' }) })} />
      );

      expect(container).toBeTruthy();
    });

    it('should render with special characters in the title without crashing', () => {
      render(
        <SessionItem
          {...buildProps({ session: buildSession({ title: '<script>alert("xss")</script>' }) })}
        />
      );

      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument();
    });

    it('should render with an empty tooltipText as title attribute when provided', () => {
      render(<SessionItem {...buildProps({ tooltipText: '' })} />);

      const button = screen.getByRole('button', { name: /Select chat/i });

      expect(button).toHaveAttribute('title', '');
    });

    it('should render the edit input with an empty editValue without crashing', () => {
      const { container } = render(
        <SessionItem
          {...buildProps({
            isEditing: true,
            editValue: '',
            onEditValueChange: vi.fn(),
            onConfirmEdit: vi.fn(),
            onCancelEdit: vi.fn(),
          })}
        />
      );

      expect(container).toBeTruthy();
    });
  });
});
