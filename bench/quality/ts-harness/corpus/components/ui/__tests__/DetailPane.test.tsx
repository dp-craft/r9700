import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DetailPane, type DetailPaneProps } from '@/components/ui/DetailPane';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildProps(overrides: Partial<DetailPaneProps> = {}): DetailPaneProps {
  return {
    headerSlot: <div data-testid="pane-header">Header content</div>,
    bodySlot: <div data-testid="pane-body">Body content</div>,
    footerActions: <div data-testid="pane-footer">Footer actions</div>,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DetailPane', () => {
  // =========================================================================
  // Locked case 1 — renders header/body/footer regions in order
  // =========================================================================

  it('should render header, body, and footer regions all present in the document', () => {
    // Given: all three slot props provided
    render(<DetailPane {...buildProps()} />);

    // Then: all three regions are rendered
    expect(screen.getByTestId('pane-header')).toBeInTheDocument();
    expect(screen.getByTestId('pane-body')).toBeInTheDocument();
    expect(screen.getByTestId('pane-footer')).toBeInTheDocument();
  });

  it('should render header before body before footer in document order', () => {
    // Given: all three slot props provided
    const { container } = render(<DetailPane {...buildProps()} />);

    // When: collect testid elements in DOM order
    const ordered = Array.from(
      container.querySelectorAll(
        '[data-testid="pane-header"], [data-testid="pane-body"], [data-testid="pane-footer"]'
      )
    ).map(el => el.getAttribute('data-testid'));

    // Then: document order is header → body → footer
    expect(ordered).toEqual(['pane-header', 'pane-body', 'pane-footer']);
  });

  // =========================================================================
  // Locked case 2 — body region is scrollable (scroll-area)
  // =========================================================================

  it('should wrap the body slot in a scrollable region', () => {
    // Given: body slot with content
    render(
      <DetailPane
        {...buildProps({
          bodySlot: <p data-testid="pane-body">Long body content</p>,
        })}
      />
    );

    const bodyContent = screen.getByTestId('pane-body');

    // Then: body content is contained within a scroll-area ancestor
    // The shadcn ScrollArea renders a [data-radix-scroll-area-viewport] or
    // a container with overflow-y-auto / overflow-auto styling.
    const scrollableAncestor = bodyContent.closest(
      '[data-radix-scroll-area-viewport], [data-slot="scroll-area-viewport"]'
    );
    expect(
      scrollableAncestor,
      'Expected body slot to be wrapped in a Radix ScrollArea viewport'
    ).not.toBeNull();
  });

  // =========================================================================
  // Edge case — empty bodySlot still renders scrollable region
  // =========================================================================

  it('should still render the scrollable region when bodySlot is an empty fragment', () => {
    // Given: bodySlot is an empty fragment (no visible content)
    const { container } = render(<DetailPane {...buildProps({ bodySlot: <></> })} />);

    // Then: a scroll-area viewport element is still present in the DOM
    const scrollViewport = container.querySelector(
      '[data-radix-scroll-area-viewport], [data-slot="scroll-area-viewport"]'
    );
    expect(
      scrollViewport,
      'Expected scrollable region to be rendered even with an empty bodySlot'
    ).not.toBeNull();
  });

  // =========================================================================
  // Edge case — all three slots accept complex ReactNode children
  // =========================================================================

  it('should render complex ReactNode trees in all three slots without error', () => {
    // Given: each slot receives a nested multi-element tree
    render(
      <DetailPane
        headerSlot={(
          <nav>
            <span data-testid="header-child-a">Title</span>
            <button type="button" data-testid="header-child-b">
              Close
            </button>
          </nav>
        )}
        bodySlot={(
          <ul>
            <li data-testid="body-child-a">Item 1</li>
            <li data-testid="body-child-b">Item 2</li>
          </ul>
        )}
        footerActions={(
          <div>
            <button type="button" data-testid="footer-child-a">
              Export
            </button>
            <button type="button" data-testid="footer-child-b">
              Delete
            </button>
          </div>
        )}
      />
    );

    // Then: all nested children across all three slots are present
    expect(screen.getByTestId('header-child-a')).toBeInTheDocument();
    expect(screen.getByTestId('header-child-b')).toBeInTheDocument();
    expect(screen.getByTestId('body-child-a')).toBeInTheDocument();
    expect(screen.getByTestId('body-child-b')).toBeInTheDocument();
    expect(screen.getByTestId('footer-child-a')).toBeInTheDocument();
    expect(screen.getByTestId('footer-child-b')).toBeInTheDocument();
  });
});
