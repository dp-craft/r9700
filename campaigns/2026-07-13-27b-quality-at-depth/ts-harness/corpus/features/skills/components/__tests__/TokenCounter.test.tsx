import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TokenCounterProps } from '../TokenCounter';
import { TokenCounter } from '../TokenCounter';

// -- Builders --

const buildProps = (overrides?: Partial<TokenCounterProps>): TokenCounterProps => ({
  tokenCount: 1250,
  exceedsSoftLimit: false,
  exceedsHardLimit: false,
  ...overrides,
});

// -- Tests --

describe('TokenCounter', () => {
  // -- Smoke tests --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<TokenCounter {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should display the token count when provided', () => {
    render(<TokenCounter {...buildProps({ tokenCount: 1250 })} />);

    expect(screen.getByText(/1,?250/)).toBeInTheDocument();
  });

  it('should display the token count with "tokens" label', () => {
    render(<TokenCounter {...buildProps({ tokenCount: 500 })} />);

    expect(screen.getByText(/token/i)).toBeInTheDocument();
  });

  it('should apply custom className when provided', () => {
    const { container } = render(<TokenCounter {...buildProps({ className: 'custom-counter' })} />);

    expect(container.querySelector('.custom-counter')).toBeInTheDocument();
  });

  // -- Conditional rendering: soft limit warning --

  it('should indicate a warning when exceedsSoftLimit is true', () => {
    const { container } = render(
      <TokenCounter {...buildProps({ exceedsSoftLimit: true, exceedsHardLimit: false })} />
    );

    const hasWarningIndicator =
      container.querySelector('[class*="yellow"]') ??
      container.querySelector('[class*="amber"]') ??
      container.querySelector('[class*="warning"]') ??
      container.querySelector('[data-warning]');

    expect(hasWarningIndicator).toBeTruthy();
  });

  it('should not indicate a warning when exceedsSoftLimit is false', () => {
    const { container } = render(
      <TokenCounter {...buildProps({ exceedsSoftLimit: false, exceedsHardLimit: false })} />
    );

    const hasWarningIndicator =
      container.querySelector('[class*="yellow"]') ??
      container.querySelector('[class*="amber"]') ??
      container.querySelector('[class*="warning"]') ??
      container.querySelector('[data-warning]');

    expect(hasWarningIndicator).toBeNull();
  });

  // -- Conditional rendering: hard limit error --

  it('should indicate an error when exceedsHardLimit is true', () => {
    const { container } = render(<TokenCounter {...buildProps({ exceedsHardLimit: true })} />);

    const hasErrorIndicator =
      container.querySelector('[class*="red"]') ??
      container.querySelector('[class*="destructive"]') ??
      container.querySelector('[class*="error"]') ??
      container.querySelector('[data-error]');

    expect(hasErrorIndicator).toBeTruthy();
  });

  it('should not indicate an error when exceedsHardLimit is false', () => {
    const { container } = render(
      <TokenCounter {...buildProps({ exceedsHardLimit: false, exceedsSoftLimit: false })} />
    );

    const hasErrorAttribute = container.querySelector('[data-error]');
    const hasDestructiveVariant = container.querySelector('[data-variant="destructive"]');

    expect(hasErrorAttribute).toBeNull();
    expect(hasDestructiveVariant).toBeNull();
  });

  // -- Edge cases --

  it('should display zero token count', () => {
    render(<TokenCounter {...buildProps({ tokenCount: 0 })} />);

    expect(screen.getByText(/0/)).toBeInTheDocument();
  });

  it('should display a large token count', () => {
    render(<TokenCounter {...buildProps({ tokenCount: 128000 })} />);

    expect(screen.getByText(/128,?000/)).toBeInTheDocument();
  });

  it('should render without className when it is not provided', () => {
    const { container } = render(<TokenCounter {...buildProps({ className: undefined })} />);

    expect(container).toBeTruthy();
  });

  it('should prioritize hard limit styling over soft limit when both are true', () => {
    const { container } = render(
      <TokenCounter {...buildProps({ exceedsSoftLimit: true, exceedsHardLimit: true })} />
    );

    const hasErrorIndicator =
      container.querySelector('[class*="red"]') ??
      container.querySelector('[class*="destructive"]') ??
      container.querySelector('[class*="error"]') ??
      container.querySelector('[data-error]');

    expect(hasErrorIndicator).toBeTruthy();
  });

  // -- Snapshot --

  it('should match inline snapshot with default props', () => {
    const { asFragment } = render(<TokenCounter {...buildProps({ tokenCount: 750 })} />);

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <span
          aria-label="~750 tokens"
          data-slot="badge"
          data-variant="secondary"
        >
          ~750 tokens
        </span>
      </DocumentFragment>
    `);
  });
});
