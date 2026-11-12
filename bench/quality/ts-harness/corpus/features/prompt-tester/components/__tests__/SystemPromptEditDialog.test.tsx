import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SystemPromptEditDialog,
  type SystemPromptEditDialogProps
} from '../SystemPromptEditDialog';

function buildLabels(): SystemPromptEditDialogProps['labels'] {
  return {
    title: 'Edit system prompt',
    save: 'Save',
    cancel: 'Cancel',
    placeholder: 'Enter system prompt…',
  };
}

function buildProps(
  overrides: Partial<SystemPromptEditDialogProps> = {}
): SystemPromptEditDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    value: 'initial content',
    onValueChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    labels: buildLabels(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SystemPromptEditDialog', () => {
  it('should match snapshot when open', () => {
    const { asFragment } = render(<SystemPromptEditDialog {...buildProps()} />);
    expect(asFragment()).toMatchSnapshot();
  });

  it('should render a textarea bound to value and fire onValueChange on typing', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(<SystemPromptEditDialog {...buildProps({ value: '', onValueChange })} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello');
    expect(onValueChange).toHaveBeenCalled();
  });

  it('should display the current value in the textarea', () => {
    render(<SystemPromptEditDialog {...buildProps({ value: 'pre-filled text' })} />);
    expect(screen.getByRole('textbox')).toHaveValue('pre-filled text');
  });

  it('should fire onSave when the Save button is clicked', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SystemPromptEditDialog {...buildProps({ onSave })} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('should fire onCancel when the Cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<SystemPromptEditDialog {...buildProps({ onCancel })} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('should render localized title and button labels from labels prop', () => {
    const labels = buildLabels();
    render(<SystemPromptEditDialog {...buildProps({ labels })} />);
    expect(screen.getByText('Edit system prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
