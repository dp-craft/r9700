import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatHeader } from '../ChatHeader';

describe('ChatHeader', () => {
  it('should match snapshot with no slots', () => {
    const { asFragment } = render(<ChatHeader />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should match snapshot when badgesSlot is provided', () => {
    const { asFragment } = render(
      <ChatHeader badgesSlot={<span data-testid="badge-sentinel">3</span>} />
    );

    expect(asFragment()).toMatchSnapshot();
  });

  it('should render badgesSlot content when provided', () => {
    render(<ChatHeader badgesSlot={<span data-testid="badge-sentinel">3</span>} />);

    expect(screen.getByTestId('badge-sentinel')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should not render any badge content when badgesSlot is omitted', () => {
    render(<ChatHeader />);

    expect(screen.queryByTestId('badge-sentinel')).not.toBeInTheDocument();
  });

  it('should apply custom className when provided', () => {
    const { container } = render(<ChatHeader className="custom-class" />);

    expect(container.firstElementChild?.className).toContain('custom-class');
  });
});
