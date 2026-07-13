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
    tabBlank: 'Blank',
    confirmBlank: 'Start blank',
    blankPlaceholder: 'No prompt selected',
    blankTextareaLabel: 'Type a custom system prompt…',
  };
}

function buildProps(overrides: Partial<PromptPickerDialogProps> = {}): PromptPickerDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    activeTab: 'skills',
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

describe('PromptPickerDialog', () => {
  it('should match snapshot when open on skills tab', () => {
    const { asFragment } = render(<PromptPickerDialog {...buildProps()} />);
    expect(asFragment()).toMatchSnapshot();
  });

  it('should render four tabs with localized labels from props', () => {
    render(<PromptPickerDialog {...buildProps()} />);
    expect(screen.getByRole('tab', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Packages' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Blank' })).toBeInTheDocument();
  });

  it('should render packagesSlot content when activeTab is packages', () => {
    render(<PromptPickerDialog {...buildProps({ activeTab: 'packages' as PromptPickerTab })} />);
    expect(screen.getByText('packages-slot-content')).toBeInTheDocument();
  });

  it('should call onTabChange with "packages" when the Packages tab is clicked', async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(<PromptPickerDialog {...buildProps({ onTabChange })} />);
    await user.click(screen.getByRole('tab', { name: 'Packages' }));
    expect(onTabChange).toHaveBeenCalledWith('packages');
  });

  it('should not show raw i18n key strings in DOM', () => {
    render(<PromptPickerDialog {...buildProps()} />);
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/promptPicker\./);
  });

  it('should fire onConfirmBlank when blank confirm button is clicked', async () => {
    const onConfirmBlank = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptPickerDialog
        {...buildProps({ activeTab: 'blank' as PromptPickerTab, onConfirmBlank })}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Start blank' }));
    expect(onConfirmBlank).toHaveBeenCalledOnce();
  });
});
