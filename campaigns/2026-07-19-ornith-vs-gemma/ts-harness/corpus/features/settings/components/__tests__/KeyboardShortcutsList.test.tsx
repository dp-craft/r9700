import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { KeyboardShortcutsListProps, ShortcutRow } from '../KeyboardShortcutsList';
import { KeyboardShortcutsList } from '../KeyboardShortcutsList';

// -- Builders --

const buildRows = (): readonly ShortcutRow[] => [
  { keys: 'Ctrl+,', description: 'Open settings' },
  { keys: '↵', description: 'Send message' },
  { keys: '⇧↵', description: 'New line' },
];

const buildProps = (
  overrides?: Partial<KeyboardShortcutsListProps>
): KeyboardShortcutsListProps => ({
  heading: 'Keyboard shortcuts',
  rows: buildRows(),
  ...overrides,
});

// -- Tests --

describe('KeyboardShortcutsList', () => {
  it('should render the heading', () => {
    render(<KeyboardShortcutsList {...buildProps()} />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Keyboard shortcuts' })
    ).toBeInTheDocument();
  });

  it('should render all rows with their keys inside <kbd> and descriptions', () => {
    const { container } = render(<KeyboardShortcutsList {...buildProps()} />);

    const kbdElements = container.querySelectorAll('kbd');
    expect(kbdElements).toHaveLength(3);
    expect(kbdElements[0]?.textContent).toBe('Ctrl+,');
    expect(kbdElements[1]?.textContent).toBe('↵');
    expect(kbdElements[2]?.textContent).toBe('⇧↵');

    expect(screen.getByText('Open settings')).toBeInTheDocument();
    expect(screen.getByText('Send message')).toBeInTheDocument();
    expect(screen.getByText('New line')).toBeInTheDocument();
  });

  it('should omit the hint paragraph when hint is undefined', () => {
    const { container } = render(<KeyboardShortcutsList {...buildProps()} />);

    expect(container.querySelector('p')).toBeNull();
  });

  it('should render the hint paragraph when hint is provided', () => {
    render(<KeyboardShortcutsList {...buildProps({ hint: 'Shortcuts work app-wide.' })} />);

    expect(screen.getByText('Shortcuts work app-wide.')).toBeInTheDocument();
  });

  it('should be a read-only display with no interactive elements', () => {
    const { container } = render(<KeyboardShortcutsList {...buildProps()} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});
