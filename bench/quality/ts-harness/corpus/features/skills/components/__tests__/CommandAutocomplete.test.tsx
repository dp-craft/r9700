import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandSuggestion } from '@/lib/command-parser';

import { CommandAutocomplete, type CommandAutocompleteProps } from '../CommandAutocomplete';

// -- Builders --

const buildSuggestion = (overrides?: Partial<CommandSuggestion>): CommandSuggestion => ({
  prefix: 'translate',
  skillName: 'Translate Text',
  skillId: 'skill-1',
  group: 'skill',
  ...overrides,
});

const buildProps = (overrides?: Partial<CommandAutocompleteProps>): CommandAutocompleteProps => ({
  suggestions: [buildSuggestion()],
  onSelect: vi.fn(),
  focusedIndex: 0,
  onKeyDown: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CommandAutocomplete', () => {
  // -- Smoke tests --

  it('should render without crashing when suggestions is empty', () => {
    const { container } = render(<CommandAutocomplete {...buildProps({ suggestions: [] })} />);

    expect(container).toBeTruthy();
  });

  // -- Empty suggestions --

  it('should render no list items when suggestions is empty', () => {
    render(<CommandAutocomplete {...buildProps({ suggestions: [] })} />);

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  // -- Items rendered --

  it('should render one item per suggestion', () => {
    const suggestions = [
      buildSuggestion({ prefix: 'translate', skillId: 'skill-1' }),
      buildSuggestion({ prefix: 'summarize', skillId: 'skill-2' }),
      buildSuggestion({ prefix: 'rewrite', skillId: 'skill-3' }),
    ];
    render(<CommandAutocomplete {...buildProps({ suggestions })} />);

    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  // -- Item prefix shown --

  it('should display the prefix with a leading slash for each suggestion', () => {
    const suggestions = [
      buildSuggestion({ prefix: 'translate', skillId: 'skill-1' }),
      buildSuggestion({ prefix: 'summarize', skillId: 'skill-2' }),
    ];
    render(<CommandAutocomplete {...buildProps({ suggestions })} />);

    expect(screen.getByText('/translate')).toBeInTheDocument();
    expect(screen.getByText('/summarize')).toBeInTheDocument();
  });

  // -- Item skill name shown --

  it('should display the skill name for each suggestion', () => {
    const suggestions = [
      buildSuggestion({ prefix: 'translate', skillName: 'Translate Text', skillId: 'skill-1' }),
      buildSuggestion({ prefix: 'summarize', skillName: 'Summarize Content', skillId: 'skill-2' }),
    ];
    render(<CommandAutocomplete {...buildProps({ suggestions })} />);

    expect(screen.getByText('Translate Text')).toBeInTheDocument();
    expect(screen.getByText('Summarize Content')).toBeInTheDocument();
  });

  // -- Click calls onSelect --

  it('should call onSelect when an item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CommandAutocomplete {...buildProps({ onSelect })} />);

    await user.click(screen.getByRole('option'));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  // -- Click correct prefix --

  it('should call onSelect with the correct prefix when one of multiple items is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const suggestions = [
      buildSuggestion({ prefix: 'translate', skillName: 'Translate Text', skillId: 'skill-1' }),
      buildSuggestion({ prefix: 'summarize', skillName: 'Summarize Content', skillId: 'skill-2' }),
    ];
    render(<CommandAutocomplete {...buildProps({ suggestions, onSelect })} />);

    await user.click(screen.getByText('Summarize Content'));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('summarize');
  });

  // -- Not called on render --

  it('should not call onSelect on initial render', () => {
    const onSelect = vi.fn();
    render(<CommandAutocomplete {...buildProps({ onSelect })} />);

    expect(onSelect).not.toHaveBeenCalled();
  });

  // -- Single suggestion edge case --

  it('should render correctly when there is exactly one suggestion', () => {
    const suggestions = [buildSuggestion()];
    render(<CommandAutocomplete {...buildProps({ suggestions })} />);

    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  // -- Many suggestions edge case --

  it('should render all items when there are five suggestions', () => {
    const suggestions = [
      buildSuggestion({ prefix: 'a', skillId: 'skill-1' }),
      buildSuggestion({ prefix: 'b', skillId: 'skill-2' }),
      buildSuggestion({ prefix: 'c', skillId: 'skill-3' }),
      buildSuggestion({ prefix: 'd', skillId: 'skill-4' }),
      buildSuggestion({ prefix: 'e', skillId: 'skill-5' }),
    ];
    render(<CommandAutocomplete {...buildProps({ suggestions })} />);

    expect(screen.getAllByRole('option')).toHaveLength(5);
  });

  // -- Custom className --

  it('should apply custom className to the root element', () => {
    const { container } = render(
      <CommandAutocomplete {...buildProps({ className: 'custom-autocomplete' })} />
    );

    expect(container.querySelector('.custom-autocomplete')).toBeInTheDocument();
  });

  // -- aria-selected reflects focusedIndex prop --

  it('should mark the item at focusedIndex as aria-selected', () => {
    const suggestions = [
      buildSuggestion({ prefix: 'translate', skillId: 'skill-1' }),
      buildSuggestion({ prefix: 'summarize', skillId: 'skill-2' }),
    ];
    render(<CommandAutocomplete {...buildProps({ suggestions, focusedIndex: 1 })} />);

    const items = screen.getAllByRole('option');
    expect(items[0]).toHaveAttribute('aria-selected', 'false');
    expect(items[1]).toHaveAttribute('aria-selected', 'true');
  });

  // -- onKeyDown forwarded --

  it('should forward keydown events to the onKeyDown prop', async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(<CommandAutocomplete {...buildProps({ onKeyDown })} />);

    const listbox = screen.getByRole('listbox');
    listbox.focus();
    await user.keyboard('{ArrowDown}');

    expect(onKeyDown).toHaveBeenCalled();
    expect(onKeyDown.mock.calls[0]?.[0]?.key).toBe('ArrowDown');
  });

  // -- Prefix with slash --

  it('should display "/" before the prefix text', () => {
    const suggestions = [buildSuggestion({ prefix: 'translate' })];
    render(<CommandAutocomplete {...buildProps({ suggestions })} />);

    expect(screen.getByText('/translate')).toBeInTheDocument();
    expect(screen.queryByText('translate', { exact: true })).not.toBeInTheDocument();
  });

  // -- Special chars in skill name --

  it('should render skill names with special characters correctly', () => {
    const suggestions = [
      buildSuggestion({ skillName: 'Tools & Helpers (v2) <beta>', skillId: 'skill-1' }),
    ];
    render(<CommandAutocomplete {...buildProps({ suggestions })} />);

    expect(screen.getByText('Tools & Helpers (v2) <beta>')).toBeInTheDocument();
  });

  // -- onSelect receives prefix without slash --

  it('should call onSelect with the raw prefix (no leading slash) when an item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const suggestions = [buildSuggestion({ prefix: 'translate' })];
    render(<CommandAutocomplete {...buildProps({ suggestions, onSelect })} />);

    await user.click(screen.getByRole('option'));

    expect(onSelect).toHaveBeenCalledWith('translate');
  });

  // -- Snapshot --

  it('should match inline snapshot with a single suggestion', () => {
    const { asFragment } = render(
      <CommandAutocomplete
        suggestions={[
          buildSuggestion({ prefix: 'translate', skillName: 'Translate Text', skillId: 'skill-1' }),
        ]}
        onSelect={vi.fn()}
        focusedIndex={0}
        onKeyDown={vi.fn()}
      />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <div
          role="listbox"
          tabindex="-1"
        >
          <div
            role="presentation"
          />
          <div
            aria-selected="true"
            role="option"
            tabindex="0"
          >
            <code>
              /translate
            </code>
            <span>
              Translate Text
            </span>
          </div>
        </div>
      </DocumentFragment>
    `);
  });
});
