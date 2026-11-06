// Boundary mocks — declared before imports (Vitest hoisting)

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUIStore } from '@/stores/useUIStore';

import { ChatHeaderContainer } from '../ChatHeaderContainer';

// -- Store state snapshot for reset --

const initialUIState = useUIStore.getState();

// -- Setup --

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState(initialUIState, true);
});

// -- Tests --

describe('ChatHeaderContainer — bg-call-counter badge', () => {
  it('should not render the bg-call-counter badge when inFlightCalls is 0', () => {
    // Given: no in-flight calls
    useUIStore.setState({ inFlightCalls: 0 });

    // When
    render(<ChatHeaderContainer />);

    // Then
    expect(screen.queryByTestId('bg-call-counter')).not.toBeInTheDocument();
  });

  it('should render the bg-call-counter badge when inFlightCalls is 1', () => {
    // Given: one in-flight call
    useUIStore.setState({ inFlightCalls: 1 });

    // When
    render(<ChatHeaderContainer />);

    // Then
    expect(screen.getByTestId('bg-call-counter')).toBeInTheDocument();
  });

  it('should display the correct count inside the badge when inFlightCalls is 3', () => {
    // Given: three in-flight calls
    useUIStore.setState({ inFlightCalls: 3 });

    // When
    render(<ChatHeaderContainer />);

    // Then
    const badge = screen.getByTestId('bg-call-counter');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('3');
  });

  it('should apply the i18n key as aria-label on the badge', () => {
    // Given
    useUIStore.setState({ inFlightCalls: 2 });

    // When
    render(<ChatHeaderContainer />);

    // Then: aria-label equals the raw i18n key (useTranslation is identity in tests)
    expect(screen.getByTestId('bg-call-counter')).toHaveAttribute(
      'aria-label',
      'chat.header.backgroundCalls'
    );
  });

  it('should hide the badge again after inFlightCalls drops back to 0', () => {
    // Given: start with 1 in-flight call
    useUIStore.setState({ inFlightCalls: 1 });
    const { rerender } = render(<ChatHeaderContainer />);
    expect(screen.getByTestId('bg-call-counter')).toBeInTheDocument();

    // When: calls drop to 0
    useUIStore.setState({ inFlightCalls: 0 });
    rerender(<ChatHeaderContainer />);

    // Then
    expect(screen.queryByTestId('bg-call-counter')).not.toBeInTheDocument();
  });

  it('should accept and apply a custom className prop', () => {
    // Given
    useUIStore.setState({ inFlightCalls: 0 });

    // When
    const { container } = render(<ChatHeaderContainer className="my-custom" />);

    // Then
    expect(container.firstElementChild?.className).toContain('my-custom');
  });
});
