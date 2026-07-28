import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Pill } from '@/components/ui/Pill';

// -- Tests --

describe('Pill', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<Pill>label</Pill>);

    expect(container).toBeTruthy();
  });

  // -- Variant matrix --

  describe('variant: default (no accent, no filled)', () => {
    it('should apply border-line text-ink2 bg-panel classes when no variant props are set', () => {
      const { container } = render(<Pill>default</Pill>);
      const span = container.firstChild as HTMLElement;

      expect(span.className).toContain('border-line');
      expect(span.className).toContain('text-ink2');
      expect(span.className).toContain('bg-panel');
    });
  });

  describe('variant: accent only', () => {
    it('should apply border-accent text-accent bg-panel classes when accent is true', () => {
      const { container } = render(<Pill accent>accent</Pill>);
      const span = container.firstChild as HTMLElement;

      expect(span.className).toContain('border-accent');
      expect(span.className).toContain('text-accent');
      expect(span.className).toContain('bg-panel');
    });
  });

  describe('variant: filled only (no accent)', () => {
    it('should apply border-line bg-accent text-white classes when filled is true without accent', () => {
      const { container } = render(<Pill filled>filled</Pill>);
      const span = container.firstChild as HTMLElement;

      expect(span.className).toContain('border-line');
      expect(span.className).toContain('bg-accent');
      expect(span.className).toContain('text-white');
    });
  });

  describe('variant: accent + filled', () => {
    it('should apply border-accent bg-accent text-white classes when both accent and filled are true', () => {
      const { container } = render(
        <Pill accent filled>
          accent filled
        </Pill>
      );
      const span = container.firstChild as HTMLElement;

      expect(span.className).toContain('border-accent');
      expect(span.className).toContain('bg-accent');
      expect(span.className).toContain('text-white');
    });
  });

  describe('variant: onDot', () => {
    it('should render accent dot span before children when onDot is true', () => {
      render(<Pill onDot>dotted</Pill>);

      const pill = screen.getByText('dotted').parentElement as HTMLElement;
      const firstChild = pill.firstChild as HTMLElement;

      expect(firstChild.tagName).toBe('SPAN');
      expect(firstChild.className).toContain('w-1.5');
      expect(firstChild.className).toContain('h-1.5');
      expect(firstChild.className).toContain('rounded-full');
      expect(firstChild.className).toContain('bg-accent');
    });

    it('should not render dot span when onDot is false', () => {
      render(<Pill onDot={false}>no dot</Pill>);

      const pill = screen.getByText('no dot').parentElement as HTMLElement;

      expect(pill.childElementCount).toBe(1);
    });
  });

  // -- Base classes --

  it('should always include base layout classes', () => {
    const { container } = render(<Pill>base</Pill>);
    const span = container.firstChild as HTMLElement;

    expect(span.className).toContain('inline-flex');
    expect(span.className).toContain('items-center');
    expect(span.className).toContain('rounded-full');
    expect(span.className).toContain('border');
    expect(span.className).toContain('whitespace-nowrap');
    expect(span.className).toContain('cursor-pointer');
  });

  // -- Custom className --

  it('should append custom className to the root span', () => {
    const { container } = render(<Pill className="my-custom-class">custom</Pill>);
    const span = container.firstChild as HTMLElement;

    expect(span.className).toContain('my-custom-class');
  });

  // -- HTML attribute passthrough --

  it('should forward data-testid attribute to the root span', () => {
    render(<Pill data-testid="pill-el">test</Pill>);

    expect(screen.getByTestId('pill-el')).toBeInTheDocument();
  });

  it('should call onClick handler when clicked', async () => {
    const handleClick = vi.fn();
    render(<Pill onClick={handleClick}>clickable</Pill>);

    await userEvent.click(screen.getByText('clickable'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  // -- Edge cases --

  it('should render with empty string children without crashing', () => {
    const { container } = render(<Pill>{''}</Pill>);

    expect(container.firstChild).toBeTruthy();
  });

  it('should render very long text content without crashing', () => {
    const longText = 'a'.repeat(200);
    render(<Pill>{longText}</Pill>);

    expect(screen.getByText(longText)).toBeInTheDocument();
  });

  // -- Snapshot --

  it('should match inline snapshot for accent + onDot variant', () => {
    const { asFragment } = render(
      <Pill accent onDot data-testid="snap-pill">
        label
      </Pill>
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <span
          data-testid="snap-pill"
        >
          <span />
          <span>
            label
          </span>
        </span>
      </DocumentFragment>
    `);
  });
});
