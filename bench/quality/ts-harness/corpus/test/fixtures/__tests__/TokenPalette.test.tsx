import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DESIGN_TOKENS } from '../../../../specs/025-design-spec-alignment/contracts/design-tokens';
import { TokenPalette } from '../TokenPalette';

// Helper: find the element carrying a given data-token attribute
const byToken = (container: HTMLElement, token: string): HTMLElement => {
  const el = container.querySelector(`[data-token="${token}"]`);
  if (!el) throw new Error(`No element found with data-token="${token}"`);
  return el as HTMLElement;
};

describe('TokenPalette', () => {
  it('should render without crashing', () => {
    const { container } = render(<TokenPalette />);

    expect(container.firstChild).not.toBeNull();
  });

  describe('color tokens', () => {
    it('should render bg token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'bg');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(250, 250, 249)');
    });

    it('should render panel token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'panel');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(255, 255, 255)');
    });

    it('should render soft token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'soft');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(245, 245, 244)');
    });

    it('should render line token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'line');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(231, 229, 228)');
    });

    it('should render lineSoft token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'lineSoft');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(241, 239, 238)');
    });

    it('should render ink token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'ink');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(28, 25, 23)');
    });

    it('should render ink2 token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'ink2');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(87, 83, 78)');
    });

    it('should render ink3 token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'ink3');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(168, 162, 158)');
    });

    it('should render accent token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'accent');

      expect(getComputedStyle(el).backgroundColor).toBe('rgb(59, 130, 246)');
    });

    it('should render diffAdd token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'diffAdd');

      expect(getComputedStyle(el).backgroundColor).toBe('rgba(22, 163, 74, 0.18)');
    });

    it('should render diffDel token with correct background-color', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'diffDel');

      expect(getComputedStyle(el).backgroundColor).toBe('rgba(220, 38, 38, 0.18)');
    });
  });

  describe('radius tokens', () => {
    it('should render card radius token with correct border-radius', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'radius-card');

      expect(getComputedStyle(el).borderRadius).toBe(DESIGN_TOKENS.radius.card);
    });

    it('should render pill radius token with correct border-radius', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'radius-pill');

      expect(getComputedStyle(el).borderRadius).toBe(DESIGN_TOKENS.radius.pill);
    });

    it('should render frame radius token with correct border-radius', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'radius-frame');

      expect(getComputedStyle(el).borderRadius).toBe(DESIGN_TOKENS.radius.frame);
    });

    it('should render modal radius token with correct border-radius', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'radius-modal');

      expect(getComputedStyle(el).borderRadius).toBe(DESIGN_TOKENS.radius.modal);
    });
  });

  describe('shadow tokens', () => {
    it('should render sm shadow token with a box-shadow containing key substring', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'shadow-sm');

      expect(getComputedStyle(el).boxShadow).toContain('0 1px 2px');
    });

    it('should render md shadow token with a box-shadow containing 0 6px 16px', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'shadow-md');

      expect(getComputedStyle(el).boxShadow).toContain('0 6px 16px');
    });
  });

  describe('font tokens', () => {
    it('should render sans font token with font-family containing Inter', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'font-sans');

      expect(getComputedStyle(el).fontFamily).toContain('Inter');
    });

    it('should render mono font token with font-family containing JetBrains Mono', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'font-mono');

      expect(getComputedStyle(el).fontFamily).toContain('JetBrains Mono');
    });
  });

  describe('text size tokens', () => {
    it('should render xs text token with correct font-size', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'text-xs');

      expect(getComputedStyle(el).fontSize).toBe(DESIGN_TOKENS.text.xs);
    });

    it('should render sm text token with correct font-size', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'text-sm');

      expect(getComputedStyle(el).fontSize).toBe(DESIGN_TOKENS.text.sm);
    });

    it('should render body text token with correct font-size', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'text-body');

      expect(getComputedStyle(el).fontSize).toBe(DESIGN_TOKENS.text.body);
    });

    it('should render md text token with correct font-size', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'text-md');

      expect(getComputedStyle(el).fontSize).toBe(DESIGN_TOKENS.text.md);
    });

    it('should render lg text token with correct font-size', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'text-lg');

      expect(getComputedStyle(el).fontSize).toBe(DESIGN_TOKENS.text.lg);
    });

    it('should render hd text token with correct font-size', () => {
      const { container } = render(<TokenPalette />);

      const el = byToken(container, 'text-hd');

      expect(getComputedStyle(el).fontSize).toBe(DESIGN_TOKENS.text.hd);
    });
  });

  describe('contract coverage', () => {
    it('should expose an element for every color key in DESIGN_TOKENS', () => {
      const { container } = render(<TokenPalette />);

      for (const key of Object.keys(DESIGN_TOKENS.colors)) {
        expect(container.querySelector(`[data-token="${key}"]`)).not.toBeNull();
      }
    });

    it('should expose an element for every radius key in DESIGN_TOKENS', () => {
      const { container } = render(<TokenPalette />);

      for (const key of Object.keys(DESIGN_TOKENS.radius)) {
        expect(container.querySelector(`[data-token="radius-${key}"]`)).not.toBeNull();
      }
    });

    it('should expose an element for every text key in DESIGN_TOKENS', () => {
      const { container } = render(<TokenPalette />);

      for (const key of Object.keys(DESIGN_TOKENS.text)) {
        expect(container.querySelector(`[data-token="text-${key}"]`)).not.toBeNull();
      }
    });
  });
});
