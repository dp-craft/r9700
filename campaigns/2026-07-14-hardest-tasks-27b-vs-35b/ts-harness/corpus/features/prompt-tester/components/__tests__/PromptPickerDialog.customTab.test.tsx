import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptPickerTab } from '../../types';
import { PromptPickerDialog, type PromptPickerDialogProps } from '../PromptPickerDialog';

function buildLabels(): PromptPickerDialogProps['labels'] {
  return {
    title: 'Pick a prompt',
    tabSkills: 'Skills',
    tabPackages: 'Packages',
    tabHistory: 'History',
    tabBlank: 'Custom',
    confirmBlank: 'Add',
    blankPlaceholder: 'No prompt selected',
    blankTextareaLabel: 'Type a custom system prompt',
  };
}

function buildProps(overrides: Partial<PromptPickerDialogProps> = {}): PromptPickerDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    activeTab: 'blank' as PromptPickerTab,
    onTabChange: vi.fn(),
    skillsSlot: <div>skills-slot-content</div>,
    packagesSlot: <div>packages-slot-content</div>,
    historySlot: <div>history-slot-content</div>,
    onConfirmBlank: vi.fn(),
    customPromptValue: '',
    onCustomPromptChange: vi.fn(),
    labels: buildLabels(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PromptPickerDialog custom tab', () => {
  it('should match snapshot when custom tab is active', () => {
    const { asFragment } = render(<PromptPickerDialog {...buildProps()} />);
    expect(asFragment()).toMatchSnapshot();
  });

  it('should reflect customPromptValue in the textarea', () => {
    render(<PromptPickerDialog {...buildProps({ customPromptValue: 'hello prompt' })} />);
    const textarea = screen.getByTestId('custom-prompt-textarea');
    expect(textarea).toHaveValue('hello prompt');
  });

  it('should call onCustomPromptChange when the textarea receives input', async () => {
    const onCustomPromptChange = vi.fn();
    const user = userEvent.setup();
    render(<PromptPickerDialog {...buildProps({ onCustomPromptChange })} />);
    await user.type(screen.getByTestId('custom-prompt-textarea'), 'x');
    expect(onCustomPromptChange).toHaveBeenCalledWith('x');
  });

  it('should call onConfirmBlank when the Add button is clicked', async () => {
    const onConfirmBlank = vi.fn();
    const user = userEvent.setup();
    render(<PromptPickerDialog {...buildProps({ onConfirmBlank })} />);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onConfirmBlank).toHaveBeenCalledOnce();
  });

  it('should label the custom tab "Custom"', () => {
    render(<PromptPickerDialog {...buildProps()} />);
    expect(screen.getByRole('tab', { name: 'Custom' })).toBeInTheDocument();
  });
});
