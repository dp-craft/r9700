/**
 * L2 Renderer test — ADR-018 shape (class-strip snapshot + 1 test per onX prop).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type EvalComparisonView,
  EvalControls,
  type EvalControlsProps
} from '../EvalControls';

const buildLabels = (): EvalControlsProps['labels'] => ({
  heading: 'Evaluate results',
  description: 'Score this run.',
  perOutput: 'Evaluate each output',
  compareAll: 'Compare all together',
  copyPrompt: 'Copy evaluation prompt',
  disabledHint: 'Configure an evaluator model in Settings.',
  verdictLabel: 'Verdict:',
});

const buildComparison = (): EvalComparisonView => ({
  winnerLabel: 'Output 2',
  ranking: [
    { label: 'Output 2', rank: 1, reasoning: '— follows tone.' },
    { label: 'Output 1', rank: 2, reasoning: '— verbose.' },
  ],
  overallReasoning: 'Output 2 best.',
  error: null,
});

const buildProps = (overrides?: Partial<EvalControlsProps>): EvalControlsProps => ({
  visible: true,
  inAppEvalEnabled: true,
  comparison: null,
  labels: buildLabels(),
  onEvaluatePerOutput: vi.fn(),
  onCompareAll: vi.fn(),
  onCopyPrompt: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EvalControls', () => {
  it('should match snapshot when enabled (default props)', () => {
    const { asFragment } = render(<EvalControls {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should match snapshot when inAppEvalEnabled is false (disabled + hint)', () => {
    const { asFragment } = render(<EvalControls {...buildProps({ inAppEvalEnabled: false })} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should match snapshot when comparison data is present (result region)', () => {
    const { asFragment } = render(<EvalControls {...buildProps({ comparison: buildComparison() })} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should render nothing when visible is false', () => {
    const { container } = render(<EvalControls {...buildProps({ visible: false })} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('should call onEvaluatePerOutput when the per-output button is clicked', async () => {
    const user = userEvent.setup();
    const onEvaluatePerOutput = vi.fn();
    render(<EvalControls {...buildProps({ onEvaluatePerOutput })} />);

    await user.click(screen.getByTestId('eval-per-output-btn'));

    expect(onEvaluatePerOutput).toHaveBeenCalledOnce();
  });

  it('should call onCompareAll when the batch button is clicked', async () => {
    const user = userEvent.setup();
    const onCompareAll = vi.fn();
    render(<EvalControls {...buildProps({ onCompareAll })} />);

    await user.click(screen.getByTestId('eval-batch-btn'));

    expect(onCompareAll).toHaveBeenCalledOnce();
  });

  it('should call onCopyPrompt when the copy button is clicked even if in-app eval disabled', async () => {
    const user = userEvent.setup();
    const onCopyPrompt = vi.fn();
    render(<EvalControls {...buildProps({ inAppEvalEnabled: false, onCopyPrompt })} />);

    const copyButton = screen.getByTestId('copy-eval-prompt');
    expect(copyButton).toBeEnabled();
    await user.click(copyButton);

    expect(onCopyPrompt).toHaveBeenCalledOnce();
  });
});
