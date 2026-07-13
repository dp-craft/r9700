import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Section, type SectionProps } from '../Section';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildProps(overrides: Partial<SectionProps> = {}): SectionProps {
  return {
    title: 'Models',
    collapsed: false,
    bodyId: 'section-body',
    onToggleCollapse: vi.fn(),
    children: <p>Section content</p>,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Section', () => {
  // =========================================================================
  // Locked case 1 — title pill on border + collapse caret + accent counter
  // =========================================================================

  it('should render title pill on top border with collapse caret and accent counter when count > 0', () => {
    // Given: title, a positive count, and expanded state
    const props = buildProps({ title: 'Models', count: 3 });

    // When: rendered
    render(<Section {...props} />);

    // Then: title text visible, counter badge with value "3" visible, toggle button present
    expect(screen.getByText('Models')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  // =========================================================================
  // Locked case 2 — counter omitted when count undefined or 0
  // =========================================================================

  it('should omit counter when count is undefined', () => {
    // Given: no count prop
    const props = buildProps({ count: undefined });

    // When: rendered
    render(<Section {...props} />);

    // Then: no numeric-only badge rendered
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('should omit counter when count is 0', () => {
    // Given: count explicitly 0
    const props = buildProps({ count: 0 });

    // When: rendered
    render(<Section {...props} />);

    // Then: "0" not rendered as a counter
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  // =========================================================================
  // Locked case 3 — action node renders on top-right border; absent when omitted
  // =========================================================================

  it('should render action node on top-right border when action prop is provided', () => {
    // Given: an action node passed as prop
    const props = buildProps({
      action: <button type="button">+ MODELL</button>,
    });

    // When: rendered
    render(<Section {...props} />);

    // Then: the action button is present in the document
    expect(screen.getByRole('button', { name: '+ MODELL' })).toBeInTheDocument();
  });

  it('should not render an action container when action prop is absent', () => {
    // Given: no action provided
    const props = buildProps({ action: undefined });

    // When: rendered
    render(<Section {...props} />);

    // Then: only the collapse toggle button exists; no extra buttons
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // =========================================================================
  // Locked case 4 — collapsed=true hides body; title/border/counter/action remain
  // =========================================================================

  it('should hide body when collapsed is true while keeping title, counter, and action visible', () => {
    // Given: collapsed state with count and action
    const props = buildProps({
      collapsed: true,
      bodyId: 'my-body',
      count: 2,
      action: <button type="button">+ PROMPT</button>,
    });

    // When: rendered
    const { container } = render(<Section {...props} />);

    // Then: body element carries hidden attribute
    const body = container.querySelector('#my-body');
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute('hidden');

    // And: title, counter, action are still visible
    expect(screen.getByText('Models')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ PROMPT' })).toBeInTheDocument();
  });

  // =========================================================================
  // Locked case 5 — caret click calls onToggleCollapse
  // =========================================================================

  it('should call onToggleCollapse when caret button is clicked', async () => {
    // Given: a spy on the toggle handler
    const onToggleCollapse = vi.fn();
    const props = buildProps({ onToggleCollapse });
    const user = userEvent.setup();

    // When: user clicks the toggle caret
    render(<Section {...props} />);
    await user.click(screen.getByRole('button', { name: /collapse|expand|toggle/i }));

    // Then: the callback fires exactly once
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // Locked case 6 — theme tokens only; no hard-coded hex colors
  // =========================================================================

  it('should use Tailwind theme tokens and not render inline hex color styles in default mood', () => {
    // Given: default mood (no mood prop)
    const { container } = render(<Section {...buildProps()} />);

    // When: examine all elements with style attributes
    const allElements = container.querySelectorAll('[style]');
    const hexPattern = /#[0-9a-fA-F]{3,6}\b|rgb\(|rgba\(/;

    // Then: no inline hex or rgb color values present on any element
    for (const el of allElements) {
      expect(el.getAttribute('style'), `Inline hex color found on <${el.tagName}>`).not.toMatch(
        hexPattern
      );
    }
  });

  it('should use Tailwind theme tokens and not render inline hex color styles in accent mood', () => {
    // Given: accent mood
    const { container } = render(<Section {...buildProps({ mood: 'accent' })} />);

    // When: examine all elements with style attributes
    const allElements = container.querySelectorAll('[style]');
    const hexPattern = /#[0-9a-fA-F]{3,6}\b|rgb\(|rgba\(/;

    // Then: no inline hex or rgb color values present
    for (const el of allElements) {
      expect(el.getAttribute('style'), `Inline hex color found on <${el.tagName}>`).not.toMatch(
        hexPattern
      );
    }
  });
});
