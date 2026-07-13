import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  UserPromptHistoryDropdown,
  type UserPromptHistoryDropdownProps,
  type UserPromptHistoryItem,
  type UserPromptHistoryLabels
} from '../UserPromptHistoryDropdown';

function buildItems(): UserPromptHistoryItem[] {
  return [
    { runId: 'r1', prompt: 'Explain quantum computing in two paragraphs', recordedAt: 100 },
    { runId: 'r2', prompt: 'Translate "hello" to French', recordedAt: 90 },
    { runId: 'r3', prompt: 'Write a haiku about TypeScript', recordedAt: 80 },
  ];
}

function buildLabels(overrides: Partial<UserPromptHistoryLabels> = {}): UserPromptHistoryLabels {
  return {
    historyTrigger: '↻ history',
    empty: 'No history yet',
    ariaLabel: 'Recent prompt history',
    ...overrides,
  };
}

interface HarnessProps {
  readonly initialOpen?: boolean;
  readonly items?: readonly UserPromptHistoryItem[];
  readonly onSelect?: UserPromptHistoryDropdownProps['onSelect'];
  readonly onOpenChange?: UserPromptHistoryDropdownProps['onOpenChange'];
  readonly labels?: UserPromptHistoryLabels;
  readonly disabled?: boolean;
}

function Harness({
  initialOpen = false,
  items = buildItems(),
  onSelect = vi.fn(),
  onOpenChange,
  labels = buildLabels(),
  disabled,
}: HarnessProps) {
  const [open, setOpen] = useState(initialOpen);
  function handleOpenChange(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }
  return (
    <UserPromptHistoryDropdown
      items={items}
      onSelect={onSelect}
      open={open}
      onOpenChange={handleOpenChange}
      labels={labels}
      disabled={disabled}
    />
  );
}

describe('UserPromptHistoryDropdown', () => {
  it('renders trigger with count suffix', () => {
    render(<Harness items={buildItems()} />);
    expect(screen.getByTestId('user-prompt-history-trigger')).toHaveTextContent('↻ history (3)');
  });

  it('renders trigger with (0) when items is empty', () => {
    render(<Harness items={[]} />);
    expect(screen.getByTestId('user-prompt-history-trigger')).toHaveTextContent('↻ history (0)');
  });

  it('shows empty message when open and items list is empty', () => {
    render(
      <Harness initialOpen={true} items={[]} labels={buildLabels({ empty: 'Nothing here' })} />
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders one row per item when open', () => {
    render(<Harness initialOpen={true} items={buildItems()} />);
    expect(screen.getByText('Explain quantum computing in two paragraphs')).toBeInTheDocument();
    expect(screen.getByText('Translate "hello" to French')).toBeInTheDocument();
    expect(screen.getByText('Write a haiku about TypeScript')).toBeInTheDocument();
  });

  it('clicking a row fires onSelect with the prompt and closes the popover', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Harness
        initialOpen={true}
        items={buildItems()}
        onSelect={onSelect}
        onOpenChange={onOpenChange}
      />
    );
    await user.click(screen.getByText('Translate "hello" to French'));
    expect(onSelect).toHaveBeenCalledWith('Translate "hello" to French');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('propagates disabled to the trigger button', () => {
    render(<Harness disabled={true} />);
    expect(screen.getByTestId('user-prompt-history-trigger')).toBeDisabled();
  });

  it('applies aria-label from labels prop to the trigger', () => {
    render(<Harness labels={buildLabels({ ariaLabel: 'Custom aria label' })} />);
    expect(screen.getByRole('button', { name: 'Custom aria label' })).toBeInTheDocument();
  });
});
