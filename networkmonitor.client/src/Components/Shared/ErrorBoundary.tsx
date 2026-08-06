/**
 * Last line of defense: catches render-time exceptions from any page and
 * shows a recoverable error card instead of React's blank white screen.
 * Keyed remounting from App (location.pathname) lets navigation clear it.
 */
import { Component } from 'react';
import type { ReactNode } from 'react';
import './Shared.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state" data-testid="error-boundary">
          <i className="bi bi-emoji-dizzy" />
          <h5>Something went wrong rendering this page</h5>
          <p>{this.state.error.message}</p>
          <button type="button" className="btn btn-accent" onClick={() => this.setState({ error: null })}>
            <i className="bi bi-arrow-clockwise me-1" />
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
