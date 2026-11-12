import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface MFErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallbackRender: (error: Error) => ReactNode;
  readonly onError?: (error: Error) => void;
  readonly resetKey?: string;
}

interface MFErrorBoundaryState {
  readonly error: Error | null;
}

/*
 * SANCTIONED CLASS COMPONENT — sole exception in the codebase.
 * React 19 provides no functional API for catching render-phase errors
 * from descendants; an error boundary MUST be a class. This component
 * carries NO business logic: `onError` dispatches into a Zustand store
 * in the caller's space for FP downstream handling. Any extension that
 * adds logic here requires an architecture review.
 */
export class MFErrorBoundary extends Component<MFErrorBoundaryProps, MFErrorBoundaryState> {
  state: MFErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): MFErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: MFErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return this.props.fallbackRender(this.state.error);
    }
    return this.props.children;
  }
}
