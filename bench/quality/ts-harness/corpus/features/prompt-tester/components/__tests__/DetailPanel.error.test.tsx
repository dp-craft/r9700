import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DetailPanel, type DetailPanelProps } from '../DetailPanel';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildProps(overrides: Partial<DetailPanelProps> = {}): DetailPanelProps {
  return {
    isOpen: true,
    title: 'Cell title',
    cellKey: 'gpt-4o / prompt-1',
    systemPrompt: null,
    responseText: '',
    status: 'failed',
    error: 'Provider 404',
    tier1: null,
    tier2: null,
    judge: null,
    tps: null,
    modelParams: null,
    isAnalyzing: false,
    isJudging: false,
    onClose: vi.fn(),
    onAnalyzeTier2: vi.fn(),
    onRunJudge: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — per-cell error + retry UI (T004, TDD Red phase)
// ---------------------------------------------------------------------------

describe('DetailPanel — error + retry', () => {
  it('should render error text and Retry button when status is failed with onRetry provided', () => {
    // Given: a failed cell with an error message and a retry handler
    const onRetry = vi.fn();
    const props = buildProps({ status: 'failed', error: 'Provider 404', onRetry });

    // When: the panel is rendered
    render(<DetailPanel {...props} />);

    // Then: error text is visible AND a Retry button is present
    expect(screen.getByRole('alert')).toHaveTextContent('Provider 404');
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('should call onRetry exactly once when the Retry button is clicked', async () => {
    // Given: a failed cell with a retry spy
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const props = buildProps({ status: 'failed', error: 'Provider 404', onRetry });

    render(<DetailPanel {...props} />);

    // When: the user clicks the Retry button
    await user.click(screen.getByRole('button', { name: /retry/i }));

    // Then: onRetry is called exactly once
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should NOT render a Retry button when status is failed but onRetry is not provided', () => {
    // Given: a failed cell without a retry handler (onRetry omitted)
    const props = buildProps({ status: 'failed', error: 'Provider 404' });
    // onRetry intentionally absent — the prop does not exist on DetailPanelProps yet

    // When: the panel is rendered
    render(<DetailPanel {...props} />);

    // Then: error text shows but no Retry button (handler not wired)
    expect(screen.getByRole('alert')).toHaveTextContent('Provider 404');
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
