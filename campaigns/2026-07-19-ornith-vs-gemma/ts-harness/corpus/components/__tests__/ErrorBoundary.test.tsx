import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UNSENT_MESSAGE_STORAGE_KEY } from '@/config';

import { ErrorBoundary } from '../ErrorBoundary';

// -- Helpers --

const ThrowError = (): never => {
  throw new Error('Test error');
};

const SafeChild = (): React.JSX.Element => <div>Safe content</div>;

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  // -- Smoke test --

  it('should render children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <SafeChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });

  // -- Default fallback UI --

  describe('Default fallback UI', () => {
    it('should render fallback UI when error is caught', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Test error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument();
    });

    it('should display the error message from the thrown error', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText('Test error')).toBeInTheDocument();
    });
  });

  // -- sessionStorage: unsent message --

  describe('Unsent message recovery', () => {
    it('should display unsent message when sessionStorage contains one', () => {
      sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, 'test message');

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText('test message')).toBeInTheDocument();
    });

    it('should show "No unsent message" when sessionStorage is empty', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText('No unsent message')).toBeInTheDocument();
    });

    it('should show "Copy Message" button when unsent message exists', () => {
      sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, 'test message');

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByRole('button', { name: 'Copy Message' })).toBeInTheDocument();
    });

    it('should not show "Copy Message" button when sessionStorage is empty', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.queryByRole('button', { name: 'Copy Message' })).not.toBeInTheDocument();
    });
  });

  // -- Clipboard callback --

  describe('Copy message callback', () => {
    it('should call clipboard.writeText with unsent message when Copy button is clicked', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, 'my unsent message');

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      await user.click(screen.getByRole('button', { name: 'Copy Message' }));

      expect(writeText).toHaveBeenCalledOnce();
      expect(writeText).toHaveBeenCalledWith('my unsent message');
    });

    it('should not call clipboard.writeText on initial render', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, 'some message');

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(writeText).not.toHaveBeenCalled();
    });
  });

  // -- Reload callback --

  describe('Reload page callback', () => {
    it('should clear sessionStorage when Reload Page button is clicked', async () => {
      const user = userEvent.setup();
      const reload = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload },
        configurable: true,
      });
      sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, 'unsaved text');

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      await user.click(screen.getByRole('button', { name: 'Reload Page' }));

      expect(sessionStorage.getItem(UNSENT_MESSAGE_STORAGE_KEY)).toBeNull();
    });

    it('should call window.location.reload when Reload Page button is clicked', async () => {
      const user = userEvent.setup();
      const reload = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload },
        configurable: true,
      });

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      await user.click(screen.getByRole('button', { name: 'Reload Page' }));

      expect(reload).toHaveBeenCalledOnce();
    });
  });

  // -- Custom fallback prop --

  describe('Custom fallback prop', () => {
    it('should render custom fallback instead of default UI when fallback prop is provided', () => {
      const CustomFallback = <div>Custom error view</div>;

      render(
        <ErrorBoundary fallback={CustomFallback}>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom error view')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('should not render Reload Page button when custom fallback is used', () => {
      const CustomFallback = <div>Custom error view</div>;

      render(
        <ErrorBoundary fallback={CustomFallback}>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.queryByRole('button', { name: 'Reload Page' })).not.toBeInTheDocument();
    });
  });

  // -- Edge cases --

  describe('Edge cases', () => {
    it('should display the default error message when the thrown error has no message', () => {
      const ThrowEmptyError = (): never => {
        const err = new Error('');
        throw err;
      };

      render(
        <ErrorBoundary>
          <ThrowEmptyError />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('should display long unsent messages without crashing', () => {
      const longMessage = 'A'.repeat(2000);
      sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, longMessage);

      const { container } = render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(container).toBeTruthy();
      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });

    it('should display unsent message with special characters', () => {
      const specialMessage = '<script>alert("xss")</script>';
      sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, specialMessage);

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText(specialMessage)).toBeInTheDocument();
    });

    it('should not show children after error is caught', () => {
      const ChildWithText = (): React.JSX.Element => <div>Child content</div>;
      const ConditionalThrow = (): React.JSX.Element => {
        throw new Error('boom');
      };

      render(
        <ErrorBoundary>
          <ChildWithText />
          <ConditionalThrow />
        </ErrorBoundary>
      );

      expect(screen.queryByText('Child content')).not.toBeInTheDocument();
    });
  });

  // -- Snapshot --

  it('should match inline snapshot for default fallback with unsent message', () => {
    sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, 'Hello world');

    const { asFragment } = render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <div>
          <div>
            <h1>
              Something went wrong
            </h1>
            <p>
              Test error
            </p>
            <div>
              <p>
                Your unsent message:
              </p>
              <pre>
                Hello world
              </pre>
              <button
                type="button"
              >
                Copy Message
              </button>
            </div>
            <button
              type="button"
            >
              Reload Page
            </button>
          </div>
        </div>
      </DocumentFragment>
    `);
  });
});
