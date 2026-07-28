import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PromptHistoryList,
  type PromptHistoryListProps,
  type PromptHistoryRowVM
} from '../PromptHistoryList';

// -- Builders --

const buildRow = (overrides?: Partial<PromptHistoryRowVM>): PromptHistoryRowVM => ({
  id: 'r1',
  text: 'Test prompt text',
  type: 'USER',
  source: 'CHAT',
  useCount: 3,
  selected: false,
  ...overrides,
});

const buildProps = (overrides?: Partial<PromptHistoryListProps>): PromptHistoryListProps => ({
  rows: [buildRow()],
  onToggleSelect: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PromptHistoryList', () => {
  it('should render one row per entry with text preview, type, and source', () => {
    const rows = [
      buildRow({ id: 'r1', text: 'First prompt', type: 'USER', source: 'CHAT' }),
      buildRow({ id: 'r2', text: 'Second prompt', type: 'SYSTEM', source: 'LAB' }),
    ];

    render(<PromptHistoryList {...buildProps({ rows })} />);

    expect(screen.getByText('First prompt')).toBeDefined();
    expect(screen.getByText('Second prompt')).toBeDefined();
    expect(screen.getByText('USER')).toBeDefined();
    expect(screen.getByText('SYSTEM')).toBeDefined();
    expect(screen.getByText('CHAT')).toBeDefined();
    expect(screen.getByText('LAB')).toBeDefined();
  });

  it('should call onToggleSelect with the row id when a row is clicked', async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    const rows = [buildRow({ id: 'row-abc', text: 'Clickable prompt' })];

    render(<PromptHistoryList {...buildProps({ rows, onToggleSelect })} />);

    await user.click(screen.getByText('Clickable prompt'));

    expect(onToggleSelect).toHaveBeenCalledOnce();
    expect(onToggleSelect).toHaveBeenCalledWith('row-abc');
  });

  it('should show selected state for a row with selected=true', () => {
    const rows = [
      buildRow({ id: 'r-selected', text: 'Selected prompt', selected: true }),
      buildRow({ id: 'r-unselected', text: 'Unselected prompt', selected: false }),
    ];

    render(<PromptHistoryList {...buildProps({ rows })} />);

    const selectedCheckbox = screen.getByRole('checkbox', { checked: true });
    expect(selectedCheckbox).toBeDefined();

    const allCheckboxes = screen.getAllByRole('checkbox');
    expect(allCheckboxes).toHaveLength(2);
  });

  it('should render no list items when rows array is empty', () => {
    const { container } = render(<PromptHistoryList {...buildProps({ rows: [] })} />);

    const listItems = container.querySelectorAll('li');
    expect(listItems).toHaveLength(0);
  });
});
