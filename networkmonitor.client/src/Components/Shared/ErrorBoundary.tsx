/**
 * Last line of defense: catches render-time exceptions from any page, reports
 * them, and shows a recoverable error card instead of React's blank white
 * screen. Keyed remounting from App (location.pathname) lets navigation clear
 * it.
 *
 * A render crash is reported at level "fatal" because it is categorically
 * worse than a failed request: the user saw nothing at all. Reporting happens
 * in componentDidCatch: the commit-phase hook, rather than in
 * getDerivedStateFromError, which React may call more than once and which must
 * stay side-effect free.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { reportError } from '../../services/errorLogger';
import './Shared.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * A class component because error boundaries have no hook equivalent. React
 * exposes this behaviour only through getDerivedStateFromError and
 * componentDidCatch, so this is not a style choice that can be modernised away.
 *
 * It only catches exceptions thrown during render, lifecycle and constructors
 * of its subtree. Errors inside event handlers and promise rejections never
 * reach it; those go through the api layer and errorLogger instead.
 *
 * Once tripped it stays tripped: nothing here clears `error`, so recovery is
 * either the Reload button or App remounting it on a route change.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack says *which* subtree died, far more actionable than
    // the JS stack alone, which usually bottoms out inside React internals.
    // errorLogger is fire-and-forget, so this never delays the fallback paint.
    reportError(error, {
      level: 'fatal',
      path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
    if (info.componentStack) {
      // Kept in the console for local debugging; the server copy has the stack.
      console.error('Render error component stack:', info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state" data-testid="error-boundary">
          <i className="bi bi-emoji-dizzy" />
          <h5>Something went wrong rendering this page</h5>
          <p>{this.state.error.message}</p>
          <p className="error-boundary-note">
            This has been logged. Admins can review it under Admin → Error Logs.
          </p>
          <div className="error-boundary-actions">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => window.location.reload()}
              data-testid="error-boundary-reload"
            >
              <i className="bi bi-arrow-clockwise me-1" />
              Reload
            </button>
            {/* Full navigation, not a router link: the router tree is exactly
                what just failed, so a fresh document is the reliable escape. */}
            <a className="btn btn-ghost" href="/" data-testid="error-boundary-home">
              <i className="bi bi-house me-1" />
              Back to dashboard
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
