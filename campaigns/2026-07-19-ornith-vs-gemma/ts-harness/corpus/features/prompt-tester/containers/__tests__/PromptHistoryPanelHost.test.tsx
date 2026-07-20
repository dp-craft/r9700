import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PromptHistoryPanelHost } from '../PromptHistoryPanelHost';

vi.mock('@/features/prompt-history', () => ({
  PromptHistoryContentContainer: () => <div data-testid="prompt-history-content-sentinel" />,
}));

describe('PromptHistoryPanelHost', () => {
  it('renders the prompt-history content', () => {
    render(<PromptHistoryPanelHost />);
    expect(screen.getByTestId('prompt-history-content-sentinel')).toBeInTheDocument();
  });

  it('contains no MFRail', () => {
    render(<PromptHistoryPanelHost />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mf-rail')).not.toBeInTheDocument();
  });
});
