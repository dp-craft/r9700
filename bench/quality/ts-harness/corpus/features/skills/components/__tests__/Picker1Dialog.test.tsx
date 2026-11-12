import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommandItem } from '@/components/ui/command';

import type { Picker1DialogLabels, Picker1DialogProps } from '../Picker1Dialog';
import { Picker1Dialog } from '../Picker1Dialog';

// -- Builders --

const buildLabels = (overrides?: Partial<Picker1DialogLabels>): Picker1DialogLabels => ({
  title: 'Add prompt',
  searchPlaceholder: 'Search skills or history…',
  empty: 'No matches.',
  groupSkills: 'Skills',
  groupHistory: 'History',
  footerNavigate: 'navigate',
  footerSelect: 'select',
  footerEditNew: 'edit on new',
  footerNewBlank: 'New blank →',
  chips: {
    all: 'All',
    skills: 'Skills · 2',
    history: 'History · 1',
    pinned: 'Pinned · 0',
    blank: 'Blank',
  },
  item: {
    skillBadge: 'SKILL',
    historyBadge: 'HIST',
    togglePinAria: 'Toggle pin',
  },
  ...overrides,
});

const buildProps = (overrides?: Partial<Picker1DialogProps>): Picker1DialogProps => ({
  open: true,
  onOpenChange: vi.fn(),
  query: '',
  onQueryChange: vi.fn(),
  activeFilter: 'all',
  onFilterChange: vi.fn(),
  skillsSlot: (
    <CommandItem key="s1" data-testid="cmd-item-skill-1">
      Skill One
    </CommandItem>
  ),
  historySlot: (
    <CommandItem key="h1" data-testid="cmd-item-history-1">
      History One
    </CommandItem>
  ),
  onNewBlank: vi.fn(),
  hasResults: true,
  labels: buildLabels(),
  ...overrides,
});

// -- Tests --

describe('Picker1Dialog', () => {
  // -- Visibility --

  it('should not render dialog content when open=false', () => {
    render(<Picker1Dialog {...buildProps({ open: false })} />);
    expect(screen.queryByTestId('picker1-dialog')).not.toBeInTheDocument();
  });

  it('should render dialog content when open=true', () => {
    render(<Picker1Dialog {...buildProps()} />);
    expect(screen.getByTestId('picker1-dialog')).toBeInTheDocument();
  });

  // -- Structure / content --

  it('should render title, search input, filter chips, both groups, and footer', () => {
    render(<Picker1Dialog {...buildProps()} />);

    expect(screen.getByText('Add prompt')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search skills or history…')).toBeInTheDocument();
    expect(screen.getByTestId('picker1-filter-all')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByTestId('picker1-new-blank')).toHaveTextContent('New blank →');
  });

  it('should pass query value to the search input', () => {
    render(<Picker1Dialog {...buildProps({ query: 'foo' })} />);
    expect(screen.getByPlaceholderText('Search skills or history…')).toHaveValue('foo');
  });

  it('should reflect activeFilter on the chips', () => {
    render(<Picker1Dialog {...buildProps({ activeFilter: 'pinned' })} />);
    expect(screen.getByTestId('picker1-filter-pinned')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('picker1-filter-all')).toHaveAttribute('aria-pressed', 'false');
  });

  // -- Slots --

  it('should render skillsSlot and historySlot children', () => {
    render(<Picker1Dialog {...buildProps()} />);
    expect(screen.getByTestId('cmd-item-skill-1')).toHaveTextContent('Skill One');
    expect(screen.getByTestId('cmd-item-history-1')).toHaveTextContent('History One');
  });

  it('should show CommandEmpty text when hasResults=false', () => {
    render(<Picker1Dialog {...buildProps({ hasResults: false })} />);
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  // -- Interactions --

  it('should call onQueryChange when typing in search input', async () => {
    const onQueryChange = vi.fn();
    const user = userEvent.setup();
    render(<Picker1Dialog {...buildProps({ onQueryChange })} />);

    await user.type(screen.getByPlaceholderText('Search skills or history…'), 'x');

    expect(onQueryChange).toHaveBeenCalled();
    expect(onQueryChange).toHaveBeenLastCalledWith('x');
  });

  it('should call onFilterChange when a chip is clicked', async () => {
    const onFilterChange = vi.fn();
    const user = userEvent.setup();
    render(<Picker1Dialog {...buildProps({ onFilterChange })} />);

    await user.click(screen.getByTestId('picker1-filter-skills'));

    expect(onFilterChange).toHaveBeenCalledWith('skills');
  });

  it('should call onNewBlank when the New blank button is clicked', async () => {
    const onNewBlank = vi.fn();
    const user = userEvent.setup();
    render(<Picker1Dialog {...buildProps({ onNewBlank })} />);

    await user.click(screen.getByTestId('picker1-new-blank'));

    expect(onNewBlank).toHaveBeenCalledTimes(1);
  });

  it('should call onOpenChange(false) when Escape is pressed', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Picker1Dialog {...buildProps({ onOpenChange })} />);

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // -- Testid --

  it('should expose data-testid="picker1-dialog" on the content', () => {
    render(<Picker1Dialog {...buildProps()} />);
    expect(screen.getByTestId('picker1-dialog')).toBeInTheDocument();
  });
});
