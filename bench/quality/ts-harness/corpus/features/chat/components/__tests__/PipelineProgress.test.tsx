import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PipelineProgressProps } from '../PipelineProgress';
import { PipelineProgress } from '../PipelineProgress';

// -- Builders --

const buildProps = (overrides?: Partial<PipelineProgressProps>): PipelineProgressProps => ({
  currentStepId: null,
  currentStepLabel: null,
  completedSteps: [],
  translatingInputLabel: 'Translating input...',
  generatingResponseLabel: 'Generating response...',
  translatingOutputLabel: 'Translating response...',
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PipelineProgress', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<PipelineProgress {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Inactive state --

  it('should not display any step content when currentStepId is null and completedSteps is empty', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: null,
          currentStepLabel: null,
          completedSteps: [],
        })}
      />
    );

    expect(screen.queryByText('Translating input...')).not.toBeInTheDocument();
    expect(screen.queryByText('Generating response...')).not.toBeInTheDocument();
    expect(screen.queryByText('Translating response...')).not.toBeInTheDocument();
  });

  // -- Current step label display --

  it('should display currentStepLabel text when currentStepId is translate-input', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'translate-input',
          currentStepLabel: 'Translating input...',
          completedSteps: [],
        })}
      />
    );

    expect(screen.getByText('Translating input...')).toBeInTheDocument();
  });

  it('should display currentStepLabel when currentStepId is main-llm', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'main-llm',
          currentStepLabel: 'Generating response...',
          completedSteps: [],
        })}
      />
    );

    expect(screen.getByText('Generating response...')).toBeInTheDocument();
  });

  it('should display currentStepLabel when currentStepId is translate-output', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'translate-output',
          currentStepLabel: 'Translating response...',
          completedSteps: [],
        })}
      />
    );

    expect(screen.getByText('Translating response...')).toBeInTheDocument();
  });

  // -- Completed step visibility --

  it('should show completed step indicator and active step label when translate-input is completed and main-llm is active', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'main-llm',
          currentStepLabel: 'Generating response...',
          completedSteps: ['translate-input'],
        })}
      />
    );

    expect(screen.getByText('Generating response...')).toBeInTheDocument();
  });

  it('should show completed step content when completedSteps contains translate-input', () => {
    const { container } = render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'main-llm',
          currentStepLabel: 'Generating response...',
          completedSteps: ['translate-input'],
        })}
      />
    );

    expect(container.firstChild).not.toBeNull();
  });

  it('should show both completed and active step when two steps are in progress', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'translate-output',
          currentStepLabel: 'Translating response...',
          completedSteps: ['translate-input', 'main-llm'],
        })}
      />
    );

    expect(screen.getByText('Translating response...')).toBeInTheDocument();
  });

  // -- currentStepLabel prop drives display --

  it('should display the exact currentStepLabel string passed as prop', () => {
    const customLabel = 'Custom step in progress';

    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'main-llm',
          currentStepLabel: customLabel,
          completedSteps: [],
        })}
      />
    );

    expect(screen.getByText(customLabel)).toBeInTheDocument();
  });

  // -- Only current step visible when no steps completed yet --

  it('should show only current step label when no steps are completed', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'translate-input',
          currentStepLabel: 'Translating input...',
          completedSteps: [],
        })}
      />
    );

    expect(screen.getByText('Translating input...')).toBeInTheDocument();
    expect(screen.queryByText('Generating response...')).not.toBeInTheDocument();
    expect(screen.queryByText('Translating response...')).not.toBeInTheDocument();
  });

  // -- Edge cases --

  it('should handle all three steps completed with no active step', () => {
    const { container } = render(
      <PipelineProgress
        {...buildProps({
          currentStepId: null,
          currentStepLabel: null,
          completedSteps: ['translate-input', 'main-llm', 'translate-output'],
        })}
      />
    );

    expect(container.firstChild).not.toBeNull();
  });

  it('should not show the translate-output label when it is not active or completed', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'translate-input',
          currentStepLabel: 'Translating input...',
          completedSteps: [],
        })}
      />
    );

    expect(screen.queryByText('Translating response...')).not.toBeInTheDocument();
  });

  it('should not show the translate-input label when main-llm is the only active step and no steps are completed', () => {
    render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'main-llm',
          currentStepLabel: 'Generating response...',
          completedSteps: [],
        })}
      />
    );

    expect(screen.queryByText('Translating input...')).not.toBeInTheDocument();
  });

  it('should render nothing visible when currentStepId is null and completedSteps is empty', () => {
    const { container } = render(
      <PipelineProgress
        {...buildProps({
          currentStepId: null,
          currentStepLabel: null,
          completedSteps: [],
        })}
      />
    );

    const allText = container.textContent;
    expect(allText?.trim()).toBeFalsy();
  });

  // -- State transitions --

  it('should transition from showing active step to inactive when currentStepId becomes null with no completed steps', () => {
    const { rerender } = render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'translate-input',
          currentStepLabel: 'Translating input...',
          completedSteps: [],
        })}
      />
    );

    expect(screen.getByText('Translating input...')).toBeInTheDocument();

    rerender(
      <PipelineProgress
        {...buildProps({
          currentStepId: null,
          currentStepLabel: null,
          completedSteps: [],
        })}
      />
    );

    expect(screen.queryByText('Translating input...')).not.toBeInTheDocument();
  });

  it('should transition from translate-input step to main-llm step', () => {
    const { rerender } = render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'translate-input',
          currentStepLabel: 'Translating input...',
          completedSteps: [],
        })}
      />
    );

    expect(screen.getByText('Translating input...')).toBeInTheDocument();

    rerender(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'main-llm',
          currentStepLabel: 'Generating response...',
          completedSteps: ['translate-input'],
        })}
      />
    );

    expect(screen.getByText('Generating response...')).toBeInTheDocument();
  });

  // -- Snapshot --

  it('should match inline snapshot when main-llm is active and translate-input is completed', () => {
    const { asFragment } = render(
      <PipelineProgress
        {...buildProps({
          currentStepId: 'main-llm',
          currentStepLabel: 'Generating response...',
          completedSteps: ['translate-input'],
        })}
      />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <output
          aria-label="Pipeline progress"
          aria-live="polite"
        >
          <span
            title="Translating input... — completed"
          >
            <span
              aria-hidden="true"
            >
              ✓
            </span>
            <span>
              Translating input...
            </span>
          </span>
          <span
            aria-hidden="true"
          >
            ·
          </span>
          <span
            title="Generating response... — active"
          >
            <span
              aria-hidden="true"
            >
              ⟳
            </span>
            <span>
              Generating response...
            </span>
          </span>
        </output>
      </DocumentFragment>
    `);
  });
});
