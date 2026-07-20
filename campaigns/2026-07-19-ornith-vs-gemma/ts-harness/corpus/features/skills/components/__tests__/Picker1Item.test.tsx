import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Picker1ItemLabels, Picker1ItemProps } from '../Picker1Item';
import { Picker1Item } from '../Picker1Item';

// -- Builders --

const buildLabels = (overrides?: Partial<Picker1ItemLabels>): Picker1ItemLabels => ({
  skillBadge: 'SKILL',
  historyBadge: 'HIST',
  togglePinAria: 'Toggle pin',
  ...overrides,
});

const buildProps = (overrides?: Partial<Picker1ItemProps>): Picker1ItemProps => ({
  kind: 'skill',
  name: 'Summarize',
  meta: 'general · 32 tok',
  selected: false,
  onActivate: vi.fn(),
  labels: buildLabels(),
  ...overrides,
});

// -- Tests --

describe('Picker1Item', () => {
  // -- Badge rendering --

  it('should render the SKILL badge with accent-tinted classes when kind=skill', () => {
    render(<Picker1Item {...buildProps({ kind: 'skill' })} />);

    const badge = screen.getByTestId('picker1-item-badge-skill');
    expect(badge).toHaveTextContent('SKILL');
    expect(badge).toHaveClass('bg-primary/15');
    expect(badge).toHaveClass('text-primary');
  });

  it('should render the HIST badge with neutral classes when kind=history', () => {
    render(<Picker1Item {...buildProps({ kind: 'history', onTogglePin: undefined })} />);

    const badge = screen.getByTestId('picker1-item-badge-history');
    expect(badge).toHaveTextContent('HIST');
    expect(badge).toHaveClass('bg-muted');
    expect(badge).toHaveClass('text-muted-foreground');
  });

  // -- Content tests --

  it('should render name and meta as passed', () => {
    render(<Picker1Item {...buildProps({ name: 'Explain like 5', meta: 'coaching · 18 tok' })} />);

    expect(screen.getByText('Explain like 5')).toBeInTheDocument();
    expect(screen.getByText('coaching · 18 tok')).toBeInTheDocument();
  });

  it('should show the 📌 indicator only when pinned=true', () => {
    const { rerender, container } = render(
      <Picker1Item {...buildProps({ pinned: false, onTogglePin: undefined })} />
    );
    expect(container.textContent).not.toContain('📌');

    rerender(<Picker1Item {...buildProps({ pinned: true, onTogglePin: undefined })} />);
    expect(container.textContent).toContain('📌');
  });

  // -- A11y / state tests --

  it('should set aria-selected=true when selected=true', () => {
    render(<Picker1Item {...buildProps({ selected: true })} />);

    expect(screen.getByTestId('picker1-item-skill')).toHaveAttribute('aria-selected', 'true');
  });

  it('should set aria-selected=false when selected=false', () => {
    render(<Picker1Item {...buildProps({ selected: false })} />);

    expect(screen.getByTestId('picker1-item-skill')).toHaveAttribute('aria-selected', 'false');
  });

  it('should expose role=option for cmdk parent consumption', () => {
    render(<Picker1Item {...buildProps()} />);

    expect(screen.getByRole('option')).toBeInTheDocument();
  });

  // -- Interaction tests --

  it('should call onActivate when the row is clicked', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<Picker1Item {...buildProps({ onActivate })} />);

    await user.click(screen.getByTestId('picker1-item-skill'));

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('should call onTogglePin (NOT onActivate) when the pin button is clicked', async () => {
    const onActivate = vi.fn();
    const onTogglePin = vi.fn();
    const user = userEvent.setup();
    render(<Picker1Item {...buildProps({ onActivate, onTogglePin })} />);

    await user.click(screen.getByTestId('picker1-item-pin-toggle'));

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('should not render a pin button when onTogglePin is undefined (history rows)', () => {
    render(<Picker1Item {...buildProps({ kind: 'history', onTogglePin: undefined })} />);

    expect(screen.queryByTestId('picker1-item-pin-toggle')).not.toBeInTheDocument();
  });

  it('should label the pin button with the provided aria label', () => {
    render(
      <Picker1Item
        {...buildProps({
          onTogglePin: vi.fn(),
          labels: buildLabels({ togglePinAria: 'Rögzítés' }),
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Rögzítés' })).toBeInTheDocument();
  });

  // -- Styling tests --

  it('should apply the className prop to the root element', () => {
    render(<Picker1Item {...buildProps({ className: 'custom-test-class' })} />);

    expect(screen.getByTestId('picker1-item-skill')).toHaveClass('custom-test-class');
  });
});
