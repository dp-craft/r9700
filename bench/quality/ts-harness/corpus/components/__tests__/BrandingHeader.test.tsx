import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BrandingHeader } from '../BrandingHeader';

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BrandingHeader', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { asFragment } = render(<BrandingHeader />);

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <a
          href="/"
        >
          <span
            aria-hidden="true"
          >
            🤖
          </span>
          <span>
            AiChatney
          </span>
        </a>
      </DocumentFragment>
    `);
  });

  // -- Content rendering --

  describe('Content rendering', () => {
    it('should display the AiChatney text', () => {
      render(<BrandingHeader />);

      expect(screen.getByText('AiChatney')).toBeInTheDocument();
    });

    it('should display the robot logo emoji', () => {
      render(<BrandingHeader />);

      expect(screen.getByText('🤖')).toBeInTheDocument();
    });

    it('should mark the logo emoji as aria-hidden', () => {
      render(<BrandingHeader />);

      const logoSpan = screen.getByText('🤖');

      expect(logoSpan).toHaveAttribute('aria-hidden', 'true');
    });
  });

  // -- Accessibility --

  describe('Accessibility', () => {
    it('should render as a link element', () => {
      render(<BrandingHeader />);

      expect(screen.getByRole('link')).toBeInTheDocument();
    });

    it('should have accessible name AiChatney', () => {
      render(<BrandingHeader />);

      expect(screen.getByRole('link', { name: 'AiChatney' })).toBeInTheDocument();
    });

    it('should have href pointing to root', () => {
      render(<BrandingHeader />);

      expect(screen.getByRole('link')).toHaveAttribute('href', '/');
    });
  });

  // -- Navigation callback --

  describe('Navigation callback', () => {
    it('should call onNavigate when clicked and onNavigate is provided', async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      render(<BrandingHeader onNavigate={onNavigate} />);

      await user.click(screen.getByRole('link'));

      expect(onNavigate).toHaveBeenCalledOnce();
    });

    it('should not call onNavigate on initial render', () => {
      const onNavigate = vi.fn();
      render(<BrandingHeader onNavigate={onNavigate} />);

      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('should call onNavigate with no arguments', async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      render(<BrandingHeader onNavigate={onNavigate} />);

      await user.click(screen.getByRole('link'));

      expect(onNavigate).toHaveBeenCalledWith();
    });
  });

  // -- Conditional navigation --

  describe('Conditional navigation', () => {
    it('should render as a link with href when onNavigate is not provided', () => {
      render(<BrandingHeader />);

      const link = screen.getByRole('link');

      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/');
    });

    it('should still render AiChatney text when onNavigate is omitted', () => {
      render(<BrandingHeader />);

      expect(screen.getByRole('link', { name: 'AiChatney' })).toBeInTheDocument();
    });
  });

  // -- className prop --

  describe('className prop', () => {
    it('should apply custom className to the link element when provided', () => {
      render(<BrandingHeader className="custom-class" />);

      expect(screen.getByRole('link')).toHaveClass('custom-class');
    });

    it('should render without custom className when not provided', () => {
      render(<BrandingHeader />);

      expect(screen.getByRole('link')).not.toHaveClass('custom-class');
    });
  });

  // -- Edge cases --

  describe('Edge cases', () => {
    it('should render correctly with both onNavigate and className provided', async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      render(<BrandingHeader onNavigate={onNavigate} className="extra-class" />);

      const link = screen.getByRole('link', { name: 'AiChatney' });
      await user.click(link);

      expect(link).toHaveClass('extra-class');
      expect(onNavigate).toHaveBeenCalledOnce();
    });

    it('should render both logo and text in the same link', () => {
      render(<BrandingHeader />);

      const link = screen.getByRole('link');

      expect(link).toContainElement(screen.getByText('🤖'));
      expect(link).toContainElement(screen.getByText('AiChatney'));
    });
  });
});
