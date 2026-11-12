import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  SystemPromptEntry,
  type SystemPromptEntryLabels,
  type SystemPromptEntryProps
} from '../SystemPromptEntry';

function buildLabels(overrides: Partial<SystemPromptEntryLabels> = {}): SystemPromptEntryLabels {
  return {
    remove: 'Remove',
    editedBy: 'edited · you',
    skillMeta: 'skill: ',
    ...overrides,
  };
}

function buildProps(overrides: Partial<SystemPromptEntryProps> = {}): SystemPromptEntryProps {
  return {
    id: 'entry-1',
    index: 1,
    kind: 'manual',
    onRemove: vi.fn(),
    onEntryClick: vi.fn(),
    labels: buildLabels(),
    ...overrides,
  };
}

describe('SystemPromptEntry', () => {
  it('renders editedBy meta text when kind is manual', () => {
    render(<SystemPromptEntry {...buildProps({ kind: 'manual' })} />);
    expect(screen.getByText('edited · you')).toBeInTheDocument();
  });

  it('renders skill meta with skillName when kind is skill', () => {
    render(<SystemPromptEntry {...buildProps({ kind: 'skill', skillName: 'JSON Format' })} />);
    expect(screen.getByText('skill: JSON Format')).toBeInTheDocument();
  });

  it('renders the numbered S{index} badge', () => {
    render(<SystemPromptEntry {...buildProps({ index: 3 })} />);
    expect(screen.getByText('S3')).toBeInTheDocument();
  });

  it('invokes onRemove with the index when the remove button is clicked', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<SystemPromptEntry {...buildProps({ index: 2, onRemove })} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it('forwards className to the root element', () => {
    const { container } = render(
      <SystemPromptEntry {...buildProps({ className: 'custom-entry' })} />
    );
    expect(container.firstChild).toHaveClass('custom-entry');
  });

  it('uses labels.remove as the remove button aria-label', () => {
    const labels = buildLabels({ remove: 'Delete entry' });
    render(<SystemPromptEntry {...buildProps({ labels })} />);
    expect(screen.getByRole('button', { name: 'Delete entry' })).toBeInTheDocument();
  });

  it('sets data-kind attribute to the kind value', () => {
    render(<SystemPromptEntry {...buildProps({ kind: 'skill', skillName: 'Foo' })} />);
    const root = screen.getByTestId('system-prompt-entry');
    expect(root).toHaveAttribute('data-kind', 'skill');
  });

  // FR-017: preview prop

  it('should render preview text when provided', () => {
    render(<SystemPromptEntry {...buildProps({ preview: 'Some prompt text' })} />);
    expect(screen.getByText('Some prompt text')).toBeInTheDocument();
  });

  it('should truncate preview text at ~120 chars with ellipsis', () => {
    const longText = 'A'.repeat(150);
    render(<SystemPromptEntry {...buildProps({ preview: longText })} />);
    const displayed = screen.getByTestId('system-prompt-entry-preview').textContent ?? '';
    expect(displayed.endsWith('…')).toBe(true);
    expect(displayed.length).toBeLessThanOrEqual(123);
  });

  it('should render empty when no preview is provided', () => {
    render(<SystemPromptEntry {...buildProps()} />);
    expect(screen.queryByTestId('system-prompt-entry-preview')).toBeNull();
  });

  // T012: onEntryClick behavior
  it('should fire onEntryClick with the entry id when the row is clicked', async () => {
    const onEntryClick = vi.fn();
    const user = userEvent.setup();
    render(<SystemPromptEntry {...buildProps({ id: 'entry-42', onEntryClick })} />);
    const row = screen.getByTestId('system-prompt-entry');
    await user.click(row);
    expect(onEntryClick).toHaveBeenCalledOnce();
    expect(onEntryClick).toHaveBeenCalledWith('entry-42');
  });

  it('should render entry row as a button element for keyboard accessibility', () => {
    render(<SystemPromptEntry {...buildProps({ id: 'entry-1' })} />);
    expect(screen.getByTestId('system-prompt-entry').tagName).toBe('BUTTON');
  });
});
