import type * as React from 'react';
import { Component, type ReactNode } from 'react';

import { UNSENT_MESSAGE_STORAGE_KEY } from '@/config';

const DEFAULT_ERROR_MESSAGE = 'An unexpected error occurred';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

export interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
  readonly unsentMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, unsentMessage: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Error boundary caught error:', error, errorInfo);
    const preserved = sessionStorage.getItem(UNSENT_MESSAGE_STORAGE_KEY) ?? '';
    this.setState({ unsentMessage: preserved });
  }

  private readonly handleReload = (): void => {
    sessionStorage.removeItem(UNSENT_MESSAGE_STORAGE_KEY);
    window.location.reload();
  };

  private readonly handleCopyMessage = (): void => {
    void navigator.clipboard.writeText(this.state.unsentMessage);
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-screen w-full items-center justify-center p-4">
          <div className="max-w-lg text-center">
            <h1 className="mb-4 text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message ?? DEFAULT_ERROR_MESSAGE}
            </p>
            {this.state.unsentMessage ? (
              <UnsentMessageSection
                message={this.state.unsentMessage}
                onCopy={this.handleCopyMessage}
              />
            ) : (
              <p className="text-muted-foreground mb-6 text-sm">No unsent message</p>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface UnsentMessageSectionProps {
  readonly message: string;
  readonly onCopy: () => void;
}

function UnsentMessageSection({ message, onCopy }: UnsentMessageSectionProps): ReactNode {
  return (
    <div className="mb-6">
      <p className="text-muted-foreground mb-2 text-sm">Your unsent message:</p>
      <pre
        className="bg-muted text-foreground mb-2 max-h-40 overflow-auto rounded-md p-3 text-left text-sm whitespace-pre-wrap"
        style={{ userSelect: 'all' }}
      >
        {message}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        className="text-muted-foreground hover:text-foreground text-sm underline"
      >
        Copy Message
      </button>
    </div>
  );
}
