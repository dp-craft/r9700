import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BulkActionToolbar, type BulkActionToolbarProps } from '@/components/ui/BulkActionToolbar';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildProps(overrides: Partial<BulkActionToolbarProps> = {}): BulkActionToolbarProps {
  return {
    searchValue: '',
    onSearchChange: vi.fn(),
    selectedCount: 0,
    onBulkDelete: vi.fn(),
    onBulkExport: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BulkActionToolbar', () => {
  // =========================================================================
  // Locked case 1 — search input reflects searchValue + fires onSearchChange
  // =========================================================================

  it('should reflect searchValue in the search input and call onSearchChange when typed into', async () => {
    // Given: a controlled search value and a spy
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    render(<BulkActionToolbar {...buildProps({ searchValue: 'hello', onSearchChange })} />);

    // When: examine input value
    const input = screen.getByRole('searchbox');

    // Then: value reflects prop
    expect((input as HTMLInputElement).value).toBe('hello');

    // When: user types more
    await user.type(input, '!');

    // Then: onSearchChange called with the incremental value
    expect(onSearchChange).toHaveBeenCalled();
  });

  // =========================================================================
  // Locked case 2 — selectedCount=0 → bulk Delete/Export disabled; >0 → enabled (FR-056)
  // =========================================================================

  it('should disable bulk Delete and Export buttons when selectedCount is 0', () => {
    // Given: no rows selected
    render(<BulkActionToolbar {...buildProps({ selectedCount: 0 })} />);

    // Then: both bulk action buttons are disabled
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('should enable bulk Delete and Export buttons when selectedCount is greater than 0', () => {
    // Given: one or more rows selected
    render(<BulkActionToolbar {...buildProps({ selectedCount: 3 })} />);

    // Then: both bulk action buttons are enabled
    expect(screen.getByRole('button', { name: /delete/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /export/i })).toBeEnabled();
  });

  // =========================================================================
  // Locked case 3 — renders filterSlots when provided
  // =========================================================================

  it('should render filterSlots content when provided', () => {
    // Given: filter slot nodes (e.g. prompt-history type/source filters)
    const filterSlots = (
      <>
        <button type="button">Type filter</button>
        <button type="button">Source filter</button>
      </>
    );
    render(<BulkActionToolbar {...buildProps({ filterSlots })} />);

    // Then: both filter slot elements are present in the document
    expect(screen.getByRole('button', { name: 'Type filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Source filter' })).toBeInTheDocument();
  });

  it('should not render filter slot area when filterSlots is not provided', () => {
    // Given: no filterSlots prop
    render(<BulkActionToolbar {...buildProps({ filterSlots: undefined })} />);

    // Then: only the delete and export buttons are rendered (no extra filter buttons)
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  // =========================================================================
  // Edge case — empty string searchValue renders empty input
  // =========================================================================

  it('should render an empty input when searchValue is an empty string', () => {
    // Given: searchValue is explicitly empty string
    render(<BulkActionToolbar {...buildProps({ searchValue: '' })} />);

    // Then: the search input exists and has an empty value
    const input = screen.getByRole('searchbox');
    expect((input as HTMLInputElement).value).toBe('');
  });

  // =========================================================================
  // Edge case — onSearchChange fires on each keystroke
  // =========================================================================

  it('should call onSearchChange once per keystroke when typing multiple characters', async () => {
    // Given: a spy and an empty input
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    render(<BulkActionToolbar {...buildProps({ searchValue: '', onSearchChange })} />);

    // When: the user types three characters
    await user.type(screen.getByRole('searchbox'), 'abc');

    // Then: onSearchChange was called exactly three times (once per keystroke)
    expect(onSearchChange).toHaveBeenCalledTimes(3);
  });

  // =========================================================================
  // Edge case — filterSlots=undefined renders no filter area
  // =========================================================================

  it('should render no filter area elements when filterSlots is undefined', () => {
    // Given: filterSlots explicitly undefined
    const { container } = render(<BulkActionToolbar {...buildProps({ filterSlots: undefined })} />);

    // Then: no element with a filter-area role or data-testid exists
    const filterArea = container.querySelector('[data-testid="filter-slots"]');
    expect(filterArea).toBeNull();
  });
});
