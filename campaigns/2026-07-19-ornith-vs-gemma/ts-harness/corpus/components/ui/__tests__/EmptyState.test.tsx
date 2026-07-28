import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyState, type EmptyStateProps } from '@/components/ui/EmptyState';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildProps(overrides: Partial<EmptyStateProps> = {}): EmptyStateProps {
  return {
    icon: <span data-testid="empty-icon">icon</span>,
    headline: 'No runs yet',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EmptyState', () => {
  // =========================================================================
  // Locked case 1 — renders icon + headline; hint + cta optional
  // =========================================================================

  it('should render icon and headline when only required props are provided', () => {
    // Given: only required props
    render(<EmptyState {...buildProps()} />);

    // Then: icon and headline are visible
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
  });

  it('should render hint when hint prop is provided', () => {
    // Given: optional hint
    render(<EmptyState {...buildProps({ hint: 'Close a Lab tab to archive a run here.' })} />);

    // Then: hint text is visible
    expect(screen.getByText('Close a Lab tab to archive a run here.')).toBeInTheDocument();
  });

  it('should not render hint text when hint prop is omitted', () => {
    // Given: no hint prop
    render(<EmptyState {...buildProps({ hint: undefined })} />);

    // Then: no supplementary hint content rendered
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
  });

  it('should render cta content when cta prop is provided', () => {
    // Given: optional cta node
    render(<EmptyState {...buildProps({ cta: <button type="button">Open Lab</button> })} />);

    // Then: the cta button is visible
    expect(screen.getByRole('button', { name: 'Open Lab' })).toBeInTheDocument();
  });

  it('should not render a cta when cta prop is omitted', () => {
    // Given: no cta prop
    render(<EmptyState {...buildProps({ cta: undefined })} />);

    // Then: no button present
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // =========================================================================
  // Locked case 2 — theme-token surfaces only (no hardcoded colors)
  // =========================================================================

  it('should use Tailwind theme tokens and not apply inline hex or rgb color styles', () => {
    // Given: fully populated props
    const { container } = render(
      <EmptyState
        {...buildProps({
          hint: 'Archive runs to see them here.',
          cta: <button type="button">Start</button>,
        })}
      />
    );

    // When: examine all elements that carry a style attribute
    const styledElements = container.querySelectorAll('[style]');
    const hardcodedColorPattern = /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(/;

    // Then: no inline hex or rgb color values present on any element
    for (const el of styledElements) {
      expect(el.getAttribute('style'), `Inline hex/rgb color found on <${el.tagName}>`).not.toMatch(
        hardcodedColorPattern
      );
    }
  });

  // =========================================================================
  // Edge case — long headline text doesn't break layout (renders without error)
  // =========================================================================

  it('should render without error when headline is a very long string', () => {
    // Given: a headline that exceeds typical display width
    const longHeadline = 'A'.repeat(300);
    render(<EmptyState {...buildProps({ headline: longHeadline })} />);

    // Then: the long headline text is present in the document
    expect(screen.getByText(longHeadline)).toBeInTheDocument();
  });

  // =========================================================================
  // Edge case — cta receives focus when provided as a Button
  // =========================================================================

  it('should allow the cta button to receive focus when tabbed to', async () => {
    // Given: a cta that is a focusable button
    const { user } = { user: (await import('@testing-library/user-event')).default.setup() };
    render(<EmptyState {...buildProps({ cta: <button type="button">Open Lab</button> })} />);

    // When: the user tabs to the cta
    await user.tab();

    // Then: the cta button has focus
    expect(screen.getByRole('button', { name: 'Open Lab' })).toHaveFocus();
  });
});
