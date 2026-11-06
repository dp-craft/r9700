import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Picker1FilterChipsLabels, Picker1FilterChipsProps } from '../Picker1FilterChips';
import { Picker1FilterChips } from '../Picker1FilterChips';

// -- Builders --

const buildLabels = (overrides?: Partial<Picker1FilterChipsLabels>): Picker1FilterChipsLabels => ({
  all: 'All',
  skills: 'Skills · 24',
  history: 'History · 5',
  pinned: 'Pinned · 2',
  blank: 'Blank',
  ...overrides,
});

const buildProps = (overrides?: Partial<Picker1FilterChipsProps>): Picker1FilterChipsProps => ({
  activeFilter: 'all',
  onFilterChange: vi.fn(),
  labels: buildLabels(),
  ...overrides,
});

// -- Tests --

describe('Picker1FilterChips', () => {
  // -- Content tests --

  it('should render all 5 chips with provided labels', () => {
    render(<Picker1FilterChips {...buildProps()} />);

    expect(screen.getByTestId('picker1-filter-all')).toHaveTextContent('All');
    expect(screen.getByTestId('picker1-filter-skills')).toHaveTextContent('Skills · 24');
    expect(screen.getByTestId('picker1-filter-history')).toHaveTextContent('History · 5');
    expect(screen.getByTestId('picker1-filter-pinned')).toHaveTextContent('Pinned · 2');
    expect(screen.getByTestId('picker1-filter-blank')).toHaveTextContent('Blank');
  });

  it('should render formatted count strings as-passed from container', () => {
    render(
      <Picker1FilterChips
        {...buildProps({
          labels: buildLabels({
            skills: 'Skills · 999',
            history: 'History · 0',
          }),
        })}
      />
    );

    expect(screen.getByTestId('picker1-filter-skills')).toHaveTextContent('Skills · 999');
    expect(screen.getByTestId('picker1-filter-history')).toHaveTextContent('History · 0');
  });

  // -- A11y / state tests --

  it('should mark only the active chip with aria-pressed=true (default: all)', () => {
    render(<Picker1FilterChips {...buildProps()} />);

    expect(screen.getByTestId('picker1-filter-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('picker1-filter-skills')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('picker1-filter-history')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('picker1-filter-pinned')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('picker1-filter-blank')).toHaveAttribute('aria-pressed', 'false');
  });

  it('should mark the pinned chip as active when activeFilter=pinned', () => {
    render(<Picker1FilterChips {...buildProps({ activeFilter: 'pinned' })} />);

    expect(screen.getByTestId('picker1-filter-pinned')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('picker1-filter-all')).toHaveAttribute('aria-pressed', 'false');
  });

  // -- Interaction tests --

  it('should call onFilterChange with the chip key when a chip is clicked', async () => {
    const onFilterChange = vi.fn();
    const user = userEvent.setup();
    render(<Picker1FilterChips {...buildProps({ onFilterChange })} />);

    await user.click(screen.getByTestId('picker1-filter-skills'));

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith('skills');
  });

  it('should call onFilterChange with "blank" when blank chip is clicked', async () => {
    const onFilterChange = vi.fn();
    const user = userEvent.setup();
    render(<Picker1FilterChips {...buildProps({ onFilterChange })} />);

    await user.click(screen.getByTestId('picker1-filter-blank'));

    expect(onFilterChange).toHaveBeenCalledWith('blank');
  });

  // -- Styling tests --

  it('should apply the className prop to the root element', () => {
    const { container } = render(
      <Picker1FilterChips {...buildProps({ className: 'custom-test-class' })} />
    );

    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('custom-test-class');
  });
});
