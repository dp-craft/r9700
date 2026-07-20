/**
 * L2 Renderer test — pure slot-composing renderer (ADR-018).
 *
 * Shape (snapshot-driven, no onX props on this renderer):
 *   1. Default snapshot with both slots and the empty hint hidden.
 *   2. Conditional-render snapshot: `showEmptyHint=true` reveals the hint
 *      paragraph — a distinct visible branch the default snapshot does not cover.
 *   3. Slot pass-through: sentinel nodes provided as providerSlot/modelSlot
 *      are rendered into the section.
 *
 * FORBIDDEN (covered by the snapshot — MUST NOT be added):
 *   - "renders without crashing"
 *   - structure-count / role-presence assertions
 *   - toHaveClass / className assertions
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EvalModelSection, type EvalModelSectionProps } from '../EvalModelSection';

const buildProps = (overrides?: Partial<EvalModelSectionProps>): EvalModelSectionProps => ({
  heading: 'Evaluator model',
  description: 'Scores run outputs against the original prompt and system prompts.',
  emptyHint: 'No evaluator model chosen — runs won\'t be scored until set.',
  showEmptyHint: false,
  providerSlot: <div data-testid="sentinel-provider">provider-slot</div>,
  modelSlot: <div data-testid="sentinel-model">model-slot</div>,
  ...overrides,
});

describe('EvalModelSection', () => {
  it('should match snapshot with hint hidden (default props)', () => {
    const { asFragment } = render(<EvalModelSection {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should match snapshot with empty hint shown', () => {
    const { asFragment } = render(<EvalModelSection {...buildProps({ showEmptyHint: true })} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should render the provided provider and model slots', () => {
    render(<EvalModelSection {...buildProps()} />);

    expect(screen.getByTestId('sentinel-provider')).toBeInTheDocument();
    expect(screen.getByTestId('sentinel-model')).toBeInTheDocument();
  });

  it('should render heading and description text from props', () => {
    render(<EvalModelSection {...buildProps({ heading: 'My Eval', description: 'My desc' })} />);

    expect(screen.getByText('My Eval')).toBeInTheDocument();
    expect(screen.getByText('My desc')).toBeInTheDocument();
  });

  it('should not render the empty hint when showEmptyHint is false', () => {
    render(<EvalModelSection {...buildProps({ showEmptyHint: false })} />);

    expect(screen.queryByTestId('mf-lab-eval-model-empty-hint')).not.toBeInTheDocument();
  });
});
