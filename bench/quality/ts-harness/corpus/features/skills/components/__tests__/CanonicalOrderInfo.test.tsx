import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CanonicalOrderInfoProps } from '../CanonicalOrderInfo';
import { CanonicalOrderInfo } from '../CanonicalOrderInfo';

// -- Builders --

const buildProps = (overrides?: Partial<CanonicalOrderInfoProps>): CanonicalOrderInfoProps => ({
  ...overrides,
});

// -- Tests --

describe('CanonicalOrderInfo', () => {
  // -- Smoke tests --

  it('should render without crashing', () => {
    const { container } = render(<CanonicalOrderInfo {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render an info trigger button', () => {
    render(<CanonicalOrderInfo {...buildProps()} />);

    const trigger = screen.getByRole('button', { name: /info|order|canonical/i });

    expect(trigger).toBeInTheDocument();
  });

  it('should show layer ordering content when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<CanonicalOrderInfo {...buildProps()} />);

    await user.click(screen.getByRole('button', { name: /info|order|canonical/i }));

    expect(screen.getByText(/persona/i)).toBeInTheDocument();
    expect(screen.getByText(/context/i)).toBeInTheDocument();
    expect(screen.getByText(/constraints/i)).toBeInTheDocument();
    expect(screen.getByText(/format/i)).toBeInTheDocument();
    expect(screen.getByText(/examples/i)).toBeInTheDocument();
  });

  it('should mention all 5 categories in the popup content', async () => {
    const user = userEvent.setup();
    render(<CanonicalOrderInfo {...buildProps()} />);

    await user.click(screen.getByRole('button', { name: /info|order|canonical/i }));

    const categories = ['persona', 'context', 'constraints', 'format', 'examples'];
    categories.forEach(category => {
      expect(screen.getByText(new RegExp(category, 'i'))).toBeInTheDocument();
    });
  });

  it('should explain why ordering matters', async () => {
    const user = userEvent.setup();
    render(<CanonicalOrderInfo {...buildProps()} />);

    await user.click(screen.getByRole('button', { name: /info|order|canonical/i }));

    const hasExplanation =
      screen.queryByText(/effective/i) ??
      screen.queryByText(/order/i) ??
      screen.queryByText(/layer/i);

    expect(hasExplanation).toBeTruthy();
  });

  // -- Edge cases --

  it('should apply custom className when provided', () => {
    const { container } = render(
      <CanonicalOrderInfo {...buildProps({ className: 'custom-info' })} />
    );

    expect(container.querySelector('.custom-info')).toBeInTheDocument();
  });

  it('should render without className when it is not provided', () => {
    const { container } = render(<CanonicalOrderInfo {...buildProps({ className: undefined })} />);

    expect(container).toBeTruthy();
  });

  // -- Snapshot --

  it('should match snapshot in closed state', () => {
    const { asFragment } = render(<CanonicalOrderInfo {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();
  });
});
