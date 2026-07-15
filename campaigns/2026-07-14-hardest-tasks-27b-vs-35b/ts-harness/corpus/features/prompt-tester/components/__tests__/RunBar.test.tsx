import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RunBar, type RunBarProps } from '../RunBar';

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function buildProps(overrides: Partial<RunBarProps> = {}): RunBarProps {
  return {
    formulaLabel: '1 modell × 1 prompt = 1 cella',
    runParallel: false,
    onToggleParallel: vi.fn(),
    parallelTooltip: 'Run models in parallel',
    hasChanges: false,
    isRunning: false,
    onRunAll: vi.fn(),
    onRunChanged: vi.fn(),
    onAbort: vi.fn(),
    labels: {
      runAll: 'Run all',
      runChanged: 'Run changed',
      parallelOn: 'Parallel',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunBar', () => {
  it('should render EXACTLY ONE parallelism switch with the parallel tooltip accessible name', () => {
    // Arrange
    render(<RunBar {...buildProps({ parallelTooltip: 'Run models in parallel' })} />);

    // Assert: exactly one switch rendered
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(1);

    // Assert: the single switch is labelled by labels.parallelOn
    expect(screen.getByRole('switch', { name: 'Parallel' })).toBeInTheDocument();

    // Assert: tooltip trigger button carries the parallelTooltip text
    expect(screen.getByRole('button', { name: 'Run models in parallel' })).toBeInTheDocument();
  });

  it('should render a "Run all" button', () => {
    // Arrange
    render(<RunBar {...buildProps()} />);

    // Assert
    expect(screen.getByRole('button', { name: 'Run all' })).toBeInTheDocument();
  });

  it('should hide "Run changed" when hasChanges=false and show it when hasChanges=true', () => {
    // Arrange – hidden
    const { rerender } = render(<RunBar {...buildProps({ hasChanges: false })} />);
    expect(screen.queryByRole('button', { name: 'Run changed' })).not.toBeInTheDocument();

    // Act – flip to true
    rerender(<RunBar {...buildProps({ hasChanges: true })} />);

    // Assert – now visible
    expect(screen.getByRole('button', { name: 'Run changed' })).toBeInTheDocument();
  });

  it('should render a parallel Switch reflecting runParallel=true with tooltip trigger present', () => {
    // Arrange
    const onToggleParallel = vi.fn();
    const props = buildProps({ runParallel: true, onToggleParallel });

    // Act
    render(<RunBar {...props} />);

    // Assert: switch is checked
    const switchEl = screen.getByRole('switch', { name: 'Parallel' });
    expect(switchEl).toBeChecked();

    // Assert: tooltip trigger (ⓘ button) is present
    expect(screen.getByRole('button', { name: 'Run models in parallel' })).toBeInTheDocument();
  });

  it('should render a parallel Switch reflecting runParallel=false', () => {
    // Arrange
    const props = buildProps({ runParallel: false });

    // Act
    render(<RunBar {...props} />);

    // Assert: switch is unchecked
    const switchEl = screen.getByRole('switch', { name: 'Parallel' });
    expect(switchEl).not.toBeChecked();
  });

  it('should fire onRunAll when the Run all button is clicked', async () => {
    // Arrange
    const user = userEvent.setup();
    const onRunAll = vi.fn();
    render(<RunBar {...buildProps({ onRunAll })} />);

    // Act
    await user.click(screen.getByRole('button', { name: 'Run all' }));

    // Assert
    expect(onRunAll).toHaveBeenCalledTimes(1);
  });

  it('should NOT render the Run changed button when hasChanges=false', () => {
    // Arrange
    render(<RunBar {...buildProps({ hasChanges: false })} />);

    // Assert
    expect(screen.queryByRole('button', { name: 'Run changed' })).not.toBeInTheDocument();
  });

  it('should render the Run changed button ONLY when hasChanges=true', () => {
    // Arrange
    render(<RunBar {...buildProps({ hasChanges: true })} />);

    // Assert
    expect(screen.getByRole('button', { name: 'Run changed' })).toBeInTheDocument();
  });

  it('should fire onRunChanged when the Run changed button is clicked', async () => {
    // Arrange
    const user = userEvent.setup();
    const onRunChanged = vi.fn();
    render(<RunBar {...buildProps({ hasChanges: true, onRunChanged })} />);

    // Act
    await user.click(screen.getByRole('button', { name: 'Run changed' }));

    // Assert
    expect(onRunChanged).toHaveBeenCalledTimes(1);
  });

  it('should show the abort affordance while isRunning=true', () => {
    // Arrange
    render(<RunBar {...buildProps({ isRunning: true })} />);

    // Assert
    expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
  });

  it('should NOT show the abort affordance when isRunning=false', () => {
    // Arrange
    render(<RunBar {...buildProps({ isRunning: false })} />);

    // Assert
    expect(screen.queryByRole('button', { name: 'Abort' })).not.toBeInTheDocument();
  });
});
