import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettingsNavProps } from '../SettingsNav';
import { SettingsNav } from '../SettingsNav';

// -- Builders --

const items = [
  { id: 'general', labelKey: 'General' },
  { id: 'api-models', labelKey: 'API & Models' },
  { id: 'appearance', labelKey: 'Appearance' },
  { id: 'defaults', labelKey: 'Defaults' },
];

const buildProps = (overrides?: Partial<SettingsNavProps>): SettingsNavProps => ({
  groups: [{ items }],
  activeId: 'general',
  onSelect: vi.fn(),
  ariaLabel: 'Settings navigation',
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SettingsNav', () => {
  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<SettingsNav {...buildProps()} />);
    expect(container).toBeTruthy();
  });

  it('should render nav with provided aria-label', () => {
    render(<SettingsNav {...buildProps({ ariaLabel: 'Beállítások navigáció' })} />);

    expect(screen.getByRole('navigation', { name: 'Beállítások navigáció' })).toBeInTheDocument();
  });

  it('should render all items as buttons', () => {
    render(<SettingsNav {...buildProps()} />);

    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('should call onSelect with item id when an item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SettingsNav {...buildProps({ onSelect })} />);

    await user.click(screen.getByRole('button', { name: /api & models/i }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('api-models');
  });

  it('should not call onSelect on initial render', () => {
    const onSelect = vi.fn();
    render(<SettingsNav {...buildProps({ onSelect })} />);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('should mark the active item with bg-accent class and aria-current', () => {
    render(<SettingsNav {...buildProps({ activeId: 'appearance' })} />);

    const activeButton = screen.getByRole('button', { name: /appearance/i });
    expect(activeButton.className).toContain('bg-accent');
    expect(activeButton.className).toContain('font-semibold');
    expect(activeButton).toHaveAttribute('aria-current', 'page');
  });

  it('should not mark inactive items with bg-accent class', () => {
    render(<SettingsNav {...buildProps({ activeId: 'general' })} />);

    const inactiveButton = screen.getByRole('button', { name: /appearance/i });
    expect(inactiveButton.className).not.toMatch(/(^|\s)bg-accent(\s|$)/);
    expect(inactiveButton).not.toHaveAttribute('aria-current');
  });

  it('should render the nav with fixed 180px width class for desktop viewports', () => {
    render(<SettingsNav {...buildProps()} />);

    const nav = screen.getByRole('navigation');
    expect(nav.className).toContain('sm:w-[180px]');
  });
});
