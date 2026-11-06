import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RunHistoryPanelHost } from '../RunHistoryPanelHost';

vi.mock('@/features/run-history', () => ({
  RunHistoryContentContainer: () => <div data-testid="run-history-content-sentinel" />,
}));

describe('RunHistoryPanelHost', () => {
  it('renders the run-history content', () => {
    render(<RunHistoryPanelHost />);
    expect(screen.getByTestId('run-history-content-sentinel')).toBeInTheDocument();
  });

  it('contains no MFRail', () => {
    const { container } = render(<RunHistoryPanelHost />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="mf-rail"]')).toBeNull();
  });
});
